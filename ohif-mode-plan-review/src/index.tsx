// @radiarch/mode-plan-review: review a radiotherapy plan (layer three of ADR 0018). The plan dose opens over its CT
// (hanging protocol 'radiarch-rt-dose'), structure sets over the images, the study's series on the left and, on the
// right, the dose's DVHs, the radiarch plan with its clinical goals, and the structures. Built on OHIF's basic mode;
// valid for a study with a CT and an RT Dose. Research use only; not for clinical use.

import {
  ohif,
  cornerstone,
  dicomRT,
  extensionDependencies as basicExtensions,
  sopClassHandlers as basicSopClassHandlers,
  isValidMode,
  onModeEnter,
  onModeExit,
  layoutTemplate,
  modeFactory,
  initToolGroups,
} from '@ohif/mode-basic';

import { id } from './id';

const RT_DOSE = '@radiarch/ohif-extension-rt-dose';
const RADIARCH = '@radiarch/ohif-extension-radiarch';

export const rtDose = {
  sopClassHandler: `${RT_DOSE}.sopClassHandlerModule.rt-dose`,
  viewport: `${RT_DOSE}.viewportModule.rt-dose`,
  dvhPanel: `${RT_DOSE}.panelModule.rt-dose-dvh`,
  hangingProtocol: 'radiarch-rt-dose',
};

export const radiarch = {
  planPanel: `${RADIARCH}.panelModule.radiarch-plan`,
};

export const extensionDependencies = {
  ...basicExtensions,
  [RT_DOSE]: '^0.1.0',
  [RADIARCH]: '^0.1.0',
};

export const planReviewLayout = {
  id: ohif.layout,
  props: {
    leftPanels: [ohif.thumbnailList],
    leftPanelResizable: true,
    rightPanels: [rtDose.dvhPanel, radiarch.planPanel, cornerstone.segmentation],
    rightPanelResizable: true,
    viewports: [
      { namespace: cornerstone.viewport, displaySetsToDisplay: [ohif.sopClassHandler] },
      { namespace: rtDose.viewport, displaySetsToDisplay: [rtDose.sopClassHandler] },
      { namespace: dicomRT.viewport, displaySetsToDisplay: [dicomRT.sopClassHandler] },
    ],
  },
};

export const planReviewRoute = {
  path: 'plan-review',
  layoutTemplate,
  layoutInstance: planReviewLayout,
};

export const modeInstance = {
  id,
  routeName: 'plan-review',
  displayName: 'Plan review (radiarch, research)',
  toolbarButtons: [{ $reference: 'cornerstone.toolbarButtons' }],
  toolbarSections: [{ $reference: 'cornerstone.toolbarSections' }],
  toolGroupAdditions: { default: [], mpr: [], SRToolGroup: [], volume3d: [] },
  initToolGroups,
  modeCustomizations: 'planReviewModeCustomizations',
  activatePanelTriggers: [],
  onModeEnter,
  onModeExit,
  validationTags: { study: [], series: [] },
  isValidMode,
  // a study with an image series and a dose
  modeModalities: [['CT', 'RTDOSE']],
  routes: [planReviewRoute],
  extensions: extensionDependencies,
  // named, not matched: the mode is valid only for a study with an RT Dose
  hangingProtocol: rtDose.hangingProtocol,
  // the RT Dose handler first: its SOP class is its own
  sopClassHandlers: [rtDose.sopClassHandler, ...basicSopClassHandlers],
};

export const customizations = {
  planReviewModeCustomizations: {
    'panelSegmentation.disableEditing': true,
  },
};

const mode = {
  id,
  modeFactory,
  modeInstance,
  extensionDependencies,
  customizations,
};

export default mode;
