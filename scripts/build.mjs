import { build as viteBuild } from 'vite';
import vue from '@vitejs/plugin-vue';
import { build, context } from 'esbuild';
import { mkdir, rm, copyFile, writeFile } from 'node:fs/promises';
const watch = process.argv.includes('--watch');
await rm('dist/extension', { recursive: true, force: true });
await mkdir('dist/extension', { recursive: true });
await viteBuild({
  root: 'apps/extension',
  base: './',
  plugins: [vue()],
  build: {
    outDir: '../../dist/extension',
    emptyOutDir: false,
    watch: watch ? {} : null,
    rollupOptions: { input: 'apps/extension/sidepanel.html' },
  },
});
for (const [entry, out, format] of [
  ['background/index', 'background', 'esm'],
  ['content/index', 'content', 'iife'],
  ['validation/worker', 'validator', 'iife'],
  ['validation/offscreen', 'offscreen', 'iife'],
]) {
  const options = {
    entryPoints: [`apps/extension/src/${entry}.ts`],
    outfile: `dist/extension/${out}.js`,
    bundle: true,
    format,
    target: 'chrome116',
    minify: !watch,
  };
  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
  } else await build(options);
}
await copyFile('apps/extension/manifest.json', 'dist/extension/manifest.json');
await writeFile(
  'dist/extension/offscreen.html',
  '<!doctype html><html><head><meta charset="utf-8"><title>Schema validator</title></head><body><script src="offscreen.js"></script></body></html>',
);
