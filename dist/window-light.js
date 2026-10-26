// Приближённый рассеянный свет от реальных световых проёмов и лампы помещений.
// В шейдер материалов интерьера добавляется освещённость от прямоугольника окна (аналитический
// форм-фактор многоугольника), ограниченная помещением этого окна. Ночью дневная добавка отключается.
import * as THREE from 'three';
import { ROOMS, LIGHT_OPENINGS, ceilingHeight } from './plan.js';

const MAX_RECTS = 24;
const MAX_WIN = 12;
const MAX_LAMP = 10;
const ROOM_INDEX = Object.fromEntries(ROOMS.map((r, i) => [r.id, i]));

const vec3s = (n) => Array.from({ length: n }, () => new THREE.Vector3());

export const WL_UNIFORMS = {
  uWLRect: { value: Array.from({ length: MAX_RECTS }, () => new THREE.Vector4()) },
  uWLRectRoom: { value: new Float32Array(MAX_RECTS).fill(-1) },
  uWLRectCount: { value: 0 },
  uWLWinC: { value: vec3s(MAX_WIN) },
  uWLWinU: { value: vec3s(MAX_WIN) },
  uWLWinV: { value: vec3s(MAX_WIN) },
  uWLWinN: { value: vec3s(MAX_WIN) },
  uWLWinL: { value: vec3s(MAX_WIN) },
  uWLWinRoom: { value: new Float32Array(MAX_WIN).fill(-1) },
  uWLWinCount: { value: 0 },
  uWLLampP: { value: vec3s(MAX_LAMP) },
  uWLLampC: { value: vec3s(MAX_LAMP) },
  uWLLampRoom: { value: new Float32Array(MAX_LAMP).fill(-1) },
  uWLLampCount: { value: 0 },
  uWLStrength: { value: 1 },
};

// Геометрия проёмов и помещений (постоянная).
const WINDOWS = LIGHT_OPENINGS.map((o) => {
  const w = o.wall;
  // Сторона помещения: у фасадных стен — внутренняя сторона, у восточных — сторона 004/005.
  const side = w.left && w.left !== '008' ? 1 : -1;
  const roomId = side === 1 ? w.left : w.right;
  const mid = (o.from + o.to) / 2;
  const cx = w.a[0] + w.ux * mid;
  const cz = w.a[1] + w.uz * mid;
  const nIn = new THREE.Vector3(w.nx * side, 0, w.nz * side);
  const c = new THREE.Vector3(cx, (o.low + o.high) / 2, cz).addScaledVector(nIn, w.t / 2);
  const U = new THREE.Vector3(w.ux, 0, w.uz).multiplyScalar((o.to - o.from) / 2);
  let V = new THREE.Vector3(0, (o.high - o.low) / 2, 0);
  if (new THREE.Vector3().crossVectors(U, V).dot(nIn) > 0) V = V.negate();
  return { id: o.id, roomId, c, U, V, n: nIn, area: (o.to - o.from) * (o.high - o.low), facadeNormal: nIn.clone().negate(), covered: w.right === '008' };
});

export function initWindowLight() {
  const u = WL_UNIFORMS;
  let k = 0;
  for (const r of ROOMS) {
    if (r.kind === 'terrace') continue;
    for (const [x0, z0, x1, z1] of r.rects) {
      if (k >= MAX_RECTS) break;
      u.uWLRect.value[k].set(x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02);
      u.uWLRectRoom.value[k] = ROOM_INDEX[r.id];
      k++;
    }
  }
  u.uWLRectCount.value = k;
  WINDOWS.slice(0, MAX_WIN).forEach((w, i) => {
    u.uWLWinC.value[i].copy(w.c);
    u.uWLWinU.value[i].copy(w.U);
    u.uWLWinV.value[i].copy(w.V);
    u.uWLWinN.value[i].copy(w.n);
    u.uWLWinRoom.value[i] = ROOM_INDEX[w.roomId];
  });
  u.uWLWinCount.value = Math.min(MAX_WIN, WINDOWS.length);
  const lampRooms = ROOMS.filter((r) => r.kind !== 'terrace').slice(0, MAX_LAMP);
  lampRooms.forEach((r, i) => {
    const [x, z] = r.center;
    u.uWLLampP.value[i].set(x, ceilingHeight(z) - 0.15, z);
    u.uWLLampRoom.value[i] = ROOM_INDEX[r.id];
  });
  u.uWLLampCount.value = lampRooms.length;
}
initWindowLight();

// Обновление яркости проёмов по солнцу: небо через окно + отражённый свет освещённого фасада.
export function updateWindowLight({ sunDir, daylight, skyColor, sunColor, lamp, strength = 1 }) {
  const u = WL_UNIFORMS;
  const sun = new THREE.Vector3(...sunDir);
  WINDOWS.slice(0, MAX_WIN).forEach((w, i) => {
    const facing = Math.max(0, sun.dot(w.facadeNormal)) * Math.max(0, Math.min(1, sun.y * 4 + 0.2));
    const cover = w.covered ? 0.62 : 1;
    const L = new THREE.Vector3(skyColor.r, skyColor.g, skyColor.b).multiplyScalar(0.55 * daylight * cover)
      .add(new THREE.Vector3(sunColor.r, sunColor.g, sunColor.b).multiplyScalar(0.55 * facing * daylight * cover));
    u.uWLWinL.value[i].copy(L.multiplyScalar(Math.PI * 0.85));
  });
  for (let i = 0; i < u.uWLLampCount.value; i++) u.uWLLampC.value[i].set(1.0, 0.78, 0.52).multiplyScalar(2.2 * lamp);
  u.uWLStrength.value = strength;
}

const VERT_DECL = 'varying vec3 vWLWorld;\n';
const VERT_BODY = `
	{
		vec4 wlp = vec4( transformed, 1.0 );
		#ifdef USE_INSTANCING
			wlp = instanceMatrix * wlp;
		#endif
		vWLWorld = ( modelMatrix * wlp ).xyz;
	}
`;

const FRAG_DECL = `
varying vec3 vWLWorld;
uniform vec4 uWLRect[${MAX_RECTS}];
uniform float uWLRectRoom[${MAX_RECTS}];
uniform int uWLRectCount;
uniform vec3 uWLWinC[${MAX_WIN}];
uniform vec3 uWLWinU[${MAX_WIN}];
uniform vec3 uWLWinV[${MAX_WIN}];
uniform vec3 uWLWinN[${MAX_WIN}];
uniform vec3 uWLWinL[${MAX_WIN}];
uniform float uWLWinRoom[${MAX_WIN}];
uniform int uWLWinCount;
uniform vec3 uWLLampP[${MAX_LAMP}];
uniform vec3 uWLLampC[${MAX_LAMP}];
uniform float uWLLampRoom[${MAX_LAMP}];
uniform int uWLLampCount;
uniform float uWLStrength;
float wlEdge( vec3 a, vec3 b, vec3 n ) {
	float c = clamp( dot( a, b ), -0.9999, 0.9999 );
	vec3 cr = cross( a, b );
	float l = length( cr );
	return l > 1e-6 ? acos( c ) * dot( n, cr / l ) : 0.0;
}
vec3 wlIrradiance( vec3 P, vec3 N ) {
	float room = -1.0;
	for ( int i = 0; i < ${MAX_RECTS}; i ++ ) {
		if ( i >= uWLRectCount ) break;
		vec4 r = uWLRect[ i ];
		if ( P.x >= r.x && P.x <= r.z && P.z >= r.y && P.z <= r.w ) { room = uWLRectRoom[ i ]; break; }
	}
	if ( room < 0.0 ) return vec3( 0.0 );
	vec3 irr = vec3( 0.0 );
	for ( int i = 0; i < ${MAX_WIN}; i ++ ) {
		if ( i >= uWLWinCount ) break;
		if ( abs( uWLWinRoom[ i ] - room ) > 0.5 ) continue;
		vec3 c = uWLWinC[ i ];
		if ( dot( P - c, uWLWinN[ i ] ) < 0.01 ) continue;
		vec3 U = uWLWinU[ i ];
		vec3 V = uWLWinV[ i ];
		vec3 v0 = normalize( c - U - V - P );
		vec3 v1 = normalize( c + U - V - P );
		vec3 v2 = normalize( c + U + V - P );
		vec3 v3 = normalize( c - U + V - P );
		float ff = ( wlEdge( v0, v1, N ) + wlEdge( v1, v2, N ) + wlEdge( v2, v3, N ) + wlEdge( v3, v0, N ) ) / 6.2831853;
		irr += max( ff, 0.0 ) * uWLWinL[ i ];
	}
	for ( int i = 0; i < ${MAX_LAMP}; i ++ ) {
		if ( i >= uWLLampCount ) break;
		if ( abs( uWLLampRoom[ i ] - room ) > 0.5 ) continue;
		vec3 d = uWLLampP[ i ] - P;
		float d2 = dot( d, d );
		irr += uWLLampC[ i ] * ( max( dot( N, d / sqrt( d2 ) ), 0.0 ) * 0.85 + 0.15 ) / ( d2 + 0.6 );
	}
	return irr * uWLStrength;
}
`;

const FRAG_BODY = `
	{
		vec3 wlN = inverseTransformDirection( normal, viewMatrix );
		reflectedLight.indirectDiffuse += wlIrradiance( vWLWorld, wlN ) * BRDF_Lambert( material.diffuseColor );
	}
`;

// Внутри дома рассеянная часть уличного окружения не должна окрашивать потолок газоном:
// нижняя полусфера заменяется верхней, цвет приглушается (отражённый свет комнаты почти нейтрален).
const INTERIOR_IBL = THREE.ShaderChunk.lights_fragment_maps.replace(
  'iblIrradiance += getIBLIrradiance( geometryNormal );',
  `{
			vec3 wlWN = inverseTransformDirection( geometryNormal, viewMatrix );
			wlWN.y = abs( wlWN.y );
			vec3 wlIbl = getIBLIrradiance( transformDirection( wlWN, viewMatrix ) );
			iblIrradiance += mix( vec3( dot( wlIbl, vec3( 0.2126, 0.7152, 0.0722 ) ) ), wlIbl, 0.35 );
		}`,
);
if (INTERIOR_IBL === THREE.ShaderChunk.lights_fragment_maps) console.warn('window-light: фрагмент IBL не найден');

export function applyWindowLight(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    Object.assign(shader.uniforms, WL_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <lights_fragment_maps>', INTERIOR_IBL)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAG_BODY}`);
  };
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|wl2`;
}

export { WINDOWS as LIGHT_WINDOWS };
