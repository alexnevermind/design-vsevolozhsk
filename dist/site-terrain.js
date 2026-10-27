// Рельеф участка по отметкам съёмки: сглаживающий тонкопластинный сплайн (thin-plate spline).
// Подгонка выполняется при сборке данных (scripts/build-site.mjs), в приложении — только вычисление
// высоты по сохранённым весам. Координаты — метры участка (X на восток, Z на юг), высоты — Балтийская система.

function phi(r2) {
  return r2 > 1e-12 ? 0.5 * r2 * Math.log(r2) : 0; // r² ln r = ½ r² ln r²
}

// points: [[x, z, h], ...]; lambda — сглаживание (м²); возвращает модель для terrainAt().
export function fitTerrain(points, lambda = 0.5) {
  const n = points.length;
  const m = n + 3;
  const A = Array.from({ length: m }, () => new Float64Array(m + 1));
  for (let i = 0; i < n; i++) {
    const [xi, zi, hi] = points[i];
    for (let j = 0; j < n; j++) {
      const dx = xi - points[j][0];
      const dz = zi - points[j][1];
      A[i][j] = phi(dx * dx + dz * dz) + (i === j ? lambda : 0);
    }
    A[i][n] = 1; A[i][n + 1] = xi; A[i][n + 2] = zi;
    A[n][i] = 1; A[n + 1][i] = xi; A[n + 2][i] = zi;
    A[i][m] = hi;
  }
  // Гаусс с выбором ведущего элемента.
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('fitTerrain: вырожденная система');
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = A[r][c] / d;
      if (f === 0) continue;
      for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k];
    }
  }
  const sol = A.map((row, i) => row[m] / row[i]);
  return {
    lambda,
    points: points.map(([x, z]) => [x, z]),
    weights: sol.slice(0, n),
    affine: sol.slice(n, n + 3),
  };
}

export function terrainAt(model, x, z) {
  const { points, weights, affine } = model;
  let h = affine[0] + affine[1] * x + affine[2] * z;
  for (let i = 0; i < points.length; i++) {
    const dx = x - points[i][0];
    const dz = z - points[i][1];
    h += weights[i] * phi(dx * dx + dz * dz);
  }
  return h;
}
