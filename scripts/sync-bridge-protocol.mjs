import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const header = '// Generated from @webmcp/bridge; run npm run sync:bridge-protocol. Do not edit.\n';
const output = fileURLToPath(new URL('../packages/protocol/bridge-v1.ts', import.meta.url));
export async function bridgeModulePath() {
  const module = process.env.WEBMCP_BRIDGE_MODULE;
  if (!module)
    throw Error(
      'Set WEBMCP_BRIDGE_MODULE to the absolute path of the built or installed bridge dist/index.js',
    );
  return resolve(module);
}
export async function syncProtocol(check = false) {
  const module = await bridgeModulePath();
  const source = await readFile(join(dirname(module), 'bridge-v1.ts'), 'utf8');
  const expected = header + source;
  if (check) {
    if ((await readFile(output, 'utf8')) !== expected)
      throw Error(
        'Bridge protocol differs: run npm run sync:bridge-protocol with the same WEBMCP_BRIDGE_MODULE',
      );
  } else await writeFile(output, expected);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await syncProtocol(process.argv.includes('--check'));
  console.log(
    process.argv.includes('--check') ? 'Bridge protocol matches' : 'Bridge protocol synchronized',
  );
}
