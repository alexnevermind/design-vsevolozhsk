// Сводка проверок → docs/CHECKS.md из фактических отчётов (artifacts/*.json) и прогона node-тестов.
// Запуск: node scripts/checks-report.mjs  (после npm run browser:check, package:offline, offline:check)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => (existsSync(join(ROOT, p)) ? JSON.parse(readFileSync(join(ROOT, p), 'utf8')) : null);
const mark = (ok) => (ok ? '✔' : '✘');
const out = ['# Результаты проверок', '', 'Сгенерировано `node scripts/checks-report.mjs` из фактических отчётов; ничего не дописано вручную.', ''];

let tap = '';
try { tap = execFileSync('node', ['--test', 'tests/**/*.test.mjs'], { cwd: ROOT, encoding: 'utf8' }); } catch (e) { tap = e.stdout || ''; }
const num = (k) => Number((tap.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0);
out.push('## Модульные тесты (`npm test`)', '', `Тестов: ${num('tests')}, успешно: ${num('pass')}, ошибок: ${num('fail')}.`, '');

let spec = '';
try { spec = execFileSync('node', ['scripts/build-spec.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' }); } catch (e) { spec = e.stdout || ''; }
out.push('## Согласованность схемы (`npm run spec -- --check`)', '', `${(spec.trim().split('\n').pop() || '').trim()} — подробности в docs/PLAN_CHECK.md.`, '');

let site = '';
try { site = execFileSync('node', ['scripts/build-site.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' }); } catch (e) { site = e.stdout || ''; }
out.push('## Данные участка (`npm run site -- --check`)', '', `${(site.trim().split('\n').pop() || '').trim()} — подробности в docs/SITE_CHECK.md.`, '');

const bc = read('artifacts/browser-check.json');
if (bc) {
  out.push('## Браузерные маршруты (`npm run browser:check`)', '', `${bc.date.slice(0, 16).replace('T', ' ')} UTC · ${bc.environment}.`, '',
    `Итог: **${bc.passed} из ${bc.passed + bc.failed}**, ошибок консоли: ${bc.consoleErrors.length}, длительность ${bc.durationSec} с.`, '');
  let scen = null;
  for (const r of bc.results) {
    if (r.scenario !== scen) { scen = r.scenario; out.push('', `### ${scen ?? 'общие'}`, ''); }
    out.push(`- ${mark(r.ok)} ${r.name}${r.note ? ` — ${r.note}` : ''}`);
  }
  if (bc.consoleErrors.length) out.push('', 'Ошибки консоли:', ...bc.consoleErrors.map((e) => `- ${e}`));
  out.push('');
}

const oc = read('artifacts/offline-check.json');
const sums = read('artifacts/offline-checksums.json');
if (oc) {
  out.push('## Автономная версия без сети (`npm run offline:check`)', '', `${oc.date.slice(0, 16).replace('T', ' ')} UTC · ${oc.environment}.`, '');
  for (const r of oc.results) out.push(`- ${mark(r.ok)} ${r.name}${r.note ? ` — ${r.note}` : ''}`);
  out.push('');
}
if (sums) {
  out.push('## Контрольные суммы автономной поставки', '', '| Файл | Байт | SHA-256 |', '|---|---:|---|',
    `| ${sums.html.path} | ${sums.html.bytes} | \`${sums.html.sha256}\` |`,
    `| ${sums.zip.path} | ${sums.zip.bytes} | \`${sums.zip.sha256}\` |`, '',
    `HTML внутри ZIP совпадает байт в байт: ${sums.htmlInZipIdentical ? 'да' : 'нет'}; встроенных ресурсов: ${sums.embeddedAssets}; three ${sums.three}.`, '');
}

const shots = read('artifacts/screenshots/index.json');
if (shots) {
  out.push('## Снимки (`npm run screenshots`)', '', `${shots.environment}. Все кадры — реальные снимки работающего приложения.`, '');
  for (const s of shots.shots) out.push(`- [${s.file}](../artifacts/screenshots/${s.file}) — ${s.caption}`);
  out.push('');
}

if (existsSync(join(ROOT, 'artifacts/screenshots/blender-cycles-facade.png'))) {
  out.push('## Blender', '', '- [blender-cycles-facade.png](../artifacts/screenshots/blender-cycles-facade.png) — контрольный рендер Cycles (CPU) из assets-source/house.blend: та же архитектура, выгруженная из браузера (`npm run export:glb`), это рендер Blender, а не кадр браузера.', '');
}

out.push('## Где проверено', '',
  '- Linux, Chromium headless (Playwright) с программным WebGL (SwiftShader): настольные 1100–1440 px и эмуляция телефона 390/320 px с сенсорным вводом (CDP).',
  '- Физические GPU, Safari/iOS, Firefox и реальные Android-устройства в этой среде недоступны и не проверялись.', '');
writeFileSync(join(ROOT, 'docs', 'CHECKS.md'), out.join('\n'));
console.log('docs/CHECKS.md');
