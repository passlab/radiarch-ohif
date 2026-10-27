// @radiarch/ohif-extension-rt-dose: DICOM RT Dose in OHIF 3.13 (layer one of ADR 0018). It needs no radiarch server:
// any system's RT Dose is shown over its CT, with the DVHs the dose carries. Research use only; not for clinical use.
//
// A mode uses it by adding `${id}.sopClassHandlerModule.rt-dose` to its SOP class handlers, the viewport
// `${id}.viewportModule.rt-dose` for that handler, and optionally the panel `${id}.panelModule.rt-dose-dvh`.

import React from 'react';
import { utilities as csUtils } from '@cornerstonejs/core';

import { id, COLORMAP_NAME, ViewportName, PanelName, SOPClassHandlerId } from './id';
import getSopClassHandlerModule from './getSopClassHandlerModule';
import PanelRTDoseDVH from './panels/PanelRTDoseDVH';
import { isodoseColormap } from './viewports/OHIFCornerstoneRTDoseViewport';

const Component = React.lazy(() => import(/* webpackPrefetch: true */ './viewports/OHIFCornerstoneRTDoseViewport'));

const OHIFCornerstoneRTDoseViewport = props => (
  <React.Suspense fallback={<div>Loading...</div>}>
    <Component {...props} />
  </React.Suspense>
);

const extension = {
  id,

  preRegistration() {
    const cmap = isodoseColormap();
    csUtils.colormap.registerColormap({ ColorSpace: 'RGB', Name: COLORMAP_NAME, name: COLORMAP_NAME, RGBPoints: cmap.RGBPoints });
  },

  getViewportModule({ servicesManager, extensionManager, commandsManager }) {
    const Viewport = props => (
      <OHIFCornerstoneRTDoseViewport
        servicesManager={servicesManager}
        extensionManager={extensionManager}
        commandsManager={commandsManager}
        {...props}
      />
    );
    return [{ name: ViewportName, component: Viewport }];
  },

  getPanelModule({ servicesManager }) {
    return [
      {
        name: PanelName,
        iconName: 'tab-linear',
        iconLabel: 'DVH',
        label: 'Dose',
        component: props => <PanelRTDoseDVH servicesManager={servicesManager} {...props} />,
      },
    ];
  },

  getSopClassHandlerModule,
};

export { SOPClassHandlerId };
export default extension;
