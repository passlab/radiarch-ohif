// Tests of @radiarch/client against a running radiarch API. tests/test_r13_viewer_client.py starts one (API key
// required), writes an export and runs this file with RADIARCH_TEST_API, RADIARCH_TEST_API_KEY and
// RADIARCH_TEST_CASE (a JSON file of what it wrote); the results go to RADIARCH_TEST_OUT for it to check.
// Without a server only the offline tests run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import { createClient, RadiarchApiError, planSummary, goalRows, evaluationCurves, INTENDED_USE } from '../src/index.js';

const API = process.env.RADIARCH_TEST_API;
const KEY = process.env.RADIARCH_TEST_API_KEY;
const CASE = process.env.RADIARCH_TEST_CASE ? JSON.parse(readFileSync(process.env.RADIARCH_TEST_CASE, 'utf8')) : null;
const skip = API && CASE ? false : 'no radiarch API (RADIARCH_TEST_API, RADIARCH_TEST_CASE)';
const out = {};

const client = () => createClient({ apiUrl: API, headers: () => ({ 'X-API-Key': KEY }), pollMs: 20 });

test('the host\'s headers reach the API; without them it refuses', { skip }, async () => {
  const info = await client().info();
  assert.ok(info);
  const anonymous = createClient({ apiUrl: API });
  await assert.rejects(anonymous.findExports({ studyInstanceUid: CASE.study_instance_uid }), e => e instanceof RadiarchApiError && e.status === 401);
});

test('the export behind a DICOM object is found by its UIDs', { skip }, async () => {
  const c = client();
  const byPlan = await c.findExports({ sopInstanceUid: CASE.plan_sop_instance_uid });
  assert.deepEqual(byPlan.map(e => e.export_id), [CASE.export_id]);
  const byDose = await c.findExports({ seriesInstanceUid: CASE.dose_series_instance_uid });
  assert.deepEqual(byDose.map(e => e.export_id), [CASE.export_id]);
  assert.deepEqual(await c.findExports({ sopInstanceUid: '1.2.3.4.5' }), []);
  out.export = byPlan[0];
});

test('the plan summary states the prescription, beams and metersets of the export', { skip }, async () => {
  const [exp] = await client().findExports({ sopInstanceUid: CASE.plan_sop_instance_uid });
  const s = planSummary(exp);
  assert.equal(s.exportId, CASE.export_id);
  assert.deepEqual(s.prescription, { doseGy: 2, fractions: 2, perFractionGy: 1, target: null });
  assert.deepEqual(s.beams.map(b => b.name), CASE.beams);
  for (const b of s.beams) {
    assert.ok(Math.abs(b.muPerFraction - CASE.beam_metersets[b.name]) < 1e-9);
  }
  assert.ok(Math.abs(s.muCourse - 2 * s.muPerFraction) < 1e-9);
  assert.equal(s.machineModel, 'test-120');
  assert.equal(s.intendedUse, INTENDED_USE);
});

test('an export is evaluated against a goal template: first through a job, then from the cache', { skip }, async () => {
  const c = client();
  const templates = await c.goalTemplates();
  assert.ok(templates.some(t => t.template_id === CASE.template_id));
  const [exp] = await c.findExports({ sopInstanceUid: CASE.plan_sop_instance_uid });
  const first = await c.evaluateExport(exp, { templateId: CASE.template_id });
  const again = await c.evaluateExport(exp, { templateId: CASE.template_id });
  assert.equal(again.evaluation_id, first.evaluation_id);
  assert.equal(first.goals.template_id, CASE.template_id);
  assert.ok(first.dvh_curves.length > 0 && first.goals.n_goals > 0);
  const rows = goalRows(first);
  assert.equal(rows.length, first.goals.n_goals);
  assert.ok(rows.every((r, i) => i === 0 || r.priority >= rows[i - 1].priority));
  const curves = evaluationCurves(first, new Map([['PTV', [255, 0, 0]]]));
  assert.equal(curves.length, first.dvh_curves.length);
  const ptv = curves.find(c => c.name === 'PTV');
  assert.deepEqual(ptv.color, [255, 0, 0]);
  assert.equal(ptv.maxDoseBinEdgeGy, ptv.doseGy[ptv.doseGy.length - 1]);
  out.evaluation = first;
  out.rows = rows;
});

test('an export without a dose or a prescription is refused before any request', async () => {
  const c = createClient({ apiUrl: 'http://radiarch.invalid', fetch: () => assert.fail('no request expected') });
  await assert.rejects(c.evaluateExport({ geometry_id: 'g' }), e => e.status === 422 && /no dose/.test(e.message));
  await assert.rejects(c.evaluateExport({ geometry_id: 'g', dose_id: 'd' }), e => e.status === 422 && /prescription/.test(e.message));
});

test('goal rows: priority first, missing structures stay unknown', () => {
  const rows = goalRows({ goals: { results: [
    { structure: 'Cord', metric: 'Dmax', op: '<=', value: 45, priority: 2, achieved: 40.1, passed: true },
    { structure: 'PTV', metric: 'D95', op: '>=', value: 57, priority: 1, achieved: 56.2, passed: false, margin: -0.8 },
    { structure: 'Liver', metric: 'Dmean', op: '<=', value: 30, priority: 2, passed: null },
  ] } });
  assert.deepEqual(rows.map(r => r.structure), ['PTV', 'Cord', 'Liver']);
  assert.equal(rows[0].goal, 'D95 >= 57');
  assert.equal(rows[2].passed, null);
  assert.deepEqual(goalRows({}), []);
});

test.after(() => {
  if (process.env.RADIARCH_TEST_OUT) {
    writeFileSync(process.env.RADIARCH_TEST_OUT, JSON.stringify(out));
  }
});
