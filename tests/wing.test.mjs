import test from 'node:test';
import assert from 'node:assert/strict';
import { mayObserve, WingClient } from '../dist/wing-client.js';
import { frontRightActionPose, sampleAction } from '../dist/wing-motion.js';
import { FORELEG_REST } from '../dist/swipe.js';

const state = overrides => ({ phase: 'ready', paused: false, busy: false, sequence: 0, dating: { phase: 'photo', screen_key: 'trial:photo:0', session_id: 'session', next_sample: 1 }, ...overrides });

test('static profile pixels are valid, but stale screens, transitions, hidden tabs and pauses are not', () => {
  const s = state();
  assert.equal(mayObserve(s, s.dating.screen_key), true);
  assert.equal(mayObserve(s, s.dating.screen_key), true);
  assert.equal(mayObserve(s, 'old-screen'), false);
  assert.equal(mayObserve(s, null), false);
  assert.equal(mayObserve(s, s.dating.screen_key, false), false);
  for (const overrides of [{ paused: true }, { busy: true }, { phase: 'error' }, { dating: { ...s.dating, phase: 'decision' } }]) assert.equal(mayObserve(state(overrides), s.dating.screen_key), false);
});

test('like, pass and rose gestures preserve all three bones and fixed shoulder', () => {
  const lengths = p => p.slice(1).map((point, i) => Math.hypot(...point.map((v, j) => v - p[i][j])));
  const original = lengths(FORELEG_REST);
  for (const choice of ['like', 'pass', 'rose']) {
    assert.deepEqual(frontRightActionPose(0, choice), FORELEG_REST);
    assert.deepEqual(frontRightActionPose(1, choice), FORELEG_REST);
    for (let i = 0; i <= 1000; i++) {
      const pose = frontRightActionPose(i / 1000, choice);
      assert.deepEqual(pose[0], FORELEG_REST[0]);
      assert.ok(pose.flat().every(Number.isFinite));
      lengths(pose).forEach((value, j) => assert.ok(Math.abs(value - original[j]) < 1e-9));
    }
  }
  assert.notDeepEqual(frontRightActionPose(.5, 'like'), frontRightActionPose(.5, 'pass'));
  assert.equal(sampleAction(.2).tapped, false);
  assert.equal(sampleAction(.5).tapped, true);
});

test('bridge attaches trial identity to actual captured bytes', async () => {
  const calls = [], pixels = new Uint8Array(90 * 160 * 4), s = state();
  let published;
  const client = new WingClient({ captureFrame: () => ({ screenKey: s.dating.screen_key, bytes: pixels }), onStatus: x => { published = x; }, onError: error => { throw error; }, fetcher: async (path, options) => {
    calls.push([path, options]);
    return { ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), json: async () => path === '/api/session' ? { token: 'test-session' } : path === '/api/status' ? s : { accepted: true } };
  } });
  client.stopped = false;
  await client.poll(); client.stop();
  const request = calls.find(([path]) => path === '/api/frame')[1];
  assert.equal(request.body, pixels);
  assert.equal(request.headers['X-Wing-Screen'], s.dating.screen_key);
  assert.equal(request.headers['X-Wing-Session'], s.dating.session_id);
  assert.equal(request.headers['X-Wing-Sample'], '1');
  assert.equal(published, s);
});

test('network retries preserve the control idempotency key', async () => {
  const bodies = [];
  const client = new WingClient({ captureFrame: () => null, onStatus: () => {}, onError: () => {}, fetcher: async (path, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) throw new Error('lost response');
    return { ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), json: async () => state() };
  } });
  client.token = 'test'; client.status = state();
  await client.action('manual_like', { trial_id: 'a' }, 'same-command');
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(client.commandPending, false);
});

test('a disconnected bridge clears measurements instead of creating a fallback brain', async () => {
  let failed;
  const client = new WingClient({ captureFrame: () => { throw new Error('must not capture'); }, onStatus: () => { throw new Error('must not publish'); }, onError: error => { failed = error; }, fetcher: async () => { throw new Error('offline'); } });
  client.status = state(); client.stopped = false;
  await client.poll(); client.stop();
  assert.equal(client.status, null); assert.equal(client.token, null); assert.equal(failed.message, 'offline');
});

test('screen-targeted taps touch reachable targets without stretching for distant ones', () => {
  const target = [1.65, .17, .8];
  const pose = frontRightActionPose(.5, 'like', target);
  pose[3].forEach((v, i) => assert.ok(Math.abs(v - target[i]) < 1e-9));
  for (const goal of [[5, 5, 5], [-3, -2, 4]]) {
    const points = frontRightActionPose(.5, 'pass', goal);
    points.slice(1).forEach((point, i) => assert.ok(Math.abs(Math.hypot(...point.map((v, j) => v - points[i][j])) - Math.hypot(...FORELEG_REST[i + 1].map((v, j) => v - FORELEG_REST[i][j]))) < 1e-9));
  }
});
