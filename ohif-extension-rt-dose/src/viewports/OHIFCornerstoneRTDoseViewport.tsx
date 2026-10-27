// The CT with the dose over it, as isodose colour bands in % of the plan's prescription. Modelled on OHIF's parametric
// map viewport: the referenced CT and the dose go to OHIF's Cornerstone viewport as two volumes, the dose with the
// isodose colormap and a window fixed in %.

import PropTypes from 'prop-types';
import React, { useCallback, useEffect, useState } from 'react';
import { OHIFCornerstoneViewport } from '@ohif/extension-cornerstone';

import { doseColormap, isodoseLevels } from '@radiarch/rt-dose-core';
import { COLORMAP_NAME } from '../id';
import { onDoseLoaded } from '../events';

export const ISODOSE_PERCENTS = [107, 100, 95, 90, 80, 70, 50, 30];
export const WINDOW_PERCENT = 120;
export const DOSE_OPACITY = 0.45;

/** The isodose colormap in %, registered once with Cornerstone (index.tsx) and used by every dose viewport. */
export function isodoseColormap() {
  return doseColormap(isodoseLevels(100, ISODOSE_PERCENTS), { opacity: DOSE_OPACITY, maxGy: WINDOW_PERCENT });
}

function OHIFCornerstoneRTDoseViewport(props: withAppTypes) {
  const { displaySets, children, viewportOptions, displaySetOptions, servicesManager } = props;
  const { customizationService } = servicesManager.services;

  if (displaySets.length !== 1) {
    throw new Error('The RT Dose viewport takes one dose display set');
  }
  const doseDisplaySet = displaySets[0];
  const referencedDisplaySet = doseDisplaySet.getReferenceDisplaySet();
  const LoadingIndicatorTotalPercent = customizationService.getCustomization('ui.loadingIndicatorTotalPercent');
  const [loading, setLoading] = useState(!doseDisplaySet.isLoaded);

  useEffect(
    () =>
      onDoseLoaded(ds => {
        if (ds.displaySetInstanceUID === doseDisplaySet.displaySetInstanceUID) {
          setLoading(false);
        }
      }),
    [doseDisplaySet]
  );

  const getCornerstoneViewport = useCallback(() => {
    const cmap = isodoseColormap();
    const doseOptions = {
      options: {
        colormap: { name: COLORMAP_NAME, opacity: cmap.opacity },
        voi: { windowCenter: cmap.range[1] / 2, windowWidth: cmap.range[1] },
      },
    };
    return (
      <OHIFCornerstoneViewport
        {...props}
        // the CT, then the dose
        displaySets={[referencedDisplaySet, doseDisplaySet]}
        viewportOptions={{
          viewportType: 'volume',
          orientation: viewportOptions.orientation,
          viewportId: viewportOptions.viewportId,
          presentationIds: viewportOptions.presentationIds,
        }}
        displaySetOptions={[{}, doseOptions]}
      />
    );
  }, [props, referencedDisplaySet, doseDisplaySet, viewportOptions.orientation, viewportOptions.viewportId, viewportOptions.presentationIds]);

  const childrenWithProps = children?.length
    ? children.map((child, index) => child && React.cloneElement(child, { viewportId: viewportOptions.viewportId, key: index }))
    : null;

  return (
    <div className="relative flex h-full w-full flex-row overflow-hidden">
      {loading && (
        <LoadingIndicatorTotalPercent className="h-full w-full" totalNumbers={null} percentComplete={null} loadingText="Loading RT Dose..." />
      )}
      {getCornerstoneViewport()}
      {childrenWithProps}
      <div className="pointer-events-none absolute bottom-2 left-2 text-xs text-white opacity-80">
        RESEARCH USE ONLY. Isodoses in % of {doseDisplaySet.reference?.source === 'prescription' ? 'the prescription' : 'the dose maximum'}
        {doseDisplaySet.reference ? ` (${doseDisplaySet.reference.gy.toFixed(2)} Gy)` : ''}
      </div>
    </div>
  );
}

OHIFCornerstoneRTDoseViewport.propTypes = {
  displaySets: PropTypes.arrayOf(PropTypes.object),
  viewportId: PropTypes.string,
  dataSource: PropTypes.object,
  children: PropTypes.node,
};

export default OHIFCornerstoneRTDoseViewport;
