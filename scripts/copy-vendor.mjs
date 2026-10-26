// Копирует Three.js и используемые addons (с их относительными зависимостями) в dist/vendor/three.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'node_modules/three');
const OUT = join(ROOT, 'dist/vendor/three');

const ADDONS = [
  'controls/OrbitControls.js',
  'postprocessing/EffectComposer.js',
  'postprocessing/RenderPass.js',
  'postprocessing/GTAOPass.js',
  'postprocessing/OutputPass.js',
  'postprocessing/SMAAPass.js',
  'postprocessing/UnrealBloomPass.js',
  'postprocessing/BokehPass.js',
  'objects/Sky.js',
  'geometries/RoundedBoxGeometry.js',
  'utils/BufferGeometryUtils.js',
  'loaders/GLTFLoader.js',
  'exporters/GLTFExporter.js',
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'addons'), { recursive: true });
for (const f of ['three.module.min.js', 'three.core.min.js', 'three.module.js', 'three.core.js']) copyFileSync(join(SRC, 'build', f), join(OUT, f));
copyFileSync(join(SRC, 'LICENSE'), join(OUT, 'LICENSE'));

const seen = new Set();
function copyAddon(rel) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const src = join(SRC, 'examples/jsm', rel);
  const text = readFileSync(src, 'utf8');
  const dst = join(OUT, 'addons', rel);
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, text);
  for (const m of text.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const dep = relative(join(SRC, 'examples/jsm'), resolve(dirname(src), m[1]));
    copyAddon(dep);
  }
}
ADDONS.forEach(copyAddon);
console.log(`three ${JSON.parse(readFileSync(join(SRC, 'package.json'))).version}: ${seen.size} addons → dist/vendor/three`);
