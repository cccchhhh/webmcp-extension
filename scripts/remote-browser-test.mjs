import { browserExecutable } from './browser-executable.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { syncProtocol, bridgeModulePath } from './sync-bridge-protocol.mjs';
const logger = { info() {}, warn() {}, error() {} };
await syncProtocol(true);
const artifactPrefix = 'bridge';
const {
  PersonalStore: LocalStore,
  config,
  startHttp,
} = await import(pathToFileURL(await bridgeModulePath()).href);
const profile = await mkdtemp(path.join(tmpdir(), 'webmcp-remote-browser-'));
const results = [];
const pass = (name) => {
  results.push(name);
  console.log('PASS:', name);
};
async function until(fn, label, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Timeout: ' + label);
}
const fixture = createServer(async (req, res) => {
  const file =
    new URL(req.url, 'http://localhost').pathname === '/tools.js' ? 'tools.js' : 'index.html';
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
  res.end(await readFile('tests/fixtures/' + file));
});
await new Promise((resolve, reject) => {
  fixture.once('error', reject);
  fixture.listen(0, '127.0.0.1', resolve);
});
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}`;
let context, app, client, cfg, store, panel;
try {
  const extension = path.join(profile, 'extension');
  await cp('dist/extension', extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  const launch = () =>
    chromium.launchPersistentContext(path.join(profile, 'browser'), {
      channel: 'chromium',
      executablePath: browserExecutable(),
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--enable-features=WebMCPTesting',
        '--enable-blink-features=WebMCP,WebMCPTesting',
      ],
      viewport: { width: 420, height: 850 },
    });
  context = await launch();
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  store = new LocalStore(path.join(profile, 'pairings.json'));
  const initialized = await store.init();
  const agent = initialized.agent;
  const device = { ...initialized.plugin, deviceId: '' };
  cfg = config({
    BRIDGE_CONFIG_FILE: store.file,
    TOOL_TIMEOUT_MS: '5000',
    SHUTDOWN_GRACE_MS: '20',
  });
  cfg.PORT = 0;
  app = await startHttp(cfg, store, logger);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  cfg.PUBLIC_BASE_URL = base;
  const connectClient = async () => {
    client = new Client({ name: 'extension-e2e', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
        requestInit: { headers: { Authorization: `Bearer ${agent.token}` } },
      }),
    );
  };
  await connectClient();
  const mcp = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return result.structuredContent || JSON.parse(result.content[0].text);
  };
  const pages = async () => (await mcp('list_webmcp_pages')).pages;
  const tools = async (pageId) => mcp('list_webmcp_tools', { pageId });
  const page = await context.newPage();
  await page.goto(fixtureUrl + '/?secret=not-uploaded#private');
  panel = await context.newPage();
  const errors = [];
  panel.on('pageerror', (e) => errors.push(e.message));
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.bringToFront();
  await panel.getByRole('button', { name: '重新发现' }).click();
  await panel.getByText('WebMCP 已就绪').waitFor();
  await panel.getByRole('button', { name: '连接设置', exact: true }).click();
  await panel.locator('#service-url').fill(base);
  assert.equal(await panel.locator('#connection-type').count(), 0);
  assert.equal(await panel.locator('#device-id').count(), 0);
  assert.equal(await panel.getByText('Agent 设备授权', { exact: true }).count(), 0);
  await panel.locator('#access-token').fill(device.token);
  await panel.getByRole('button', { name: '保存连接配置', exact: true }).click();
  await panel.getByText('连接配置已保存', { exact: true }).waitFor();
  assert.equal(await panel.locator('#access-token').inputValue(), '');
  await panel.getByRole('button', { name: '开启连接', exact: true }).click();
  await panel.getByTestId('remote-status').filter({ hasText: '已连接' }).waitFor();
  await until(async () => (await pages()).length === 1, 'default shared page');
  pass('真实票据认证；已发现页面自动共享；令牌输入清空');
  const command = (c) =>
    panel.evaluate(
      (c) =>
        new Promise((resolve, reject) => {
          const p = chrome.runtime.connect({ name: 'sidepanel' }),
            requestId = crypto.randomUUID();
          const t = setTimeout(() => {
            p.disconnect();
            reject(Error('command timeout'));
          }, 15000);
          p.onMessage.addListener((m) => {
            if (m.requestId === requestId) {
              clearTimeout(t);
              p.disconnect();
              m.type === 'ACK' ? resolve(null) : reject(Error(m.error));
            }
          });
          p.postMessage({ requestId, command: c });
        }),
      c,
    );
  const snapshot = () =>
    panel.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const port = chrome.runtime.connect({ name: 'sidepanel' });
          const timer = setTimeout(() => {
            port.disconnect();
            reject(Error('snapshot timeout'));
          }, 10000);
          port.onMessage.addListener((m) => {
            if (m.type === 'SNAPSHOT') {
              clearTimeout(timer);
              port.disconnect();
              resolve(m.snapshot);
            }
          });
        }),
    );
  const localPage = async (tabPage) => {
    const tab = await panel.evaluate(
      (url) => chrome.tabs.query({}).then((ts) => ts.find((t) => t.url === url)),
      tabPage.url(),
    );
    await command({ type: 'DISCOVER', tabId: tab.id });
    return (await snapshot()).pages[tab.id];
  };
  const share = async (tabPage, names = ['query_orders']) => {
    const p = await localPage(tabPage);
    await command({
      type: 'SET_SHARING',
      pageId: p.pageId,
      catalogVersion: p.catalogVersion,
      enabled: true,
      toolNames: names,
    });
    return p;
  };
  await panel.getByRole('tab', { name: 'Tools' }).click();
  await panel.getByRole('button', { name: /页面共享/ }).click();
  await panel.getByRole('checkbox', { name: '共享当前页面', exact: true }).uncheck();
  await until(async () => (await pages()).length === 0, 'disabled sharing');
  await panel.getByRole('checkbox', { name: '共享当前页面', exact: true }).check();
  await panel.getByRole('checkbox', { name: '授权 set_order_list_query', exact: true }).uncheck();
  await panel
    .getByRole('checkbox', { name: '授权 select_order_filter_options', exact: true })
    .uncheck();
  await panel.getByRole('checkbox', { name: '授权 query_orders', exact: true }).check();
  let remotePage = await until(async () => (await pages())[0], 'shared page');
  let catalog = await until(async () => {
    const c = await tools(remotePage.pageId);
    return c.tools?.length === 1 ? c : false;
  }, 'shared tool');
  assert.equal(catalog.tools.length, 1);
  assert.equal(catalog.tools[0].name, 'query_orders');
  assert(!remotePage.url.includes('?') && !remotePage.url.includes('#'));
  const invoke = async (rp, cat, args) =>
    mcp('call_webmcp_tool', {
      pageId: rp.pageId,
      catalogVersion: cat.catalogVersion,
      toolName: 'query_orders',
      arguments: args,
    });
  let result = await invoke(remotePage, catalog, { query: 'remote native', delay: 20 });
  assert.equal(result.execution, 'returned');
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 1);
  assert((await snapshot()).calls.some((c) => c.source === 'agent' && c.execution === 'returned'));
  pass('共享 UI → MCP 发现 → 原生工具执行 → 结果及 Agent 历史；URL 去除隐私参数');
  // Manual invocation uses the native version even after remote permission changes.
  const lp = await localPage(page);
  await command({
    type: 'INVOKE',
    pageId: lp.pageId,
    catalogVersion: lp.catalogVersion,
    toolName: 'query_orders',
    arguments: { query: 'manual', delay: 20 },
  });
  await until(async () => !(await snapshot()).locks[lp.pageId], 'manual settle');
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 2);
  pass('远程授权版本与原生版本分离，本地调用保持可用');
  const running = invoke(remotePage, catalog, { query: 'busy', delay: 1200 });
  await until(
    async () => (await page.evaluate(() => window.fixtureCalls.length)) === 3,
    'running call',
  );
  await assert.rejects(
    command({
      type: 'INVOKE',
      pageId: lp.pageId,
      catalogVersion: lp.catalogVersion,
      toolName: 'query_orders',
      arguments: {},
    }),
    /PAGE_BUSY/,
  );
  await running;
  pass('Agent 与手动调用共用文档执行锁');
  // Close the UI; the background still executes.
  await panel.close();
  result = await invoke(remotePage, catalog, { query: 'panel closed' });
  assert.equal(result.execution, 'returned');
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  pass('关闭侧边栏不影响远程执行');
  const page2 = await context.newPage();
  await page2.goto(fixtureUrl + '/second');
  await share(page2);
  const two = await until(async () => {
    const p = await pages();
    return p.length === 2 ? p : false;
  }, 'two pages');
  const remote2 = two.find((p) => p.pageId !== remotePage.pageId),
    cat2 = await tools(remote2.pageId);
  await invoke(remote2, cat2, { query: 'second' });
  assert.equal(await page2.evaluate(() => window.fixtureCalls.length), 1);
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 4);
  pass('两标签页同名工具正确隔离');
  const oldPageId = remotePage.pageId;
  const beforeRestart = await page.evaluate(() => window.fixtureCalls.length);
  const inFlight = invoke(remotePage, catalog, { query: 'restart', delay: 1800 });
  await until(
    async () => (await page.evaluate(() => window.fixtureCalls.length)) === beforeRestart + 1,
    'restart running',
  );
  const cdp = await context.newCDPSession(panel);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  result = await inFlight;
  assert.equal(result.execution, 'unknown');
  await command({ type: 'GET_SNAPSHOT' });
  remotePage = await until(
    async () => (await pages()).find((p) => p.url === fixtureUrl + '/' && p.pageId !== oldPageId),
    'worker reconnect',
  );
  await until(async () => Object.keys((await snapshot()).locks).length === 0, 'recovered unlock');
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), beforeRestart + 1);
  pass('后台执行中重启：结果未知，恢复文档锁，不重放调用');
  // Simulate a network loss by terminating only this isolated server's sockets.
  const beforeLoss = await page.evaluate(() => window.fixtureCalls.length),
    beforeLossId = remotePage.pageId;
  for (const ws of app.gateway.wss.clients) ws.terminate();
  remotePage = await until(
    async () =>
      (await pages()).find((p) => p.url === fixtureUrl + '/' && p.pageId !== beforeLossId),
    'network reconnect',
  );
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), beforeLoss);
  pass('连接中断后重连并重新注册，不重放业务操作');
  // Restart the actual service with the same isolated pairings.
  await client.close();
  await app.close();
  cfg.PORT = Number(new URL(base).port);
  store = new LocalStore(path.join(profile, 'pairings.json'));
  app = await startHttp(cfg, store, logger);
  await connectClient();
  remotePage = await until(
    async () => (await pages()).find((p) => p.url === fixtureUrl + '/'),
    'service restart',
  );
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), beforeLoss);
  pass('服务重启后恢复共享目录，不重放调用');
  catalog = await tools(remotePage.pageId);
  const revoking = invoke(remotePage, catalog, { query: 'revoked', delay: 1000 });
  await until(
    async () => (await page.evaluate(() => window.fixtureCalls.length)) === beforeLoss + 1,
    'revocation running',
  );
  const current = await localPage(page);
  await command({
    type: 'SET_SHARING',
    pageId: current.pageId,
    catalogVersion: current.catalogVersion,
    enabled: false,
    toolNames: [],
  });
  result = await revoking;
  assert.equal(result.execution, 'unknown');
  assert.equal(result.rawResult, undefined);
  await until(
    async () => !(await pages()).some((p) => p.pageId === remotePage.pageId),
    'revoked page removed',
  );
  pass('执行中撤销共享立即阻止访问，原始业务结果不返回');
  await share(page);
  remotePage = await until(
    async () => (await pages()).find((p) => p.url === fixtureUrl + '/'),
    'reshare',
  );
  await page.evaluate(() =>
    navigator.modelContext.registerTool({
      name: 'new_tool',
      description: 'new',
      inputSchema: { type: 'object' },
      execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    }),
  );
  await until(async () => {
    const s = await snapshot();
    const p = Object.values(s.pages).find((p) => p.pageId === current.pageId);
    return p?.tools.length === 4 && s.sharing[p.pageId]?.authorizedToolNames.length === 0;
  }, 'changed catalog clears grants');
  pass('新增工具及目录变化不继承授权');
  await share(page);
  await page.evaluate(() => history.pushState({}, '', '/spa'));
  await until(
    async () =>
      Object.values((await snapshot()).sharing).some(
        (s) => s.enabled && s.authorizedToolNames.length === 0,
      ),
    'spa invalidation',
  );
  await page.reload();
  await until(
    async () => !(await pages()).some((p) => p.url === fixtureUrl + '/'),
    'navigation removes old target',
  );
  pass('SPA 变更清空工具授权；刷新移除旧页面');
  const liveSecond = await until(
    async () => (await pages()).find((p) => p.url === fixtureUrl + '/second'),
    'second live',
  );
  const liveCatalog = await tools(liveSecond.pageId);
  const secondBefore = await page2.evaluate(() => window.fixtureCalls.length);
  result = await invoke(liveSecond, liveCatalog, { query: 'deadline', delay: 6200 });
  assert.equal(result.execution, 'unknown');
  const blocked = await invoke(liveSecond, liveCatalog, { query: 'must not execute' });
  assert.equal(blocked.execution, 'rejected');
  assert.equal(blocked.errorCode, 'PAGE_BUSY');
  await until(async () => Object.keys((await snapshot()).locks).length === 0, 'late result unlock');
  assert.equal(await page2.evaluate(() => window.fixtureCalls.length), secondBefore + 1);
  pass('远程真实截止时间与取消：未知结果保留锁，晚到结果解锁，不重复执行');
  await context.close();
  context = await launch();
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await until(
    async () => (await snapshot()).remote.status === 'connected',
    'browser restart auto-connect',
  );
  assert.deepEqual((await snapshot()).sharing, {});
  assert.equal((await pages()).length, 0);
  assert.equal((await snapshot()).calls.length, 0);
  assert.equal((await snapshot()).remote.hasToken, true);
  pass('浏览器完全退出再启动：凭证恢复连接，共享与历史不恢复');
  await command({ type: 'DISCONNECT_REMOTE' });
  await until(async () => (await pages()).length === 0, 'manual disconnect');
  await command({
    type: 'SAVE_REMOTE',
    settings: {
      baseUrl: base,
      connectionType: 'bridge',
      mode: 'local',
      deviceId: device.deviceId,
      token: 'invalid-test-token',
    },
  });
  await command({ type: 'CONNECT_REMOTE' });
  await until(async () => (await snapshot()).remote.status === 'attention', 'bad token');
  assert.equal((await snapshot()).remote.enabled, false);
  await command({ type: 'CLEAR_REMOTE' });
  assert.deepEqual((await snapshot()).sharing, {});
  pass('错误令牌停止重连；清除凭证同时清除共享');
  assert.deepEqual(errors, []);
  await panel.getByRole('button', { name: '连接设置', exact: true }).click();
  await mkdir('docs/screenshots', { recursive: true });
  for (const width of [360, 420]) {
    await panel.setViewportSize({ width, height: 1000 });
    assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await panel.screenshot({
      path: `docs/screenshots/${artifactPrefix}-settings-${width}.png`,
      fullPage: true,
    });
    await panel.locator('main').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await panel.screenshot({
      path: `docs/screenshots/${artifactPrefix}-access-${width}.png`,
      fullPage: true,
    });
    await panel.locator('main').evaluate((el) => (el.scrollTop = 0));
  }
  await writeFile(
    `docs/${artifactPrefix}-browser-results.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: context.browser()?.version(),
        installedPackage: !!process.env.WEBMCP_BRIDGE_MODULE,
        results,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Remote browser checks:', results.length);
} finally {
  await client?.close().catch(() => {});
  await app?.close().catch(() => {});
  await context?.close();
  await new Promise((r) => fixture.close(r));
  await rm(profile, { recursive: true, force: true });
}
