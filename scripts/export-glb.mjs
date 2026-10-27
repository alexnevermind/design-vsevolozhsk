// Экспорт фактической браузерной архитектуры (и исходной расстановки) в GLB для сборки house.blend.
// Запуск: npm run export:glb  → artifacts/house-architecture.glb
import { launchChromium } from './browser-launch.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8773;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', join(ROOT, 'dist')], { stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
const browser = await launchChromium();
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await page.goto(`${BASE}base-house.html?quality=low`);
  await page.waitForFunction(() => window.__vsemdom?.ready?.() && window.__vsemdom.texturesPending() === 0, null, { timeout: 240000 });
  const b64 = await page.evaluate(async () => {
    const THREE = await import('three');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const a = window.__vsemdom.app;
    const root = new THREE.Group();
    root.name = 'VSEMDOM_house';
    for (const [key, part] of Object.entries(a.house.parts)) {
      if (!part || key === 'shell') continue;
      const c = part.clone(true);
      c.name = `arch_${key}`;
      root.add(c);
    }
    const items = a.house.itemsGroup.clone(true);
    items.name = 'furniture_initial';
    root.add(items);
    // Участок у дома: мангальная зона (без пламени, искр, дыма и ореолов — это шейдерные эффекты),
    // гравийные дорожки с бордюром и столбики-светильники.
    const site = new THREE.Group();
    site.name = 'site';
    const zone = a.fireZone.group.clone(true);
    const drop = [];
    zone.traverse((o) => { if (o.isPoints || o.isSprite || o.material?.isShaderMaterial) drop.push(o); });
    for (const o of drop) o.parent?.remove(o);
    // Экземпляры (поленница, лампы гирлянды) — отдельными мешами: импорт Blender без расширений.
    const inst = [];
    zone.traverse((o) => { if (o.isInstancedMesh) inst.push(o); });
    for (const im of inst) {
      const g = new THREE.Group();
      g.name = im.name || 'instances';
      g.position.copy(im.position); g.quaternion.copy(im.quaternion); g.scale.copy(im.scale);
      const m = new THREE.Matrix4();
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        const mesh = new THREE.Mesh(im.geometry, im.material);
        m.decompose(mesh.position, mesh.quaternion, mesh.scale);
        g.add(mesh);
      }
      im.parent.add(g);
      im.parent.remove(im);
    }
    zone.name = 'bbq_zone';
    site.add(zone);
    for (const n of ['paths', 'bollards']) {
      const part = a.landscape.getObjectByName(n);
      if (part) { const c = part.clone(true); c.name = n; site.add(c); }
    }
    root.add(site);
    const lights = [];
    root.traverse((o) => {
      if (o.isLight) lights.push(o);
      // userData (коллайдеры, служебные ссылки) в GLB не нужны и раздувают JSON до десятков МБ.
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
    for (const l of lights) l.parent?.remove(l);
    const data = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false, maxTextureSize: 1024 });
    const bytes = new Uint8Array(data);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  mkdirSync(join(ROOT, 'artifacts'), { recursive: true });
  const buf = Buffer.from(b64, 'base64');
  writeFileSync(join(ROOT, 'artifacts', 'house-architecture.glb'), buf);
  console.log(`artifacts/house-architecture.glb ${(buf.length / 1e6).toFixed(2)} МБ`);
} finally {
  await browser.close();
  server.kill();
}
