// Построитель BufferGeometry: позиции, нормали, метрические UV, цвет вершин; группы по слотам материалов.
import * as THREE from 'three';

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  vertex(p, n, uv, c = 1) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    if (Array.isArray(c)) this.col.push(c[0], c[1], c[2]);
    else this.col.push(c, c, c);
    return this.pos.length / 3 - 1;
  }

  // Четырёхугольник a-b-c-d с общей нормалью; порядок обхода выбирается по нормали.
  quad(a, b, c, d, n, uva, uvb, uvc, uvd, col = 1) {
    const i0 = this.vertex(a, n, uva, col);
    const i1 = this.vertex(b, n, uvb, col);
    const i2 = this.vertex(c, n, uvc, col);
    const i3 = this.vertex(d, n, uvd, col);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0) this.idx.push(i0, i1, i2, i0, i2, i3);
    else this.idx.push(i0, i2, i1, i0, i3, i2);
  }

  // Выпуклый многоугольник (веер) с общей нормалью.
  polygon(points, n, uvs, col = 1) {
    if (points.length < 3) return;
    const base = this.vertexCount;
    points.forEach((p, i) => this.vertex(p, n, uvs[i], col));
    const a = points[0];
    const b = points[1];
    const c = points[2];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const flip = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0;
    for (let i = 1; i + 1 < points.length; i++) {
      if (flip) this.idx.push(base, base + i + 1, base + i);
      else this.idx.push(base, base + i, base + i + 1);
    }
  }

  append(other) {
    const off = this.vertexCount;
    this.pos.push(...other.pos);
    this.nrm.push(...other.nrm);
    this.uv.push(...other.uv);
    this.col.push(...other.col);
    for (const i of other.idx) this.idx.push(i + off);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// Набор построителей по ключам слотов.
export class GroupBuilder {
  constructor() {
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) this.map.set(key, new MeshBuilder());
    return this.map.get(key);
  }

  entries() {
    return [...this.map.entries()].filter(([, b]) => b.idx.length > 0);
  }
}

// Отсечение выпуклого многоугольника в 2D полуплоскостью f(p) ≤ 0 (f линейна).
export function clipPolygon(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// Значение профиля (периодического) в точке s и список изломов на интервале.
export function profileBreaks(points, period, s0, s1) {
  const out = [];
  const k0 = Math.floor(s0 / period);
  const k1 = Math.floor(s1 / period);
  for (let k = k0; k <= k1; k++) {
    for (const [s] of points) {
      const v = k * period + s;
      if (v > s0 + 1e-6 && v < s1 - 1e-6) out.push(v);
    }
  }
  return [s0, ...[...new Set(out.map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b), s1];
}

export function profileAt(points, period, s) {
  let x = s % period;
  if (x < 0) x += period;
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, da] = points[i];
    const [b, db] = points[i + 1];
    if (x >= a - 1e-9 && x <= b + 1e-9) {
      const t = b - a > 1e-9 ? (x - a) / (b - a) : 0;
      return da + (db - da) * t;
    }
  }
  return points[points.length - 1][1];
}

// Детерминированная псевдослучайная величина по целому индексу.
export function hash01(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
