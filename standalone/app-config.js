// OHIF's configuration in the standalone radiarch viewer: Orthanc's DICOMweb and radiarch's API through the same
// origin (default.conf.template). Research use only; not for clinical use.
const origin = window.location.origin;

/** @type {AppTypes.Config} */
window.config = {
  routerBasename: null,
  extensions: [],
  modes: [],
  showStudyList: true,
  maxNumberOfWebWorkers: 3,
  showLoadingIndicator: true,
  showWarningMessageForCrossOrigin: false,
  showCPUFallbackMessage: true,
  strictZSpacingForVolumeViewport: true,
  defaultDataSourceName: 'orthanc',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc',
      configuration: {
        friendlyName: 'Orthanc (radiarch viewer)',
        name: 'orthanc',
        wadoUriRoot: `${origin}/dicom-web`,
        qidoRoot: `${origin}/dicom-web`,
        wadoRoot: `${origin}/dicom-web`,
        qidoSupportsIncludeField: true,
        supportsReject: false,
        dicomUploadEnabled: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'rendered',
        thumbnailRequestStrategy: 'fetch',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        omitQuotationForMultipartRequest: true,
        bulkDataURI: { enabled: true },
      },
    },
  ],
  // the radiarch extension's API, served by this origin's proxy
  radiarch: { apiUrl: '/radiarch/api/v1', defaultTemplateId: null },
};
