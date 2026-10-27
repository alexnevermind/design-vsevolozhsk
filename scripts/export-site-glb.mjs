// Экспорт сцены участка из приложения (та же геометрия, что в браузере) в GLB для сборки файла Blender:
// постройки с интерьерами и исходной расстановкой мебели, оба варианта фасада (доска — видимый,
// штукатурка с кирпичным цоколем — отдельной группой), рельеф, благоустройство, деревья по плану,
// фонари. Рядом — JSON с видами камер, солнцем для Всеволожска и точками ночного света.
// Запуск: npm run export:site  → artifacts/vsevolozhsk-site.glb, artifacts/vsevolozhsk-site.json
import { launchChromium } from './browser-launch.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8774;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', join(ROOT, 'dist')], { stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
const browser = await launchChromium();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(300000);
  await page.goto(`${BASE}index.html?still=1&quality=high`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__site?.ready?.() && window.__site.texturesPending() === 0, null, { timeout: 300000 });
  const out = await page.evaluate(async () => {
    const S = window.__site;
    const { THREE, app } = S;
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    app.store.commit((s) => { s.facade = 'board'; }, 'экспорт');
    if (app.mode !== 'site') app.setMode('site');

    // Описание сцены для Blender: виды (как в приложении), солнце, ночной свет, огонь.
    // Для внешних видов — деревья, которые приложение на этом виде скрывает (заслоняют постройку).
    const views = {};
    for (const id of ['site', 'guest', 'grill', 'garage', 'entry', 'fire', 'pond', 'dining']) {
      const spot = !['site', 'guest', 'grill', 'garage'].includes(id);
      const v = spot ? S.spot(id) : S.view(id);
      if (spot) app.showSpot(id); else app.focusOn(id);
      S.setCamera(v.pos, v.target);
      app.updateTreeClearance();
      views[id] = { ...v, fov: S.camera().fov, hiddenTrees: [...app.hiddenTrees].sort() };
    }
    app.trees.userData.setHidden(new Set());
    const walkAt = (bid, x, z, tx, tz, level = 0) => {
      const part = app.buildings.userData.parts[bid];
      const p = part.group.localToWorld(new THREE.Vector3(x, part.levels[level] + 1.62, z));
      const t = part.group.localToWorld(new THREE.Vector3(tx, part.levels[level] + 1.45, tz));
      return { pos: p.toArray(), target: t.toArray(), fov: 62 };
    };
    views['living'] = walkAt('guest', 4.1, 4.9, 1.2, 7.0);
    views['kitchen'] = walkAt('guest', 3.6, 7.9, 2.0, 1.4);
    views['mansard'] = walkAt('guest', 2.6, 3.9, 2.6, 8.6, 1);
    views['rest'] = walkAt('guest', 9.6, 4.4, 13.6, 3.2);
    views['grill-inside'] = walkAt('grill', -2.2, 1.6, 1.6, -0.6);
    const sun = {};
    for (const h of [13, 19, 22.5]) {
      app.store.commit((s) => { s.hour = h; }, 'экспорт');
      const i = S.sunInfo();
      sun[h] = { elevation: i.elevation, azimuth: i.azimuth, dir: i.lightDir };
    }
    app.store.commit((s) => { s.hour = 13; }, 'экспорт');
    const st = S.state();
    const lamps = app.siteLights.lights.map((L) => ({ pos: L.p.toArray(), color: L.c.toArray(), radius: L.r, intensity: L.i }));
    const fireAt = app.fires.map((f) => { const b = new THREE.Box3().setFromObject(f.group); const c = b.getCenter(new THREE.Vector3()); return { name: f.group.name, pos: [c.x, b.min.y + 0.35, c.z] }; });

    // Копии частей сцены без шейдерных эффектов (пламя, искры, ореолы) и служебных объектов.
    const clean = (obj) => {
      const drop = [];
      obj.traverse((o) => {
        if (o.isPoints || o.isSprite || o.isLight || o.isCamera || o.material?.isShaderMaterial || o.userData.shadowProxy || o.userData.cut !== undefined || o.visible === false) drop.push(o);
      });
      for (const o of drop) o.parent?.remove(o);
      // Экземпляры — отдельными мешами с общей геометрией (импорт Blender без расширений glTF).
      const inst = [];
      obj.traverse((o) => { if (o.isInstancedMesh) inst.push(o); });
      for (const im of inst) {
        const g = new THREE.Group();
        g.name = im.name || 'instances';
        g.position.copy(im.position); g.quaternion.copy(im.quaternion); g.scale.copy(im.scale);
        const m = new THREE.Matrix4();
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, m);
          if (Math.abs(m.determinant()) < 1e-9) continue;
          const mesh = new THREE.Mesh(im.geometry, im.material);
          mesh.name = `${g.name}.${i}`;
          m.decompose(mesh.position, mesh.quaternion, mesh.scale);
          g.add(mesh);
        }
        im.parent.add(g);
        im.parent.remove(im);
      }
      return obj;
    };
    const root = new THREE.Group();
    root.name = 'Vsevolozhsk_site';
    // Постройки с интерьерами и мебелью; фасад и цоколь — в группы вариантов.
    const mats = app.buildings.userData.materials;
    const builds = new THREE.Group();
    builds.name = 'buildings';
    root.add(builds);
    const board = new THREE.Group();
    board.name = 'facade_board';
    const plaster = new THREE.Group();
    plaster.name = 'facade_plaster';
    root.add(board, plaster);
    for (const [id, part] of Object.entries(app.buildings.userData.parts)) {
      const c = clean(part.group.clone(true));
      c.name = `building_${id}`;
      builds.add(c);
      root.updateMatrixWorld(true);
      const slots = [];
      c.traverse((o) => { if (o.isMesh && ['facade', 'plinth', 'corner', 'drip'].includes(o.userData.slot)) slots.push(o); });
      for (const o of slots) {
        if (o.userData.slot === 'facade' || o.userData.slot === 'plinth') {
          const p = new THREE.Mesh(o.geometry, o.userData.slot === 'facade' ? mats.plaster : mats.brick);
          p.name = `${id}_${o.userData.slot === 'facade' ? 'plaster' : 'brick'}`;
          o.matrixWorld.decompose(p.position, p.quaternion, p.scale);
          plaster.add(p);
        }
        o.name = `${id}_${o.userData.slot}`;
        board.attach(o);
      }
    }
    // Огонь очага гриль-дома и кострище (без пламени), благоустройство (без мелкой травы), рельеф,
    // деревья по плану, фонари.
    const fires = new THREE.Group();
    fires.name = 'fire_zones';
    for (const f of app.fires) { if (f.group.parent !== app.landscape) fires.add(clean(f.group.clone(true))); }
    root.add(fires);
    const land = app.landscape.clone(true);
    land.remove(...land.children.filter((o) => o.name === 'grass'));
    root.add(clean(land));
    root.add(clean(app.ground.clone(true)));
    // Деревья по плану: группа на дерево (tree_T01 …) — ствол с ветвями и крона с общей геометрией шаблона.
    // Ветви внутри объёмов построек (в приложении их отбрасывает шейдер) вырезаются из копии геометрии
    // этого дерева: треугольник, центр которого под кровлей постройки, удаляется.
    const { buildingVolumes } = await import('./site-trees.js');
    const vols = buildingVolumes();
    const insideVol = (x, y, z) => vols.some(({ A, B }) => {
      if (y < B[0]) return false;
      let d;
      if (B[3] > 1.5) {
        const qx = x - A[0], qz = z - A[1];
        d = Math.max(Math.abs(qx), Math.abs(qx * 0.5 + qz * 0.8660254), Math.abs(-qx * 0.5 + qz * 0.8660254));
        if (d > A[2]) return false;
      } else {
        if (x < A[0] || x > A[2] || z < A[1] || z > A[3]) return false;
        d = B[3] < 0.5 ? Math.abs(z - (A[1] + A[3]) / 2) : Math.abs(x - (A[0] + A[2]) / 2);
      }
      return y < B[1] - d * B[2];
    });
    let clipped = 0;
    const clipMesh = (mesh) => {
      const g = mesh.geometry;
      mesh.updateMatrix();
      const pos = g.attributes.position, idx = g.index;
      const n = idx ? idx.count : pos.count;
      const keep = [];
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      let cut = false;
      for (let i = 0; i < n; i += 3) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
        const m = a.add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(mesh.matrix);
        if (insideVol(m.x, m.y, m.z)) { cut = true; continue; }
        keep.push(i0, i1, i2);
      }
      if (!cut) return;
      const ng = g.clone();
      ng.setIndex(keep);
      mesh.geometry = ng;
      clipped++;
    };
    const trees = new THREE.Group();
    trees.name = 'trees';
    const planned = app.trees.userData.planned;
    const perTree = {};
    const m4 = new THREE.Matrix4();
    for (const m of app.trees.children) {
      if (!m.isInstancedMesh || m.userData.far || /:shadow$/.test(m.name)) continue;
      const [, sp, v, part] = m.name.split(':');
      const items = planned.filter((t) => t.species === sp && t.variant === Number(v));
      items.forEach((t, i) => {
        if (!perTree[t.id]) { perTree[t.id] = new THREE.Group(); perTree[t.id].name = `tree_${t.id}`; trees.add(perTree[t.id]); }
        m.getMatrixAt(i, m4);
        const mesh = new THREE.Mesh(m.geometry, m.material);
        mesh.name = `${t.id}_${part === 'crown' ? 'crown' : 'wood'}`;
        m4.decompose(mesh.position, mesh.quaternion, mesh.scale);
        clipMesh(mesh);
        perTree[t.id].add(mesh);
      });
    }
    root.add(trees);
    // Фон: редкий лес за забором и кромка леса на горизонте (как в приложении).
    const backdrop = new THREE.Group();
    backdrop.name = 'backdrop';
    for (const m of app.trees.children) if (m.userData.far) backdrop.add(m.clone());
    root.add(clean(backdrop));
    const lights = clean(app.siteLights.group.clone(true));
    lights.name = 'lamps';
    root.add(lights);
    // Цвет вершин, который материал приложения не использует (vertexColors выключен), в glTF умножился бы
    // на цвет материала (где атрибута не было при слиянии — нули, чёрные пятна) — такой атрибут снимается.
    const noColor = new Map();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry.attributes.color) return;
      const uses = [o.material].flat().some((m) => m?.vertexColors);
      if (uses) return;
      if (!noColor.has(o.geometry)) { const g = o.geometry.clone(); g.deleteAttribute('color'); noColor.set(o.geometry, g); }
      o.geometry = noColor.get(o.geometry);
    });
    const stats = { meshes: 0, tris: 0 };
    root.traverse((o) => {
      if (o.isMesh) { stats.meshes++; stats.tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }
      // userData (коллайдеры, служебные ссылки) в GLB не нужны и раздувают JSON.
      o.userData = {};
      for (const m of [o.material].flat().filter(Boolean)) {
        m.userData = {};
        const opaque = !m.transparent && !(m.alphaTest > 0);
        for (const t of Object.values(m)) {
          if (t?.isTexture && t.image) t.userData = { mimeType: opaque && t !== m.alphaMap ? 'image/jpeg' : 'image/png' };
        }
      }
      if (o.geometry) o.geometry.userData = {};
    });
    const data = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true, maxTextureSize: 1024 });
    const bytes = new Uint8Array(data);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return {
      glb: btoa(s),
      meta: { clippedTreeMeshes: clipped, date: st.solar.date, place: 'Всеволожск', latitude: 60.0203, longitude: 30.6367, views, sun, lamps, fires: fireAt, stats: { meshes: stats.meshes, tris: Math.round(stats.tris) } },
    };
  });
  mkdirSync(join(ROOT, 'artifacts'), { recursive: true });
  const buf = Buffer.from(out.glb, 'base64');
  writeFileSync(join(ROOT, 'artifacts', 'vsevolozhsk-site.glb'), buf);
  writeFileSync(join(ROOT, 'artifacts', 'vsevolozhsk-site.json'), JSON.stringify(out.meta, null, 2) + '\n');
  console.log(`artifacts/vsevolozhsk-site.glb ${(buf.length / 1e6).toFixed(2)} МБ, ${out.meta.stats.meshes} мешей, ${(out.meta.stats.tris / 1e6).toFixed(2)} млн треуг.`);
} finally {
  await browser.close();
  server.kill();
}
