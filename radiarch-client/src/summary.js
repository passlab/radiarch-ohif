// What a panel shows of an export and an evaluation, as plain rows.

export const INTENDED_USE = 'RESEARCH USE ONLY. NOT FOR CLINICAL USE.';

/**
 * The plan summary of an export: prescription, fractions, technique, machine, beams with their metersets per fraction,
 * the engine and machine model it came from.
 *
 * @param {object} exp an RTExportResult
 */
export function planSummary(exp) {
  const metersets = exp.beam_metersets ?? {};
  const beams = Object.entries(exp.beam_numbers ?? {})
    .sort((a, b) => a[1] - b[1])
    .map(([name, number]) => ({ number, name, muPerFraction: metersets[name] ?? null }));
  const fractions = exp.prescription?.fractions ?? exp.n_fractions ?? 1;
  const totalPerFraction = beams.reduce((s, b) => s + (b.muPerFraction ?? 0), 0);
  const a = exp.attribution ?? {};
  return {
    exportId: exp.export_id,
    created: exp.created_at ?? null,
    modality: exp.modality,
    prescription: exp.prescription
      ? { doseGy: exp.prescription.dose_gy, fractions, perFractionGy: exp.prescription.dose_gy / fractions, target: exp.prescription.target_structure ?? null }
      : null,
    fractions,
    machine: exp.machine_name ?? null,
    beams,
    muPerFraction: totalPerFraction,
    muCourse: totalPerFraction * fractions,
    engine: a.engine_name ? `${a.engine_name}${a.engine_version ? ` ${a.engine_version}` : ''}` : null,
    machineModel: a.machine_model_id ?? null,
    radiarchVersion: a.capability_version ?? null,
    ids: { geometry: exp.geometry_id, beamModel: exp.beam_model_id, dose: exp.dose_id ?? null, plan: exp.plan_id ?? null },
    intendedUse: INTENDED_USE,
  };
}

/**
 * The graded goals of an evaluation, priority first then by structure: what was asked, what was achieved, met or not
 * (null when the structure is missing).
 *
 * @param {object} evaluation an EvaluationResult
 */
export function goalRows(evaluation) {
  const goals = evaluation?.goals?.results ?? [];
  return goals
    .map(g => ({
      priority: g.priority,
      structure: g.structure,
      resolved: g.resolved_structure ?? null,
      goal: `${g.metric} ${g.op} ${g.value}`,
      achieved: g.achieved ?? null,
      passed: g.passed ?? null,
      margin: g.margin ?? null,
      note: g.note ?? '',
    }))
    .sort((x, y) => x.priority - y.priority || String(x.structure).localeCompare(String(y.structure)));
}

/**
 * An evaluation's DVHs as chart curves (the shape @radiarch/ohif-extension-rt-dose's DVHChart draws), coloured by
 * structure name when the colours are known.
 *
 * @param {object} evaluation an EvaluationResult
 * @param {Map<string, number[]>} [colors] structure name → RGB 0–255
 */
export function evaluationCurves(evaluation, colors = new Map()) {
  return (evaluation?.dvh_curves ?? []).map((c, i) => ({
    roiNumber: i + 1,
    name: c.structure_name,
    color: colors.get(c.structure_name) ?? null,
    doseGy: c.dose_bins_gy,
    percent: c.volume_pct,
    maxDoseBinEdgeGy: c.dose_bins_gy.length ? c.dose_bins_gy[c.dose_bins_gy.length - 1] : 0,
    minGy: c.metrics?.min_gy ?? null,
    meanGy: c.metrics?.mean_gy ?? null,
    maxGy: c.metrics?.max_gy ?? null,
    source: 'radiarch evaluation',
  }));
}
