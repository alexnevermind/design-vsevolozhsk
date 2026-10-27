# Участок во Всеволожске — 3D-конфигуратор участка с тремя постройками

Новый проект на основе конфигуратора дома VSEMDOM (`alexnevermind/design-planner-V-2.0`,
ветка `claude/blissful-heisenberg-1bzi5o`, перенесён без истории). Цель — интерактивный участок
клиента: рельеф, деревья по плану, дорожки, забор и три постройки (гостевой дом-баня, гриль-дом,
навес с хоз.блоком) со своими планами, высотами, кровлями, отделкой, прогулкой и солнцем.

Этапы (каждый — после согласования владельца):

1. данные + 2D-схема участка + отчёт о нестыковках — **готово, согласовано**;
2. участок и постройки снаружи в 3D — **готово, согласовано** с доработками (отчёт — `docs/STAGE2.md`);
3. интерьеры, фасад «штукатурка + кирпич», ночной свет — **готово, ждёт согласования** (`docs/STAGE3.md`);
4. проверки, кадры, автономный HTML, файл Blender.

### Данные участка (этап 1)

```bash
npm run site                 # scripts/site-source.mjs → SITE_SPEC.json, SITE_PLAN.svg, dist/data/site-spec.js,
                             # docs/SITE_CHECK.md (--check — только проверка, код 1 при ошибках)
npm run site:png             # SITE_PLAN.svg → docs/img/site-plan.png
node --test tests/site-spec.test.mjs
```

- `scripts/site-source.mjs` — единственный ручной ввод: граница и масштаб плана, 160 отметок рельефа, 44 дерева,
  площадки, постройки в мм их листов (стены, проёмы, помещения, высоты, кровли), забор, ворота, дорожки.
- `scripts/build-site.mjs` — размещение построек по подписанным размерам, рельеф (сплайн по отметкам), отметки
  пола (+0,25 над спланированной землёй), деревья под вырубку, сверка подписей листов и плана.
- `dist/site-terrain.js` — высота рельефа по данным (общая для сборки и будущей 3D-сцены).
- Исходники — `references/site|guest-house|grill-house|garage|style/`; разбор — `docs/SITE_SOURCES.md`;
  решения — `docs/ASSUMPTIONS.md`.

### 3D-участок (этап 2)

```bash
npm run serve                # http://127.0.0.1:8769/ — участок (index.html); дом базы — base-house.html
npm run site:check           # браузерная проверка участка → artifacts/site-check.json
npm run site:shots           # кадры этапа → docs/img/stage2-*.png
```

- `dist/site-app.js` — рендер, камера, виды построек и точек интереса, солнце, костёр, режимы; `?view=guest|grill|
  garage|entry|fire|pond|dining` — стартовый вид, `?quality=low|auto|high`, `?still=1`, `#s=1.…` — ссылка.
- `dist/site-buildings.js`, `site-arch.js`, `site-roof.js` — постройки по листам (стены с проёмами, окна и двери,
  наличники, кровли с черепицей, водостоками, снегозадержателями, трубами, мансардными окнами, обеденная
  площадка с перголой, навес); `site-ground.js` — рельеф и газон; `site-trees.js` — деревья по плану и фон;
  `site-landscape.js` — забор, ворота, мощение, отмостка, пруд, купель, спортплощадка, ЛОС, кострище и
  гриль-зона, кусты, трава; `site-walk.js` — прогулка; `site-ui.js` — интерфейс; `site-state.js` — состояние.
- Деревья, заслоняющие выбранную постройку, на виде скрываются (тени остаются) — флажок в панели.

### Интерьеры (этап 3)

```bash
npm run site:shots -- --stage 3   # кадры этапа → docs/img/stage3-*.png
node --test tests/site-interior.test.mjs
```

- Режим «Внутри» (`site-app.js`: разрез, `site-edit.js`: перенос мебели) — разрез постройки на 2,1 м
  (мансарда — 1,3 м над её полом), список помещений, перенос и поворот мебели в пределах помещения,
  «На место»; положения — в состоянии и ссылке.
- `site-buildings.js` — отделка внутри (вертикальная имитация бруса, тёмно-серый ламинат, керамогранит в
  мокрых помещениях и хоз.блоке), потолки по скатам, перегородки и двери, Г-образная лестница на мансарду,
  ограждения; `site-furniture.js` — мебель по листам; `site-lights.js` — фонари у дверей, столбики вдоль
  дорожек, свет помещений; `site-walk.js` — прогулка внутри (двери, лестница, мебель).
- Фасады всех построек — «Доска» или «Штукатурка и кирпич» (один кирпичный цоколь на все постройки).

Ниже — описание перенесённой базы (дом VSEMDOM; открывается как `base-house.html`).
Отличие среды: Chromium для проверок запускается через `scripts/browser-launch.mjs` — если браузер нужной
Playwright версии не скачан, берётся `CHROMIUM_PATH` или `$PLAYWRIGHT_BROWSERS_PATH/chromium`.

---

## База: VSEMDOM.COM — конфигуратор дома 12 × 6,8 м с террасой

Интерактивный 3D-конфигуратор одноэтажного каркасного дома по новой планировке владельца:
12 000 × 6 800 мм, терраса 3 000 мм, 7 помещений (72,0 м²) + терраса 20 м², пол на 0,70 м над землёй
на ж/б сваях, потолок по двум скатам 2,30–2,70 м. Three.js r183, ассеты подготовлены в Blender 4.3.

- Режимы: **Снаружи** (фасады, кровля, терраса, солнце), **Внутри** (помещения, отделка, двери, потолок,
  мебель), **Прогулка** (от первого лица, двери открываются, стены и мебель — преграды).
- Редактирование мебели: перенос, поворот колесом/кнопками по 45°, добавление из каталога, удаление выносом
  за контур, телевизор на стене, пристенная привязка, коллизии, зоны дверей и окон, отмена/повтор (80 шагов).
- Физическое солнце (NOAA) по широте/долготе/дате/часу и ориентации участка, ночной режим со светильниками
  и лунным светом, лучи солнца в окнах (прогулка).
- Участок: мангальная зона с живым костром (плитняк, кострище, мангал, скамьи, поленница, гирлянда),
  гравийная дорожка от террасы, отмостка, столбики-светильники; режим костра «авто / горит / погашен».
- Детализация по разбору sael.net/interior (`docs/SAEL_ANALYSIS.md`): дешёвые точечные источники,
  тени по требованию, MSAA, цветокоррекция, подушки с защипом, растения из листьев, книги, вазы, лампа, шторы,
  водостоки.
- Сохранение в браузере, ссылка с полной конфигурацией `#r=1.…`, кадр PNG 1800 × 1120.
- Автономная версия — один HTML без сети: `offline/VSEMDOM.html` и `artifacts/VSEMDOM-local.zip`.

## Запуск

```bash
npm ci                      # three, esbuild, playwright (только для сборки и проверок)
npm run serve               # http://127.0.0.1:8769/  (python3 -m http.server, каталог dist/)
```

Рабочая версия — `dist/` (ES-модули + import map на `dist/vendor/three`, без сборки). Нужен браузер с WebGL 2.
Параметры адреса: `?quality=low|auto|high` (размер теней и карт), `?still=1` — огонь без анимации,
`#r=1.<…>` — конфигурация из ссылки.

Автономно: распакуйте `artifacts/VSEMDOM-local.zip` и откройте `VSEMDOM.html` двойным щелчком (file://).

### Управление

| Где | Действие |
|---|---|
| Снаружи/Внутри | левая кнопка — вращение, правая/два пальца — сдвиг, колесо/щипок — масштаб; W A S D, Q E — камера; R — исходный вид; C — облёт; `[` `]` — время ±15 мин; N — траектория солнца; `/` — скрыть интерфейс; панель «Солнце» — режим костра и «Показать зону» |
| Мебель | нажать и тянуть (порог 7 px); колесо над предметом или `,` `.` — поворот 45°; Delete — удалить; Esc — отменить перенос; из каталога — перетащить в комнату (на телефоне — вверх из ленты) |
| Прогулка | W A S D / стрелки, Shift — быстрее, мышь (Pointer Lock или перетаскивание), E — дверь, Esc — пауза; на телефоне — джойстик и взгляд пальцем |
| Везде | Ctrl/Cmd+Z — отмена, Ctrl+Shift+Z / Ctrl+Y — повтор |

## Структура

```
scripts/plan-source.mjs      единственный ручной ввод геометрии (мм, как на листах) + исправления C1–C4
scripts/build-spec.mjs       → PROJECT_SPEC.json, INITIAL_PROJECT_STATE.json, HOUSE_PLAN.svg,
                               dist/data/*.js, docs/PLAN_CHECK.md (317 проверок)
dist/                        рабочая версия
  app.js                     связывание сцены, состояния, режимов, диагностический API window.__vsemdom
  plan.js geometry.js        данные плана, 2D-геометрия (полигоны, OBB, интервалы)
  house-core.js placement.js wall-placement.js catalog.js
                             допустимость размещения, привязка, кухонная стыковка, ТВ на стене, каталог
  project-state.js core.js   состояние, миграция, ссылка, localStorage; история (отмена/повтор)
  solar.js sun-path.js       солнце NOAA и видимая траектория
  walk-geometry.js walk-controls.js   модель и ввод прогулки
  editor-input.js editor.js  жесты (порог, владение указателем, колесо) и редактор сцены
  materials.js mesh-builder.js house-geometry.js house-ceiling.js roof-covering.js exterior.js
  interior-door.js furniture-detail.js fixtures.js building-envelope.js house-scene.js
                             архитектура и мебель из плана; PBR-материалы; тени оболочки
  window-light.js outdoor-environment.js      свет проёмов, небо, солнце, луна, дымка, подгонка теней
  point-lights.js sun-beams.js                 дешёвые точечные источники; лучи солнца в окнах
  terrain.js landscape.js forest.js            рельеф, газон/подстилка/трава/кусты/забор, гравийные дорожки
                                               и отмостка, столбики, сосны и дальний лес
  bbq-zone.js                                  мангальная зона: плитняк, кострище, пламя, искры, дым, мангал,
                                               скамьи, пни, поленница, гирлянда
  decor.js curtains.js gutters.js              декор мебели (подушки, растения, книги, вазы, лампа), шторы, водостоки
  ui.js index.html style.css интерфейс
  assets/textures/*.webp     38 карт из Blender (+ manifest.json), assets/models/wall-hung-wc.glb,
  assets/profiles.json       профили бруса, доски, фальца, металлочерепицы, рамы, плинтуса
  vendor/three/              копия three 0.183.2 (npm run vendor)
scripts/blender/             make_textures.py, make_architecture.py, make_wc.py, make_house_blend.py, build-all.sh
assets-source/               house.blend (вся архитектура + исходная мебель), house-architecture.blend,
                             wall-hung-wc.blend
tests/                       node:test — геометрия, редактор, состояние, солнце и прогулка, участок
scripts/browser-check.mjs    браузерные маршруты (Playwright) → artifacts/browser-check.json
scripts/screenshots.mjs      реальные кадры приложения → artifacts/screenshots/*.png + index.json
scripts/package-offline.mjs  автономный HTML, ZIP, SHA-256; scripts/offline-check.mjs — проверка без сети
scripts/export-glb.mjs       экспорт браузерной архитектуры → artifacts/house-architecture.glb
references/                  план, фото фасада, полный текст задания
docs/                        ASSUMPTIONS.md (принятые предположения), PLAN_CHECK.md, CHECKS.md,
                             SAEL_ANALYSIS.md (разбор sael.net/interior: что перенесено и почему)
```

## Пересборка и проверки

```bash
npm run spec                 # данные из плана + проверка согласованности (--check — без записи)
npm run site                 # данные участка + docs/SITE_CHECK.md (--check — без записи)
npm test                     # 76 модульных тестов
npm run browser:check        # браузерные маршруты (Chromium; нужен playwright)
npm run screenshots          # кадры приложения
npm run package:offline      # offline/VSEMDOM.html + artifacts/VSEMDOM-local.zip + offline-checksums.json
npm run offline:check        # распаковка ZIP, открытие file:// без сети, отделка, прогулка, PNG, SHA-256
npm run checks:report        # docs/CHECKS.md из фактических отчётов artifacts/*.json
npm run check:all            # всё по порядку
```

В среде без GPU Chromium запускается с `--use-angle=swiftshader` (скрипты делают это сами).

### Blender

Ассеты воспроизводятся скриптами (Blender 4.3: модуль `bpy==4.3.0` под Python 3.11 или `blender -b --python`):

```bash
npm run export:glb           # фактическая архитектура из браузера → artifacts/house-architecture.glb
npm run assets:blender       # карты, профили, унитаз, assets-source/house.blend
# или по одному: <python с bpy> scripts/blender/make_textures.py | make_architecture.py | make_wc.py
#                <python с bpy> scripts/blender/make_house_blend.py [--render]   (кадр Cycles)
```

Принятые предположения и исправления подписей — `docs/ASSUMPTIONS.md`; итоги проверок — `docs/CHECKS.md`.
