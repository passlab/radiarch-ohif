// Structure masks on the dose grid from an RT Structure Set's closed planar contours: each contour goes to the dose
// frame its plane lies on (within half a frame), and the voxels whose centres lie inside an odd number of the ROI's
// contours on that frame are in the mask (even-odd, so a contour inside another is a hole).

function num(v) {
  return typeof v === 'number' ? v : parseFloat(v);
}

function nums(v) {
  if (v === undefined || v === null) {
    return [];
  }
  if (typeof v === 'string') {
    return v.split('\\').map(parseFloat);
  }
  return Array.from(Array.isArray(v) ? v : [v], num);
}

function items(seq) {
  if (!seq) {
    return [];
  }
  return Array.isArray(seq) ? seq : [seq];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The nearest frame of an offset along the normal, or -1 beyond half a frame from the grid. */
function nearestFrame(g, w) {
  const f = g.frameOffsets;
  let best = -1;
  let dist = Infinity;
  for (let k = 0; k < f.length; k++) {
    const d = Math.abs(f[k] - w);
    if (d < dist) {
      dist = d;
      best = k;
    }
  }
  const half = (f.length > 1 ? Math.min(...f.slice(1).map((o, k) => o - f[k])) : g.frameSpacing || 1) / 2;
  return dist <= half + 1e-6 ? best : -1;
}

/**
 * One ROI's mask on the dose grid (a Uint8Array, frame by frame, x fastest), from its closed planar contours.
 *
 * @param {object[]} contours the ROI's Contour Sequence items (ContourGeometricType, ContourData)
 * @param {ReturnType<import('./rtdose.js').doseGeometry>} g
 */
export function contourMask(contours, g) {
  const { columns: nx, rows: ny, frames: nz } = g;
  const mask = new Uint8Array(nx * ny * nz);
  const byFrame = new Map();
  for (const c of contours) {
    if (String(c.ContourGeometricType ?? 'CLOSED_PLANAR') !== 'CLOSED_PLANAR') {
      continue;
    }
    const pts = nums(c.ContourData);
    if (pts.length < 9) {
      continue;
    }
    const poly = [];
    let w = 0;
    for (let p = 0; p < pts.length; p += 3) {
      const d = [pts[p] - g.origin[0], pts[p + 1] - g.origin[1], pts[p + 2] - g.origin[2]];
      poly.push([dot(d, g.rowDirection) / g.colSpacing, dot(d, g.columnDirection) / g.rowSpacing]);
      w += dot(d, g.normal);
    }
    const k = nearestFrame(g, w / (pts.length / 3));
    if (k >= 0) {
      if (!byFrame.has(k)) {
        byFrame.set(k, []);
      }
      byFrame.get(k).push(poly);
    }
  }
  for (const [k, polys] of byFrame) {
    for (let j = 0; j < ny; j++) {
      const xs = [];
      for (const poly of polys) {
        for (let e = 0; e < poly.length; e++) {
          const [x0, y0] = poly[e];
          const [x1, y1] = poly[(e + 1) % poly.length];
          if ((y0 <= j && y1 > j) || (y1 <= j && y0 > j)) {
            xs.push(x0 + ((j - y0) / (y1 - y0)) * (x1 - x0));
          }
        }
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const from = Math.max(0, Math.ceil(xs[q]));
        const to = Math.min(nx - 1, Math.ceil(xs[q + 1]) - 1);
        for (let i = from; i <= to; i++) {
          mask[(k * ny + j) * nx + i] ^= 1;
        }
      }
    }
  }
  return mask;
}

/**
 * Every ROI of a structure set with contours, as masks on the dose grid.
 *
 * @param {object} rtstruct naturalized RT Structure Set (with its ContourData, not bulk data references)
 * @param {ReturnType<import('./rtdose.js').doseGeometry>} g
 * @returns {Map<number, Uint8Array>} ROI number → mask
 */
export function structureMasks(rtstruct, g) {
  const out = new Map();
  for (const roi of items(rtstruct?.ROIContourSequence)) {
    const contours = items(roi.ContourSequence);
    if (contours.length) {
      out.set(num(roi.ReferencedROINumber), contourMask(contours, g));
    }
  }
  return out;
}
