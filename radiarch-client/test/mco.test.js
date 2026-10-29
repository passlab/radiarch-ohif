// Tests of @radiarch/client's multi-criteria calls (R11.7). tests/test_r11_viewer_client.py starts a radiarch API
// (API key required), computes a Pareto set, makes and exports a deliverable plan, and runs this file with
// RADIARCH_TEST_API, RADIARCH_TEST_API_KEY and RADIARCH_TEST_MCO_CASE (a JSON file of what it made); the results go to
// RADIARCH_TEST_OUT for it to check. Without a server only the offline tests run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import { createClient, tradeoffName, tradeoffRows, stateCurves, deviationRows } from '../src/index.js';

const API = process.env.RADIARCH_TEST_API;
const KEY = process.env.RADIARCH_TEST_API_KEY;
const CASE = process.env.RADIARCH_TEST_MCO_CASE ? JSON.parse(readFileSync(process.env.RADIARCH_TEST_MCO_CASE, 'utf8')) : null;
const skip = API && CASE ? false : 'no radiarch API (RADIARCH_TEST_API, RADIARCH_TEST_MCO_CASE)';
const out = {};

const client = () => createClient({ apiUrl: API, headers: () => ({ 'X-API-Key': KEY }), pollMs: 20 });

test('the Pareto set behind an exported dose is found, with its states and the plan that made the dose', { skip }, async () => {
  const c = client();
  const [exp] = await c.findExports({ sopInstanceUid: CASE.plan_sop_instance_uid });
  const found = await c.paretoSetOf(exp);
  assert.equal(found.set.mco_id, CASE.mco_id);
  assert.equal(found.plan.deliverable_id, CASE.deliverable_id);
  assert.ok(found.states.some(s => s.state_id === found.plan.state_id));
  assert.equal(await c.paretoSetOf({ dose_id: 'no-such-dose' }), null);
  assert.equal(await c.paretoSetOf({}), null);
});

test('a slider move, a lock, automatic navigation, and the moved state made deliverable', { skip }, async () => {
  const c = client();
  const { set } = await c.paretoSetOf({ dose_id: CASE.dose_id });
  const [ptv, oar] = set.tradeoffs.map(tradeoffName);
  const start = (await c.paretoSetOf({ dose_id: CASE.dose_id })).plan.state_id;
  const mid = 0.5 * (set.ideal_gy[1] + set.nadir_gy[1]);
  const moved = await c.navigate(set.mco_id, { from_state: start, move: { [oar]: mid }, locks: [], dvh_bins: 20 });
  assert.equal(moved.from_state, start);
  assert.ok(moved.values_gy[1] <= mid + 1e-6);
  const rows = tradeoffRows(set, moved);
  assert.deepEqual(rows.map(r => r.name), [ptv, oar]);
  assert.ok(rows.every(r => r.valueGy <= r.boundGy + 1e-6));
  assert.equal(stateCurves(moved).length, moved.dvh.length);

  const locked = await c.navigate(set.mco_id, { from_state: moved.state_id, locks: [oar], reference: { [ptv]: set.ideal_gy[0] } });
  assert.ok(locked.values_gy[1] <= moved.values_gy[1] + 1e-3);
  assert.equal(tradeoffRows(set, locked)[1].clamp, locked.clamps[oar]);

  const auto = await c.autoNavigate(set.mco_id, {
    goals: { goals: [{ structure: 'PTV', metric: 'D95%[Gy]', op: '>=', value: 1.5, priority: 1 }] }, from_state: moved.state_id,
  });
  assert.equal(auto.levels[0].priority, 1);

  // the moved state (a new blend: a job), then the same again (the stored plan, at once)
  const plan = await c.makeDeliverable(set.mco_id, { state_id: moved.state_id, levels: 5, max_iterations: 40 });
  assert.equal(plan.state_id, moved.state_id);
  assert.equal((await c.makeDeliverable(set.mco_id, { state_id: moved.state_id, levels: 5, max_iterations: 40 })).deliverable_id,
               plan.deliverable_id);
  const dev = deviationRows(plan);
  assert.equal(dev.length, plan.deviation.length);
  assert.ok(dev.every((r, i) => i === 0 || Number(r.flagged) <= Number(dev[i - 1].flagged)));
  assert.deepEqual((await c.findDeliverables({ doseId: plan.dose_id })).map(p => p.deliverable_id), [plan.deliverable_id]);

  const exp = await c.exportPlan({ beam_model_id: plan.beam_model_id, dose_id: plan.dose_id, label: 'MCO',
                                   prescription: { dose_gy: 2.0, fractions: 2 } });
  assert.ok(exp.export_id && exp.objects.some(o => o.kind === 'RTDOSE'));
  out.deliverable = plan;
  out.export_id = exp.export_id;
});

test('trade-off rows: worst case and nominal on a robust set, null without a state', () => {
  const set = { tradeoffs: [{ type: 'UniformRMS', structure_name: 'CTV' }, { type: 'MeanDose', structure_name: 'Parotid' }],
                ideal_gy: [0.5, 10], nadir_gy: [3, 25] };
  const state = { values_gy: [1.2, 18], nominal_gy: [0.9, 16], bound_gy: [1.4, 19], normalized: [0.28, 0.53],
                  clamps: { 'MeanDose(Parotid)': 20 } };
  const rows = tradeoffRows(set, state);
  assert.deepEqual(rows[1], { index: 1, name: 'MeanDose(Parotid)', valueGy: 18, nominalGy: 16, boundGy: 19, idealGy: 10, nadirGy: 25,
                              normalized: 0.53, clamp: 20 });
  assert.equal(tradeoffRows(set, null)[0].valueGy, null);
  assert.deepEqual(tradeoffRows(null, state), []);
});

test('state curves and deviation rows keep the API\'s values', () => {
  const curves = stateCurves({ dvh: [{ structure: 'PTV', dose_gy: [0, 1, 2], volume_pct: [100, 90, 0] }] }, new Map([['PTV', [1, 2, 3]]]));
  assert.deepEqual(curves[0].color, [1, 2, 3]);
  assert.equal(curves[0].maxDoseBinEdgeGy, 2);
  const rows = deviationRows({ deviation: [
    { name: 'a', kind: 'trade-off', unit: 'Gy', navigated: 1, deliverable: 1.1, worse_by: 0.1, flagged: false },
    { name: 'b', kind: 'goal', unit: '%', navigated: 95, projected: 96, deliverable: 90, worse_by: 5, flagged: true },
  ] });
  assert.deepEqual(rows.map(r => [r.name, r.flagged, r.projected]), [['b', true, 96], ['a', false, null]]);
  assert.deepEqual(deviationRows(null), []);
});

test.after(() => {
  if (process.env.RADIARCH_TEST_OUT) {
    writeFileSync(process.env.RADIARCH_TEST_OUT, JSON.stringify(out));
  }
});
