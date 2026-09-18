import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const profile = await mkdtemp(path.join(tmpdir(), 'webmcp-fixture-ui-'));
let context;
try {
  const extension = path.join(profile, 'extension');
  await cp('dist/extension', extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json')));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--enable-features=WebMCPTesting',
      '--enable-blink-features=WebMCP,WebMCPTesting',
    ],
    viewport: { width: 1200, height: 1000 },
  });
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:4177');
  await page.getByText('原生 WebMCP 已就绪 · 已注册 3 个工具').waitFor();
  assert.equal(await page.locator('#orders tr').count(), 4);
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/fixture-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 360, height: 850 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'docs/screenshots/fixture-mobile.png', fullPage: true });
  const panel = await context.newPage();
  panel.on('pageerror', (e) => errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.bringToFront();
  await panel.getByRole('button', { name: '重新发现' }).click();
  await panel.getByText('WebMCP 已就绪').waitFor();
  await panel.getByRole('button', { name: /set_order_list_query/ }).click();
  await panel.getByRole('checkbox', { name: '传入 query', exact: true }).check();
  await panel.getByLabel('query', { exact: true }).fill('键盘');
  for (const width of [360, 420]) {
    await panel.setViewportSize({ width, height: 850 });
    assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await panel.screenshot({ path: `docs/screenshots/argument-form-${width}.png`, fullPage: true });
  }
  await panel.getByRole('button', { name: 'JSON', exact: true }).click();
  assert.deepEqual(JSON.parse(await panel.locator('#arguments').inputValue()), { query: '键盘' });
  await panel.getByRole('button', { name: '表单', exact: true }).click();
  await panel.getByRole('button', { name: '执行工具', exact: true }).click();
  await panel.getByText('已返回', { exact: true }).waitFor();
  assert.equal(await page.locator('#orders tr').count(), 2);
  assert.equal(await page.locator('#query').inputValue(), '键盘');
  await panel.getByRole('button', { name: '返回工具' }).click();
  await panel.getByRole('button', { name: /select_order_filter_options/ }).click();
  await panel.getByRole('checkbox', { name: '传入 labels', exact: true }).check();
  await panel.getByLabel('labels', { exact: true }).fill('[broken');
  await panel.getByRole('button', { name: '执行工具', exact: true }).click();
  await panel.getByText('请输入有效 JSON', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 1);
  await panel.getByRole('button', { name: '返回工具' }).click();
  await panel.getByRole('button', { name: /set_order_list_query/ }).click();
  assert.equal(await panel.getByLabel('query', { exact: true }).inputValue(), '键盘');
  await panel.getByRole('button', { name: '返回工具' }).click();
  await panel.getByRole('button', { name: /select_order_filter_options/ }).click();
  assert.equal(await panel.getByLabel('labels', { exact: true }).inputValue(), '[broken');
  await panel.getByLabel('labels', { exact: true }).fill('["待支付"]');
  await panel.getByRole('button', { name: '执行工具', exact: true }).click();
  await panel.getByText('已返回', { exact: true }).waitFor();
  assert.equal(await page.locator('#orders tr').count(), 0);
  await panel.getByLabel('labels', { exact: true }).fill('["已支付"]');
  await panel.getByRole('checkbox', { name: '传入 fail', exact: true }).check();
  await panel.getByLabel('fail', { exact: true }).selectOption('true');
  await panel.getByRole('button', { name: '执行工具', exact: true }).click();
  await panel.getByText('业务错误', { exact: true }).waitFor();
  assert.equal(await page.locator('#orders tr').count(), 0);
  assert.equal(await page.locator('.log').count(), 3);
  await panel.getByRole('button', { name: '返回工具' }).click();
  await panel.getByRole('button', { name: /query_orders/ }).click();
  await panel.getByRole('checkbox', { name: '传入 delay', exact: true }).check();
  await panel.getByLabel('delay', { exact: true }).fill('1200');
  await panel.getByRole('button', { name: '执行工具', exact: true }).click();
  await panel.getByText('执行中', { exact: true }).waitFor();
  assert(await panel.getByRole('button', { name: '页面忙碌 / 等待确认' }).isDisabled());
  await panel.getByText('已返回', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 4);
  await panel.getByLabel('delay', { exact: true }).focus();
  await panel.keyboard.press('Tab');
  assert(await panel.evaluate(() => document.activeElement !== document.body));
  await page.getByRole('button', { name: '暂停工具注册' }).click();
  await panel.getByRole('button', { name: '返回工具' }).click();
  await panel.getByText('页面尚未注册工具').waitFor();
  await page.getByRole('button', { name: '重新注册工具' }).click();
  await panel.getByText('WebMCP 已就绪').waitFor();
  assert.equal(await panel.locator('.tool-card').count(), 3);
  await page.evaluate(() =>
    navigator.modelContext.registerTool({
      name: 'form_long_fields',
      description: '表单长文本验证',
      inputSchema: {
        type: 'object',
        properties: {
          ['long_field_'.repeat(20)]: {
            type: 'string',
            description: '<img src=x onerror=alert(1)> ' + '长描述'.repeat(80),
          },
        },
      },
      execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    }),
  );
  await panel.getByRole('button', { name: /form_long_fields/ }).click();
  for (const width of [360, 420]) {
    await panel.setViewportSize({ width, height: 850 });
    assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await panel.locator('.argument-fields img').count(), 0);
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: native registration, order query/filter UI, business error, call log, unregister/re-register, 360/420px form layout, text escaping, form/JSON sync, draft restoration, validation, single execution',
  );
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
