// Автономная поставка: один HTML с кодом, стилями, Three.js, геометрией, картами и моделью (data URI).
// Результат: offline/VSEMDOM.html, offline/README.txt, лицензии, artifacts/VSEMDOM-local.zip, контрольные суммы.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OFF = join(ROOT, 'offline');
const ART = join(ROOT, 'artifacts');
mkdirSync(OFF, { recursive: true });
mkdirSync(ART, { recursive: true });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// 1. Бандл ES-модулей (Three.js и addons разрешаются при сборке из node_modules).
const result = await build({
  entryPoints: [join(DIST, 'app.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  target: ['es2022'],
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
});
let js = result.outputFiles[0].text;
// Безопасная вставка в <script>: последовательности закрытия и комментария.
js = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

// 2. Ресурсы как data URI (карты WebP, модель GLB).
const mime = { webp: 'image/webp', png: 'image/png', glb: 'model/gltf-binary', json: 'application/json' };
const assets = {};
for (const dir of ['assets/textures', 'assets/models']) {
  for (const f of readdirSync(join(DIST, dir))) {
    const ext = f.split('.').pop();
    if (!mime[ext] || f.startsWith('_') || ext === 'json') continue;
    const buf = readFileSync(join(DIST, dir, f));
    assets[`${dir}/${f}`] = `data:${mime[ext]};base64,${buf.toString('base64')}`;
  }
}
const assetsJson = JSON.stringify(assets).replace(/<\/script/gi, '<\\/script');

// 3. HTML: стили встроены, importmap и внешний модуль заменены встроенным кодом.
let html = readFileSync(join(DIST, 'index.html'), 'utf8');
const css = readFileSync(join(DIST, 'style.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="./style.css">', () => `<style>\n${css}\n</style>`);
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
html = html.replace('<script type="module" src="./app.js"></script>', () => `<script>window.__VSEMDOM_ASSETS__ = ${assetsJson};</script>\n<script type="module">\n${js}\n</script>`);
if (/<script[^>]+src=|<link[^>]+href="(?!data:)/.test(html)) throw new Error('В автономном HTML остались внешние ссылки');
const htmlBuf = Buffer.from(html, 'utf8');
writeFileSync(join(OFF, 'VSEMDOM.html'), htmlBuf);

// 4. Сопроводительные файлы и лицензии.
const threePkg = JSON.parse(readFileSync(join(ROOT, 'node_modules/three/package.json'), 'utf8'));
writeFileSync(join(OFF, 'THREE-LICENSE.txt'), readFileSync(join(ROOT, 'node_modules/three/LICENSE'), 'utf8'));
writeFileSync(join(OFF, 'THIRD-PARTY-LICENSES.txt'), `Сторонние компоненты автономной поставки VSEMDOM.COM

1. three.js ${threePkg.version} и addons (OrbitControls, EffectComposer, RenderPass, GTAOPass, OutputPass,
   SMAAPass, UnrealBloomPass, BokehPass, Sky, RoundedBoxGeometry, BufferGeometryUtils, GLTFLoader,
   GLTFExporter и их шейдеры) — лицензия MIT, текст: THREE-LICENSE.txt. Copyright © 2010–${new Date().getFullYear()} three.js authors.

2. Хвойные деревья построены собственным генератором проекта (dist/forest.js); EZ-Tree не используется.

3. Карты материалов, текстура хвои, модель подвесного унитаза и профили изготовлены скриптами
   scripts/blender/*.py в Blender ${'4.3'} (модуль bpy) и являются ресурсами проекта.
   Газон подобран по цветам лужайки на фотографии фасада владельца.

4. Blender (bpy) применяется только при пересборке ассетов и в поставку не входит
   (GNU GPL v2+; сами изготовленные файлы данных лицензией Blender не ограничиваются).
`);
writeFileSync(join(OFF, 'README.txt'), `VSEMDOM.COM — автономная версия конфигуратора дома 12 × 6,8 м с террасой

Запуск: распакуйте архив и откройте VSEMDOM.html в браузере с WebGL 2 (Chrome, Edge, Firefox, Safari 17+).
Установка Node.js, Python или Blender не нужна; интернет не требуется.

Режимы: «Снаружи» (фасады, кровля, терраса), «Внутри» (помещения, отделка, мебель, двери и потолок),
«Прогулка» (WASD/стрелки, мышь, E — дверь, Esc — пауза; на телефоне — джойстик).
Изменения сохраняются в браузере автоматически. Кнопка «Ссылка» формирует адрес с полной конфигурацией
(#r=1.…); для автономного файла это локальный путь с конфигурацией, а не публикация в интернете.
Кнопка с фотоаппаратом сохраняет кадр PNG 1800 × 1120.

Состав: VSEMDOM.html (код, стили, Three.js ${threePkg.version}, геометрия, карты, модель), README.txt,
THREE-LICENSE.txt, THIRD-PARTY-LICENSES.txt, SHA256SUMS.txt.
Сборка: ${new Date().toISOString().slice(0, 10)}, npm run package:offline.
`);

// 5. Контрольные суммы и ZIP из актуальных файлов.
const files = ['VSEMDOM.html', 'README.txt', 'THREE-LICENSE.txt', 'THIRD-PARTY-LICENSES.txt'];
const sums = files.map((f) => `${sha256(readFileSync(join(OFF, f)))}  ${f}`).join('\n') + '\n';
writeFileSync(join(OFF, 'SHA256SUMS.txt'), sums);
const zipPath = join(ART, 'VSEMDOM-local.zip');
if (existsSync(zipPath)) rmSync(zipPath);
execFileSync('zip', ['-X', '-q', '-9', zipPath, ...files, 'SHA256SUMS.txt'], { cwd: OFF });
// Проверка: HTML внутри ZIP байт в байт совпадает с проверенным файлом.
const fromZip = execFileSync('unzip', ['-p', zipPath, 'VSEMDOM.html'], { maxBuffer: 256 * 1024 * 1024 });
const same = Buffer.compare(fromZip, htmlBuf) === 0;
if (!same) throw new Error('HTML в ZIP не совпадает с offline/VSEMDOM.html');
const report = {
  date: new Date().toISOString(),
  three: threePkg.version,
  html: { path: 'offline/VSEMDOM.html', bytes: htmlBuf.length, sha256: sha256(htmlBuf) },
  zip: { path: 'artifacts/VSEMDOM-local.zip', bytes: readFileSync(zipPath).length, sha256: sha256(readFileSync(zipPath)) },
  htmlInZipIdentical: same,
  embeddedAssets: Object.keys(assets).length,
  jsBytes: js.length,
};
writeFileSync(join(ART, 'offline-checksums.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`offline/VSEMDOM.html ${(htmlBuf.length / 1e6).toFixed(2)} МБ, sha256 ${report.html.sha256}`);
console.log(`artifacts/VSEMDOM-local.zip ${(report.zip.bytes / 1e6).toFixed(2)} МБ, sha256 ${report.zip.sha256}; HTML в ZIP совпадает: ${same}`);
