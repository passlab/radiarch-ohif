// @radiarch/ohif-extension-radiarch: the radiarch plan behind the dose on screen (layer two of ADR 0018). It needs a
// radiarch API, at `apiUrl` from the extension's configuration or the app config's `radiarch` block (default
// /radiarch/api/v1, where the standalone viewer's proxy serves it); requests carry OHIF's authorization header.
// Research use only; not for clinical use.

import React from 'react';

import { id, PanelName } from './id';
import { setConfig } from './config';
import PanelRadiarchPlan from './panels/PanelRadiarchPlan';

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
    ];
  },
};

export default extension;
