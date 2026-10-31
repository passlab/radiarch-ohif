// The dose resampled onto another grid (an image volume), trilinearly; zero outside the dose grid.

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The fractional frame index of an offset along the normal, or -1 outside. */
function frameIndex(geometry, w) {
  const { frameOffsets: f, uniformFrames, frameSpacing } = geometry;
  const last = f.length - 1;
  if (w < f[0] - 1e-6 || w > f[last] + 1e-6) {
    return -1;
  }
  if (last === 0) {
    return 0;
  }
  if (uniformFrames) {
    return Math.min(last, Math.max(0, (w - f[0]) / frameSpacing));
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (f[mid] <= w) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo + (w - f[lo]) / (f[hi] - f[lo]);
}

/**
 * Patient coordinates (mm) to the dose grid's fractional (i, j, k), or null outside it.
 *
 * @param {ReturnType<import('./rtdose.js').doseGeometry>} geometry
 * @param {number[]} p
 */
export function worldToDoseIndex(geometry, p) {
  const d = [p[0] - geometry.origin[0], p[1] - geometry.origin[1], p[2] - geometry.origin[2]];
  const i = dot(d, geometry.rowDirection) / geometry.colSpacing;
  const j = dot(d, geometry.columnDirection) / geometry.rowSpacing;
  const k = frameIndex(geometry, dot(d, geometry.normal));
  const tol = 1e-6;
  if (k < 0 || i < -tol || j < -tol || i > geometry.columns - 1 + tol || j > geometry.rows - 1 + tol) {
    return null;
  }
  return [Math.min(Math.max(i, 0), geometry.columns - 1), Math.min(Math.max(j, 0), geometry.rows - 1), k];
}

function sample(values, g, i, j, k) {
  const nx = g.columns;
  const ny = g.rows;
  const nz = g.frames;
  const i0 = Math.floor(i);
  const j0 = Math.floor(j);
  const k0 = Math.floor(k);
  const i1 = Math.min(i0 + 1, nx - 1);
  const j1 = Math.min(j0 + 1, ny - 1);
  const k1 = Math.min(k0 + 1, nz - 1);
  const fi = i - i0;
  const fj = j - j0;
  const fk = k - k0;
  const at = (a, b, c) => values[(c * ny + b) * nx + a];
  const c00 = at(i0, j0, k0) * (1 - fi) + at(i1, j0, k0) * fi;
  const c10 = at(i0, j1, k0) * (1 - fi) + at(i1, j1, k0) * fi;
  const c01 = at(i0, j0, k1) * (1 - fi) + at(i1, j0, k1) * fi;
  const c11 = at(i0, j1, k1) * (1 - fi) + at(i1, j1, k1) * fi;
  const c0 = c00 * (1 - fj) + c10 * fj;
  const c1 = c01 * (1 - fj) + c11 * fj;
  return c0 * (1 - fk) + c1 * fk;
}

/**
 * The dose on a target grid, x fastest then y then z, as a Cornerstone volume stores it: target voxel
 * (x, y, z) lies at origin + x·spacing[0]·direction[0..2] + y·spacing[1]·direction[3..5] + z·spacing[2]·direction[6..8].
 *
 * @param {{geometry: object, values: Float32Array}} dose from readDose
 * @param {{dimensions:number[], spacing:number[], origin:number[], direction:number[]}} target
 * @returns {Float32Array}
 */
export function resampleToGrid(dose, target) {
  const { geometry: g, values } = dose;
  const [nx, ny, nz] = target.dimensions;
  const [sx, sy, sz] = target.spacing;
  const dir = target.direction;
  const ax = [dir[0] * sx, dir[1] * sx, dir[2] * sx];
  const ay = [dir[3] * sy, dir[4] * sy, dir[5] * sy];
  const az = [dir[6] * sz, dir[7] * sz, dir[8] * sz];
  const out = new Float32Array(nx * ny * nz);
  const p = [0, 0, 0];
  let n = 0;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++, n++) {
        p[0] = target.origin[0] + x * ax[0] + y * ay[0] + z * az[0];
        p[1] = target.origin[1] + x * ax[1] + y * ay[1] + z * az[1];
        p[2] = target.origin[2] + x * ax[2] + y * ay[2] + z * az[2];
        const idx = worldToDoseIndex(g, p);
        out[n] = idx === null ? 0 : sample(values, g, idx[0], idx[1], idx[2]);
      }
    }
  }
  return out;
}
