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

const sc = read('artifacts/site-check.json');
if (sc) {
  out.push('## Приложение участка в браузере (`npm run site:check`)', '', `${sc.date.slice(0, 16).replace('T', ' ')} UTC · Chromium, программный WebGL (SwiftShader).`, '',
    `Итог: **${sc.total - sc.failed} из ${sc.total}**, ошибок консоли: ${sc.consoleErrors.length}.`, '');
  let scen = null;
  for (const r of sc.results) {
    if (r.scenario !== scen) { scen = r.scenario; out.push('', `### ${scen || 'общие'}`, ''); }
    out.push(`- ${mark(r.ok)} ${r.name}${r.note ? ` — ${r.note}` : ''}`);
  }
  out.push('');
}

const bc = read('artifacts/browser-check.json');
if (bc) {
  out.push('## Браузерные маршруты базы — дом VSEMDOM (`npm run browser:check`, base-house.html)', '', `${bc.date.slice(0, 16).replace('T', ' ')} UTC · ${bc.environment}.`, '',
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
const TARGET = { site: 'Участок — Vsevolozhsk.html', base: 'Дом базы — VSEMDOM.html' };
if (oc) {
  out.push('## Автономные версии без сети (`npm run offline:check`)', '', `${oc.date.slice(0, 16).replace('T', ' ')} UTC · ${oc.environment}.`, '');
  let tg = null;
  for (const r of oc.results) {
    if (r.target !== tg) { tg = r.target; out.push('', `### ${TARGET[tg] ?? 'общие'}`, ''); }
    out.push(`- ${mark(r.ok)} ${r.name}${r.note ? ` — ${r.note}` : ''}`);
  }
  out.push('');
}
if (sums) {
  out.push('## Контрольные суммы автономных поставок', '', '| Файл | Байт | SHA-256 |', '|---|---:|---|');
  for (const id of ['site', 'base']) {
    const t = sums[id];
    if (!t) continue;
    out.push(`| ${t.html.path} | ${t.html.bytes} | \`${t.html.sha256}\` |`, `| ${t.zip.path} | ${t.zip.bytes} | \`${t.zip.sha256}\` |`);
  }
  out.push('', `HTML внутри ZIP совпадает байт в байт: ${['site', 'base'].every((id) => !sums[id] || sums[id].htmlInZipIdentical) ? 'да' : 'нет'}; встроенных ресурсов: ${sums.site?.embeddedAssets ?? sums.base?.embeddedAssets}; three ${sums.three}.`, '');
}

const shots = read('artifacts/screenshots/index.json');
if (shots) {
  out.push('## Снимки (`npm run screenshots`)', '', `${shots.environment}. Все кадры — реальные снимки работающего приложения.`, '');
  for (const s of shots.shots) out.push(`- [${s.file}](../artifacts/screenshots/${s.file}) — ${s.caption}`);
  out.push('');
}

const blender = ['day-site', 'day-guest', 'day-guest-plaster', 'day-grill', 'day-living', 'day-kitchen', 'night-guest'].map((n) => `blender-site-${n}.png`).filter((f) => existsSync(join(ROOT, 'artifacts/screenshots', f)));
if (blender.length || existsSync(join(ROOT, 'artifacts/screenshots/blender-cycles-facade.png'))) {
  out.push('## Blender', '');
  if (blender.length) out.push('Кадры Cycles (CPU) из assets-source/vsevolozhsk-site.blend — сцена участка, выгруженная из приложения (`npm run export:site`); это рендер Blender, а не кадр браузера:', '', ...blender.map((f) => `- [${f}](../artifacts/screenshots/${f})`), '');
  if (existsSync(join(ROOT, 'artifacts/screenshots/blender-cycles-facade.png'))) out.push('- [blender-cycles-facade.png](../artifacts/screenshots/blender-cycles-facade.png) — дом базы, assets-source/house.blend.', '');
}

out.push('## Где проверено', '',
  '- Linux, Chromium headless (Playwright) с программным WebGL (SwiftShader): настольные 1100–1440 px и эмуляция телефона 390/320 px с сенсорным вводом (CDP).',
  '- Физические GPU, Safari/iOS, Firefox и реальные Android-устройства в этой среде недоступны и не проверялись.', '');
writeFileSync(join(ROOT, 'docs', 'CHECKS.md'), out.join('\n'));
console.log('docs/CHECKS.md');
