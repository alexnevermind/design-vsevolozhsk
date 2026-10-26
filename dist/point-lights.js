// Дешёвые точечные источники (приём sael.net/interior): вместо настоящих PointLight — пул источников
// в мировых координатах, из которого на кадр берутся N самых заметных для точки интереса; их вклад
// добавляется к прямому рассеянному свету материалов после стандартного освещения. Так горят костёр,
// столбики вдоль дорожки, гирлянда над зоной отдыха и лампы — без пересборки шейдеров и без теней.
import * as THREE from 'three';

export const PL_COUNT = 10;
const pool = [];
export const POINT_LIGHTS = {
  uPLPos: { value: Array.from({ length: PL_COUNT }, () => new THREE.Vector4(0, -999, 0, 1)) },
  uPLCol: { value: Array.from({ length: PL_COUNT }, () => new THREE.Vector3()) },
  // Число активных источников: днём 0 — цикл в шейдере не выполняется.
  uPLNum: { value: 0 },
};
const patched = new WeakSet();

// radius — дальность, м; intensity — яркость при k = 1; flicker — мерцание пламени (0…1).
export function addPointLight({ x, y, z, color, radius, intensity, flicker = 0 }) {
  const L = { p: new THREE.Vector3(x, y, z), c: new THREE.Color(color), r: radius, i: intensity, k: 0, flicker, seed: pool.length * 7.31 };
  pool.push(L);
  return L;
}

// Мерцание: сумма несоизмеримых синусов — живое пламя без шума на кадр.
function flickerAt(L, t) {
  if (!L.flicker) return 1;
  const s = L.seed;
  const f = 0.55 * Math.sin(t * 9.1 + s) + 0.3 * Math.sin(t * 15.7 + s * 2.1) + 0.15 * Math.sin(t * 23.3 + s * 3.7);
  return 1 + L.flicker * f * 0.35;
}

const picked = [];
export function updatePointLights(ref, t = 0) {
  picked.length = 0;
  for (const L of pool) {
    if (L.k * L.i <= 0.001) continue;
    L.score = (L.i * L.k * L.r) / (1 + L.p.distanceToSquared(ref) * 0.01);
    picked.push(L);
  }
  picked.sort((a, b) => b.score - a.score);
  POINT_LIGHTS.uPLNum.value = Math.min(PL_COUNT, picked.length);
  for (let i = 0; i < PL_COUNT; i++) {
    const L = picked[i];
    const P = POINT_LIGHTS.uPLPos.value[i];
    const C = POINT_LIGHTS.uPLCol.value[i];
    if (!L) { P.set(0, -999, 0, 1); C.set(0, 0, 0); continue; }
    const k = L.i * L.k * flickerAt(L, t);
    P.set(L.p.x, L.p.y, L.p.z, 1 / (L.r * L.r));
    C.set(L.c.r * k, L.c.g * k, L.c.b * k);
  }
}

const PARS = `uniform vec4 uPLPos[${PL_COUNT}];\nuniform vec3 uPLCol[${PL_COUNT}];\nuniform int uPLNum;\nvarying vec3 vPLWorld;`;
const BODY = `
	{
		vec3 plN = inverseTransformDirection( normal, viewMatrix );
		vec3 plIrr = vec3( 0.0 );
		for ( int i = 0; i < ${PL_COUNT}; i ++ ) {
			if ( i >= uPLNum ) break;
			vec3 d = uPLPos[ i ].xyz - vPLWorld;
			float dd = dot( d, d );
			// Окно по радиусу × обратный квадрат с мягким ядром (без бесконечной яркости у источника).
			float a = max( 0.0, 1.0 - dd * uPLPos[ i ].w );
			a *= a / ( 1.0 + dd );
			float n = dot( plN, d ) * inversesqrt( dd + 1e-4 );
			plIrr += uPLCol[ i ] * a * ( max( n, 0.0 ) * 0.85 + 0.15 );
		}
		// Мягкое сжатие освещённости у самого огня: камни кострища не «выгорают» в белое,
		// дальние пятна света почти не меняются.
		reflectedLight.directDiffuse += plIrr / ( 1.0 + plIrr / 8.0 ) * DIFFUSE_TERM;
	}`;

// Подключение к стандартному/физическому материалу (цепочкой к уже заданному onBeforeCompile).
export function applyPointLights(material) {
  if (patched.has(material)) return material;
  patched.add(material);
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, POINT_LIGHTS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPLWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvPLWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n#ifdef USE_INSTANCING\nvPLWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${BODY.replace('DIFFUSE_TERM', material.isMeshStandardMaterial ? 'material.diffuseContribution' : 'material.diffuseColor')}`);
  };
  // Ключ программы: собственный ключ материала или текст его прежнего onBeforeCompile.
  const own = Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey');
  const prevKey = own ? material.customProgramCacheKey.bind(material) : () => (prev === THREE.Material.prototype.onBeforeCompile ? '' : String(prev));
  material.customProgramCacheKey = () => `${prevKey()}|pl1`;
  material.needsUpdate = true;
  return material;
}
