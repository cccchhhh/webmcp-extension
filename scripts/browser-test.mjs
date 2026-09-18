import { browserExecutable } from './browser-executable.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const permissionOnly = process.argv.includes('--permission-only');
const profile = await mkdtemp(path.join(tmpdir(), 'webmcp-test-'));
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : pathname === '/tools.js' ? 'tools.js' : null;
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    'Content-Type',
    file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8',
  );
  res.end(await readFile(`tests/fixtures/${file}`));
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const fixtureUrl = `http://127.0.0.1:${server.address().port}`;
let context;
try {
  const extension = path.join(profile, 'extension');
  await cp('dist/extension', extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  if (!permissionOnly) manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {
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
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  console.log('BROWSER', context.browser()?.version(), 'EXTENSION', id);
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  console.log('FIXTURE', await page.locator('#status').innerText());
  const panel = await context.newPage();
  panel.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.bringToFront();
  await panel.getByRole('button', { name: '重新发现' }).click();
  await panel.waitForTimeout(1000);
  if (permissionOnly) {
    await panel.getByRole('button', { name: '允许访问当前站点' }).waitFor();
    assert.equal(await panel.locator('.tool-card').count(), 0);
    console.log('PASS: 正式 manifest 在未授权站点显示正确的按需授权入口');
  } else {
    await panel.getByText('WebMCP 已就绪').waitFor();
    const errors = [];
    panel.on('pageerror', (e) => errors.push(e.message));
    await mkdir('docs/screenshots', { recursive: true });
    for (const width of [360, 420, 1000]) {
      await panel.setViewportSize({ width, height: 850 });
      assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await panel.screenshot({ path: `docs/screenshots/home-${width}.png` });
    }
    await panel.setViewportSize({ width: 420, height: 850 });
    await panel.getByRole('button', { name: /query_orders/ }).click();
    await panel.getByRole('button', { name: 'JSON', exact: true }).click();
    assert.equal(await panel.locator('textarea').inputValue(), '{}');
    await panel.locator('textarea').fill('{broken');
    await panel.getByRole('button', { name: '校验参数', exact: true }).click();
    await panel.getByText('JSON 格式无效', { exact: false }).waitFor();
    await panel.locator('textarea').fill('{"delay": 1200, "query": "真实 API 测试"}');
    await panel.getByRole('button', { name: '执行工具', exact: true }).click();
    await panel.getByText('执行中', { exact: true }).waitFor({ timeout: 5000 });
    assert(await panel.getByRole('button', { name: '页面忙碌 / 等待确认' }).isDisabled());
    await panel.getByText('已返回', { exact: true }).waitFor();
    console.log('RESULT', await panel.locator('.result').innerText());
    assert.equal(await page.evaluate(() => window.fixtureCalls.length), 1);
    await panel.screenshot({ path: 'docs/screenshots/result-420.png' });
    await panel.getByRole('tab', { name: 'Tools' }).click();
    await panel.getByRole('button', { name: /set_order_list_query/ }).click();
    await panel.getByRole('button', { name: 'JSON', exact: true }).click();
    assert.equal(await panel.locator('textarea').inputValue(), '{}');
    assert.equal(await panel.locator('.result').count(), 0);
    await panel.locator('textarea').fill('{"fail":true}');
    await panel.getByRole('button', { name: '执行工具', exact: true }).click();
    await panel.getByText('业务错误', { exact: true }).waitFor();
    await panel.getByRole('button', { name: '会话记录', exact: true }).click();
    assert.equal(await panel.locator('.history-row').count(), 2);
    await panel.getByRole('button', { name: '连接设置', exact: true }).click();
    await panel.locator('#device').fill('测试浏览器');
    await panel.getByRole('button', { name: '保存名称' }).click();
    await panel.waitForFunction(() => document.querySelector('#device')?.value === '测试浏览器');
    await panel.getByRole('tab', { name: 'Tools' }).click();
    await panel.getByRole('button', { name: /页面共享/ }).click();
    assert(!(await panel.locator('input').first().isDisabled()));
    assert(await panel.locator('input').first().isChecked());
    await panel.getByRole('tab', { name: 'Tools' }).click();
    await panel.getByRole('button', { name: /query_orders/ }).click();
    await panel.getByRole('button', { name: 'JSON', exact: true }).click();
    assert.match(await panel.locator('textarea').inputValue(), /真实 API 测试/);
    await panel.locator('textarea').fill('{"delay":2500}');
    await panel.getByRole('button', { name: '执行工具', exact: true }).click();
    await panel.getByText('执行中', { exact: true }).waitFor({ timeout: 5000 });
    await panel.reload();
    await page.bringToFront();
    await panel.getByRole('button', { name: '重新发现' }).click();
    await panel.getByText('WebMCP 已就绪').waitFor();
    await panel.getByRole('button', { name: '会话记录', exact: true }).click();
    assert.equal(await panel.locator('.history-row').count(), 3);
    await panel.waitForFunction(
      () =>
        ![...document.querySelectorAll('.history-row')].some((el) =>
          el.textContent.includes('执行中'),
        ),
    );
    assert.equal(await page.evaluate(() => window.fixtureCalls.length), 3);

    // Stop only this isolated browser's workers; reconnect must recover the actual running call.
    await panel.getByRole('tab', { name: 'Tools' }).click();
    await panel.getByRole('button', { name: /query_orders/ }).click();
    await panel.getByRole('button', { name: 'JSON', exact: true }).click();
    await panel.locator('textarea').fill('{"delay":3000}');
    await panel.getByRole('button', { name: '执行工具', exact: true }).click();
    await panel.getByText('执行中', { exact: true }).waitFor();
    const cdp = await context.newCDPSession(panel);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await panel.getByText('已返回', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.fixtureCalls.length), 4);
    // SPA navigation invalidates the draft/catalog, without replaying a call.
    await page.evaluate(() => history.pushState({}, '', '/?route=changed'));
    await panel
      .getByRole('button', { name: '表单', exact: true })
      .filter({ visible: true })
      .waitFor();
    await panel.waitForFunction(
      () =>
        document.querySelector('.argument-modes button')?.getAttribute('aria-pressed') === 'true',
    );
    await panel.getByRole('button', { name: 'JSON', exact: true }).click();
    assert.equal(await panel.locator('#arguments').inputValue(), '{}');
    // Long native tool names and long results remain contained at narrow width.
    await page.evaluate(() =>
      navigator.modelContext.registerTool({
        name: 'long_tool_'.repeat(10),
        description: '长名称测试',
        inputSchema: { type: 'object' },
        execute: async () => ({ content: [{ type: 'text', text: 'x'.repeat(15000) }] }),
      }),
    );
    await panel.getByRole('tab', { name: 'Tools' }).click();
    await panel.getByRole('button', { name: /long_tool_/ }).waitFor();
    await panel.setViewportSize({ width: 360, height: 850 });
    await panel.getByRole('button', { name: /long_tool_/ }).click();
    await panel.getByRole('button', { name: '执行工具', exact: true }).click();
    await panel.getByText('已返回', { exact: true }).waitFor();
    assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await panel.screenshot({ path: 'docs/screenshots/long-result-360.png' });
    await panel.keyboard.press('Tab');
    assert(await panel.evaluate(() => document.activeElement !== document.body));
    // A navigation during execution cannot deliver the old result into the new document.
    await panel.getByRole('tab', { name: 'Tools' }).click();
    await panel.getByRole('button', { name: /query_orders/ }).click();
    await panel.getByRole('button', { name: 'JSON', exact: true }).click();
    await panel.locator('textarea').fill('{"delay":3000}');
    await panel.getByRole('button', { name: '执行工具', exact: true }).click();
    await panel.getByText('执行中', { exact: true }).waitFor();
    await page.reload();
    await panel.getByText('工具已失效', { exact: true }).waitFor();
    await panel.getByRole('button', { name: '会话记录', exact: true }).click();
    await panel.getByText('结果未知', { exact: true }).waitFor();

    // An expensive regular expression cannot keep the extension background blocked.
    const bounded = await panel.evaluate(() =>
      chrome.runtime.sendMessage({
        target: 'validator',
        job: { schema: { type: 'string', pattern: '^(a+)+$' }, value: 'a'.repeat(80) + '!' },
      }),
    );
    assert.equal(bounded.ok, false);
    assert.match(bounded.errors.join(' '), /500ms/);
    // Real 60-second deadline: keep the document locked until the original Promise settles.
    await panel.getByRole('tab', { name: 'Tools' }).click();
    await panel.getByRole('button', { name: /query_orders/ }).click();
    await panel.getByRole('button', { name: 'JSON', exact: true }).click();
    await panel.locator('textarea').fill('{"delay":65000}');
    await panel.getByRole('button', { name: '执行工具', exact: true }).click();
    await panel.getByText('执行中', { exact: true }).waitFor();
    console.log('WAITING: real 60s deadline and late result');
    await panel.getByText('结果未知', { exact: true }).waitFor({ timeout: 70000 });
    assert(await panel.getByRole('button', { name: '页面忙碌 / 等待确认' }).isDisabled());
    await panel.getByText('后续已返回', { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await page.evaluate(() => window.fixtureCalls.length), 1);
    assert.equal(errors.length, 0);
    console.log(
      'PASS: 原生发现、JSON 校验、单次执行、业务错误、结果隔离、草稿、侧边栏重载、设置、共享默认全部授权与 3 个宽度',
    );
    await writeFile(
      'docs/browser-results.json',
      JSON.stringify(
        {
          browser: context.browser()?.version(),
          date: new Date().toISOString(),
          nativeWebMCP: true,
          permission: 'fixture origin pregranted in temporary test copy',
          passed: [
            'discovery',
            'validation',
            'execution',
            'business-error',
            'result-isolation',
            'draft-isolation',
            'panel-reload',
            'settings',
            'sharing-default-all',
            'widths-360-420-1000',
            'worker-restart',
            'spa-invalidation',
            'long-results',
            'keyboard-focus',
            'navigation-unknown',
            'validation-budget',
            'real-timeout-lock',
            'late-result',
          ],
          errors,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await context?.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
