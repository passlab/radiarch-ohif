# Radiarch viewer packages

These are web packages for viewing radiotherapy plans in OHIF 3.13.13 (ADR 0018). They are research
use only, not for clinical use.

| Package | What it is | Needs |
|---|---|---|
| [`rt-dose-core/`](rt-dose-core/) | Plain JavaScript, no dependencies: the dose of a DICOM RT Dose, its resampling onto an image grid, the DVHs it carries, isodose levels and the colour wash | nothing |
| [`ohif-extension-rt-dose/`](ohif-extension-rt-dose/) | OHIF extension: RT Dose display sets, a viewport with the dose over its CT as isodose bands of the prescription, a DVH panel, and the hanging protocol `radiarch-rt-dose` | OHIF 3.13.13; any DICOMweb server; no radiarch server |
| [`radiarch-client/`](radiarch-client/) | Plain JavaScript, no dependencies: radiarch's API for a viewer (the export behind a DICOM object, goal templates, evaluations that follow their job, the plan summary, goal rows) | a radiarch API |
| [`ohif-extension-radiarch/`](ohif-extension-radiarch/) | OHIF extension: the radiarch plan behind the dose on screen (summary, a goal template to evaluate against, the goals graded by radiarch, radiarch's DVHs and indices) | OHIF 3.13.13; a radiarch API |
| [`ohif-mode-plan-review/`](ohif-mode-plan-review/) | OHIF mode "Plan review" (route `plan-review`): the plan dose over its CT, structures, the series list, and the dose, plan and structure panels; for a study with a CT and an RT Dose | the two extensions |

| [`standalone/`](standalone/) | The standalone viewer image: OHIF with the packages above, nginx with Orthanc's DICOMweb and radiarch's API on one origin, the API key added by the proxy (`docs/viewing.md`) | Orthanc, a radiarch API |

Still to come (`docs/impl-plan.md`, R13.3): checking the views by hand in a browser with a GPU.

## Configuration

The radiarch extension finds radiarch's API from its configuration or the OHIF app config:

```js
window.config = { /* ... */ radiarch: { apiUrl: '/radiarch/api/v1', defaultTemplateId: 'rtog-0617' } };
```

`/radiarch/api/v1` is the default, which is where the standalone viewer's proxy serves the API.
Requests carry OHIF's authorization header (`userAuthenticationService`). Radiarch's API key never
reaches the browser: the proxy, or a host's gateway, authenticates the user and adds the key.

## Using the extensions in an OHIF build

1. Put both packages in OHIF's workspace (`extensions/`).
2. Register `@radiarch/ohif-extension-rt-dose` in `platform/app/pluginConfig.json`.
3. In the mode, add these to its configuration:
   - the SOP class handler `@radiarch/ohif-extension-rt-dose.sopClassHandlerModule.rt-dose`;
   - the viewport `@radiarch/ohif-extension-rt-dose.viewportModule.rt-dose` for that handler;
   - optionally the panel `@radiarch/ohif-extension-rt-dose.panelModule.rt-dose-dvh`.

For the radiarch panel, also register `@radiarch/ohif-extension-radiarch`, put `radiarch-client` in
the workspace, and add the panel `@radiarch/ohif-extension-radiarch.panelModule.radiarch-plan` (and, for MCO plans,
`@radiarch/ohif-extension-radiarch.panelModule.radiarch-mco`). Or use
the plan-review mode, which brings all of them; register it in `pluginConfig.json`'s `modes`.

`scripts/build-ohif.sh` does all of this on a clean OHIF checkout and builds it. CI runs it on every
push (the job "Viewer") and checks that both extensions and the mode are in the bundle. With `OHIF_DIR` set, it
uses an existing OHIF checkout instead of cloning (a fork or a patched tree, at the pinned release): the packages are
added to that workspace and it is built in place.

## How the dose is shown

1. **Loading.** The dose is read from the RT Dose file, which OHIF fetches by WADO.
2. **Resampling.** It is resampled trilinearly onto the CT volume with the same frame of reference.
3. **Units.** It is drawn in % of the plan's target prescription dose, found by the RT Plan the dose
   references. Without a stated prescription, the dose maximum is the 100 % level.
4. **Colours.** Isodose bands at 107, 100, 95, 90, 80, 70, 50 and 30 % are drawn over the CT. Below
   30 % the dose is transparent. The viewport opens on the slice through the dose maximum.
5. **Opacity.** Cornerstone's ray caster scales opacity by the sample distance over the opacity unit
   distance, 1 mm by default. Through a 0.05 mm MPR slab, the bands' 0.45 per mm came to almost
   nothing, so the first hand check saw no colour wash. The dose actor's unit distance is now 0.15 mm,
   chosen by eye on a lung plan: the bands are clear and the CT shows through. It is set when OHIF
   mounts the volumes, and the opacity function is marked modified, because Cornerstone caches the
   opacity texture by that function's time stamp.
6. **DVHs.** The DVH panel shows the curves stored in the RT Dose, named and coloured by the structure
   set the dose references. For a radiarch export these are radiarch's own DVHs, computed on its grid.
7. **Contours.** The structure set the dose references (directly or through its plan; else one of the same
   frame of reference) is loaded by OHIF's RT handler and drawn as contours in the dose viewport, once the
   dose is loaded; OHIF's segmentation panel lists its structures. Planning aids start hidden, in the
   viewport and in the DVH panel (`planningAids` in rt-dose-core): ROIs interpreted as avoidance, control
   and the like, rings and optimisation helpers, and organ-minus-target structures such as `Lungs-PTV`.
8. **A black image.** Chrome's default backend on Linux (ANGLE on OpenGL) draws 3D volumes black without an error.
   Once the volumes are mounted, the viewport samples its canvas every 3 s (`isBlankImage` in rt-dose-core); black
   three times running, it shows a warning naming the fix (Firefox, or `chrome://flags/#use-angle` set to Vulkan),
   and removes it when something is drawn.

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
- `tests/test_r13_viewer_client.py` serves radiarch's API with uvicorn in a thread, with an API key
  required, writes an export, and runs `radiarch-client/test/client.test.js` against it:
  - the host's headers reach the API, and without them it refuses (401);
  - the export is found by the plan's instance and by the dose's series;
  - the plan summary matches the export's beams and metersets;
  - an evaluation against a goal template runs through its job, then comes from the cache; the
    test checks it is the evaluation radiarch's service holds.
