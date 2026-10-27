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
