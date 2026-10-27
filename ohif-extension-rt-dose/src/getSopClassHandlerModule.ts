// RT Dose display sets. OHIF 3.13.13 has no RT Dose handler; this one loads the dose, resamples it onto the CT it
// belongs to (same frame of reference) as a derived volume in % of the plan's prescription, and reads the DVHs the
// dose carries, named by its structure set.
//
// The display set's Modality is 'PMAP': OHIF's cache service (CornerstoneCacheService._getVolumeViewportData)
// treats a display set with its own load() as a derived volume only for that pseudo-modality, as the parametric map
// extension does. The label says RT Dose; `isRTDose` marks it. CI builds against the pinned OHIF release, so a
// change there is caught.

import { utils, DicomMetadataStore, Types as OhifTypes } from '@ohif/core';
import { cache, utilities as csUtils, volumeLoader } from '@cornerstonejs/core';
import { dicomLoaderService, VOLUME_LOADER_SCHEME } from '@ohif/extension-cornerstone';
import dcmjs from 'dcmjs';
import { readDose, readDVHs, roiInfo, referenceDose, relativeDose, resampleToGrid } from '@radiarch/rt-dose-core';

import { SOPClassHandlerId } from './id';
import { emitDoseLoaded } from './events';

const sopClassUids = ['1.2.840.10008.5.1.4.1.1.481.2'];

function frameOfReference(displaySet) {
  return displaySet.FrameOfReferenceUID ?? displaySet.instance?.FrameOfReferenceUID ?? displaySet.instances?.[0]?.FrameOfReferenceUID;
}

function findInstance(StudyInstanceUID: string, SOPInstanceUID: string) {
  const study = DicomMetadataStore.getStudy(StudyInstanceUID);
  for (const series of study?.series ?? []) {
    const found = series.instances?.find(i => i.SOPInstanceUID === SOPInstanceUID);
    if (found) {
      return found;
    }
  }
  return null;
}

function firstItem(seq) {
  return Array.isArray(seq) ? seq[0] : seq;
}

function _getDisplaySetsFromSeries(instances, servicesManager: AppTypes.ServicesManager) {
  return instances.map(instance => {
    const { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, SeriesDescription, SeriesNumber, SeriesDate, SOPClassUID,
      wadoRoot, wadoUri, wadoUriRoot, DoseSummationType } = instance;
    const summation = DoseSummationType ? ` (${DoseSummationType})` : '';
    const displaySet = {
      Modality: 'PMAP',
      isRTDose: true,
      isReconstructable: true,
      isDerivedDisplaySet: true,
      displaySetInstanceUID: `rtdose.${utils.guid()}`,
      SeriesDescription,
      SeriesNumber,
      SeriesDate,
      SOPInstanceUID,
      SeriesInstanceUID,
      StudyInstanceUID,
      FrameOfReferenceUID: instance.FrameOfReferenceUID,
      SOPClassHandlerId,
      SOPClassUID,
      referencedDisplaySetInstanceUID: null,
      referencedVolumeURI: null,
      referencedVolumeId: null,
      loadStatus: { loading: false, loaded: false },
      sopClassUids,
      instance,
      instances: [instance],
      wadoRoot,
      wadoUriRoot,
      wadoUri,
      supportsWindowLevel: true,
      label: `${SeriesDescription || 'RT Dose'}${summation}`,
      // set when loaded
      dose: null,
      dvhs: [],
      reference: null,
    } as any;

    // the image display set of the same frame of reference (a CT, preferably), found when first needed: at creation
    // the other display sets may not exist yet
    displaySet.getReferenceDisplaySet = () => {
      const { displaySetService } = servicesManager.services;
      if (displaySet.referencedDisplaySetInstanceUID) {
        return displaySetService.getDisplaySetByUID(displaySet.referencedDisplaySetInstanceUID);
      }
      const candidates = displaySetService
        .getActiveDisplaySets()
        .filter(ds => ds.isReconstructable && !ds.isDerivedDisplaySet && ds.StudyInstanceUID === StudyInstanceUID
          && frameOfReference(ds) === displaySet.FrameOfReferenceUID);
      const ref = candidates.find(ds => ds.Modality === 'CT') ?? candidates[0];
      if (!ref) {
        throw new Error('RT Dose: no image series of the same frame of reference in the study');
      }
      displaySet.referencedDisplaySetInstanceUID = ref.displaySetInstanceUID;
      return ref;
    };

    displaySet.getReferencedVolumeId = () => {
      if (!displaySet.referencedVolumeId) {
        const ref = displaySet.getReferenceDisplaySet();
        displaySet.referencedVolumeURI = ref.displaySetInstanceUID;
        displaySet.referencedVolumeId = `${VOLUME_LOADER_SCHEME}:${ref.displaySetInstanceUID}`;
      }
      return displaySet.referencedVolumeId;
    };

    displaySet.load = async ({ headers }) => _load(displaySet, headers);
    return displaySet;
  });
}

async function _load(displaySet, headers) {
  const volumeId = `${VOLUME_LOADER_SCHEME}:${displaySet.displaySetInstanceUID}`;
  const existing = cache.getVolumeLoadObject(volumeId);
  if (existing) {
    return existing.promise;
  }
  displaySet.loading = true;
  displaySet.isLoaded = false;
  const promise = _loadDose(displaySet, headers);
  cache.putVolumeLoadObject(volumeId, { promise }).catch(err => {
    throw err;
  });
  promise
    .then(() => {
      displaySet.loading = false;
      displaySet.isLoaded = true;
      emitDoseLoaded(displaySet);
    })
    .catch(err => {
      displaySet.loading = false;
      displaySet.isLoaded = false;
      throw err;
    });
  return promise;
}

async function _loadDose(displaySet, headers) {
  const arrayBuffer = await dicomLoaderService.findDicomDataPromise(displaySet, null, headers);
  const dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer);
  const ds = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict);
  const dose = readDose(ds);

  const referencedVolumeId = displaySet.getReferencedVolumeId();
  const ct = cache.getVolume(referencedVolumeId);
  if (!ct) {
    throw new Error('RT Dose: the CT volume is not loaded; open the dose in a viewport with its CT');
  }

  // the plan's prescription is the 100 % isodose; the structure set names the DVHs
  const { StudyInstanceUID } = displaySet;
  const planUid = firstItem(ds.ReferencedRTPlanSequence)?.ReferencedSOPInstanceUID;
  const structUid = firstItem(ds.ReferencedStructureSetSequence)?.ReferencedSOPInstanceUID;
  const rtplan = planUid ? findInstance(StudyInstanceUID, planUid) : null;
  const rtstruct = structUid ? findInstance(StudyInstanceUID, structUid) : null;
  displaySet.reference = referenceDose(rtplan, dose.max);
  displaySet.dvhs = readDVHs(ds, roiInfo(rtstruct));
  displaySet.dose = { max: dose.max, units: dose.units, type: dose.type, summation: dose.summation, comment: dose.comment };

  const onCt = resampleToGrid(dose, { dimensions: ct.dimensions, spacing: ct.spacing, origin: ct.origin, direction: ct.direction });
  const percent = relativeDose(onCt, displaySet.reference.gy);
  const derived = await volumeLoader.createAndCacheDerivedVolume(referencedVolumeId, {
    volumeId: displaySet.displaySetInstanceUID,
    targetBuffer: { type: 'Float32Array' },
  });
  derived.voxelManager.setCompleteScalarDataArray(percent);
  derived.metadata.voiLut = [csUtils.windowLevel.toWindowLevel(0, 120)];
  derived.loadStatus = { loaded: true };
  return derived;
}

function getSopClassHandlerModule(params: OhifTypes.Extensions.ExtensionParams) {
  const { servicesManager } = params;
  return [
    {
      name: 'rt-dose',
      sopClassUids,
      getDisplaySetsFromSeries: instances => _getDisplaySetsFromSeries(instances, servicesManager),
    },
  ];
}

export default getSopClassHandlerModule;
