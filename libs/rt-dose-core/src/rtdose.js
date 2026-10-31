// The dose volume of a DICOM RT Dose (PS3.3 C.8.8.3), from a naturalized dataset as dcmjs gives it: keywords as keys,
// numbers as numbers (or numeric strings), sequences as arrays, PixelData as an ArrayBuffer or an array of them.

const EPS = 1e-6;

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

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * The grid of an RT Dose: voxel (i column, j row, k frame) lies at
 * origin + i·colSpacing·row + j·rowSpacing·column + frameOffsets[k]·normal (patient coordinates, mm).
 *
 * @param {object} ds naturalized RT Dose
 * @returns {{columns:number, rows:number, frames:number, origin:number[], rowDirection:number[], columnDirection:number[],
 *            normal:number[], colSpacing:number, rowSpacing:number, frameOffsets:number[], uniformFrames:boolean, frameSpacing:number}}
 */
export function doseGeometry(ds) {
  const iop = nums(ds.ImageOrientationPatient);
  const rowDirection = iop.slice(0, 3);
  const columnDirection = iop.slice(3, 6);
  const normal = cross(rowDirection, columnDirection);
  const origin = nums(ds.ImagePositionPatient);
  const [rowSpacing, colSpacing] = nums(ds.PixelSpacing);   // DICOM: between rows, then between columns
  const frames = num(ds.NumberOfFrames ?? 1);
  let offsets = nums(ds.GridFrameOffsetVector);
  if (offsets.length === 0) {
    offsets = [0];
  }
  if (offsets.length !== frames) {
    throw new Error(`GridFrameOffsetVector has ${offsets.length} values for ${frames} frames`);
  }
  // C.8.8.3.2: relative to the first frame when its first value is 0, else positions along the normal
  if (Math.abs(offsets[0]) > EPS) {
    const z0 = dot(origin, normal);
    offsets = offsets.map(o => o - z0);
  }
  const steps = offsets.slice(1).map((o, k) => o - offsets[k]);
  const frameSpacing = steps.length ? steps[0] : num(ds.SliceThickness ?? 1);
  const uniformFrames = steps.every(s => Math.abs(s - frameSpacing) < 1e-3);
  if (steps.some(s => s <= 0)) {
    throw new Error('GridFrameOffsetVector must increase');
  }
  return {
    columns: num(ds.Columns),
    rows: num(ds.Rows),
    frames,
    origin,
    rowDirection,
    columnDirection,
    normal,
    colSpacing,
    rowSpacing,
    frameOffsets: offsets,
    uniformFrames,
    frameSpacing,
  };
}

function pixelBuffer(pixelData) {
  const parts = Array.isArray(pixelData) ? pixelData : [pixelData];
  const views = parts.map(p => (p instanceof ArrayBuffer ? new Uint8Array(p) : new Uint8Array(p.buffer, p.byteOffset, p.byteLength)));
  if (views.length === 1) {
    return views[0];
  }
  const out = new Uint8Array(views.reduce((n, v) => n + v.length, 0));
  let at = 0;
  for (const v of views) {
    out.set(v, at);
    at += v.length;
  }
  return out;
}

/**
 * The dose in Gy, frame by frame, row by row (x fastest): stored values × DoseGridScaling.
 *
 * @param {object} ds naturalized RT Dose
 * @returns {Float32Array}
 */
export function doseValues(ds) {
  const n = num(ds.Columns) * num(ds.Rows) * num(ds.NumberOfFrames ?? 1);
  const bits = num(ds.BitsAllocated);
  const signed = num(ds.PixelRepresentation ?? 0) === 1;
  const scaling = num(ds.DoseGridScaling ?? 1);
  const bytes = pixelBuffer(ds.PixelData);
  if (bytes.length < n * (bits / 8)) {
    throw new Error(`PixelData has ${bytes.length} bytes for ${n} voxels of ${bits} bits`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v;
    if (bits === 32) {
      v = signed ? view.getInt32(4 * i, true) : view.getUint32(4 * i, true);
    } else if (bits === 16) {
      v = signed ? view.getInt16(2 * i, true) : view.getUint16(2 * i, true);
    } else {
      throw new Error(`unsupported BitsAllocated ${bits}`);
    }
    out[i] = v * scaling;
  }
  return out;
}

/**
 * Geometry, values and the facts a viewer labels the dose with.
 *
 * @param {object} ds naturalized RT Dose
 */
export function readDose(ds) {
  const geometry = doseGeometry(ds);
  const values = doseValues(ds);
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > max) {
      max = values[i];
    }
  }
  return {
    geometry,
    values,
    max,
    units: String(ds.DoseUnits ?? 'GY'),
    type: String(ds.DoseType ?? 'PHYSICAL'),
    summation: String(ds.DoseSummationType ?? ''),
    comment: String(ds.DoseComment ?? ''),
  };
}
