// История изменений и хранилище состояния. Одно действие пользователя — одна запись.
import { clone } from './project-state.js';

export const HISTORY_LIMIT = 80;

export class History {
  constructor(initial, limit = HISTORY_LIMIT) {
    this.limit = limit;
    this.states = [JSON.stringify(initial)];
    this.labels = ['Начало'];
    this.index = 0;
  }

  get current() {
    return JSON.parse(this.states[this.index]);
  }

  // Новое действие очищает redo; одинаковое состояние не записывается.
  push(state, label = '') {
    const snap = JSON.stringify(state);
    if (snap === this.states[this.index]) return false;
    this.states.splice(this.index + 1);
    this.labels.splice(this.index + 1);
    this.states.push(snap);
    this.labels.push(label);
    if (this.states.length > this.limit) {
      const drop = this.states.length - this.limit;
      this.states.splice(0, drop);
      this.labels.splice(0, drop);
    }
    this.index = this.states.length - 1;
    return true;
  }

  canUndo() {
    return this.index > 0;
  }

  canRedo() {
    return this.index < this.states.length - 1;
  }

  undo() {
    if (!this.canUndo()) return null;
    this.index--;
    return { state: this.current, label: this.labels[this.index + 1] };
  }

  redo() {
    if (!this.canRedo()) return null;
    this.index++;
    return { state: this.current, label: this.labels[this.index] };
  }

  reset(state) {
    this.states = [JSON.stringify(state)];
    this.labels = ['Начало'];
    this.index = 0;
  }
}

// Хранилище: подтверждённые изменения проходят через commit (история + сохранение),
// превью (preview) меняет только отображение и не трогает историю.
export class Store {
  constructor(state, { onChange, persist } = {}) {
    this.state = clone(state);
    this.history = new History(this.state);
    this.onChange = onChange || (() => {});
    this.persist = persist || (() => {});
  }

  get() {
    return this.state;
  }

  commit(mutator, label) {
    const next = clone(this.state);
    mutator(next);
    if (!this.history.push(next, label)) return false;
    this.state = next;
    this.persist(this.state);
    this.onChange(this.state, { kind: 'commit', label });
    return true;
  }

  // Изменения, не создающие запись истории (например, служебная нормализация при загрузке).
  replace(state, { resetHistory = false } = {}) {
    this.state = clone(state);
    if (resetHistory) this.history.reset(this.state);
    this.persist(this.state);
    this.onChange(this.state, { kind: 'replace' });
  }

  undo() {
    const r = this.history.undo();
    if (!r) return false;
    this.state = r.state;
    this.persist(this.state);
    this.onChange(this.state, { kind: 'undo', label: r.label });
    return true;
  }

  redo() {
    const r = this.history.redo();
    if (!r) return false;
    this.state = r.state;
    this.persist(this.state);
    this.onChange(this.state, { kind: 'redo', label: r.label });
    return true;
  }
}
