// Bundles the server (and the workspace `@taazastream/shared` package) into dist/.
// npm dependencies stay external and are loaded from node_modules at runtime.
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
].filter((d) => !d.startsWith('@taazastream/'));

await rm(new URL('./dist', import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: {
    index: 'src/index.ts',
    'cli/backup': 'src/cli/backup.ts',
    'cli/reset-admin': 'src/cli/reset-admin.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external: [...external, 'pino-pretty'],
  banner: {
    // Allow bundled CommonJS helpers to use require() inside an ES module.
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
