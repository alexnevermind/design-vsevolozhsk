// Состояние конфигуратора участка: солнце (место, дата, время), светильники, костёр, вариант фасада
// (доска или штукатурка с кирпичным цоколем) и положения мебели. Сохранение в браузере и ссылка
// #s=1.<base64url JSON>; история — core.js.
import SITE from './data/site-spec.js';

export const MODEL = 'site-vsevolozhsk-v1';
export const STORAGE_KEY = 'vsevolozhsk-site-v1';
export const HASH_PREFIX = '#s=1.';
export const FIRE_MODES = ['auto', 'on', 'off'];
export const FACADE_KINDS = ['board', 'plaster'];
export const FOCUS = ['site', 'guest', 'grill', 'garage'];

export function newSite() {
  const g = SITE.geo;
  return {
    model: MODEL,
    solar: { latitude: g.latitude, longitude: g.longitude, utcOffset: g.utcOffset, date: '2026-06-21', northAngle: g.northAngle, orientationConfirmed: true },
    hour: 11,
    lamps: true,
    fire: 'auto',
    notes: false,
    facade: 'board',
    items: {},
  };
}

const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function validate(s) {
  const e = [];
  if (!s || typeof s !== 'object') return ['не объект'];
  if (s.model !== MODEL) e.push('модель не участок');
  const so = s.solar ?? {};
  if (!(Math.abs(so.latitude) <= 90)) e.push('широта');
  if (!(Math.abs(so.longitude) <= 180)) e.push('долгота');
  if (!(Math.abs(so.utcOffset) <= 14)) e.push('часовой пояс');
  if (!validDate(so.date)) e.push('дата');
  if (!(so.northAngle >= 0 && so.northAngle < 360)) e.push('север');
  if (!(s.hour >= 0 && s.hour < 24)) e.push('время');
  if (!FIRE_MODES.includes(s.fire)) e.push('режим костра');
  if (!FACADE_KINDS.includes(s.facade)) e.push('отделка фасада');
  if (!s.items || typeof s.items !== 'object' || Array.isArray(s.items)) e.push('мебель');
  else for (const [k, v] of Object.entries(s.items)) {
    if (!/^(guest|grill|garage):[\w-]+$/.test(k) || !Array.isArray(v) || v.length !== 3 || !v.every((n) => Number.isFinite(n) && Math.abs(n) < 50)) { e.push(`мебель: ${k}`); break; }
  }
  return e;
}

export function loadState(raw) {
  const base = newSite();
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['пусто'] };
  const s = { ...base, ...raw, solar: { ...base.solar, ...(raw.solar ?? {}) } };
  const errors = validate(s);
  return errors.length ? { ok: false, errors } : { ok: true, state: s };
}

function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64(b64) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
export const encodeHash = (state) => HASH_PREFIX + toB64(JSON.stringify(state));
export function decodeHash(hash) {
  if (!hash?.startsWith(HASH_PREFIX)) return null;
  return JSON.parse(fromB64(hash.slice(HASH_PREFIX.length)));
}

export function resolveStartup({ hash, storage }) {
  try {
    const fromHash = decodeHash(hash);
    if (fromHash) {
      const r = loadState(fromHash);
      if (r.ok) return { state: r.state, source: 'link', messages: [] };
    }
  } catch { /* ссылка повреждена — дальше сохранение */ }
  try {
    const raw = storage?.get(STORAGE_KEY);
    if (raw) {
      const r = loadState(JSON.parse(raw));
      if (r.ok) return { state: r.state, source: 'storage', messages: [] };
    }
  } catch { /* непригодное сохранение — новый проект */ }
  return { state: newSite(), source: 'new', messages: [] };
}

// Хранилище браузера без исключений (приватный режим, запрет сайта).
export function safeStorage(ls) {
  return {
    get(k) { try { return ls?.getItem(k) ?? null; } catch { return null; } },
    set(k, v) { try { ls?.setItem(k, v); return true; } catch { return false; } },
  };
}
