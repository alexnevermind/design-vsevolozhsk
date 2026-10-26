// Положение солнца: NOAA fractional-year approximation. Один расчёт для источника света,
// траектории, значка и показаний панели.

const RAD = Math.PI / 180;

export function dayOfYear(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = Date.UTC(y, 0, 1);
  return Math.round((Date.UTC(y, m - 1, d) - start) / 86400000) + 1;
}

export function daysInYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

// hour — местное время (часы, дробные), utcOffset — часовой пояс в часах.
export function solarPosition({ date, hour, latitude, longitude, utcOffset }) {
  const year = Number(date.slice(0, 4));
  const doy = dayOfYear(date);
  const nDays = daysInYear(year);
  // 1. Дробный год.
  const g = ((2 * Math.PI) / nDays) * (doy - 1 + (hour - 12) / 24);
  // 2. Уравнение времени (мин).
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  // 3. Склонение (рад).
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  // 4. Поправка долготы и часового пояса (мин).
  const timeOffset = eqTime + 4 * longitude - 60 * utcOffset;
  // 5. Истинное солнечное время и часовой угол.
  const tst = hour * 60 + timeOffset;
  const ha = (tst / 4 - 180) * RAD;
  // 6. Высота и азимут (от севера по часовой стрелке).
  const lat = latitude * RAD;
  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const elevation = 90 - zen / RAD;
  let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / RAD + 180;
  az = ((az % 360) + 360) % 360;
  return { elevation, azimuth: az, declination: decl / RAD, eqTime, hourAngle: ha / RAD };
}

// 7. Поворот по northAngle: 0° — север вверх плана (−Z), 90° — вправо (+X).
// Возвращает единичный вектор на солнце в координатах сцены [x, y, z].
export function sunDirection(pos, northAngle = 0) {
  const na = northAngle * RAD;
  const north = [Math.sin(na), -Math.cos(na)];
  const east = [Math.cos(na), Math.sin(na)];
  const a = pos.azimuth * RAD;
  const e = pos.elevation * RAD;
  const hx = north[0] * Math.cos(a) + east[0] * Math.sin(a);
  const hz = north[1] * Math.cos(a) + east[1] * Math.sin(a);
  return [hx * Math.cos(e), Math.sin(e), hz * Math.cos(e)];
}

export function sunState(solar, hour) {
  const pos = solarPosition({ ...solar, hour });
  return { ...pos, dir: sunDirection(pos, solar.northAngle) };
}

// Траектория за сутки с шагом step минут: непрерывные сегменты для рисования и выбора времени.
export function sunPath(solar, stepMinutes = 10) {
  const pts = [];
  for (let m = 0; m <= 1440; m += stepMinutes) {
    const hour = Math.min(m, 1439) / 60;
    const s = sunState(solar, hour);
    pts.push({ hour, elevation: s.elevation, azimuth: s.azimuth, dir: s.dir });
  }
  return pts;
}

// Фаза дня по высоте солнца.
export function dayPhase(elevation) {
  if (elevation >= 6) return 'day';
  if (elevation >= 0) return 'golden';
  if (elevation >= -6) return 'civil';
  if (elevation >= -12) return 'nautical';
  return 'night';
}

const PHASE_LABEL = { day: 'день', golden: 'низкое солнце', civil: 'гражданские сумерки', nautical: 'навигационные сумерки', night: 'ночь' };
export function phaseLabel(elevation) {
  return PHASE_LABEL[dayPhase(elevation)];
}

// Интенсивность дневного света 0…1 (плавно в сумерках).
export function daylightFactor(elevation) {
  if (elevation <= -8) return 0;
  if (elevation >= 12) return 1;
  const t = (elevation + 8) / 20;
  return t * t * (3 - 2 * t);
}

// Автоматические светильники: включаются при низком солнце.
export function lampFactor(elevation, enabled) {
  if (!enabled) return 0;
  if (elevation >= 4) return 0;
  if (elevation <= -4) return 1;
  return (4 - elevation) / 8;
}

// Ближайшая точка на проекции траектории (непрерывные отрезки) к экранной точке.
// proj(dir) → [sx, sy] или null, если точка за камерой.
export function nearestPathHour(points, proj, sx, sy) {
  let best = null;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = proj(points[i].dir);
    const b = proj(points[i + 1].dir);
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((sx - a[0]) * dx + (sy - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(a[0] + dx * t - sx, a[1] + dy * t - sy);
    if (!best || d < best.d) best = { d, hour: points[i].hour + (points[i + 1].hour - points[i].hour) * t };
  }
  if (!best) return null;
  return { ...best, hour: Math.round(best.hour * 60) / 60 };
}

export function formatHour(hour) {
  const total = Math.round(hour * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const PREVIEW_TIMES = [
  { id: 'morning', label: 'Утро', hour: 7.0 },
  { id: 'day', label: 'День', hour: 13.0 },
  { id: 'evening', label: 'Вечер', hour: 20.5 },
  { id: 'night', label: 'Ночь', hour: 1.0 },
];
