import packageJson from '../package.json';

const id = packageJson.name;
const SOPClassHandlerName = 'rt-dose';
const SOPClassHandlerId = `${id}.sopClassHandlerModule.${SOPClassHandlerName}`;
const ViewportName = 'rt-dose';
const PanelName = 'rt-dose-dvh';
const COLORMAP_NAME = 'radiarch-isodose';
// Fired with { rtDoseDisplaySet } when a dose has loaded (its volume, DVHs and reference dose are set)
const RT_DOSE_LOADED = 'radiarch-rt-dose-loaded';

export { id, SOPClassHandlerId, SOPClassHandlerName, ViewportName, PanelName, COLORMAP_NAME, RT_DOSE_LOADED };
