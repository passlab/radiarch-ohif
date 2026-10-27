# Radiarch viewer packages

These are web packages for viewing radiotherapy plans in OHIF 3.13.13 (ADR 0018). They are research
use only, not for clinical use.

| Package | What it is | Needs |
|---|---|---|
| [`rt-dose-core/`](rt-dose-core/) | Plain JavaScript, no dependencies: the dose of a DICOM RT Dose, its resampling onto an image grid, the DVHs it carries, isodose levels and the colour wash | nothing |
| [`ohif-extension-rt-dose/`](ohif-extension-rt-dose/) | OHIF extension: RT Dose display sets, a viewport with the dose over its CT as isodose bands of the prescription, and a DVH panel | OHIF 3.13.13; any DICOMweb server; no radiarch server |

Still to come (`docs/impl-plan.md`, R13):
- the radiarch panel (clinical goals, the plan summary, evaluation through radiarch's API) and a plan
  review mode;
- the standalone viewer image.

## Using the extension in an OHIF build

1. Put both packages in OHIF's workspace (`extensions/`).
2. Register `@radiarch/ohif-extension-rt-dose` in `platform/app/pluginConfig.json`.
3. In the mode, add these to its configuration:
   - the SOP class handler `@radiarch/ohif-extension-rt-dose.sopClassHandlerModule.rt-dose`;
   - the viewport `@radiarch/ohif-extension-rt-dose.viewportModule.rt-dose` for that handler;
   - optionally the panel `@radiarch/ohif-extension-rt-dose.panelModule.rt-dose-dvh`.

`scripts/build-ohif.sh` does steps 1 and 2 on a clean OHIF checkout and builds it. CI runs it on every
push (the job "Viewer").

## How the dose is shown

1. **Loading.** The dose is read from the RT Dose file, which OHIF fetches by WADO.
2. **Resampling.** It is resampled trilinearly onto the CT volume with the same frame of reference.
3. **Units.** It is drawn in % of the plan's target prescription dose, found by the RT Plan the dose
   references. Without a stated prescription, the dose maximum is the 100 % level.
4. **Colours.** Isodose bands at 107, 100, 95, 90, 80, 70, 50 and 30 % are drawn over the CT. Below
   30 % the dose is transparent.
5. **DVHs.** The DVH panel shows the curves stored in the RT Dose, named and coloured by the structure
   set the dose references. For a radiarch export these are radiarch's own DVHs, computed on its grid.

OHIF 3.13.13 draws a derived overlay volume only for display sets of its pseudo-modality `PMAP`, so a
dose display set carries that modality, its own label, and `isRTDose`. A change in OHIF's handling
breaks the CI build or, from R13.2d, the browser test.

## Tests

- `tests/test_r13_viewer_core.py` (in radiarch's Python suite) writes fixtures and runs
  `rt-dose-core/test/core.test.js` against them with Node. The fixtures are radiarch's own RT Dose,
  structure set and DVHs, plus synthetic doses with rotated orientations, absolute and uneven frame
  offsets, and 16- and 32-bit pixels.
- Expected values are computed independently in Python:
  - the stored doses;
  - voxel indices;
  - trilinear interpolation onto other grids, including a rotated one;
  - the DVH curves.
- Without fixtures, `node --test rt-dose-core/test/core.test.js` runs the tests that need none.
