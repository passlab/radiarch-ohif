// Tests of @radiarch/rt-dose-core. The fixtures come from radiarch's own writer and from synthetic doses
// (tests/test_r13_viewer_core.py writes them and runs this file with RT_DOSE_FIXTURES set); without fixtures only the
// colormap tests run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  readDose,
  doseGeometry,
  resampleToGrid,
  worldToDoseIndex,
  readDVHs,
  roiInfo,
  isodoseLevels,
  doseColormap,
  referenceDose,
  relativeDose,
  computeDVHs,
  structureMasks,
  dvhBinWidth,
  planningAids,
} from '../src/index.js';

const DIR = process.env.RT_DOSE_FIXTURES;
const fixtures = DIR && existsSync(join(DIR, 'index.json')) ? JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) : null;
const skip = fixtures ? false : 'no fixtures (RT_DOSE_FIXTURES)';

function arrayBuffer(name) {
  const b = readFileSync(join(DIR, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// A naturalized dataset as dcmjs gives it; binary values are stored beside the JSON as {"$file": name}
function dataset(name) {
  const revive = v => {
    if (v && typeof v === 'object' && !Array.isArray(v) && v.$file) {
      return [arrayBuffer(v.$file)];
    }
    if (Array.isArray(v)) {
      return v.map(revive);
    }
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
    }
    return v;
  };
  return revive(JSON.parse(readFileSync(join(DIR, name), 'utf8')));
}

function float32(name) {
  return new Float32Array(arrayBuffer(name));
}

function maxAbsDiff(a, b) {
  assert.equal(a.length, b.length);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    m = Math.max(m, Math.abs(a[i] - b[i]));
  }
  return m;
}

test('the dose of each fixture reads as the writer stored it', { skip }, () => {
  for (const c of fixtures.doses) {
    const dose = readDose(dataset(c.rtdose));
    const expected = float32(c.values);
    assert.ok(maxAbsDiff(dose.values, expected) <= c.max_gy * 1e-6, c.name);
    assert.ok(Math.abs(dose.max - c.max_gy) <= c.max_gy * 1e-6, c.name);
    const g = dose.geometry;
    assert.deepEqual([g.columns, g.rows, g.frames], c.shape_xyz, c.name);
    assert.equal(g.uniformFrames, c.uniform_frames, c.name);
    for (let k = 0; k < g.frames; k++) {
      assert.ok(Math.abs(g.frameOffsets[k] - c.frame_offsets[k]) < 1e-4, `${c.name} frame ${k}`);
    }
  }
});

test('patient coordinates map to the dose grid, voxel centres to whole indices', { skip }, () => {
  for (const c of fixtures.doses) {
    const g = doseGeometry(dataset(c.rtdose));
    for (const { world, index } of c.probes) {
      const got = worldToDoseIndex(g, world);
      if (index === null) {
        assert.equal(got, null, `${c.name} ${world}`);
      } else {
        assert.ok(got && got.every((v, i) => Math.abs(v - index[i]) < 1e-6), `${c.name} ${world}: ${got} != ${index}`);
      }
    }
  }
});

test('resampled onto an image grid, the dose matches an independent trilinear interpolation', { skip }, () => {
  for (const c of fixtures.resamples) {
    const dose = readDose(dataset(c.rtdose));
    const got = resampleToGrid(dose, c.target);
    const expected = float32(c.expected);
    const err = maxAbsDiff(got, expected);
    assert.ok(err <= c.tolerance_gy, `${c.name}: max difference ${err} Gy > ${c.tolerance_gy}`);
    let inside = 0;
    for (const v of got) {
      inside += v > 0 ? 1 : 0;
    }
    assert.ok(inside >= c.min_nonzero, `${c.name}: ${inside} voxels with dose`);
  }
});

test('the DVHs in the dose are the writer\'s, named by the structure set', { skip }, () => {
  for (const c of fixtures.dvhs) {
    const rois = roiInfo(dataset(c.rtstruct));
    const curves = readDVHs(dataset(c.rtdose), rois);
    assert.deepEqual(curves.map(x => x.name), c.expected.map(x => x.name));
    curves.forEach((curve, i) => {
      const e = c.expected[i];
      assert.equal(curve.roiNumber, e.roi_number);
      assert.deepEqual(curve.color, e.color);
      assert.equal(curve.volumeUnits, 'CM3');
      assert.equal(curve.doseGy.length, e.dose_gy.length);
      assert.ok(maxAbsDiff(curve.doseGy, e.dose_gy) < 1e-9);
      assert.ok(maxAbsDiff(curve.volume, e.volume) < 1e-9);
      assert.ok(Math.abs(curve.percent[0] - 100) < 1e-9);
      assert.ok(Math.abs(curve.maxGy - e.max_gy) < 1e-9 && Math.abs(curve.meanGy - e.mean_gy) < 1e-9);
    });
  }
});

test('a differential DVH is accumulated', () => {
  const ds = {
    DVHSequence: [{
      DVHReferencedROISequence: [{ ReferencedROINumber: 3 }],
      DVHType: 'DIFFERENTIAL', DVHDoseScaling: 1, DVHVolumeUnits: 'CM3', DVHNumberOfBins: 3,
      DVHData: [1, 2, 1, 3, 1, 5],
    }],
  };
  const [c] = readDVHs(ds);
  assert.deepEqual(Array.from(c.doseGy), [0, 1, 2]);
  assert.deepEqual(Array.from(c.volume), [10, 8, 5]);
  assert.deepEqual(Array.from(c.percent), [100, 80, 50]);
  assert.equal(c.name, 'ROI 3');
});

test('a dose without DVHs has none, and a structure set names and colours ROIs', () => {
  assert.deepEqual(readDVHs({}), []);
  const rois = roiInfo({
    StructureSetROISequence: [{ ROINumber: 1, ROIName: 'PTV' }, { ROINumber: 2, ROIName: 'Cord' }],
    ROIContourSequence: [{ ReferencedROINumber: 2, ROIDisplayColor: [0, 255, 0] }],
  });
  assert.deepEqual(rois.get(1), { name: 'PTV', color: null });
  assert.deepEqual(rois.get(2), { name: 'Cord', color: [0, 255, 0] });
});

test('isodose levels and the colour wash', () => {
  const levels = isodoseLevels(60, [50, 100, 95]);
  assert.deepEqual(levels.map(l => l.percent), [100, 95, 50]);
  assert.deepEqual(levels.map(l => l.gy), [60, 57, 30]);
  assert.deepEqual(isodoseLevels(0), []);
  const cmap = doseColormap(levels, { opacity: 0.4, maxGy: 66 });
  // transparent below the lowest level, opaque within the bands up to the maximum
  assert.equal(cmap.opacity[0].opacity, 0);
  assert.ok(cmap.opacity[1].value < 30 && cmap.opacity[1].opacity === 0);
  assert.ok(cmap.opacity.filter(p => p.value >= 30).every(p => p.opacity === 0.4));
  assert.ok(cmap.opacity[cmap.opacity.length - 1].value >= 66);
  // the RGB points span exactly the range a viewer windows to, so their dose values survive Cornerstone's rescaling
  assert.deepEqual([cmap.RGBPoints[0], cmap.RGBPoints[cmap.RGBPoints.length - 4]], cmap.range);
  // RGB points come in fours (value, r, g, b) with values not decreasing
  assert.equal(cmap.RGBPoints.length % 4, 0);
  const values = cmap.RGBPoints.filter((_, i) => i % 4 === 0);
  assert.ok(values.every((v, i) => i === 0 || v >= values[i - 1]));
});

test('the 100 % isodose is the prescription when the plan states one, else the maximum', () => {
  const plan = { DoseReferenceSequence: [{ DoseReferenceType: 'ORGAN_AT_RISK' }, { DoseReferenceType: 'TARGET', TargetPrescriptionDose: '60' }] };
  assert.deepEqual(referenceDose(plan, 63.2), { gy: 60, source: 'prescription' });
  assert.deepEqual(referenceDose({ DoseReferenceSequence: [{ DoseReferenceType: 'TARGET' }] }, 63.2), { gy: 63.2, source: 'maximum' });
  assert.deepEqual(referenceDose(null, 12), { gy: 12, source: 'maximum' });
  assert.deepEqual(Array.from(relativeDose(new Float32Array([0, 30, 66]), 60)), [0, 50, 110]);
  assert.equal(relativeDose(new Float32Array([5]), 0)[0], 0);
});

test('DVHs computed in the browser from the structure set reproduce the ones radiarch wrote', { skip }, () => {
  for (const c of fixtures.dvhs) {
    const rd = dataset(c.rtdose);
    const rs = dataset(c.rtstruct);
    const dose = readDose(rd);
    const rois = roiInfo(rs);
    const computed = computeDVHs(dose, structureMasks(rs, dose.geometry), rois);
    const written = readDVHs(rd, rois);
    assert.deepEqual(computed.map(x => x.name), written.map(x => x.name));
    computed.forEach((got, i) => {
      const want = written[i];
      assert.equal(got.source, 'computed in the browser');
      // the same voxels: the same volume at 0 Gy, and the same curve bin for bin
      assert.ok(Math.abs(got.volume[0] - want.volume[0]) <= 1e-6 * want.volume[0], `${got.name}: ${got.volume[0]} vs ${want.volume[0]} cm3`);
      assert.equal(got.doseGy.length, want.doseGy.length, got.name);
      assert.ok(maxAbsDiff(got.volume, want.volume) <= 1e-6 * want.volume[0], got.name);
      assert.ok(Math.abs(got.meanGy - want.meanGy) <= 1e-4 * want.meanGy && Math.abs(got.maxGy - want.maxGy) <= 1e-4 * want.maxGy, got.name);
    });
  }
});

test('the DVH bin width is radiarch\'s', () => {
  assert.deepEqual([0, 5, 20, 60, 74, 300].map(dvhBinWidth), [0.01, 0.01, 0.05, 0.1, 0.1, 0.5]);
});

test('a contour inside another is a hole', () => {
  const g = doseGeometry({
    ImageOrientationPatient: [1, 0, 0, 0, 1, 0], ImagePositionPatient: [0, 0, 0], PixelSpacing: [1, 1],
    Rows: 10, Columns: 10, NumberOfFrames: 1, GridFrameOffsetVector: [0],
  });
  const square = (a, b) => [a, a, 0, b, a, 0, b, b, 0, a, b, 0];
  const masks = structureMasks({ ROIContourSequence: [{ ReferencedROINumber: 1, ContourSequence: [
    { ContourGeometricType: 'CLOSED_PLANAR', ContourData: square(0.5, 8.5) },
    { ContourGeometricType: 'CLOSED_PLANAR', ContourData: square(2.5, 6.5) },
  ] }] }, g);
  const m = masks.get(1);
  const inside = (i, j) => m[j * 10 + i];
  assert.equal(inside(1, 1), 1);       // in the outer ring
  assert.equal(inside(4, 4), 0);       // in the hole
  assert.equal(inside(9, 9), 0);       // outside
  assert.equal(m.reduce((s, v) => s + v, 0), 8 * 8 - 4 * 4);
});

test('planning aids are hidden by default: rings, helpers and organ-minus-target structures', () => {
  const names = ['GTV', 'CTV', 'PTV', 'SpinalCord', 'Lungs', 'Lungs-PTV', 'RingNear', 'z_opt', 'Spinal-Cord', 'Heart'];
  const aids = planningAids({
    StructureSetROISequence: names.map((ROIName, i) => ({ ROINumber: i + 1, ROIName })),
    RTROIObservationsSequence: [
      { ReferencedROINumber: 1, RTROIInterpretedType: 'GTV' },
      { ReferencedROINumber: 10, RTROIInterpretedType: 'CONTROL' },
    ],
  });
  assert.deepEqual([...aids].sort(), ['Heart', 'Lungs-PTV', 'RingNear', 'z_opt']);
  assert.equal(planningAids(undefined).size, 0);
});
