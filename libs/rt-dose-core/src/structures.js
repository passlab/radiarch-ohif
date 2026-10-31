// Which structures of a structure set a plan review shows by default. Research use only; not for clinical use.

function items(seq) {
  if (!seq) {
    return [];
  }
  return Array.isArray(seq) ? seq : [seq];
}

const AID_TYPES = new Set(['AVOIDANCE', 'CONTROL', 'DOSE_REGION', 'BOLUS', 'SUPPORT', 'FIXATION', 'REGISTRATION', 'ISOCENTER', 'MARKER']);
// optimisation rings and helpers, and an organ minus a target ("Lungs-PTV"): drawn over the targets and organs
// they come from, they hide them
const AID_NAMES = [/^ring/i, /^z_/i, /^opt/i, /^avoid/i, /[-−]\s*(gtv|ctv|itv|ptv)/i];

/**
 * The names of a structure set's planning aids: ROIs interpreted as avoidance, control or similar (RT ROI
 * Observations), and optimisation helpers by name. A review shows them on request, not by default.
 *
 * @param {object} rtstruct naturalized RT Structure Set
 * @returns {Set<string>}
 */
export function planningAids(rtstruct) {
  const names = new Map();
  for (const roi of items(rtstruct?.StructureSetROISequence)) {
    names.set(Number(roi.ROINumber), String(roi.ROIName ?? ''));
  }
  const aids = new Set();
  for (const obs of items(rtstruct?.RTROIObservationsSequence)) {
    const name = names.get(Number(obs.ReferencedROINumber));
    if (name && AID_TYPES.has(String(obs.RTROIInterpretedType ?? '').toUpperCase())) {
      aids.add(name);
    }
  }
  for (const name of names.values()) {
    if (AID_NAMES.some(re => re.test(name))) {
      aids.add(name);
    }
  }
  return aids;
}
