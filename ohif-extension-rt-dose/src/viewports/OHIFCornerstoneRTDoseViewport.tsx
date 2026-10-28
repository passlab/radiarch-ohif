// The CT with the dose over it, as isodose colour bands in % of the plan's prescription. Modelled on OHIF's parametric
// map viewport: the referenced CT and the dose go to OHIF's Cornerstone viewport as two volumes, the dose with the
// isodose colormap and a window fixed in %.

import PropTypes from 'prop-types';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { OHIFCornerstoneViewport } from '@ohif/extension-cornerstone';
import { Enums as csToolsEnums } from '@cornerstonejs/tools';

import { doseColormap, isodoseLevels, isBlankImage } from '@radiarch/rt-dose-core';
import { COLORMAP_NAME } from '../id';
import { onDoseLoaded } from '../events';

export const ISODOSE_PERCENTS = [107, 100, 95, 90, 80, 70, 50, 30];
export const WINDOW_PERCENT = 120;
export const DOSE_OPACITY = 0.45;
// The ray caster scales a volume's opacity by (sample distance / opacity unit distance, 1 mm by default). Through an
// MPR slice, which is Cornerstone's 0.05 mm slab, an opacity of 0.45 per mm comes to about 0.03, so the dose was
// almost invisible over the CT. At 0.15 mm the bands are clearly coloured and the CT shows through (0.05 hides it,
// 0.3 darkens the colours); chosen by eye on a lung plan.
export const OPACITY_UNIT_DISTANCE_MM = 0.15;
// Chrome's default OpenGL backend on Linux (seen on NVIDIA) draws every 3D volume black, without an error: the
// viewport samples what it drew every few seconds once the volumes are mounted and says so while it stays black.
const BLANK_CHECK_MS = 3000;
const BLANK_CHECKS = 10;
const BLANK_AFTER = 3;

/** True when the viewport's canvas is black (a 32 × 32 sample); null when it cannot be read. */
function viewportIsBlank(viewport) {
  const canvas = viewport?.canvas;
  if (!canvas?.width || !canvas?.height) {
    return null;
  }
  try {
    const sample = document.createElement('canvas');
    sample.width = sample.height = 32;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, 32, 32);
    return isBlankImage(ctx.getImageData(0, 0, 32, 32).data);
  } catch (e) {
    return null;
  }
}

/** The isodose colormap in %, registered once with Cornerstone (index.tsx) and used by every dose viewport. */
export function isodoseColormap() {
  return doseColormap(isodoseLevels(100, ISODOSE_PERCENTS), { opacity: DOSE_OPACITY, maxGy: WINDOW_PERCENT });
}

function OHIFCornerstoneRTDoseViewport(props: withAppTypes) {
  const { displaySets, children, viewportOptions, displaySetOptions, servicesManager } = props;
  const { customizationService, cornerstoneViewportService, displaySetService, segmentationService, userAuthenticationService } =
    servicesManager.services;

  if (displaySets.length !== 1) {
    throw new Error('The RT Dose viewport takes one dose display set');
  }
  const doseDisplaySet = displaySets[0];
  const referencedDisplaySet = doseDisplaySet.getReferenceDisplaySet();
  const LoadingIndicatorTotalPercent = customizationService.getCustomization('ui.loadingIndicatorTotalPercent');
  const [loading, setLoading] = useState(!doseDisplaySet.isLoaded);
  const [blank, setBlank] = useState(false);

  useEffect(
    () =>
      onDoseLoaded(ds => {
        if (ds.displaySetInstanceUID === doseDisplaySet.displaySetInstanceUID) {
          setLoading(false);
        }
      }),
    [doseDisplaySet]
  );

  // once Cornerstone has mounted the volumes (and after any remount), give the dose its opacity per slice; marking
  // the opacity function modified rebuilds the opacity texture, which is cached by that function's time stamp. The
  // first time, move to the slice through the dose maximum (the middle slice may hold little or no dose), and draw
  // the dose's structure set as contours over the CT and the dose (OHIF's segmentation panel lists them), planning
  // aids (rings, organ minus target) hidden. Contours added before the volumes are mounted make Cornerstone's
  // contour display throw on every render ("No actor found"), hence here.
  const opened = useRef(false);
  const contoured = useRef(false);
  useEffect(() => {
    const viewportId = viewportOptions.viewportId;
    const drawContours = async () => {
      const uid = doseDisplaySet.structureSetSOPInstanceUID;
      const rt = uid && displaySetService.getActiveDisplaySets().find(ds => ds.Modality === 'RTSTRUCT' && ds.SOPInstanceUID === uid);
      if (!rt || contoured.current) {
        return;
      }
      contoured.current = true;
      await rt.load({ headers: userAuthenticationService.getAuthorizationHeader() });
      const segmentationId = rt.displaySetInstanceUID;
      await segmentationService.addSegmentationRepresentation(viewportId, {
        segmentationId,
        type: csToolsEnums.SegmentationRepresentations.Contour,
      });
      const segments = segmentationService.getSegmentation(segmentationId)?.segments ?? {};
      for (const [index, segment] of Object.entries(segments)) {
        if (segment && doseDisplaySet.planningAids?.has(segment.label)) {
          segmentationService.setSegmentVisibility(viewportId, segmentationId, Number(index), false);
        }
      }
    };
    const apply = () => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      const dose = viewport?.getActors?.().find(a => String(a.referencedId).endsWith(doseDisplaySet.displaySetInstanceUID));
      if (!dose) {
        return;
      }
      const property = dose.actor.getProperty();
      if (property.getScalarOpacityUnitDistance(0) !== OPACITY_UNIT_DISTANCE_MM) {
        property.setScalarOpacityUnitDistance(0, OPACITY_UNIT_DISTANCE_MM);
        property.getScalarOpacity(0)?.modified();
        viewport.render();
      }
      const hot = doseDisplaySet.hotspotWorld;
      if (hot && !opened.current) {
        opened.current = true;
        const { focalPoint, position, viewPlaneNormal } = viewport.getCamera();
        const shift = [0, 1, 2].reduce((s, a) => s + (hot[a] - focalPoint[a]) * viewPlaneNormal[a], 0);
        const move = p => p.map((v, a) => v + shift * viewPlaneNormal[a]);
        viewport.setCamera({ focalPoint: move(focalPoint), position: move(position) });
        viewport.render();
      }
      drawContours().catch(e => {
        contoured.current = false;
        console.warn('RT Dose: the structure set could not be drawn', e);
      });
    };
    const { unsubscribe } = cornerstoneViewportService.subscribe(
      cornerstoneViewportService.EVENTS.VIEWPORT_VOLUMES_CHANGED,
      ({ viewportInfo }) => (viewportInfo?.viewportId ?? viewportInfo?.getViewportId?.()) === viewportId && apply()
    );
    apply();
    return unsubscribe;
  }, [cornerstoneViewportService, displaySetService, segmentationService, userAuthenticationService, viewportOptions.viewportId,
    doseDisplaySet, loading]);

  // nothing drawn after the volumes are mounted: say why, rather than show a black square
  useEffect(() => {
    if (loading) {
      return;
    }
    let checks = 0;
    let blankChecks = 0;
    const timer = setInterval(() => {
      checks += 1;
      const isBlank = viewportIsBlank(cornerstoneViewportService.getCornerstoneViewport(viewportOptions.viewportId));
      if (isBlank === false) {
        setBlank(false);
        clearInterval(timer);
        return;
      }
      blankChecks = isBlank ? blankChecks + 1 : blankChecks;
      if (blankChecks >= BLANK_AFTER) {
        setBlank(true);
      }
      if (checks >= BLANK_CHECKS) {
        clearInterval(timer);
      }
    }, BLANK_CHECK_MS);
    return () => clearInterval(timer);
  }, [loading, cornerstoneViewportService, viewportOptions.viewportId]);

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
      {blank && (
        <div data-cy="rt-dose-blank-warning" className="pointer-events-none absolute left-1/2 top-1/3 w-2/3 -translate-x-1/2 rounded bg-black/80 p-3 text-sm text-yellow-300">
          This browser draws the CT and the dose black: its WebGL backend cannot render 3D volumes (seen with Chrome&apos;s
          default OpenGL backend on Linux). Use Firefox, or in Chrome set chrome://flags/#use-angle to Vulkan and relaunch.
        </div>
      )}
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
