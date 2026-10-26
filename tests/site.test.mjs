// Участок: режим костра в состоянии, мангальная зона и дорожки, дешёвые точечные источники, водостоки.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { newProject, migrate, validate, encodeHash, decodeHash, loadState, FIRE_MODES } from '../dist/project-state.js';
import { BBQ, bbqOccupied } from '../dist/bbq-zone.js';
import { PATH_PTS } from '../dist/landscape.js';
import { terrainHeight } from '../dist/terrain.js';
import { GROUND_Y, SPEC } from '../dist/plan.js';
import { addPointLight, updatePointLights, POINT_LIGHTS, PL_COUNT } from '../dist/point-lights.js';
import { buildGutters } from '../dist/gutters.js';
import { ROOF_EXTENT } from '../dist/roof-covering.js';

test('костёр: режим auto по умолчанию, старые проекты получают auto, недопустимое значение отклоняется', () => {
  assert.deepEqual(FIRE_MODES, ['auto', 'on', 'off']);
  const s = newProject();
  assert.equal(s.fire, 'auto');
  const old = JSON.parse(JSON.stringify(s));
  delete old.fire;
  assert.equal(migrate(old).state.fire, 'auto');
  assert.ok(validate({ ...s, fire: 'smoke' }).some((e) => e.includes('костра')));
  const on = { ...s, fire: 'on' };
  const back = loadState(decodeHash(encodeHash(on)));
  assert.ok(back.ok);
  assert.equal(back.state.fire, 'on');
});

test('мангальная зона: на ровной площадке, не ближе 8 м к дому и террасе', () => {
  const corners = [];
  for (let x = -6; x <= 9; x += 0.25) corners.push([x, -3.4], [x, 3.4]);
  for (let z = -3.4; z <= 3.4; z += 0.25) corners.push([-6, z], [9, z]);
  const dmin = Math.min(...corners.map(([x, z]) => Math.hypot(x - BBQ.x, z - BBQ.z)));
  assert.ok(dmin >= 8, `до дома ${dmin.toFixed(2)} м`);
  for (let a = 0; a < 360; a += 15) {
    const x = BBQ.x + Math.cos(a * Math.PI / 180) * (BBQ.r + 0.5);
    const z = BBQ.z + Math.sin(a * Math.PI / 180) * (BBQ.r + 0.5);
    assert.equal(terrainHeight(x, z), GROUND_Y, `рельеф у края площадки (${a}°)`);
  }
  assert.ok(bbqOccupied(BBQ.x, BBQ.z) && bbqOccupied(BBQ.x + BBQ.r - 0.05, BBQ.z) && !bbqOccupied(BBQ.x + BBQ.r + 1, BBQ.z));
});

test('гравийная дорожка: от ступеней террасы ко входу на площадку, без пересечения с кустами и домом', () => {
  const st = SPEC.exteriorFixtures.terraceStair;
  const [sx, sz] = PATH_PTS[0];
  assert.ok(sx > st.x + st.treads * st.run - 0.2 && sx < st.x + st.treads * st.run + 1 && Math.abs(sz - st.center) < 1.5, 'начало у ступеней');
  const [ex, ez] = PATH_PTS[PATH_PTS.length - 1];
  const dEnd = Math.hypot(ex - BBQ.x, ez - BBQ.z);
  assert.ok(Math.abs(dEnd - (BBQ.r + 0.3)) < 0.01, `конец у края площадки (${dEnd.toFixed(2)})`);
  for (const [x, z] of PATH_PTS) {
    assert.ok(!(x > -6.05 && x < 9.05 && z > -3.45 && z < 3.45), 'дорожка не заходит под дом');
    for (const [bx, bz, r] of [[12.35, 4.7, 0.5], [9.7, 4.65, 0.48]]) assert.ok(Math.hypot(x - bx, z - bz) > r + 0.5, `куст у (${bx}, ${bz})`);
  }
});

test('точечные источники: выбираются самые заметные, число активных — в униформе', () => {
  const far = addPointLight({ x: 500, y: 1, z: 500, color: 0xffffff, radius: 3, intensity: 1 });
  const near = addPointLight({ x: 1, y: 1, z: 1, color: 0xff8800, radius: 6, intensity: 10, flicker: 1 });
  updatePointLights(new THREE.Vector3(0, 0, 0), 0);
  assert.equal(POINT_LIGHTS.uPLNum.value, 0, 'выключенные источники не участвуют');
  far.k = 1;
  near.k = 1;
  updatePointLights(new THREE.Vector3(0, 0, 0), 1.3);
  assert.equal(POINT_LIGHTS.uPLNum.value, 2);
  const p0 = POINT_LIGHTS.uPLPos.value[0];
  assert.deepEqual([p0.x, p0.y, p0.z], [1, 1, 1], 'первым идёт близкий яркий источник');
  assert.ok(Math.abs(p0.w - 1 / 36) < 1e-9, 'w = 1/r²');
  for (let i = 0; i < PL_COUNT + 4; i++) addPointLight({ x: i, y: 0, z: 0, color: 0xffffff, radius: 2, intensity: 1 }).k = 1;
  updatePointLights(new THREE.Vector3(0, 0, 0), 0);
  assert.equal(POINT_LIGHTS.uPLNum.value, PL_COUNT, 'не больше PL_COUNT');
});

test('водостоки: желоба по длине карниза, трубы до отмостки', () => {
  const g = buildGutters();
  g.computeBoundingBox();
  const b = g.boundingBox;
  assert.ok(b.min.x <= ROOF_EXTENT.x0 && b.max.x >= ROOF_EXTENT.x1, 'желоб на всю длину свеса');
  assert.ok(b.max.z > ROOF_EXTENT.zEave && b.min.z < -ROOF_EXTENT.zEave, 'оба ската');
  assert.ok(b.min.y < GROUND_Y + 0.15 && b.min.y > GROUND_Y, 'трубы заканчиваются над землёй');
  assert.ok(b.max.z < 3.95 + 0.01, 'отмёт трубы — в пределах гравийной отмостки');
});
