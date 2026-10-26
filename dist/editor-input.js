// Намерение жеста редактора без привязки к DOM: порог клика, владение указателем,
// направленный жест из каталога, накопление колеса и точка захвата.

export const DRAG_THRESHOLD_PX = 7;
export const WHEEL_STEP_PX = 50;
export const LIFT_HEIGHT = 0.14;
export const DELETE_MARGIN = 0.65;

// Состояния: idle → pending (нажатие) → dragging (порог) → завершение (commit/cancel/delete).
export class Gesture {
  constructor(threshold = DRAG_THRESHOLD_PX) {
    this.threshold = threshold;
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.pointerId = null;
    this.startX = 0;
    this.startY = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.payload = null;
    this.suppressClick = false;
  }

  get active() {
    return this.state !== 'idle';
  }

  begin(pointerId, x, y, payload) {
    if (this.active) return false;
    this.state = 'pending';
    this.pointerId = pointerId;
    this.startX = this.lastX = x;
    this.startY = this.lastY = y;
    this.payload = payload;
    this.suppressClick = false;
    return true;
  }

  owns(pointerId) {
    return this.active && pointerId === this.pointerId;
  }

  // Возвращает 'drag-start' при достижении порога, 'drag' при переносе, null иначе.
  move(pointerId, x, y, { requireUpward = false } = {}) {
    if (!this.owns(pointerId)) return null;
    this.lastX = x;
    this.lastY = y;
    if (this.state === 'pending') {
      const dx = x - this.startX;
      const dy = y - this.startY;
      if (Math.hypot(dx, dy) < this.threshold) return null;
      if (requireUpward) {
        // В каталоге на сенсорном экране: движение вдоль ленты — прокрутка, вверх — перенос.
        if (!(dy < 0 && Math.abs(dy) > Math.abs(dx) * 1.2)) {
          this.state = 'scroll';
          return 'scroll';
        }
      }
      this.state = 'dragging';
      this.suppressClick = true;
      return 'drag-start';
    }
    return this.state === 'dragging' ? 'drag' : null;
  }

  // Завершение: 'click' если порог не достигнут, 'drop' если был перенос.
  end(pointerId) {
    if (!this.owns(pointerId)) return null;
    const result = this.state === 'dragging' ? 'drop' : this.state === 'pending' ? 'click' : 'none';
    const suppress = this.suppressClick;
    this.reset();
    this.suppressClick = suppress;
    return result;
  }

  // Отмена (Escape, pointercancel, потеря фокуса, второй палец, смена режима).
  cancel() {
    const was = this.state;
    const suppress = this.state === 'dragging' || this.state === 'scroll';
    this.reset();
    this.suppressClick = suppress || was !== 'idle';
    return was;
  }

  // Завершающий click подавляется после переноса или отменённого жеста.
  consumeClickSuppression() {
    const s = this.suppressClick;
    this.suppressClick = false;
    return s;
  }
}

// Колесо: шаг 45° на каждые 50 нормализованных пикселей; мелкие события трекпада накапливаются.
export function normalizeWheelDelta(deltaY, deltaMode = 0) {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * 400;
  return deltaY;
}

export class WheelAccumulator {
  constructor(step = WHEEL_STEP_PX) {
    this.step = step;
    this.acc = 0;
  }

  // Одно «щелчковое» событие колеса (≥ 50 px) — ровно один шаг 45°; мелкие события трекпада копятся до 50 px.
  add(deltaY, deltaMode = 0) {
    const d = normalizeWheelDelta(deltaY, deltaMode);
    if (Math.abs(d) >= this.step) {
      this.acc = 0;
      return Math.sign(d);
    }
    this.acc += d;
    let steps = 0;
    while (this.acc >= this.step) { this.acc -= this.step; steps++; }
    while (this.acc <= -this.step) { this.acc += this.step; steps--; }
    return steps;
  }

  reset() {
    this.acc = 0;
  }
}

// Луч на горизонтальную плоскость пола y=planeY. Луч вверх/около горизонта — без позиции.
export function rayToFloor(origin, dir, planeY = 0, maxDist = 60) {
  if (dir[1] > -0.02) return null;
  const t = (planeY - origin[1]) / dir[1];
  if (!(t > 0) || t > maxDist) return null;
  return [origin[0] + dir[0] * t, planeY, origin[2] + dir[2] * t];
}

// Смещение захвата: основание предмета минус точка пересечения луча с полом при нажатии.
export function grabOffset(item, hit) {
  return [item.x - hit[0], item.z - hit[2]];
}

// Предмет вынесен за общий контур дома и террасы с запасом — состояние удаления.
export function isDeleteZone(x, z, outer, margin = DELETE_MARGIN) {
  return x < outer[0] - margin || x > outer[2] + margin || z < outer[1] - margin || z > outer[3] + margin;
}
