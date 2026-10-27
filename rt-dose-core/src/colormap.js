// Isodose levels and the dose colour wash: colour bands at the isodose levels of a reference dose, transparent
// below the lowest level.

export const DEFAULT_ISODOSE_PERCENTS = [107, 100, 95, 90, 80, 70, 50, 30];

// From cold to hot, one colour per level from the lowest up (RGB 0–1)
const PALETTE = [
  [0.0, 0.0, 1.0],
  [0.0, 0.6, 1.0],
  [0.0, 0.8, 0.4],
  [0.6, 0.9, 0.0],
  [1.0, 0.9, 0.0],
  [1.0, 0.6, 0.0],
  [1.0, 0.0, 0.0],
  [1.0, 0.0, 1.0],
];

/**
 * Isodose levels in Gy, highest first, each with a colour.
 *
 * @param {number} referenceGy the 100 % level (the prescription; the maximum when there is none)
 * @param {number[]} [percents]
 */
export function isodoseLevels(referenceGy, percents = DEFAULT_ISODOSE_PERCENTS) {
  if (!(referenceGy > 0)) {
    return [];
  }
  const sorted = [...new Set(percents)].filter(p => p > 0).sort((a, b) => a - b);
  const levels = sorted.map((percent, i) => ({
    percent,
    gy: (referenceGy * percent) / 100,
    color: PALETTE[Math.round((i * (PALETTE.length - 1)) / Math.max(1, sorted.length - 1))],
  }));
  return levels.reverse();
}

/**
 * A Cornerstone-style colormap for the dose: RGB points and opacity points in Gy. Below the lowest level the dose is
 * transparent; each band [level, next level) has the level's colour. Cornerstone takes opacity points as data values
 * but rescales RGB points onto the display window, so a viewer sets its window to `range` (0 Gy to `range[1]`).
 *
 * @param {ReturnType<typeof isodoseLevels>} levels
 * @param {{opacity?: number, maxGy?: number}} [options]
 */
export function doseColormap(levels, { opacity = 0.5, maxGy } = {}) {
  const asc = [...levels].sort((a, b) => a.gy - b.gy);
  if (asc.length === 0) {
    return { name: 'radiarch-dose', RGBPoints: [], opacity: [], range: [0, maxGy ?? 0] };
  }
  const top = Math.max(maxGy ?? 0, asc[asc.length - 1].gy) * 1.0001;
  const RGBPoints = [0, ...asc[0].color];
  const opacityPoints = [{ value: 0, opacity: 0 }, { value: asc[0].gy * 0.9999, opacity: 0 }];
  asc.forEach((level, i) => {
    const end = i + 1 < asc.length ? asc[i + 1].gy * 0.9999 : top;
    RGBPoints.push(level.gy, ...level.color, end, ...level.color);
    opacityPoints.push({ value: level.gy, opacity }, { value: end, opacity });
  });
  return { name: 'radiarch-dose', RGBPoints, opacity: opacityPoints, range: [0, top] };
}

/**
 * The 100 % isodose: the plan's target prescription dose (Dose Reference Sequence, the first TARGET with a Target
 * Prescription Dose), else the dose maximum. Says which it is.
 *
 * @param {object | null} rtplan naturalized RT (Ion) Plan, or null
 * @param {number} doseMaxGy
 * @returns {{gy: number, source: 'prescription' | 'maximum'}}
 */
export function referenceDose(rtplan, doseMaxGy) {
  const refs = rtplan?.DoseReferenceSequence;
  for (const r of Array.isArray(refs) ? refs : refs ? [refs] : []) {
    const gy = parseFloat(r.TargetPrescriptionDose);
    if ((r.DoseReferenceType ?? 'TARGET') === 'TARGET' && gy > 0) {
      return { gy, source: 'prescription' };
    }
  }
  return { gy: doseMaxGy, source: 'maximum' };
}

/**
 * The dose in % of a reference dose, the units the viewer's colour wash works in (its levels and window are then fixed).
 *
 * @param {Float32Array} values Gy
 * @param {number} referenceGy
 */
export function relativeDose(values, referenceGy) {
  const out = new Float32Array(values.length);
  if (!(referenceGy > 0)) {
    return out;
  }
  const k = 100 / referenceGy;
  for (let i = 0; i < values.length; i++) {
    out[i] = values[i] * k;
  }
  return out;
}
