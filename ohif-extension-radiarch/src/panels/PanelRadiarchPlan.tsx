// The radiarch plan behind the RT Dose in the active viewport: found by the dose's SOP Instance UID through
// GET /rt/exports, summarised, and evaluated by radiarch against a goal template (goals graded, radiarch's DVHs).
// Requests carry the host's authorization header; radiarch's API key never reaches the browser (ADR 0018).

import React, { useEffect, useMemo, useState } from 'react';
import { useViewportGrid } from '@ohif/ui-next';
import { createClient, planSummary, goalRows, evaluationCurves, INTENDED_USE } from '@radiarch/client';
import { DVHChart, onDoseLoaded } from '@radiarch/ohif-extension-rt-dose';

import { getConfig } from '../config';

const TEMPLATE_KEY = 'radiarch.goalTemplate';

function storedTemplate(): string | null {
  try {
    return window.localStorage.getItem(TEMPLATE_KEY);
  } catch {
    return null;
  }
}

function storeTemplate(id: string) {
  try {
    window.localStorage.setItem(TEMPLATE_KEY, id);
  } catch {
    // a browser without storage forgets the choice
  }
}

function fmt(v, digits = 2) {
  return v === null || v === undefined ? '–' : Number(v).toFixed(digits);
}

function PanelRadiarchPlan({ servicesManager }: withAppTypes) {
  const { displaySetService, userAuthenticationService } = servicesManager.services;
  const [{ activeViewportId, viewports }] = useViewportGrid();
  const [, setLoaded] = useState(0);
  const [exp, setExp] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState(storedTemplate() ?? getConfig().defaultTemplateId ?? '');
  const [evaluation, setEvaluation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const client = useMemo(
    () => createClient({ apiUrl: getConfig().apiUrl, headers: () => userAuthenticationService?.getAuthorizationHeader?.() ?? {} }),
    [userAuthenticationService]
  );

  useEffect(() => onDoseLoaded(() => setLoaded(n => n + 1)), []);

  const uids = viewports.get(activeViewportId)?.displaySetInstanceUIDs ?? [];
  const dose = uids.map(uid => displaySetService.getDisplaySetByUID(uid)).find(ds => ds?.isRTDose);
  const sopInstanceUid = dose?.SOPInstanceUID ?? null;

  useEffect(() => {
    let cancelled = false;
    setExp(null);
    setEvaluation(null);
    setError(null);
    if (!sopInstanceUid) {
      return;
    }
    client
      .findExports({ sopInstanceUid })
      .then(found => !cancelled && setExp(found[0] ?? false))
      .catch(e => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [client, sopInstanceUid]);

  useEffect(() => {
    client.goalTemplates().then(setTemplates).catch(e => setError(e.message));
  }, [client]);

  const evaluate = async () => {
    setBusy(true);
    setError(null);
    try {
      storeTemplate(templateId);
      setEvaluation(await client.evaluateExport(exp, { templateId: templateId || undefined }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!dose) {
    return <div className="p-2 text-sm text-white">Open a plan's RT Dose in the active viewport.</div>;
  }
  if (error) {
    return <div className="p-2 text-sm text-red-400">radiarch: {error}</div>;
  }
  if (exp === null) {
    return <div className="p-2 text-sm text-white">Looking for the plan in radiarch…</div>;
  }
  if (exp === false) {
    return <div className="p-2 text-sm text-white">This dose was not written by the radiarch this viewer is connected to.</div>;
  }

  const s = planSummary(exp);
  const colors = new Map((dose.dvhs ?? []).filter(c => c.color).map(c => [c.name, c.color]));
  const rows = evaluation ? goalRows(evaluation) : [];
  return (
    <div className="flex flex-col gap-2 p-2 text-sm text-white">
      <div className="text-xs text-yellow-300">{INTENDED_USE}</div>
      <div>
        <div className="font-semibold">Plan</div>
        {s.prescription && (
          <div>
            {fmt(s.prescription.doseGy, 1)} Gy in {s.prescription.fractions} fractions ({fmt(s.prescription.perFractionGy)} Gy each)
            {s.prescription.target ? ` to ${s.prescription.target}` : ''}
          </div>
        )}
        <div>
          {s.modality}, {s.beams.length} beams, {fmt(s.muPerFraction, 1)} MU per fraction ({fmt(s.muCourse, 0)} MU course)
        </div>
        <div className="text-xs text-gray-300">
          machine {s.machineModel ?? s.machine ?? '–'}; engine {s.engine ?? '–'}; radiarch {s.radiarchVersion ?? '–'}; export {s.exportId}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <select className="bg-black text-white" value={templateId} onChange={e => setTemplateId(e.target.value)} aria-label="Goal template">
          <option value="">no goals (DVHs and indices only)</option>
          {templates.map(t => (
            <option key={t.template_id} value={t.template_id}>
              {t.name}
              {t.provisional ? ' (provisional)' : ''}
            </option>
          ))}
        </select>
        <button className="rounded bg-blue-700 px-2 py-0.5 disabled:opacity-50" disabled={busy} onClick={evaluate}>
          {busy ? 'Evaluating…' : 'Evaluate'}
        </button>
      </div>
      {evaluation && (
        <>
          {evaluation.goals && (
            <div>
              <div className="font-semibold">
                Goals: {evaluation.goals.n_passed} met, {evaluation.goals.n_failed} not met, {evaluation.goals.n_missing} missing
                {evaluation.goals.all_priority1_passed ? '' : ' (a priority-1 goal is not met)'}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr><th className="text-left">P</th><th className="text-left">Structure</th><th className="text-left">Goal</th><th className="text-right">Achieved</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.priority}</td>
                      <td>{r.structure}</td>
                      <td>{r.goal}</td>
                      <td className="text-right">{fmt(r.achieved)}</td>
                      <td className={r.passed === null ? 'text-gray-400' : r.passed ? 'text-green-400' : 'text-red-400'}>
                        {r.passed === null ? 'missing' : r.passed ? 'met' : 'not met'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DVHChart curves={evaluationCurves(evaluation, colors)} />
          <div className="text-xs text-gray-300">DVHs from radiarch's evaluation ({evaluation.dose_units}), on its own grid.</div>
          {evaluation.indices && (
            <div className="text-xs">
              {evaluation.indices.target_structure}: HI {fmt(evaluation.indices.homogeneity_index, 3)}
              {evaluation.indices.conformity_index !== undefined ? `, CI ${fmt(evaluation.indices.conformity_index, 3)}` : ''}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default PanelRadiarchPlan;
