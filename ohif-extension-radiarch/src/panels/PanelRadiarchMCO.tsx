// Navigation on the Pareto set behind the dose on screen (R11.7): the dose's export is found by its SOP Instance UID,
// and the deliverable plan that made the dose names its Pareto set and the state it came from. Each trade-off has a
// slider over its range (ideal to nadir) with a value field, and a lock; a move asks radiarch for the blend (no dose
// calculation), and the panel shows the new state's values, goals and DVHs. Automatic navigation works by a goal
// template's priorities. "Make deliverable" makes the state a plan as the dose on screen was made, with its deviation
// table; "Export and open" writes it beside this plan and opens it in the viewer. Requests carry the host's
// authorization header (ADR 0018).

import React, { useEffect, useMemo, useState } from 'react';
import { useViewportGrid } from '@ohif/ui-next';
import { createClient, tradeoffRows, stateCurves, deviationRows, goalRows, INTENDED_USE } from '@radiarch/client';
import { DVHChart, onDoseLoaded } from '@radiarch/ohif-extension-rt-dose';

import { getConfig } from '../config';

function fmt(v, digits = 2) {
  return v === null || v === undefined ? '–' : Number(v).toFixed(digits);
}

function PanelRadiarchMCO({ servicesManager }: withAppTypes) {
  const { displaySetService, userAuthenticationService } = servicesManager.services;
  const [{ activeViewportId, viewports }] = useViewportGrid();
  const [, setLoaded] = useState(0);
  const [exp, setExp] = useState(null);
  const [found, setFound] = useState(null);
  const [state, setState] = useState(null);
  const [draft, setDraft] = useState({});
  const [locks, setLocks] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState(getConfig().defaultTemplateId ?? '');
  const [plan, setPlan] = useState(null);
  const [exported, setExported] = useState(null);
  const [busy, setBusy] = useState(null);
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
    setFound(null);
    setState(null);
    setPlan(null);
    setExported(null);
    setError(null);
    if (!sopInstanceUid) {
      return;
    }
    (async () => {
      const [e] = await client.findExports({ sopInstanceUid });
      const f = e ? await client.paretoSetOf(e) : null;
      if (cancelled) {
        return;
      }
      setExp(e ?? false);
      setFound(f ?? false);
      if (f) {
        setState(f.states.find(s => s.state_id === f.plan.state_id) ?? f.states[0] ?? null);
      }
    })().catch(err => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [client, sopInstanceUid]);

  useEffect(() => {
    client.goalTemplates().then(setTemplates).catch(e => setError(e.message));
  }, [client]);

  const rx = exp?.prescription ?? null;
  const goalsBody = () => (templateId ? { goals: { template_id: templateId }, prescription_gy: rx?.dose_gy ?? null, fractions: rx?.fractions ?? null } : {});

  const run = async (label, fn) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const navigate = (body, name) =>
    run('Navigating…', async () => {
      const next = await client.navigate(found.set.mco_id, { from_state: state.state_id, locks, dvh_bins: 60, name, ...goalsBody(), ...body });
      setState(next);
      setDraft({});
      setPlan(null);
      setExported(null);
    });

  const move = (row, value) => {
    const v = Number(value);
    if (Number.isFinite(v) && Math.abs(v - row.valueGy) > 1e-9) {
      navigate({ move: { [row.name]: v } }, `${row.name} to ${v.toFixed(2)} Gy`);
    }
  };

  const autoNavigate = () =>
    run('Navigating automatically…', async () => {
      const next = await client.autoNavigate(found.set.mco_id, { from_state: state.state_id, locks, dvh_bins: 60, ...goalsBody() });
      setState(next);
      setDraft({});
      setPlan(null);
      setExported(null);
    });

  const makeDeliverable = () =>
    run('Making the plan deliverable…', async () => {
      const before = found.plan.request ?? {};
      const goals = templateId ? { goals: { template_id: templateId }, prescription_gy: rx?.dose_gy ?? null } : {};
      setPlan(await client.makeDeliverable(found.set.mco_id, { ...before, state_id: state.state_id, ...goals }));
    });

  const exportAndOpen = () =>
    run('Exporting…', async () => {
      const rs = (exp.objects ?? []).find(o => o.kind === 'RTSTRUCT');
      setExported(
        await client.exportPlan({
          beam_model_id: plan.beam_model_id,
          dose_id: plan.dose_id,
          label: 'MCO',
          prescription: rx,
          push: true,
          ...(rs ? { rtstruct_uid: rs.sop_instance_uid, objects: ['rtplan', 'rtdose'] } : {}),
        })
      );
    });

  if (!dose) {
    return <div className="p-2 text-sm text-white">Open a plan's RT Dose in the active viewport.</div>;
  }
  if (exp === null || found === null) {
    return error ? <div className="p-2 text-sm text-red-400">radiarch: {error}</div> : <div className="p-2 text-sm text-white">Looking for the plan in radiarch…</div>;
  }
  if (exp === false) {
    return <div className="p-2 text-sm text-white">This dose was not written by the radiarch this viewer is connected to.</div>;
  }
  if (found === false) {
    return <div className="p-2 text-sm text-white">This plan was not made from a Pareto set.</div>;
  }

  const { set } = found;
  const rows = tradeoffRows(set, state);
  const robust = (set.scenarios ?? []).length > 0;
  const colors = new Map((dose.dvhs ?? []).filter(c => c.color).map(c => [c.name, c.color]));
  const goals = state?.goals ? goalRows({ goals: state.goals }) : [];
  return (
    <div className="flex w-full min-w-0 flex-col gap-2 overflow-x-hidden break-words p-2 text-sm text-white">
      <div className="text-xs text-yellow-300">{INTENDED_USE}</div>
      <div>
        <div className="font-semibold">Pareto set</div>
        <div className="text-xs text-gray-300">
          {set.plans.length} plans, error bound {fmt(set.error_bound, 3)}
          {robust ? `; robust over ${set.scenarios.length} scenarios (worst case, nominal in brackets)` : ''}
        </div>
        <div className="text-xs text-gray-300" data-cy="radiarch-mco-state">
          state {state?.name ?? state?.state_id}
        </div>
      </div>
      {rows.map(r => {
        const span = Math.max(r.nadirGy - r.idealGy, 1e-6);
        const typed = draft[r.name];
        const shown = typed === undefined ? r.valueGy : Number(typed);
        const text = typed === undefined ? (r.valueGy === null ? '' : r.valueGy.toFixed(2)) : String(typed);
        return (
          <div key={r.name} className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex-1 truncate">{r.name}</span>
              <span>
                {fmt(r.valueGy)} Gy{robust ? ` (${fmt(r.nominalGy)})` : ''}
              </span>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  aria-label={`Lock ${r.name}`}
                  checked={locks.includes(r.name)}
                  onChange={e => setLocks(e.target.checked ? [...locks, r.name] : locks.filter(n => n !== r.name))}
                />
                lock
              </label>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <input
                type="range"
                className="w-0 min-w-0 flex-1"
                aria-label={`${r.name} slider`}
                min={r.idealGy}
                max={r.nadirGy}
                step={span / 200}
                value={Number.isFinite(shown) ? shown : r.idealGy}
                disabled={!!busy || locks.includes(r.name)}
                onChange={e => setDraft({ ...draft, [r.name]: Number(e.target.value) })}
                onMouseUp={e => move(r, (e.target as HTMLInputElement).value)}
                onKeyUp={e => move(r, (e.target as HTMLInputElement).value)}
                onTouchEnd={e => move(r, (e.target as HTMLInputElement).value)}
              />
              <input
                type="number"
                className="w-16 bg-black text-right text-white"
                aria-label={`${r.name} (Gy)`}
                step={span / 100}
                value={text}
                disabled={!!busy || locks.includes(r.name)}
                onChange={e => setDraft({ ...draft, [r.name]: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && move(r, (e.target as HTMLInputElement).value)}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>{fmt(r.idealGy)}</span>
              <span>{fmt(r.nadirGy)}</span>
            </div>
          </div>
        );
      })}
      <div className="flex min-w-0 items-center gap-2">
        <select className="w-0 min-w-0 flex-1 truncate bg-black text-white" value={templateId} onChange={e => setTemplateId(e.target.value)} aria-label="Navigation goals">
          <option value="">no goals</option>
          {templates.map(t => (
            <option key={t.template_id} value={t.template_id}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="shrink-0 rounded bg-blue-700 px-2 py-0.5 disabled:opacity-50" disabled={!!busy || !templateId} onClick={autoNavigate}>
          Navigate automatically
        </button>
      </div>
      {busy && <div className="text-xs text-gray-300">{busy}</div>}
      {error && <div className="text-xs text-red-400">radiarch: {error}</div>}
      {(state?.notes ?? []).map((n, i) => (
        <div key={i} className="text-xs text-gray-300">
          {n}
        </div>
      ))}
      {state?.goals && (
        <div>
          <div className="font-semibold">
            Goals: {state.goals.n_passed} met, {state.goals.n_failed} not met
            {robust && state.goals.robust_all_passed === false ? ' (not all in every scenario)' : ''}
          </div>
          <table className="w-full table-fixed text-xs">
            <tbody>
              {goals.map((g, i) => (
                <tr key={i} className="border-b border-gray-800">
                  <td className="w-6 text-gray-400">P{g.priority}</td>
                  <td>
                    {g.structure} {g.goal}
                  </td>
                  <td className={`w-16 text-right ${g.passed === null ? 'text-gray-400' : g.passed ? 'text-green-400' : 'text-red-400'}`}>{fmt(g.achieved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {state?.dvh?.length > 0 && (
        <>
          <DVHChart curves={stateCurves(state, colors)} />
          <div className="text-xs text-gray-300">DVHs of the navigated blend (nominal), on the navigation voxels.</div>
        </>
      )}
      <button className="rounded bg-blue-700 px-2 py-0.5 disabled:opacity-50" disabled={!!busy || !state} onClick={makeDeliverable}>
        Make deliverable
      </button>
      {plan && (
        <div>
          <div className="font-semibold" data-cy="radiarch-mco-deviation">
            Deviation: {plan.flagged} of {plan.deviation.length} worse than navigated beyond tolerance
          </div>
          <table className="w-full table-fixed text-xs">
            <tbody>
              {deviationRows(plan).map((r, i) => (
                <tr key={i} className={`border-b border-gray-800 ${r.flagged ? 'text-red-400' : ''}`}>
                  <td>{r.name}</td>
                  <td className="w-12 text-right">{fmt(r.navigated)}</td>
                  <td className="w-12 text-right">{fmt(r.deliverable)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="mt-1 rounded bg-blue-700 px-2 py-0.5 disabled:opacity-50" disabled={!!busy || !plan.dose_id} onClick={exportAndOpen}>
            Export and open
          </button>
        </div>
      )}
      {exported && (
        <div className="text-xs">
          {exported.pushed ? (
            exported.viewer_url ? (
              <a className="text-blue-300 underline" href={exported.viewer_url}>
                Open the deliverable plan
              </a>
            ) : (
              'Sent to the image server: reopen the study to see it.'
            )
          ) : (
            `Exported (${exported.export_id}); not sent: ${exported.push_error ?? 'no image server configured'}`
          )}
        </div>
      )}
    </div>
  );
}

export default PanelRadiarchMCO;
