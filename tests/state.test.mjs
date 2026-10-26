// Состояние проекта: новый проект, миграция, валидация, ссылка, хранилище, история.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newProject, migrate, validate, loadState, encodeHash, decodeHash, resolveStartup, safeStorage, STORAGE_KEY, BACKUP_KEY,
  MAX_ITEMS, slotOptions, SLOTS,
} from '../dist/project-state.js';
import { History, Store, HISTORY_LIMIT } from '../dist/core.js';
import { INTERIOR_PAINTS, FACADE_PAINTS } from '../dist/choices.js';

function memoryStorage(init = {}) {
  const data = { ...init };
  return safeStorage({
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  });
}

test('новый проект: базовая схема, исходные назначения отделки, 10:30, условный север', () => {
  const s = newProject();
  assert.equal(s.model, 'house-plan-12x68');
  assert.equal(s.revision, 2);
  assert.equal(s.wallLayout, 'vertical');
  assert.equal(s.ceilingType, 'timber');
  assert.equal(s.roofType, 'standingSeam');
  assert.equal(s.hour, 10.5);
  assert.deepEqual(s.solar, { latitude: 59.94, longitude: 30.31, utcOffset: 3, date: '2026-06-21', northAngle: 0, orientationConfirmed: false });
  assert.equal(s.mats['facade:east'], 'ext-Q854');
  for (const side of ['north', 'south', 'west']) assert.equal(s.mats[`facade:${side}`], 'ext-D129');
  assert.equal(s.mats['wall:005'], 'tk-H484');
  assert.equal(s.mats['floor:005'], 'oak');
  assert.equal(s.mats['floor:006'], 'terrazzo');
  assert.equal(s.mats['floor:008'], 'walnut');
  assert.equal(s.mats.interiorDoors, 'door-light');
  assert.equal(s.mats.ceiling, 'tk-F497');
  assert.deepEqual(validate(s), []);
});

test('каждый из семи оттенков допустим для фасада, стен и потолка', () => {
  for (const p of FACADE_PAINTS) {
    const s = newProject();
    for (const side of ['north', 'east', 'south', 'west']) s.mats[`facade:${side}`] = p.id;
    s.cladding.loggia = p.id;
    assert.deepEqual(validate(s), [], p.id);
  }
  for (const p of INTERIOR_PAINTS) {
    const s = newProject();
    for (const k of SLOTS.filter((k) => k.startsWith('wall:'))) s.mats[k] = p.id;
    s.mats.ceiling = p.id;
    assert.deepEqual(validate(s), [], p.id);
  }
  assert.deepEqual(slotOptions('floor:008'), ['oak', 'whiteoak', 'walnut', 'smoked', 'ash']);
  assert.deepEqual(slotOptions('floor:007'), ['terrazzo', 'travertine', 'slate']);
});

test('миграция: недостающие поля получают timber, standingSeam, door-light, tk-F497', () => {
  const s = newProject();
  delete s.ceilingType;
  delete s.roofType;
  delete s.mats.interiorDoors;
  delete s.mats.ceiling;
  s.revision = 1;
  const { state, notes } = migrate(s);
  assert.equal(state.ceilingType, 'timber');
  assert.equal(state.roofType, 'standingSeam');
  assert.equal(state.mats.interiorDoors, 'door-light');
  assert.equal(state.mats.ceiling, 'tk-F497');
  assert.equal(state.revision, 2);
  assert.ok(notes.length > 0);
  assert.deepEqual(validate(state), []);
});

test('миграция не возвращает удалённые предметы', () => {
  const s = newProject();
  s.items = s.items.filter((i) => i.type !== 'sofa');
  const { state } = migrate(s);
  assert.equal(state.items.some((i) => i.type === 'sofa'), false);
  assert.equal(state.items.length, 22);
});

test('сохранение прежнего дома (house-plan-v1): переносится отделка, расстановка не смешивается', () => {
  const legacy = {
    model: 'house-plan-v1', revision: 2, wallLayout: 'horizontal', roofType: 'metalTile',
    mats: { 'facade:east': 'ext-D105', 'wall:005': 'tk-L447', 'floor:005': 'walnut' },
    items: [{ id: 1, type: 'bed', x: -3.4882, z: -1.793, ry: 0, room: '001', mats: {} }],
  };
  const r = loadState(legacy);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.state.wallLayout, 'horizontal');
  assert.equal(r.state.roofType, 'metalTile');
  assert.equal(r.state.mats['facade:east'], 'ext-D105');
  assert.equal(r.state.mats['wall:002'], 'tk-L447');
  assert.equal(r.state.mats['floor:003'], 'walnut');
  assert.equal(r.state.items.length, 23);
});

test('валидация отклоняет непригодные данные предсказуемо', () => {
  const bad = (mut) => { const s = newProject(); mut(s); return validate(s); };
  assert.ok(bad((s) => { s.items[0].x = NaN; }).length > 0);
  assert.ok(bad((s) => { s.items[1].id = s.items[0].id; }).some((e) => e.includes('Повторяющийся')));
  assert.ok(bad((s) => { s.items[0].type = 'piano'; }).some((e) => e.includes('Неизвестный тип')));
  assert.ok(bad((s) => { s.mats['facade:east'] = 'tk-F497'; }).some((e) => e.includes('facade:east')));
  assert.ok(bad((s) => { s.mats['floor:006'] = 'oak'; }).length > 0);
  assert.ok(bad((s) => { s.hour = 24; }).length > 0);
  assert.ok(bad((s) => { s.solar.date = '2026-02-30'; }).length > 0);
  assert.ok(bad((s) => { s.solar.northAngle = 360; }).length > 0);
  assert.ok(bad((s) => { s.roofType = 'straw'; }).length > 0);
  assert.ok(bad((s) => { s.items[0].x = 0.4; s.items[0].z = -0.1; }).length > 0, 'недопустимое положение');
  assert.ok(bad((s) => { for (let i = 0; i < MAX_ITEMS; i++) s.items.push({ ...s.items[4], id: 1000 + i }); }).some((e) => e.includes('Слишком много')));
});

test('ссылка #r=1.: base64url без =, с - и _, Unicode и полная конфигурация', () => {
  const s = newProject();
  s.items = s.items.filter((i) => i.id !== 5);
  s.items.push({ id: 100, type: 'tv', wall: 'part-002-001', side: 1, u: 0.85, y: 1.1, mats: {} });
  s.hour = 18.25;
  s.solar.northAngle = 37;
  s.lamps = false;
  s.roofType = 'metalTile';
  s.ceilingType = 'stretch';
  s.mats.interiorDoors = 'door-grey';
  s.note = 'Дом — «тест» ✓';
  const h = encodeHash(s);
  assert.ok(h.startsWith('#r=1.'));
  assert.ok(!/[=+/]/.test(h.slice(5)));
  assert.deepEqual(decodeHash(h), s);
  assert.equal(decodeHash('#other'), null);
  assert.throws(() => decodeHash('#r=1.@@@'));
  assert.throws(() => decodeHash('#r=1.Zm9vYmFy'), /нет читаемой конфигурации/);
});

test('старт: ссылка важнее локального сохранения, затем локальное, затем новый проект', () => {
  const linkState = newProject();
  linkState.hour = 7;
  const localState = newProject();
  localState.hour = 20;
  const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(localState) });
  assert.equal(resolveStartup({ hash: encodeHash(linkState), storage }).state.hour, 7);
  assert.equal(resolveStartup({ hash: '', storage }).source, 'local');
  assert.equal(resolveStartup({ hash: '', storage: memoryStorage() }).source, 'new');
  // Повреждённая ссылка → локальное сохранение и сообщение.
  const r = resolveStartup({ hash: '#r=1.AAAA', storage });
  assert.equal(r.source, 'local');
  assert.ok(r.messages.length > 0);
});

test('непригодное сохранение: новый проект, понятное сообщение, резервная копия исходного текста', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '{"model":"house-plan-12x68","items":[{"id":1,"type":"bed","x":"a"}]}' });
  const r = resolveStartup({ hash: '', storage });
  assert.equal(r.source, 'new');
  assert.ok(r.messages[0].includes('новый проект'));
  assert.equal(storage.get(BACKUP_KEY), '{"model":"house-plan-12x68","items":[{"id":1,"type":"bed","x":"a"}]}');
  const storage2 = memoryStorage({ [STORAGE_KEY]: '{oops' });
  assert.equal(resolveStartup({ hash: '', storage: storage2 }).source, 'new');
  assert.equal(storage2.get(BACKUP_KEY), '{oops');
});

test('недоступное хранилище не ломает запуск', () => {
  const broken = safeStorage({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
  assert.equal(broken.get('x'), null);
  assert.equal(broken.set('x', '1'), false);
  assert.equal(resolveStartup({ hash: '', storage: broken }).source, 'new');
});

test('история: до 80 состояний, новое действие очищает redo, одинаковое состояние не пишется', () => {
  const h = new History({ v: 0 });
  for (let i = 1; i <= 100; i++) h.push({ v: i });
  assert.equal(h.states.length, HISTORY_LIMIT);
  assert.equal(h.current.v, 100);
  h.undo();
  h.undo();
  assert.equal(h.current.v, 98);
  assert.equal(h.canRedo(), true);
  h.push({ v: 500 });
  assert.equal(h.canRedo(), false);
  assert.equal(h.push({ v: 500 }), false);
});

test('хранилище: одно действие — одна запись, undo/redo восстанавливают состояние и сохраняются', () => {
  const saved = [];
  const events = [];
  const store = new Store(newProject(), { persist: (s) => saved.push(JSON.stringify(s)), onChange: (s, e) => events.push(e.kind) });
  store.commit((s) => { for (const side of ['north', 'east', 'south', 'west']) s.mats[`facade:${side}`] = 'ext-D110'; s.cladding.loggia = 'ext-D110'; }, 'Весь дом одним цветом');
  assert.equal(store.history.states.length, 2);
  store.undo();
  assert.equal(store.get().mats['facade:north'], 'ext-D129');
  assert.equal(store.get().mats['facade:east'], 'ext-Q854');
  store.redo();
  assert.equal(store.get().mats['facade:west'], 'ext-D110');
  assert.deepEqual(events, ['commit', 'undo', 'redo']);
  assert.equal(saved.length, 3);
});
