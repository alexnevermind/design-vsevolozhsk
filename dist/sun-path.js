// Видимая траектория солнца над участком, подписи часов и значок солнца — по тому же расчёту,
// что и источник света. Перетаскивание значка выбирает время на проекции траектории.
import * as THREE from 'three';
import { sunPath, sunState, nearestPathHour, formatHour } from './solar.js';

const CENTER = new THREE.Vector3(1.5, -0.7, 0);
const RADIUS = 15;

function label(text, color = '#2b2f26') {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const g = c.getContext('2d');
  g.font = '600 26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(250,248,243,0.85)';
  g.beginPath();
  g.roundRect(14, 6, 100, 36, 12);
  g.fill();
  g.fillStyle = color;
  g.fillText(text, 64, 25);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.3, 0.49, 1);
  s.renderOrder = 10;
  return s;
}

function sunIcon() {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(48, 48, 6, 48, 48, 46);
  grd.addColorStop(0, 'rgba(255,248,214,1)');
  grd.addColorStop(0.35, 'rgba(255,214,120,0.95)');
  grd.addColorStop(1, 'rgba(255,190,90,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 96, 96);
  g.strokeStyle = 'rgba(80,60,20,0.8)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(48, 48, 15, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.8, 1.8, 1);
  s.renderOrder = 11;
  return s;
}

export class SunPath {
  constructor(scene, invalidate, { center = CENTER, radius = RADIUS } = {}) {
    this.invalidate = invalidate;
    this.center = center.clone ? center.clone() : new THREE.Vector3(...center);
    this.radius = radius;
    this.group = new THREE.Group();
    this.group.name = 'sun-path';
    this.group.visible = false;
    this.group.userData.excludeAO = true;
    scene.add(this.group);
    this.lineDay = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf2b84b, depthTest: false, transparent: true }));
    this.lineNight = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0x8090a8, dashSize: 0.4, gapSize: 0.3, depthTest: false, transparent: true, opacity: 0.7 }));
    this.lineDay.renderOrder = this.lineNight.renderOrder = 9;
    this.group.add(this.lineDay, this.lineNight);
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 96 }, (_, i) => new THREE.Vector3(Math.cos((i / 96) * Math.PI * 2) * radius, 0, Math.sin((i / 96) * Math.PI * 2) * radius))), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthTest: false }));
    ring.position.copy(this.center);
    this.group.add(ring);
    this.labels = new THREE.Group();
    this.group.add(this.labels);
    this.icon = sunIcon();
    this.group.add(this.icon);
    this.northLabel = label('С', '#9b3a2c');
    this.group.add(this.northLabel);
    this.points = [];
  }

  pointFor(dir) {
    return new THREE.Vector3(...dir).multiplyScalar(this.radius).add(this.center);
  }

  update(solar, hour, visible) {
    this.group.visible = !!visible;
    this.points = sunPath(solar, 5);
    const day = [];
    const night = [];
    for (const p of this.points) {
      const v = this.pointFor(p.dir);
      (p.elevation >= -0.83 ? day : night).push(v);
    }
    this.lineDay.geometry.dispose();
    this.lineDay.geometry = new THREE.BufferGeometry().setFromPoints(this.points.map((p) => (p.elevation >= -0.83 ? this.pointFor(p.dir) : this.pointFor([p.dir[0], Math.max(p.dir[1], 0), p.dir[2]]))));
    this.lineNight.geometry.dispose();
    this.lineNight.geometry = new THREE.BufferGeometry().setFromPoints(this.points.map((p) => this.pointFor(p.dir)));
    this.lineNight.computeLineDistances();
    this.labels.clear();
    for (let h = 0; h < 24; h++) {
      const s = sunState(solar, h);
      if (s.elevation < -4) continue;
      const l = label(formatHour(h));
      l.position.copy(this.pointFor(s.dir)).add(new THREE.Vector3(0, 0.6, 0));
      this.labels.add(l);
    }
    const cur = sunState(solar, hour);
    this.icon.position.copy(this.pointFor(cur.dir));
    const na = (solar.northAngle * Math.PI) / 180;
    this.northLabel.position.set(this.center.x + Math.sin(na) * (this.radius + 1.2), this.center.y + 0.4, this.center.z - Math.cos(na) * (this.radius + 1.2));
    this.invalidate();
  }

  // Время по экранной точке: ближайшая точка на проекции непрерывных сегментов траектории.
  hourAtScreen(camera, rect, sx, sy) {
    const proj = (dir) => {
      const v = this.pointFor(dir).project(camera);
      if (v.z > 1) return null;
      return [rect.left + (v.x * 0.5 + 0.5) * rect.width, rect.top + (-v.y * 0.5 + 0.5) * rect.height];
    };
    return nearestPathHour(this.points, proj, sx, sy);
  }

  iconScreen(camera, rect) {
    const v = this.icon.position.clone().project(camera);
    return [rect.left + (v.x * 0.5 + 0.5) * rect.width, rect.top + (-v.y * 0.5 + 0.5) * rect.height];
  }
}
