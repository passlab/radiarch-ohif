// Where radiarch's API is, from the extension's configuration or the app config's `radiarch` block. The default is the
// path the standalone viewer's proxy serves it under; a host that embeds the extension sets its own.
// getUploadToken (radiarch's ADR 0020): a host whose archive authorizes each upload gives a function that issues a
// token for this user, this study and these objects; the MCO panel asks it before "Export and open" and the client
// sends the token in uploadTokenHeader. Without it the export is pushed as before.

export type UploadTokenContext = { studyInstanceUID: string; objects: string[] };

export type RadiarchViewerConfig = {
  apiUrl: string;
  defaultTemplateId: string | null;
  getUploadToken?: (ctx: UploadTokenContext) => Promise<string | null>;
  uploadTokenHeader?: string;
};

let config: RadiarchViewerConfig = { apiUrl: '/radiarch/api/v1', defaultTemplateId: null };

export function setConfig(configuration: Partial<RadiarchViewerConfig> = {}, appConfig: any = {}) {
  const fromApp = appConfig?.radiarch ?? {};
  config = {
    apiUrl: configuration.apiUrl ?? fromApp.apiUrl ?? config.apiUrl,
    defaultTemplateId: configuration.defaultTemplateId ?? fromApp.defaultTemplateId ?? config.defaultTemplateId,
    getUploadToken: configuration.getUploadToken ?? fromApp.getUploadToken ?? config.getUploadToken,
    uploadTokenHeader: configuration.uploadTokenHeader ?? fromApp.uploadTokenHeader ?? config.uploadTokenHeader,
  };
}

export function getConfig(): RadiarchViewerConfig {
  return config;
}
