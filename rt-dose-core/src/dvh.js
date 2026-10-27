// The DVHs an RT Dose carries (RT DVH module, PS3.3 C.8.8.4), as cumulative curves a panel can plot.

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

/**
 * ROI names and display colours of a structure set, by ROI number.
 *
 * @param {object} rtstruct naturalized RT Structure Set
 * @returns {Map<number, {name: string, color: number[] | null}>}
 */
export function roiInfo(rtstruct) {
  const out = new Map();
  for (const roi of items(rtstruct?.StructureSetROISequence)) {
    out.set(num(roi.ROINumber), { name: String(roi.ROIName ?? `ROI ${roi.ROINumber}`), color: null });
  }
  for (const c of items(rtstruct?.ROIContourSequence)) {
    const number = num(c.ReferencedROINumber);
    const entry = out.get(number) ?? { name: `ROI ${number}`, color: null };
    const color = nums(c.ROIDisplayColor);
    entry.color = color.length === 3 ? color : null;
    out.set(number, entry);
  }
  return out;
}

/**
 * The DVHs of an RT Dose, cumulative: dose (Gy) at each bin's lower edge and the volume at or above it, in the file's
 * units and in % of the ROI. A differential DVH is accumulated. Returns [] when the dose carries none.
 *
 * @param {object} rtdose naturalized RT Dose
 * @param {Map<number, {name: string, color: number[] | null}>} [rois] from roiInfo
 */
export function readDVHs(rtdose, rois = new Map()) {
  const curves = [];
  for (const item of items(rtdose?.DVHSequence)) {
    const ref = items(item.DVHReferencedROISequence)[0];
    const roiNumber = ref ? num(ref.ReferencedROINumber) : NaN;
    const scaling = num(item.DVHDoseScaling ?? 1);
    const data = nums(item.DVHData);
    const n = Math.min(num(item.DVHNumberOfBins ?? data.length / 2), Math.floor(data.length / 2));
    const dose = new Float64Array(n);
    let volume = new Float64Array(n);
    let edge = 0;
    for (let b = 0; b < n; b++) {
      dose[b] = edge;
      edge += data[2 * b] * scaling;
      volume[b] = data[2 * b + 1];
    }
    const type = String(item.DVHType ?? 'CUMULATIVE');
    if (type === 'DIFFERENTIAL') {
      const cum = new Float64Array(n);
      let acc = 0;
      for (let b = n - 1; b >= 0; b--) {
        acc += volume[b];
        cum[b] = acc;
      }
      volume = cum;
    }
    const total = n ? volume[0] : 0;
    const percent = Float64Array.from(volume, v => (total > 0 ? (100 * v) / total : 0));
    const info = rois.get(roiNumber);
    curves.push({
      roiNumber,
      name: info?.name ?? `ROI ${roiNumber}`,
      color: info?.color ?? null,
      doseGy: dose,
      volume,
      volumeUnits: String(item.DVHVolumeUnits ?? ''),
      percent,
      maxDoseBinEdgeGy: edge,
      minGy: item.DVHMinimumDose !== undefined ? num(item.DVHMinimumDose) : null,
      maxGy: item.DVHMaximumDose !== undefined ? num(item.DVHMaximumDose) : null,
      meanGy: item.DVHMeanDose !== undefined ? num(item.DVHMeanDose) : null,
      source: 'file',
    });
  }
  return curves;
}

const MAX_BINS = 1000;

/** radiarch's DVH bin width (dicom/writers/rtdose.dvh_bin_width): 1, 2 or 5 × 10^k Gy, ≥ 0.01 Gy, ≤ 1000 bins. */
export function dvhBinWidth(maxGy) {
  const target = Math.max(0.01, maxGy / (MAX_BINS - 1));
  const k = Math.floor(Math.log10(target));
  for (const m of [1, 2, 5, 10]) {
    if (m * 10 ** k >= target * (1 - 1e-9)) {
      return parseFloat((m * 10 ** k).toPrecision(6));
    }
  }
  return 10 ** (k + 1);
}

/**
 * DVHs computed here, for a dose that carries none: each ROI's mask on the dose grid (rasterize.js), then the
 * cumulative DVH of the dose in it, in cm³ and %, bins as radiarch writes them. Marked `source: 'computed in the
 * browser'`, as they differ from the planning system's at structure edges.
 *
 * @param {{geometry: object, values: Float32Array}} dose from readDose
 * @param {Map<number, Uint8Array>} masks from structureMasks
 * @param {Map<number, {name: string, color: number[] | null}>} [rois] from roiInfo
 */
export function computeDVHs(dose, masks, rois = new Map()) {
  const g = dose.geometry;
  const voxelCc = (g.colSpacing * g.rowSpacing * (g.frameSpacing || 1)) / 1000;
  let doseMax = 0;
  for (const v of dose.values) {
    doseMax = Math.max(doseMax, v);
  }
  const width = dvhBinWidth(doseMax);
  const curves = [];
  for (const [roiNumber, mask] of masks) {
    const inside = [];
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) {
        inside.push(dose.values[i]);
      }
    }
    if (!inside.length) {
      continue;
    }
    inside.sort((a, b) => a - b);
    const n = Math.floor(inside[inside.length - 1] / width) + 1;
    const doseGy = new Float64Array(n);
    const volume = new Float64Array(n);
    const percent = new Float64Array(n);
    let below = 0;
    for (let b = 0; b < n; b++) {
      const edge = b * width;
      while (below < inside.length && inside[below] < edge) {
        below++;
      }
      doseGy[b] = edge;
      percent[b] = (100 * (inside.length - below)) / inside.length;
      volume[b] = ((inside.length - below) * voxelCc);
    }
    const info = rois.get(roiNumber);
    curves.push({
      roiNumber,
      name: info?.name ?? `ROI ${roiNumber}`,
      color: info?.color ?? null,
      doseGy,
      volume,
      volumeUnits: 'CM3',
      percent,
      maxDoseBinEdgeGy: n * width,
      minGy: inside[0],
      maxGy: inside[inside.length - 1],
      meanGy: inside.reduce((s, v) => s + v, 0) / inside.length,
      source: 'computed in the browser',
    });
  }
  return curves.sort((a, b) => a.roiNumber - b.roiNumber);
}
