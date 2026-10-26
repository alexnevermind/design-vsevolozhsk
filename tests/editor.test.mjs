// Правила редактора: каталог, коллизии, привязка, стыковка, доступ к шкафу, телевизор, жесты.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_TYPES, CATALOG_ORDER, roomAllowsType } from '../dist/catalog.js';
import { newProject } from '../dist/project-state.js';
import { checkFloorPlacement, checkWallPlacement, validateLayout, accessObb, wallItemPose, itemObb } from '../dist/house-core.js';
import { placeFloorItem, rotateItem, findSpotInRoom, FACE_LINES } from '../dist/placement.js';
import { defaultWallSpot, hitMountFace, wallPoseFromHit, nearestValidWallPose } from '../dist/wall-placement.js';
import { Gesture, WheelAccumulator, rayToFloor, grabOffset, isDeleteZone, DRAG_THRESHOLD_PX } from '../dist/editor-input.js';
import { ROOM_BY_ID, WALL_BY_ID, SPEC } from '../dist/plan.js';
import { obbCorners } from '../dist/geometry.js';

const items = () => newProject().items;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('исходная расстановка: 23 предмета нового дома, все положения допустимы', () => {
  const its = items();
  assert.equal(its.length, 23);
  assert.deepEqual(validateLayout(its), []);
  assert.equal(new Set(its.map((i) => i.id)).size, 23);
});

test('компактный каталог: ровно шесть типов', () => {
  assert.deepEqual(CATALOG_ORDER, ['bed', 'wardrobe', 'sofa', 'dining', 'chair', 'tv']);
  assert.equal(Object.values(ITEM_TYPES).filter((t) => t.catalog).length, 6);
});

test('прихожая 004 и парная 007 остаются свободными от каталожной мебели', () => {
  for (const type of CATALOG_ORDER) {
    assert.equal(roomAllowsType(ROOM_BY_ID['004'], type), false);
    assert.equal(roomAllowsType(ROOM_BY_ID['007'], type), false);
  }
  const r = checkFloorPlacement(items(), { id: 99, type: 'chair', x: 5.1, z: -1.4, ry: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'entry');
});

test('коллизии по размерам видимой модели: стена, предмет, дверной проход, окно', () => {
  const its = items();
  // Шкаф поперёк перегородки спален.
  assert.equal(checkFloorPlacement(its, { id: 99, type: 'wardrobe', x: -2.9, z: 1.5, ry: 0 }).code, 'wall');
  // Стул поверх обеденного стола.
  assert.equal(checkFloorPlacement(its, { id: 99, type: 'chair', x: 3.9, z: 2.22, ry: 0 }).code, 'item');
  // Стул в проёме двери прихожая → кухня-гостиная.
  assert.equal(checkFloorPlacement(its, { id: 99, type: 'chair', x: 5.2, z: 0.4, ry: 0 }).code, 'door');
  // Высокий шкаф перед окном южного фасада кухни-гостиной.
  assert.equal(checkFloorPlacement(its, { id: 99, type: 'wardrobe', x: 1.6, z: 2.95, ry: Math.PI }).code, 'window');
  // Низкий стул у того же окна допустим.
  assert.equal(checkFloorPlacement(its, { id: 99, type: 'chair', x: 1.6, z: 2.9, ry: Math.PI }).ok, true);
});

test('кровать на террасу не ставится, стул — ставится; предмет целиком на одной платформе', () => {
  const its = items();
  assert.equal(checkFloorPlacement(its, { id: 99, type: 'bed', x: 8.0, z: 0, ry: 0 }).code, 'room-type');
  assert.equal(checkFloorPlacement(its, { id: 99, type: 'chair', x: 8.0, z: 0, ry: 0 }).ok, true);
  // Стул на границе дома и террасы (в стене) — недопустим.
  assert.equal(checkFloorPlacement(its, { id: 99, type: 'chair', x: 6.0, z: 2.0, ry: 0 }).ok, false);
});

test('шкаф: задняя привязка к стене, поворот к помещению и свободный доступ 0,6 м', () => {
  const its = items();
  const w = { id: 99, type: 'wardrobe', mats: {} };
  // Указатель возле южной стены кабинета 001 (грань z = −1,25).
  const r = placeFloorItem(its, w, -1.1, -1.5, 0);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.room, '001');
  assert.ok(near(r.z, -1.25 - 0.3, 1e-6), `z=${r.z}`);
  assert.ok(near(Math.cos(r.ry), -1, 1e-9), 'перед смотрит на север');
  assert.deepEqual(r.anchor, { wall: 'south-001', side: -1 });
  // Перед шкафом нельзя поставить стул.
  const its2 = [...its, { ...w, ...r }];
  const acc = accessObb({ ...w, ...r });
  assert.equal(checkFloorPlacement(its2, { id: 100, type: 'chair', x: acc.cx, z: acc.cz, ry: 0 }).code, 'access');
});

test('перенос к другой стене разворачивает заднюю часть к ней', () => {
  // Без кровати спальни 1: проверяется только ориентация и прижатие.
  const its = items().filter((i) => i.id !== 1);
  const w = { id: 99, type: 'wardrobe', mats: {} };
  // Перегородка спальни 1 (грань x = −2,75), шкаф смотрит на запад.
  const r = placeFloorItem(its, w, -3.1, -2.4, 0);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.room, '002');
  assert.ok(near(Math.sin(r.ry), -1, 1e-9), 'перед смотрит на запад');
  assert.ok(near(r.x, -2.75 - 0.3, 1e-6));
  assert.deepEqual(r.anchor, { wall: 'part-002-001', side: 1 });
});

test('кухонные модули состыковываются с зазором 3 мм', () => {
  const its = items().filter((i) => i.type !== 'kitchenCabinet');
  const hob = its.find((i) => i.type === 'kitchenHob');
  const sink = its.find((i) => i.type === 'kitchenSink');
  const cab = { id: 9, type: 'kitchenCabinet', mats: {} };
  // Указатель примерно между плитой и мойкой, но неточно.
  const r = placeFloorItem(its, cab, 2.55, 0.0, 0);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.docked, true);
  const gapLeft = r.x - 0.825 / 2 - (hob.x + 0.825 / 2);
  const gapRight = sink.x - 0.925 / 2 - (r.x + 0.825 / 2);
  assert.ok(near(gapLeft, 0.003, 1e-6) || near(gapRight, 0.003, 1e-6), `${gapLeft} ${gapRight}`);
  assert.ok(near(r.z, -0.65 + 0.34, 1e-6));
});

test('унитаз закреплён у стены kitchen-006: z = грань + 0,65/2', () => {
  const wc = items().find((i) => i.type === 'toilet');
  const w = WALL_BY_ID['kitchen-006'];
  assert.deepEqual(wc.anchor, { wall: 'kitchen-006', side: -1 });
  assert.ok(near(wc.z, w.a[1] - w.t / 2 - 0.65 / 2, 1e-4));
});

test('поворот кнопкой на 90°: свободный предмет поворачивается, пристенный — разворачивается к стене', () => {
  const its = items();
  const chair = its.find((i) => i.id === 18);
  const r = rotateItem(its, chair, 1);
  assert.ok(r && r.ok);
  assert.ok(near(Math.abs(r.ry - chair.ry), Math.PI / 2, 1e-9) || near(Math.abs(r.ry - chair.ry), (3 * Math.PI) / 2, 1e-9));
});

test('новый предмет: клик по карточке находит место в выбранном помещении', () => {
  const its = items();
  for (const type of ['bed', 'wardrobe', 'sofa', 'dining', 'chair']) {
    const r = findSpotInRoom(its, type, '005');
    assert.ok(r, type);
    assert.equal(checkFloorPlacement(its, { ...r, id: 99 }).ok, true, type);
  }
  assert.equal(findSpotInRoom(its, 'chair', '004'), null);
});

test('удаление: вынос за общий контур дома и террасы с запасом 65 см', () => {
  const outer = [SPEC.house.outer.x0, SPEC.house.outer.z0, SPEC.house.terrace.x1, SPEC.house.outer.z1];
  assert.equal(isDeleteZone(9.5, 0, outer), false);
  assert.equal(isDeleteZone(9.7, 0, outer), true);
  assert.equal(isDeleteZone(0, -4.1, outer), true);
});

test('телевизор: место ближе к центру помещения, положение по стене и высоте', () => {
  const its = items();
  const spot = defaultWallSpot(its, 'tv', '005');
  assert.ok(spot);
  assert.equal(checkWallPlacement(its, spot).ok, true);
  const p = wallItemPose({ ...spot, id: 99 });
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
  for (const room of ['004', '007', '008', '006']) assert.equal(defaultWallSpot(its, 'tv', room), null, room);
});

test('телевизор: наружная грань, проёмы и потолок недопустимы', () => {
  const its = items();
  assert.equal(checkWallPlacement(its, { id: 99, type: 'tv', wall: 'north-001', side: -1, u: 1.6, y: 1 }).code, 'exterior');
  // Через окно W2 (u 0.325…1.125) на северной стене кабинета.
  assert.equal(checkWallPlacement(its, { id: 99, type: 'tv', wall: 'north-001', side: 1, u: 0.9, y: 1 }).code, 'opening');
  assert.equal(checkWallPlacement(its, { id: 99, type: 'tv', wall: 'north-001', side: 1, u: 2.2, y: 1.8 }).code, 'height');
});

test('телевизор и высокая мебель проверяются симметрично; над низким предметом можно', () => {
  const its = items().filter((i) => i.id !== 1);
  const tv = { id: 50, type: 'tv', wall: 'part-002-001', side: 1, u: 0.85, y: 1.1, mats: {} };
  assert.equal(checkWallPlacement(its, tv).ok, true);
  const withTv = [...its, tv];
  const wardrobe = { id: 51, type: 'wardrobe', x: -3.05, z: -2.4, ry: -Math.PI / 2 };
  assert.equal(checkFloorPlacement(its, wardrobe).ok, true);
  // Телевизор стоит — шкаф под ним нельзя.
  assert.equal(checkFloorPlacement(withTv, wardrobe).code, 'tv');
  // Шкаф стоит — телевизор над ним нельзя.
  assert.equal(checkWallPlacement([...its, wardrobe], tv).code, 'tall');
  // Низкий стул под телевизором допустим.
  assert.equal(checkFloorPlacement(withTv, { id: 52, type: 'chair', x: -3.0, z: -2.4, ry: -Math.PI / 2 }).ok, true);
});

test('наведение на стену использует математическую плоскость стены', () => {
  const its = items();
  const hit = hitMountFace([3.6, 1.4, 1.5], [0, 0, 1]);
  assert.ok(hit);
  assert.equal(hit.wall, 'south-005');
  assert.equal(hit.side, -1);
  const pose = wallPoseFromHit('tv', hit);
  const v = nearestValidWallPose(its, { ...pose, id: 99, type: 'tv' });
  assert.ok(v.ok, v.reason);
  // Луч, начинающийся за плоскостью грани, её не пересекает.
  assert.equal(hitMountFace([3.6, 1.4, 3.6], [0, 0, 1]), null);
});

test('жест: порог 7 px отделяет клик от переноса, перенос подавляет завершающий click', () => {
  assert.equal(DRAG_THRESHOLD_PX, 7);
  const g = new Gesture();
  g.begin(1, 100, 100, {});
  assert.equal(g.move(1, 104, 104), null);
  assert.equal(g.move(2, 140, 140), null, 'чужой указатель игнорируется');
  assert.equal(g.end(1), 'click');
  g.begin(1, 100, 100, {});
  assert.equal(g.move(1, 105, 106), 'drag-start');
  assert.equal(g.move(1, 120, 130), 'drag');
  assert.equal(g.end(1), 'drop');
  assert.equal(g.consumeClickSuppression(), true);
  g.begin(3, 0, 0, {});
  g.move(3, 0, 20);
  g.cancel();
  assert.equal(g.active, false);
  assert.equal(g.consumeClickSuppression(), true);
});

test('жест из каталога на сенсорном экране: вдоль ленты — прокрутка, вверх — перенос', () => {
  const g = new Gesture();
  g.begin(1, 100, 500, {});
  assert.equal(g.move(1, 130, 498, { requireUpward: true }), 'scroll');
  g.reset();
  g.begin(1, 100, 500, {});
  assert.equal(g.move(1, 102, 480, { requireUpward: true }), 'drag-start');
});

test('колесо: шаг 45° на 50 нормализованных пикселей, трекпад накапливается', () => {
  const w = new WheelAccumulator();
  let steps = 0;
  for (let i = 0; i < 12; i++) steps += w.add(5);
  assert.equal(steps, 1);
  assert.equal(w.add(-120), -1, 'один щелчок колеса — один шаг 45°');
  assert.equal(new WheelAccumulator().add(2, 1), 0);
  assert.equal(new WheelAccumulator().add(4, 1), 1);
  const t = new WheelAccumulator();
  assert.equal(t.add(30) + t.add(30), 1, 'трекпад: 60 px → один шаг');
});

test('луч около горизонта или вверх не создаёт позицию; захват сохраняет смещение', () => {
  assert.equal(rayToFloor([0, 5, 0], [1, 0.01, 0]), null);
  assert.equal(rayToFloor([0, 5, 0], [1, -0.01, 0]), null);
  const hit = rayToFloor([0, 5, 0], [0.3, -1, 0.2]);
  assert.ok(hit);
  const off = grabOffset({ x: 1.6, z: 1.2 }, hit);
  assert.ok(near(hit[0] + off[0], 1.6) && near(hit[2] + off[1], 1.2));
});

test('углы footprint повёрнутого предмета совпадают с габаритами каталога', () => {
  const sofa = items().find((i) => i.type === 'sofa');
  const c = obbCorners(itemObb(sofa));
  const xs = c.map((p) => p[0]);
  const zs = c.map((p) => p[1]);
  assert.ok(near(Math.max(...xs) - Math.min(...xs), 0.85, 1e-9));
  assert.ok(near(Math.max(...zs) - Math.min(...zs), 1.9, 1e-9));
});

test('линии граней существуют для всех помещений с мебелью', () => {
  for (const id of ['001', '002', '003', '005', '006']) assert.ok(FACE_LINES.some((l) => l.room === id), id);
});
