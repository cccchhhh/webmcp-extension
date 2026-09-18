import { browserExecutable } from './browser-executable.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, cp, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const requests = [];
const server = createServer(async (req, res) => {
  if (req.url === '/v1/chat/completions') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    requests.push(data);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const frame = (delta, finish_reason = null) =>
      res.write(
        'data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] }) + '\n\n',
      );
    const last = data.messages.at(-1);
    if (last.content === 'slow stream') {
      frame({ content: '正在接收慢流' });
      const timer = setTimeout(() => {
        frame({}, 'stop');
        res.end('data: [DONE]\n\n');
      }, 5000);
      res.on('close', () => clearTimeout(timer));
      return;
    }
    if (data.tools?.length && last.role !== 'tool') {
      frame({ content: '我将查询页面数据。' });
      frame(
        {
          tool_calls: [
            {
              index: 0,
              id: 'provider_' + requests.length,
              type: 'function',
              function: {
                name: data.tools[0].function.name,
                arguments: '{"query":"AI Chat 验证"}',
              },
            },
          ],
        },
        'tool_calls',
      );
    } else {
      frame(
        {
          content:
            last.role === 'tool'
              ? '已根据工具返回完成总结。\n\n## 订单摘要\n\n**处理完成**，以下为页面返回。\n\n- 第一项\n- 第二项\n\n> 仅供测试\n\n| 字段 | 内容 |\n| --- | --- |\n| 示例 | 很长的表格内容用于验证局部滚动而不撑宽整个侧栏 |\n\n```js\nconst result = "' +
                'x'.repeat(100) +
                '";\n```\n\n[查看说明](https://example.com)\n\n![图片替代文字](https://remote.example/image.png)\n\n<img src=x onerror=alert(1)>'
              : '连接成功。',
        },
        'stop',
      );
    }
    res.end('data: [DONE]\n\n');
    return;
  }
  const file = req.url === '/' ? 'index.html' : req.url === '/tools.js' ? 'tools.js' : null;
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    'Content-Type',
    file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8',
  );
  res.end(await readFile('tests/fixtures/' + file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const profile = await mkdtemp(path.join(tmpdir(), 'webmcp-chat-'));
let context;
try {
  const extension = path.join(profile, 'extension');
  await cp('dist/extension', extension, { recursive: true });
  const manifest = JSON.parse(await readFile(extension + '/manifest.json', 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(extension + '/manifest.json', JSON.stringify(manifest));
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
    viewport: { width: 420, height: 900 },
  });
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(origin);
  const panel = await context.newPage();
  const errors = [];
  panel.on('pageerror', (e) => errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.bringToFront();
  await panel.getByRole('button', { name: '重新发现', exact: true }).click();
  await panel.getByText('WebMCP 已就绪', { exact: true }).waitFor();
  await panel.getByRole('tab', { name: 'Settings' }).click();
  await panel.locator('#profile-name').fill('本地验证模型');
  await panel.locator('#base-url').fill(origin + '/v1');
  await panel.locator('#model-id').fill('fixture-model');
  await panel.locator('#api-key').fill('test-key-not-real');
  await panel.getByRole('button', { name: '保存配置', exact: true }).click();
  await panel.getByText('模型配置已保存', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '测试连接', exact: true }).click();
  await panel
    .getByText('文本流连接成功；工具能力需通过页面工具调用验证', { exact: true })
    .waitFor();
  await panel.getByRole('tab', { name: 'AIChat' }).click();
  await panel.waitForFunction(
    () => !document.querySelector('textarea[aria-label="对话内容"]').disabled,
  );
  assert.equal(await panel.locator('.chat-context').count(), 0);
  assert.equal(await panel.locator('.tool-scope').evaluate((el) => el.open), false);
  await panel.getByText('已授权 3 个工具 · 自动执行', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 0, '仅授权不自动发起任务');
  await panel.getByRole('textbox', { name: '对话内容' }).fill('**我的任务**：查询订单并总结');
  await panel.getByRole('button', { name: '发送消息', exact: true }).click();
  await panel.getByText('已根据工具返回完成总结。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 1);
  assert.equal(await panel.locator('.message.user .message-label,.message.user strong').count(), 0);
  assert.equal(
    await panel.locator('.assistant-markdown img,.assistant-markdown script').count(),
    0,
  );
  for (const selector of ['h2', 'strong', 'ul', 'blockquote', 'table', 'pre code'])
    assert(await panel.locator('.assistant-markdown ' + selector).count());
  assert.equal(
    await panel.locator('.assistant-markdown a').first().getAttribute('rel'),
    'noopener noreferrer',
  );
  assert(requests.some((r) => r.tools?.length === 3 && r.messages.some((m) => m.role === 'tool')));
  await mkdir('docs/screenshots', { recursive: true });
  for (const width of [360, 420, 1000]) {
    await panel.setViewportSize({ width, height: 900 });
    assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await panel.screenshot({ path: `docs/screenshots/chat-${width}.png` });
  }
  await panel.getByRole('button', { name: '查看原始调用记录 →' }).first().click();
  await panel.getByText('AIChat调用', { exact: true }).first().waitFor();
  const stored = await panel.evaluate(() => chrome.storage.session.get(null));
  assert(!JSON.stringify(stored.snapshot).includes('test-key-not-real'));
  assert(!JSON.stringify(stored.chatSession).includes('test-key-not-real'));
  await panel.getByRole('tab', { name: 'AIChat' }).click();
  await panel.locator('.tool-scope summary').click();
  await panel.getByRole('button', { name: '撤销授权', exact: true }).click();
  await panel.waitForFunction(
    () => document.querySelector('textarea[aria-label="对话内容"]').disabled,
  );
  await panel.getByRole('tab', { name: 'Help' }).click();
  await panel.getByRole('tab', { name: 'AIChat' }).click();
  assert(await panel.getByRole('textbox', { name: '对话内容' }).isDisabled());
  await panel.reload();
  await page.bringToFront();
  await panel.getByRole('tab', { name: 'AIChat' }).click();
  await panel.getByText('本会话授权已撤销，可手动恢复。', { exact: true }).waitFor();
  assert(await panel.getByRole('textbox', { name: '对话内容' }).isDisabled());
  assert.equal(
    await page.evaluate(() => window.fixtureCalls.length),
    1,
    '重开不重放工具或恢复已撤销授权',
  );
  await panel.locator('.tool-scope summary').click();
  for (const name of ['select_order_filter_options', 'set_order_list_query'])
    await panel
      .locator('.tool-scope .check-row')
      .filter({ hasText: name })
      .locator('input')
      .uncheck();
  await panel.getByRole('checkbox', { name: '本次会话自动执行已选工具' }).uncheck();
  await panel.getByRole('button', { name: '应用并恢复授权', exact: true }).click();
  await panel.getByText('已授权 1 个工具 · 逐次确认', { exact: true }).waitFor();
  await panel.getByRole('textbox', { name: '对话内容' }).fill('查询订单并确认');
  await panel.getByRole('button', { name: '发送消息', exact: true }).click();
  await panel.getByRole('button', { name: '允许执行', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 1);
  await panel.getByRole('tab', { name: 'Help' }).click();
  await panel.getByRole('tab', { name: 'AIChat' }).click();
  await panel.getByRole('button', { name: '允许执行', exact: true }).click();
  await panel.getByText('已根据工具返回完成总结。', { exact: true }).nth(1).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 2);
  await panel.getByRole('tab', { name: 'Settings' }).click();
  await panel.getByRole('button', { name: '＋ 新增模型' }).click();
  await panel.locator('#profile-name').fill('第二个模型');
  await panel.locator('#base-url').fill(origin + '/v1');
  await panel.locator('#model-id').fill('fixture-model-2');
  await panel.locator('#api-key').fill('another-test-key');
  await panel.getByRole('button', { name: '保存配置', exact: true }).click();
  await panel.getByText('模型配置已保存', { exact: true }).waitFor();
  await panel.getByRole('tab', { name: 'AIChat' }).click();
  await panel
    .getByRole('combobox', { name: '聊天模型' })
    .selectOption({ label: '第二个模型 · fixture-model-2' });
  await panel.getByText('说出目标，', { exact: false }).waitFor();
  await panel.waitForFunction(
    () => !document.querySelector('textarea[aria-label="对话内容"]').disabled,
  );
  await panel.getByRole('textbox', { name: '对话内容' }).fill('第二个模型查询订单');
  await panel.getByRole('button', { name: '发送消息', exact: true }).click();
  await panel.getByText('已根据工具返回完成总结。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 3);
  await panel.getByRole('textbox', { name: '对话内容' }).fill('slow stream');
  await panel.getByRole('button', { name: '发送消息', exact: true }).click();
  await panel.getByText('正在接收慢流', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '停止生成', exact: true }).click();
  await panel.getByRole('button', { name: '发送消息', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 3);
  await panel.getByRole('tab', { name: 'Settings' }).click();
  await panel.getByRole('button', { name: '清除全部模型密钥' }).click();
  await panel.getByText('已清除全部模型密钥', { exact: true }).waitFor();
  assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile(
    'docs/chat-browser-results.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: context.browser()?.version(),
        tests: [
          '模型保存与连接测试',
          '默认全选并自动执行原生工具',
          '撤销跨视图和重开保持，手动修改范围与确认模式',
          'Markdown 与 HTML/图片隔离，用户消息无身份标签',
          '跨视图运行保持',
          '工具结果回传与总结',
          '360/420/1000 无横向溢出',
          '凭证不进入记录',
          '重新打开不自动重试',
          '第二模型自动工具闭环',
          '停止慢流不提交工具',
          '清除所有模型密钥',
        ],
        provider: 'local controlled SSE fixture; real provider pending',
        passed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS AIChat: default auto grant/execution, revocation, manual approval, Markdown and recovery',
  );
} finally {
  await context?.close();
  await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true });
}
