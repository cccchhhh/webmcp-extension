import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
// Prefer the explicitly selected browser or the installed Playwright revision.
// On macOS, reuse an existing Chrome for Testing cache when the package was updated.
export function browserExecutable() {
  if (process.env.BROWSER_EXECUTABLE) return process.env.BROWSER_EXECUTABLE;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = path.join(homedir(), 'Library/Caches/ms-playwright');
  if (process.platform === 'darwin' && existsSync(cache))
    for (const dir of readdirSync(cache)
      .filter((x) => /^chromium-\d+$/.test(x))
      .sort()
      .reverse()) {
      const file = path.join(
        cache,
        dir,
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      );
      if (existsSync(file)) return file;
    }
  return undefined;
}
