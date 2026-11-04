/**
 * Static asset staging for the zero-bundler build.
 *
 * TypeScript compilation is done by tsc (see tools/build.ps1) because this
 * sandbox forbids a child process from capturing another process's output, and
 * every bundler needs exactly that. This script only copies files.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const VENDOR_FILES = [
  ['node_modules/three/build/three.module.js', 'vendor/three.module.js'],
  ['node_modules/three/build/three.core.js', 'vendor/three.core.js'],
  ['node_modules/three/examples/jsm/postprocessing', 'vendor/jsm/postprocessing'],
  ['node_modules/three/examples/jsm/shaders', 'vendor/jsm/shaders'],
  ['node_modules/three/examples/jsm/utils', 'vendor/jsm/utils'],
  ['node_modules/three/LICENSE', 'vendor/three.LICENSE'],
];

function log(message) {
  process.stdout.write(`[build] ${message}\n`);
}

async function copyIfExists(from, to) {
  const source = path.join(root, from);
  if (!existsSync(source)) return false;
  const target = path.join(dist, to);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  return true;
}

await mkdir(dist, { recursive: true });

// Fresh shell assets each build; compiled JS lives in dist/src and is left alone
// unless --clean is passed.
const clean = process.argv.includes('--clean');
if (clean) {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
}

const copied = [];
for (const [from, to] of [
  ['index.html', 'index.html'],
  ['styles.css', 'styles.css'],
  ...VENDOR_FILES,
]) {
  if (await copyIfExists(from, to)) copied.push(to);
}
for (const dir of ['public', 'assets']) {
  if (await copyIfExists(dir, dir)) copied.push(dir + '/');
}

// A build stamp the page can show, and that a screenshot can verify.
const stamp = {
  builtAt: new Date().toISOString(),
  node: process.version,
};
await writeFile(path.join(dist, 'build.json'), JSON.stringify(stamp, null, 2));

// Keep the Cloudflare upload to the site itself: compiled tests and source maps
// are build artefacts, not part of the published app.
await writeFile(path.join(dist, '.assetsignore'), ['tests/', '*.map', '*.js.map', ''].join('\n'));

const index = await readFile(path.join(root, 'index.html'), 'utf8');
if (!index.includes('vendor/three.module.js')) {
  log('WARNING: index.html does not reference the vendored three.js module');
}

log(`staged ${copied.length} asset groups into dist/`);
log(`stamp ${stamp.builtAt}`);
