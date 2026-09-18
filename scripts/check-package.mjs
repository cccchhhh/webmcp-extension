import { readFile, readdir, access } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = 'dist/extension';
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
for (const file of [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  'content.js',
  'validator.js',
  'offscreen.html',
  'offscreen.js',
])
  await access(`${root}/${file}`);
assert.equal(manifest.manifest_version, 3);
assert(!manifest.host_permissions);
assert(!manifest.content_security_policy.extension_pages.includes('unsafe-eval'));
// CSP host-source grammar does not accept IPv6 literal hosts.
assert(
  !/\[[^\]]*:[^\]]*\]/.test(manifest.content_security_policy.extension_pages),
  'CSP 不支持 IPv6 字面地址来源，请使用 localhost',
);
for (const file of await readdir(root, { recursive: true })) {
  if (!/\.(js|html)$/.test(file)) continue;
  const text = await readFile(`${root}/${file}`, 'utf8');
  assert(!/\beval\s*\(|new Function\s*\(/.test(text), `${file}: 动态代码`);
  assert(!/https?:\/\/[^\s"']+\.js/.test(text), `${file}: 远程脚本`);
  assert(!/prototype:true|模拟登录|ORD-2026/.test(text), `${file}: 模拟代码`);
}
console.log('安装包结构、CSP 和模拟代码检查通过');
