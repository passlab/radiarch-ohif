// @radiarch/ohif-extension-radiarch: the radiarch plan behind the dose on screen (layer two of ADR 0018). It needs a
// radiarch API, at `apiUrl` from the extension's configuration or the app config's `radiarch` block (default
// /radiarch/api/v1, where the standalone viewer's proxy serves it); requests carry OHIF's authorization header. A second
// panel navigates the Pareto set behind an MCO plan (R11.7).
// Research use only; not for clinical use.

import React from 'react';

import { id, PanelName, MCOPanelName } from './id';
import { setConfig } from './config';
import PanelRadiarchPlan from './panels/PanelRadiarchPlan';
import PanelRadiarchMCO from './panels/PanelRadiarchMCO';

const extension = {
  id,

  preRegistration({ configuration = {}, appConfig = {} } = {} as any) {
    setConfig(configuration, appConfig);
  },

  getPanelModule({ servicesManager }) {
    return [
      {
        name: PanelName,
        iconName: 'tab-linear',
        iconLabel: 'Plan',
        label: 'Radiarch plan',
        component: props => <PanelRadiarchPlan servicesManager={servicesManager} {...props} />,
      },
      {
        name: MCOPanelName,
        iconName: 'tab-linear',
        iconLabel: 'MCO',
        label: 'Radiarch MCO',
        component: props => <PanelRadiarchMCO servicesManager={servicesManager} {...props} />,
      },
    ];
  },
};

export default extension;
