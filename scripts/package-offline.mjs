// Автономная поставка: один HTML с кодом, стилями, Three.js, данными, картами и моделью (data URI).
// Цели: участок (основная) — offline/Vsevolozhsk.html и artifacts/Vsevolozhsk-local.zip; дом базы —
// offline/VSEMDOM.html и artifacts/VSEMDOM-local.zip. Контрольные суммы — artifacts/offline-checksums.json.
// Запуск: npm run package:offline [-- --target site|base]
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
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const threePkg = JSON.parse(readFileSync(join(ROOT, 'node_modules/three/package.json'), 'utf8'));
const date = new Date().toISOString().slice(0, 10);

const TARGETS = {
  site: {
    html: 'index.html', entry: 'site-app.js', css: ['style.css', 'site.css'], name: 'Vsevolozhsk', title: 'Участок во Всеволожске',
    readme: () => `Участок во Всеволожске — автономная версия 3D-конфигуратора участка с тремя постройками

Запуск: распакуйте архив и откройте Vsevolozhsk.html в браузере с WebGL 2 (Chrome, Edge, Firefox, Safari 17+).
Установка Node.js, Python или Blender не нужна; интернет не требуется. Первая загрузка — несколько секунд.

Режимы: «Участок» (постройки, виды, фасады «Доска» / «Штукатурка и кирпич», солнце и время для Всеволожска),
«Внутри» (разрез построек, помещения, перестановка мебели в пределах помещения), «Прогулка» (WASD/стрелки,
мышь, Shift — быстрее, Esc — пауза; на телефоне — джойстик; двери открываются при подходе).
Изменения сохраняются в браузере автоматически. Кнопка «Ссылка» формирует адрес с состоянием (#s=1.…);
для автономного файла это локальный путь, а не публикация в интернете. Кнопка с фотоаппаратом сохраняет
кадр PNG 1800 × 1120.

Состав: Vsevolozhsk.html (код, стили, Three.js ${threePkg.version}, данные участка и построек, карты, модель),
README.txt, THREE-LICENSE.txt, THIRD-PARTY-LICENSES.txt, SHA256SUMS.txt.
Сборка: ${date}, npm run package:offline.
`,
  },
  base: {
    html: 'base-house.html', entry: 'base-app.js', css: ['style.css'], name: 'VSEMDOM', title: 'VSEMDOM.COM',
    readme: () => `VSEMDOM.COM — автономная версия конфигуратора дома 12 × 6,8 м с террасой (база проекта участка)

Запуск: распакуйте архив и откройте VSEMDOM.html в браузере с WebGL 2 (Chrome, Edge, Firefox, Safari 17+).
Установка Node.js, Python или Blender не нужна; интернет не требуется.

Режимы: «Снаружи» (фасады, кровля, терраса), «Внутри» (помещения, отделка, мебель, двери и потолок),
«Прогулка» (WASD/стрелки, мышь, E — дверь, Esc — пауза; на телефоне — джойстик).
Изменения сохраняются в браузере автоматически. Кнопка «Ссылка» формирует адрес с полной конфигурацией
(#r=1.…); для автономного файла это локальный путь с конфигурацией, а не публикация в интернете.
Кнопка с фотоаппаратом сохраняет кадр PNG 1800 × 1120.

Состав: VSEMDOM.html (код, стили, Three.js ${threePkg.version}, геометрия, карты, модель), README.txt,
THREE-LICENSE.txt, THIRD-PARTY-LICENSES.txt, SHA256SUMS.txt.
Сборка: ${date}, npm run package:offline.
`,
  },
};

// Ресурсы как data URI (карты WebP, модель GLB) — общие для обеих целей.
const mime = { webp: 'image/webp', png: 'image/png', glb: 'model/gltf-binary' };
const assets = {};
for (const dir of ['assets/textures', 'assets/models']) {
  for (const f of readdirSync(join(DIST, dir))) {
    const ext = f.split('.').pop();
    if (!mime[ext] || f.startsWith('_')) continue;
    assets[`${dir}/${f}`] = `data:${mime[ext]};base64,${readFileSync(join(DIST, dir, f)).toString('base64')}`;
  }
}
const assetsJson = JSON.stringify(assets).replace(/<\/script/gi, '<\\/script');

const licenses = `Сторонние компоненты автономной поставки

1. three.js ${threePkg.version} и addons (OrbitControls, EffectComposer, RenderPass, GTAOPass, OutputPass,
   SMAAPass, UnrealBloomPass, BokehPass, ShaderPass, Sky, RoundedBoxGeometry, BufferGeometryUtils, GLTFLoader
   и их шейдеры) — лицензия MIT, текст: THREE-LICENSE.txt. Copyright © 2010–${new Date().getFullYear()} three.js authors.

2. Деревья (сосна, ель, берёза) построены собственными генераторами проекта (dist/forest.js, dist/site-trees.js).

3. Карты материалов (доска фасада, штукатурка, кирпич, имитация бруса, ламинат, керамогранит, плитка,
   кровля, газон и др.), текстура хвои, модель подвесного унитаза и профили изготовлены скриптами
   scripts/blender/*.py в Blender 4.3 (модуль bpy) и являются ресурсами проекта.

4. Blender (bpy) применяется только при пересборке ассетов и в поставку не входит
   (GNU GPL v2+; сами изготовленные файлы данных лицензией Blender не ограничиваются).
`;

async function pack(id) {
  const T = TARGETS[id];
  // 1. Бандл ES-модулей (Three.js и addons разрешаются при сборке из node_modules).
  const result = await build({ entryPoints: [join(DIST, T.entry)], bundle: true, format: 'esm', minify: true, target: ['es2022'], write: false, legalComments: 'none', logLevel: 'warning' });
  // Безопасная вставка в <script>: последовательности закрытия и комментария.
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  // 2. HTML: стили встроены, importmap и внешний модуль заменены встроенным кодом.
  let html = readFileSync(join(DIST, T.html), 'utf8');
  for (const c of T.css) html = html.replace(`<link rel="stylesheet" href="./${c}">`, () => `<style>\n${readFileSync(join(DIST, c), 'utf8')}\n</style>`);
  html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
  html = html.replace(`<script type="module" src="./${T.entry}"></script>`, () => `<script>window.__VSEMDOM_ASSETS__ = ${assetsJson};</script>\n<script type="module">\n${js}\n</script>`);
  if (/<script[^>]+src=|<link[^>]+href="(?!data:)/.test(html)) throw new Error(`${T.name}: в автономном HTML остались внешние ссылки`);
  const htmlName = `${T.name}.html`;
  const htmlBuf = Buffer.from(html, 'utf8');
  // 3. Каталог поставки: HTML, README, лицензии, контрольные суммы; ZIP из этих файлов.
  const dir = id === 'site' ? OFF : join(OFF, 'base');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, htmlName), htmlBuf);
  writeFileSync(join(dir, 'README.txt'), T.readme());
  writeFileSync(join(dir, 'THREE-LICENSE.txt'), readFileSync(join(ROOT, 'node_modules/three/LICENSE'), 'utf8'));
  writeFileSync(join(dir, 'THIRD-PARTY-LICENSES.txt'), licenses);
  const files = [htmlName, 'README.txt', 'THREE-LICENSE.txt', 'THIRD-PARTY-LICENSES.txt'];
  writeFileSync(join(dir, 'SHA256SUMS.txt'), files.map((f) => `${sha256(readFileSync(join(dir, f)))}  ${f}`).join('\n') + '\n');
  const zipPath = join(ART, `${T.name}-local.zip`);
  if (existsSync(zipPath)) rmSync(zipPath);
  execFileSync('zip', ['-X', '-q', '-9', zipPath, ...files, 'SHA256SUMS.txt'], { cwd: dir });
  // Проверка: HTML внутри ZIP байт в байт совпадает с проверенным файлом.
  const fromZip = execFileSync('unzip', ['-p', zipPath, htmlName], { maxBuffer: 256 * 1024 * 1024 });
  const same = Buffer.compare(fromZip, htmlBuf) === 0;
  if (!same) throw new Error(`HTML в ZIP не совпадает с ${htmlName}`);
  const zipBuf = readFileSync(zipPath);
  const rel = (p) => p.slice(ROOT.length + 1);
  console.log(`${rel(join(dir, htmlName))} ${(htmlBuf.length / 1e6).toFixed(2)} МБ; ${rel(zipPath)} ${(zipBuf.length / 1e6).toFixed(2)} МБ; HTML в ZIP совпадает: ${same}`);
  return {
    html: { path: rel(join(dir, htmlName)), bytes: htmlBuf.length, sha256: sha256(htmlBuf) },
    zip: { path: rel(zipPath), bytes: zipBuf.length, sha256: sha256(zipBuf) },
    htmlInZipIdentical: same,
    embeddedAssets: Object.keys(assets).length,
    jsBytes: js.length,
  };
}

const ids = args.target ? [args.target] : ['site', 'base'];
const path = join(ART, 'offline-checksums.json');
let prev = {};
try { prev = JSON.parse(readFileSync(path, 'utf8')); } catch { /* первая сборка */ }
const report = { date: new Date().toISOString(), three: threePkg.version, site: prev.site, base: prev.base };
for (const id of ids) report[id] = await pack(id);
writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
