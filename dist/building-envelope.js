// Закрытая оболочка настоящего дома для солнечных теней: полные стены с реальными проёмами и
// основа кровли. Не пишет цвет/глубину в обычный кадр (слой 1 виден только теневой камере)
// и исключена из прохода нормалей/AO.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildWalls } from './house-geometry.js';
import { buildRoofBase } from './roof-covering.js';

export const SHADOW_LAYER = 1;

export function buildShadowShell() {
  const { shell } = buildWalls({ shellOnly: true });
  const walls = shell.build();
  const roof = buildRoofBase();
  const geo = mergeGeometries([walls, roof].map((g) => {
    const c = new THREE.BufferGeometry();
    c.setAttribute('position', g.getAttribute('position'));
    c.setAttribute('normal', g.getAttribute('normal'));
    c.setIndex(g.getIndex());
    return c.index.array instanceof Uint32Array ? c : c.toNonIndexed();
  }).map((g) => (g.index ? g.toNonIndexed() : g)));
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'shadow-shell';
  mesh.layers.set(SHADOW_LAYER);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.userData.excludeAO = true;
  mesh.frustumCulled = false;
  return mesh;
}
