export const OBSERVATION_PHASES = new Set(['calibration', 'warmup', 'baseline', 'photo', 'outcome', 'washout']);

export function mayObserve(status, renderedKey, visible = true) {
  return Boolean(status?.phase === 'ready' && !status.paused && !status.busy && visible && status.dating && OBSERVATION_PHASES.has(status.dating.phase) && renderedKey === status.dating.screen_key);
}

export class WingClient {
  constructor({ captureFrame, onStatus, onError, fetcher = globalThis.fetch.bind(globalThis), visible = () => !globalThis.document?.hidden }) {
    Object.assign(this, { captureFrame, onStatus, onError, fetcher, visible });
    this.clientId = globalThis.crypto.randomUUID();
    this.token = null; this.status = null; this.stopped = true; this.commandPending = false; this.epoch = 0; this.timer = null;
  }
  async request(path, options = {}) {
    const response = await this.fetcher(path, { ...options, cache: 'no-store', signal: AbortSignal.timeout(options.method === 'POST' ? 65000 : 15000), headers: { 'X-Fly-Token': this.token || '', 'X-Fly-Client': this.clientId, ...options.headers } });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Start WING with uv run flywirehead run');
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
    return data;
  }
  publish(status) {
    if (this.status?.dating?.session_id === status.dating?.session_id && this.status.sequence > status.sequence) return;
    this.status = status; this.onStatus(status);
  }
  async action(action, fields = {}, id = globalThis.crypto.randomUUID()) {
    if (this.commandPending) throw new Error('One moment — the previous action is still saving.');
    if (!this.token) throw new Error('The local brain is not connected.');
    this.commandPending = true; this.epoch++;
    const data = { action, id, trial_id: this.status?.dating?.trial_id, ...fields };
    try {
      let result;
      try { result = await this.request('/api/wing/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }
      catch (error) {
        if (error.status) throw error;
        result = await this.request('/api/wing/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      }
      this.publish(result); return result;
    } finally { this.commandPending = false; }
  }
  start() { this.stopped = false; void this.poll(); }
  stop() { this.stopped = true; clearTimeout(this.timer); }
  async poll() {
    if (this.stopped) return;
    let delay = 80;
    try {
      if (this.commandPending) return;
      if (!this.token) this.token = (await this.request('/api/session')).token;
      const epoch = this.epoch;
      const status = await this.request('/api/status');
      if (this.stopped || epoch !== this.epoch || this.commandPending) return;
      this.publish(status);
      const capture = this.captureFrame(status);
      if (capture && mayObserve(status, capture.screenKey, this.visible())) {
        await this.request('/api/frame', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Wing-Screen': capture.screenKey, 'X-Wing-Session': status.dating.session_id, 'X-Wing-Sample': String(status.dating.next_sample) }, body: capture.bytes });
      }
    } catch (error) {
      if (error.status === 409) delay = 150;
      else { this.token = null; this.status = null; this.onError(error); delay = 1500; }
    } finally { if (!this.stopped) this.timer = setTimeout(() => this.poll(), delay); }
  }
}
