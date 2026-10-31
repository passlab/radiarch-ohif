// A client of radiarch's REST API (/api/v1) for a viewer. The host gives the base URL and the request headers (its
// sign-in): the browser never holds radiarch's API key (ADR 0018); a proxy in front of the API adds it.

export class RadiarchApiError extends Error {
  constructor(status, detail, method, path) {
    super(`${method} ${path}: HTTP ${status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    this.status = status;
    this.detail = detail;
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param {{apiUrl: string, headers?: () => (object | Promise<object>), fetch?: typeof fetch, pollMs?: number, timeoutMs?: number}} options
 *   apiUrl: radiarch's API base, e.g. "/radiarch/api/v1"; headers: called per request (a host's authorization header)
 */
export function createClient({ apiUrl, headers = () => ({}), fetch: fetchImpl = globalThis.fetch, pollMs = 500, timeoutMs = 300000 }) {
  const base = String(apiUrl).replace(/\/+$/, '');

  async function request(method, path, { query, body, expect = [200, 201, 202] } = {}) {
    const qs = query
      ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null)).toString()
      : '';
    const resp = await fetchImpl(`${base}${path}${qs}`, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(await headers()) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!expect.includes(resp.status)) {
      throw new RadiarchApiError(resp.status, data?.detail ?? data, method, path);
    }
    return { status: resp.status, data };
  }

  /** Follow a 202 answer (a job) through /{service}/jobs/{id} until it ends; returns the job's result id. */
  async function follow(service, job, resultField) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { data } = await request('GET', `/${service}/jobs/${job.job_id}`);
      if (data.state === 'succeeded') {
        return data[resultField];
      }
      if (data.state === 'failed' || data.state === 'cancelled') {
        throw new RadiarchApiError(500, data.message ?? data.state, 'GET', `/${service}/jobs/${job.job_id}`);
      }
      if (Date.now() > deadline) {
        throw new RadiarchApiError(504, 'timed out waiting for the job', 'GET', `/${service}/jobs/${job.job_id}`);
      }
      await sleep(pollMs);
    }
  }

  return {
    request,

    /** The service's identity and intended use. */
    info: async () => (await request('GET', '/info')).data,

    /** Exports that wrote a DICOM study, series or instance, newest first. */
    findExports: async ({ studyInstanceUid, seriesInstanceUid, sopInstanceUid, limit } = {}) =>
      (
        await request('GET', '/rt/exports', {
          query: { study_instance_uid: studyInstanceUid, series_instance_uid: seriesInstanceUid, sop_instance_uid: sopInstanceUid, limit },
        })
      ).data,

    /** The clinical-goal templates radiarch ships. */
    goalTemplates: async () => (await request('GET', '/evaluate/goal-templates')).data,

    /**
     * Evaluate an export's dose against a goal template: DVHs, indices and the goals graded. A cached evaluation
     * answers at once; otherwise the job is followed.
     */
    evaluateExport: async (exp, { templateId, dvhBins = 200 } = {}) => {
      if (!exp?.dose_id) {
        throw new RadiarchApiError(422, 'this export has no dose radiarch can evaluate', 'POST', '/evaluate/run');
      }
      const rx = exp.prescription;
      if (!rx?.dose_gy) {
        throw new RadiarchApiError(422, 'this export has no prescription to evaluate against', 'POST', '/evaluate/run');
      }
      const body = {
        geometry_id: exp.geometry_id,
        dose_id: exp.dose_id,
        prescription_gy: rx.dose_gy,
        target_structure: rx.target_structure ?? null,
        fractions: rx.fractions ?? exp.n_fractions ?? null,
        dvh_bins: dvhBins,
        goals: templateId ? { template_id: templateId } : null,
      };
      const { status, data } = await request('POST', '/evaluate/run', { body });
      if (status === 200) {
        return data;
      }
      const evaluationId = await follow('evaluate', data, 'evaluation_id');
      return (await request('GET', `/evaluate/${evaluationId}`)).data;
    },

    /** The lineage node of a version (its parents and children). */
    lineage: async (kind, id) => (await request('GET', `/lineage/${kind}/${id}`)).data,

    // --- multi-criteria optimization (R11) -------------------------------------------------------------------------

    /** The deliverable plans (of a Pareto set) that made a dose or a beam model, newest first. */
    findDeliverables: async ({ doseId, beamModelId, limit } = {}) =>
      (await request('GET', '/mco/deliverables', { query: { dose_id: doseId, beam_model_id: beamModelId, limit } })).data,

    /**
     * The Pareto set behind an export's dose, or null: the set, its stored states and the deliverable plan that made the
     * dose (whose state_id is where navigation starts).
     */
    paretoSetOf: async exp => {
      if (!exp?.dose_id) {
        return null;
      }
      const [plan] = (await request('GET', '/mco/deliverables', { query: { dose_id: exp.dose_id, limit: 1 } })).data;
      if (!plan) {
        return null;
      }
      const [set, states] = await Promise.all([
        request('GET', `/mco/${plan.mco_id}`).then(r => r.data),
        request('GET', `/mco/${plan.mco_id}/states`).then(r => r.data),
      ]);
      return { set, states, plan };
    },

    /** A navigation step from a state: a slider move, a reference point, clamps and locks (NavigateRequest). */
    navigate: async (mcoId, body) => (await request('POST', `/mco/${mcoId}/navigate`, { body })).data,

    /** The blend that best meets a goal set, priority by priority (AutoNavigateRequest). */
    autoNavigate: async (mcoId, body) => (await request('POST', `/mco/${mcoId}/auto-navigate`, { body })).data,

    /** A state made deliverable (DeliverableRequest): a stored plan at once, else the job followed to its result. */
    makeDeliverable: async (mcoId, body) => {
      const { status, data } = await request('POST', `/mco/${mcoId}/deliverable`, { body });
      if (status === 200) {
        return data;
      }
      const deliverableId = await follow('mco/deliverables', data, 'deliverable_id');
      return (await request('GET', `/mco/deliverables/${deliverableId}`)).data;
    },

    /** Write (and, with push, send to the DICOMweb server) the RT objects of a plan (RTExportRequest). */
    exportPlan: async body => (await request('POST', '/rt/export', { body })).data,
  };
}
