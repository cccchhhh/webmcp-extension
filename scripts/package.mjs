import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
await rm('dist/webmcp-extension.zip', { force: true });
execFileSync('zip', ['-qr', '../webmcp-extension.zip', '.'], { cwd: 'dist/extension' });
console.log('dist/webmcp-extension.zip');
