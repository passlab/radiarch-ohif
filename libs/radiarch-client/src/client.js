// A client of radiarch's REST API (/api/v1) for a viewer. The host gives the base URL and the request headers (its
// sign-in): the browser never holds radiarch's API key (ADR 0018); a proxy in front of the API adds it.

export class RadiarchApiError extends Error {
  constructor(status, detail, method, path) {
    super(`${method} ${path}: HTTP ${status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    this.status = status;
    this.detail = detail;
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason);
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

// While a job is followed, a gateway or network error is retried this many times in a row before the wait fails.
const POLL_ERRORS = 5;
const TRANSIENT = new Set([502, 503, 504]);

/**
 * @param {{apiUrl: string, headers?: () => (object | Promise<object>), fetch?: typeof fetch, pollMs?: number,
 *   pollMaxMs?: number, timeoutMs?: number, now?: () => number}} options
 *   apiUrl: radiarch's API base, e.g. "/radiarch/api/v1"; headers: called per request (a host's authorization header).
 *   A job is followed until it ends (a deliverable arc plan takes hours): polls start every pollMs and slow to
 *   pollMaxMs; timeoutMs, when given, stops the wait (not the job) after that long.
 */
export function createClient({ apiUrl, headers = () => ({}), fetch: fetchImpl = globalThis.fetch, pollMs = 500, pollMaxMs = 5000,
                               timeoutMs = Infinity, now = () => Date.now() }) {
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

  /**
   * Follow a 202 answer (a job) through /{service}/jobs/{id} until it ends; returns the job's result id. onProgress
   * gets each status (state, progress 0-1, stage, message); an aborted signal stops the wait, not the job.
   */
  async function follow(service, job, resultField, { onProgress, signal } = {}) {
    const path = `/${service}/jobs/${job.job_id}`;
    const deadline = now() + timeoutMs;
    let wait = pollMs;
    let errors = 0;
    for (;;) {
      signal?.throwIfAborted();
      let data;
      try {
        ({ data } = await request('GET', path));
        errors = 0;
      } catch (e) {
        // a gateway restarting or a dropped connection: the job runs on, so ask again
        if ((e instanceof RadiarchApiError && !TRANSIENT.has(e.status)) || ++errors > POLL_ERRORS) {
          throw e;
        }
      }
      if (data) {
        onProgress?.(data);
        if (data.state === 'succeeded') {
          return data[resultField];
        }
        if (data.state === 'failed' || data.state === 'cancelled') {
          throw new RadiarchApiError(500, data.message ?? data.state, 'GET', path);
        }
      }
      if (now() > deadline) {
        throw new RadiarchApiError(504, 'stopped waiting for the job; it runs on, and once it ends asking again returns its result', 'GET', path);
      }
      await sleep(wait, signal);
      wait = Math.min(pollMaxMs, wait * 1.5);
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
     * answers at once; otherwise the job is followed (onProgress, signal: as for makeDeliverable).
     */
    evaluateExport: async (exp, { templateId, dvhBins = 200, onProgress, signal } = {}) => {
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
      const evaluationId = await follow('evaluate', data, 'evaluation_id', { onProgress, signal });
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

    /**
     * A state made deliverable (DeliverableRequest): a stored plan at once, else the job followed to its result, however
     * long it takes. onProgress gets the job's status at each poll; an aborted signal stops the wait, not the job.
     */
    makeDeliverable: async (mcoId, body, { onProgress, signal } = {}) => {
      const { status, data } = await request('POST', `/mco/${mcoId}/deliverable`, { body });
      if (status === 200) {
        return data;
      }
      const deliverableId = await follow('mco/deliverables', data, 'deliverable_id', { onProgress, signal });
      return (await request('GET', `/mco/deliverables/${deliverableId}`)).data;
    },

    /** Write (and, with push, send to the DICOMweb server) the RT objects of a plan (RTExportRequest). */
    exportPlan: async body => (await request('POST', '/rt/export', { body })).data,
  };
}
