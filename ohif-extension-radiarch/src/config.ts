// Where radiarch's API is, from the extension's configuration or the app config's `radiarch` block. The default is the
// path the standalone viewer's proxy serves it under; a host that embeds the extension sets its own.

export type RadiarchViewerConfig = { apiUrl: string; defaultTemplateId: string | null };

let config: RadiarchViewerConfig = { apiUrl: '/radiarch/api/v1', defaultTemplateId: null };

export function setConfig(configuration: Partial<RadiarchViewerConfig> = {}, appConfig: any = {}) {
  const fromApp = appConfig?.radiarch ?? {};
  config = {
    apiUrl: configuration.apiUrl ?? fromApp.apiUrl ?? config.apiUrl,
    defaultTemplateId: configuration.defaultTemplateId ?? fromApp.defaultTemplateId ?? config.defaultTemplateId,
  };
}

export function getConfig(): RadiarchViewerConfig {
  return config;
}
