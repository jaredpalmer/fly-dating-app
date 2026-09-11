import { createLab } from './scene.js';
import { createFrameClock } from './simulation.js';
import { WingClient, mayObserve } from './wing-client.js';
import { WingScreen } from './wing-screen.js';
import { PortraitStudio } from './wing-portraits.js';

const $ = selector => document.querySelector(selector);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const dialog = $('#world-dialog'), content = $('#dialog-content');
let profiles = [], account = null, studio, screen, lab, status = null, action = null, camera = 0, rendered = false, time = 0;
let historyKey = '', accessibilityKey = '', resumeAfterDialog = false, toastTimer, reducedInitialized = false, recorder = null, visualFailed = false;
const thumbs = new Map();
const fmt = value => Number.isFinite(value) ? value.toFixed(1) : '—';
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const node = (tag, className = '', text = '') => { const element = document.createElement(tag); element.className = className; element.textContent = text; return element; };
const profileFor = id => profiles.find(p => p.id === id);
const reasonText = { above_threshold: 'A sustained response crossed the threshold.', below_threshold: 'The response stayed below the like threshold.', insufficient_signal: 'No PAM11 spikes during this observation. No preference is inferred.', incomplete_observation: 'The observation was incomplete.', unstable_response: 'The response was not consistent across photos.', operator_override: 'You made this decision. It is not attributed to the brain.' };

function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000); }
function button(text, handler, style = 'secondary') { const el = node('button', `button ${style}`, text); el.addEventListener('click', handler); return el; }
function thumb(profile, photo = 0) { const key = `${profile.id}:${photo}`; if (!thumbs.has(key)) thumbs.set(key, studio.get(profile, photo).toDataURL('image/jpeg', .8)); return thumbs.get(key); }
function image(profile, photo = 0, className = '') { const el = node('img', className); el.src = thumb(profile, photo); el.alt = `Original procedural portrait of ${profile.name}, a fictional adult female fly`; return el; }
function download(blob, name) { const url = URL.createObjectURL(blob), link = node('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

const client = new WingClient({
  captureFrame(next) {
    if (!rendered || !screen || !lab || dialog.open || screen.error || !mayObserve(next, screen.renderedKey, !document.hidden)) return null;
    return { screenKey: screen.renderedKey, bytes: lab.captureFrame() };
  },
  visible: () => !document.hidden && !dialog.open,
  onStatus(next) {
    status = next;
    if (next.dating?.phase === 'decision') {
      const receipt = next.dating.current_decision;
      if (receipt && action?.id !== receipt.id) {
        action = { id: receipt.id, choice: receipt.choice, progress: 0, acknowledging: false };
        if (receipt.simulated_outcome) toast(`It is a match with ${profileFor(receipt.profile_id)?.name}. Reciprocity is simulated.`);
      }
    } else action = null;
    if (reduced && !reducedInitialized && next.phase === 'ready') { reducedInitialized = true; void act('pause'); }
    update();
  },
  onError(error) { status = null; rendered = false; update(); $('#connection-label').textContent = 'BRAIN DISCONNECTED'; $('#connection-dot').className = 'error'; $('#decision-description').textContent = error.message; }
});

async function act(name, fields = {}, id) {
  try { return await client.action(name, fields, id); }
  catch (error) { toast(error.message); return null; }
}

function update() {
  const d = status?.dating, t = status?.telemetry, ready = status?.phase === 'ready';
  $('#connection-label').textContent = ready ? status.paused ? 'BRAIN PAUSED' : 'BRAIN CONNECTED' : status?.phase === 'error' ? 'BRAIN ERROR' : 'LOADING CONNECTOME';
  $('#connection-dot').className = ready ? 'ready' : status?.phase === 'error' ? 'error' : '';
  $('#dopamine-value').textContent = fmt(t?.pam11_hz);
  $('#spike-value').textContent = t ? `${t.total_spikes.toLocaleString()} spikes / sample` : '— spikes';
  $('#pause-button span').textContent = status?.paused ? 'Resume fly' : 'Pause fly';
  $('#pause-button use').setAttribute('href', status?.paused ? '#i-play' : '#i-pause');
  for (const el of document.querySelectorAll('.session-controls button, [data-choice], #save-button')) el.disabled = !ready;
  $('#checkpoint-label').textContent = status?.checkpoint ? `Saved at ${Math.round(status.checkpoint.sim_ms)} ms` : 'Not yet saved';
  if (!d) { $('#decision-description').textContent = status?.message || 'Waiting for the local neural model. No fabricated fallback.'; drawChart(); return; }
  $('#deck-counter').textContent = `${String(Math.min(d.index + 1, d.deck.length)).padStart(2, '0')} / ${d.deck.length}`;
  $('#stat-viewed').textContent = d.stats.viewed; $('#stat-likes').textContent = d.stats.likes; $('#stat-matches').textContent = d.stats.matches;
  $('#incoming-badge').textContent = d.incoming.length; $('#incoming-badge').hidden = !d.incoming.length;
  $('#matches-badge').textContent = d.stats.matches; $('#matches-badge').hidden = !d.stats.matches;
  const profile = profileFor(d.profile_id), receipt = d.current_decision;
  const labels = { calibration: 'Reference calibration', warmup: 'Settling in', baseline: 'Taking a baseline', photo: `Photo ${d.photo + 1} of 3`, decision: receipt?.choice === 'pass' ? 'Passed' : receipt?.choice === 'rose' ? 'Rose sent' : 'Liked', outcome: 'Outcome training', washout: 'Letting it settle', complete: 'Small world' };
  $('#phase-label').textContent = status.paused ? 'Paused' : labels[d.phase];
  $('#subject-status').textContent = status.paused ? 'Taking a breath' : labels[d.phase];
  const lines = { calibration: 'A quiet moment before the introductions.', warmup: `A little pause before meeting ${profile?.name}.`, baseline: 'Establishing a neutral starting point.', photo: `Getting to know ${profile?.name}, one photo at a time.`, decision: receipt?.choice === 'pass' ? `Not this time, ${profile?.name}.` : `A little connection with ${profile?.name}.`, outcome: 'The social world sends something back.', washout: 'Letting the last encounter fade.', complete: 'That is everyone in the neighborhood.' };
  $('#chamber-action').textContent = lines[d.phase] || '';
  const descriptions = { calibration: 'A fixed neutral screen measures reference variability. It does not select for attractive profiles.', warmup: 'Neutral pixels let the previous encounter settle before scoring a new one.', baseline: 'Recording a neutral PAM11 baseline, in simulated neural time.', photo: 'Only completed observations count. Photos remain on screen until their neural exposure budget is met.', outcome: 'Experimental current follows a committed neural like and a simulated match. It is excluded from the decision.', washout: 'No scoring during the post-outcome washout.', complete: 'The deck is finished. Review his decisions or start another round.' };
  $('#decision-description').textContent = receipt ? reasonText[receipt.reason] : descriptions[d.phase];
  const rate = samples => { const ms = samples.reduce((sum, x) => sum + x.interval_ms, 0); return ms ? samples.reduce((sum, x) => sum + x.pam11_spikes, 0) / (15 * ms / 1000) : null; };
  const baseline = receipt?.baseline_hz ?? rate(d.baseline), photos = d.photos.flat(), response = rate(photos);
  $('#baseline-value').textContent = `${fmt(baseline)} Hz`;
  $('#delta-value').textContent = `${fmt(receipt?.delta_hz ?? (response !== null && baseline !== null ? response - baseline : null))} Hz`;
  $('#threshold-value').textContent = `+${fmt(d.policy.threshold_hz)} Hz`;
  $('#exposure-value').textContent = ['calibration', 'warmup', 'baseline', 'washout', 'outcome'].includes(d.phase) ? `${Math.round(d.elapsed_ms)} / ${d.target_ms} ms` : `${Math.round(photos.reduce((sum, x) => sum + x.interval_ms, 0))} / ${d.photo_ms * 3} ms`;
  const stage = d.phase === 'decision' ? 4 : d.phase === 'photo' ? d.photo + 1 : 0;
  document.querySelectorAll('.stage-steps i').forEach((el, i) => { el.className = i === stage ? 'active' : i < stage ? 'done' : ''; });
  $('#signal-notice').textContent = d.tonic_mv ? `Experimental tonic input: ${d.tonic_mv} mV to every PAM11 cell, independent of profile. Visual selectivity is not validated.` : 'Unboosted model. PAM11 may stay silent; an insufficient-signal pass is not evidence of dislike.';
  if (d.learning) $('#signal-notice').textContent += ' Outcome training is experimental, not established learning.';
  for (const el of document.querySelectorAll('[data-choice]')) el.disabled = !ready || ['decision', 'complete', 'outcome', 'washout'].includes(d.phase);
  const currentKey = `${d.trial_id}:${d.phase}:${d.photo}`;
  if (accessibilityKey !== currentKey && profile) {
    accessibilityKey = currentKey;
    $('#profile-accessible').textContent = `${profile.name}, ${profile.adult_days} days into adulthood. ${profile.job}. ${profile.prompts.map(p => `${p.question}: ${p.answer}`).join(' ')}. ${labels[d.phase]}.`;
    $('#wing-screen').setAttribute('aria-label', `${profile.name}: ${labels[d.phase]}. The same pixels appear on Francis's phone.`);
  }
  const key = d.decisions.map(x => x.id).join(',');
  if (key !== historyKey) { historyKey = key; renderHistory(d.decisions.slice(-3).reverse(), $('#decision-history')); }
  if (d.phase === 'complete' && !$('#new-round-button')) {
    const el = button('Meet everyone again', async () => { const next = await act('new_round'); if (next) { el.remove(); } }); el.id = 'new-round-button'; $('#decision-history').append(el);
  }
  drawChart();
}

function drawChart() {
  const canvas = $('#dopamine-chart'), c = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
  c.clearRect(0, 0, width, height);
  const history = status?.history || [], values = history.map(s => s.pam11_hz).filter(Number.isFinite);
  const low = values.length ? Math.max(0, Math.floor(Math.min(...values) - 2)) : 0;
  const high = values.length ? Math.max(low + 5, Math.ceil(Math.max(...values) + 2)) : 5;
  const left = 8, right = width - 7, top = 12, bottom = height - 10;
  c.lineWidth = 1; c.strokeStyle = '#e7e6db';
  for (let i = 0; i < 4; i++) { const y = top + i / 3 * (bottom - top); c.beginPath(); c.moveTo(left, y); c.lineTo(right, y); c.stroke(); }
  if (values.length) {
    const start = history[0].sim_ms, end = history.at(-1).sim_ms;
    c.strokeStyle = '#8b6179'; c.lineWidth = 2.4; c.beginPath();
    history.forEach((sample, i) => { const x = left + (end === start ? .5 : (sample.sim_ms - start) / (end - start)) * (right - left), y = bottom - (sample.pam11_hz - low) / (high - low) * (bottom - top); if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); }); c.stroke();
    const y = bottom - (values.at(-1) - low) / (high - low) * (bottom - top); c.fillStyle = '#8b6179'; c.beginPath(); c.arc(values.length === 1 ? width / 2 : right, y, 4, 0, Math.PI * 2); c.fill();
  }
  $('#chart-range').textContent = values.length ? `${low}–${high} Hz · ${values.length} SAMPLES` : 'WAITING FOR SAMPLES';
}

function renderHistory(decisions, parent) {
  parent.replaceChildren();
  if (!decisions.length) { parent.append(node('div', 'empty-history', 'A clean slate. His first decision will appear here.')); return; }
  for (const receipt of decisions) {
    const p = profileFor(receipt.profile_id), row = node('button', 'history-row');
    row.append(image(p, receipt.photo, 'mini-avatar'));
    const label = node('span'); label.append(node('strong', '', p.name), node('small', '', receipt.source === 'operator' ? 'You gave him a nudge' : receipt.reason === 'insufficient_signal' ? 'Insufficient neural signal' : `${fmt(receipt.delta_hz)} Hz over baseline`));
    row.append(label, node('span', receipt.choice !== 'pass' ? 'like' : '', receipt.choice.toUpperCase())); row.addEventListener('click', () => showReceipt(receipt)); parent.append(row);
  }
}

async function openDialog(title, builder, kicker = 'THE WING WORLD') {
  const first = !dialog.open;
  $('#dialog-title').textContent = title; $('#dialog-kicker').textContent = kicker;
  content.replaceChildren();
  if (first) {
    resumeAfterDialog = Boolean(status?.phase === 'ready' && !status.paused);
    dialog.showModal();
    if (resumeAfterDialog) await act('pause');
  }
  await builder(content);
}
function closeDialog() { dialog.close(); }
dialog.addEventListener('close', () => { const resume = resumeAfterDialog; resumeAfterDialog = false; if (resume && status?.dating?.phase !== 'complete') void act('resume'); });
$('#close-dialog').addEventListener('click', closeDialog);

function empty(parent, title, text) { const wrap = node('div', 'empty-state'); wrap.innerHTML = icon('wing'); wrap.append(node('h3', '', title), node('p', '', text)); parent.append(wrap); }
function grid(parent, list, badges = {}) {
  if (!list.length) { empty(parent, 'Nothing here. Yet.', 'Let the fly meet a few profiles. We will not fabricate decisions or mutual interest.'); return; }
  const grid = node('div', 'profile-grid');
  for (const p of list) {
    const tile = node('button', 'profile-tile'), details = node('div');
    details.append(node('h3', '', p.name), node('p', '', `${p.adult_days} adult days · ${p.district}`));
    if (badges[p.id]) details.append(node('small', '', badges[p.id]));
    tile.append(image(p), details); tile.addEventListener('click', () => showProfile(p)); grid.append(tile);
  }
  parent.append(grid);
}

async function reviewProfile(profile, date = false) {
  if (status?.dating?.phase === 'decision' && !await act('advance')) return;
  const next = await act(date ? 'date' : 'review', { profile_id: profile.id });
  if (next) { resumeAfterDialog = true; closeDialog(); toast(date ? `A date with ${profile.name}. The setting is fictional; responses are measured.` : `${profile.name} is up next. Your selection is recorded separately from his decision.`); }
}
function showProfile(profile) {
  return openDialog(profile.name, parent => {
    const details = node('div', 'profile-detail'), info = node('div');
    info.append(node('h3', '', `${profile.name}, ${profile.adult_days} adult days`), node('p', '', `${profile.job} · ${profile.district} · ${profile.distance_cm} cm away`), node('p', '', profile.intentions));
    details.append(image(profile), info); parent.append(details);
    for (const prompt of profile.prompts) { const box = node('div', 'prompt-block'); box.append(node('span', '', prompt.question), node('p', '', prompt.answer)); parent.append(box); }
    const actions = node('div', 'detail-actions'); actions.append(button('Let Francis meet her', () => reviewProfile(profile), 'primary'));
    if (status.dating.matches[profile.id] && !status.dating.matches[profile.id].unmatched) actions.append(button('Open conversation', () => showConversation(profile)));
    parent.append(actions, node('p', 'dialog-note', 'Fictional adult female Drosophila melanogaster. Original procedural artwork. Profile text is narrative; the brain receives pixels, not semantic personality traits.'));
  });
}
function showConversation(profile) {
  return openDialog(profile.name, parent => {
    const match = status.dating.matches[profile.id];
    if (!match || match.unmatched) { empty(parent, 'A connection, archived.', 'This conversation is no longer active.'); return; }
    const log = node('div', 'chat-log');
    for (const message of match.messages) log.append(node('div', `chat-bubble ${message.from}`, message.text));
    if (match.quiet) log.append(node('div', 'chat-bubble system', 'No reply yet. This silence is part of the seeded fictional world.'));
    parent.append(log);
    const form = node('form', 'chat-form'), input = node('input'); input.placeholder = 'Send a very small opening line…'; input.maxLength = 500; input.required = true; input.setAttribute('aria-label', `Message to ${profile.name}`);
    const send = button('Send', () => {}, 'primary'); send.type = 'submit'; form.append(input, send);
    form.addEventListener('submit', async event => { event.preventDefault(); const next = await act('message', { profile_id: profile.id, text: input.value }); if (next) await showConversation(profile); }); parent.append(form);
    const actions = node('div', 'chat-actions');
    if (!match.date) actions.append(button('Invite her on a date', async () => { if (await act('invite', { profile_id: profile.id })) await showConversation(profile); }));
    else if (match.date.status === 'invited') actions.append(button(`Meet at ${match.date.place.toLowerCase()}`, () => reviewProfile(profile, true), 'primary'));
    else actions.append(node('p', 'dialog-note', `Date: ${match.date.status.replaceAll('_', ' ')} · ${match.date.place}`));
    actions.append(button('Archive match', async () => { if (await act('unmatch', { profile_id: profile.id })) await showTab('messages'); })); parent.append(actions);
    parent.append(node('p', 'dialog-note', 'You write Francis’s messages. Her replies are authored, seeded fiction—not language generated by the connectome. No messages leave this machine.'));
    log.scrollTop = log.scrollHeight;
  }, 'SIMULATED CONVERSATION');
}

function showTab(tab) {
  if (!status?.dating) return toast('The local brain is still loading.');
  if (tab === 'discover') { if (dialog.open) closeDialog(); return; }
  if (tab === 'incoming') return openDialog('A little interest.', parent => { parent.append(node('p', 'dialog-note', 'These incoming likes belong to the seeded fictional world. They do not influence his neural scoring.')); grid(parent, status.dating.incoming.map(profileFor)); });
  if (tab === 'standouts') return openDialog('The ones that stood out.', parent => {
    const unique = [...new Set(status.dating.standouts.map(d => d.profile_id))], badges = {};
    for (const id of unique) badges[id] = `Measured delta: +${fmt(status.dating.standouts.find(d => d.profile_id === id).delta_hz)} Hz`;
    if (!unique.length) empty(parent, 'No sparks to rank yet.', 'Only neural responses above the session threshold appear here. Manual likes and fabricated compatibility scores do not qualify.');
    else grid(parent, unique.map(profileFor), badges);
  });
  if (tab === 'messages') return openDialog('Small talk.', parent => {
    const matches = Object.values(status.dating.matches).filter(m => !m.unmatched);
    if (!matches.length) { empty(parent, 'It takes two to tango.', 'Mutual matches appear here. Incoming likes can be reviewed with Francis, and manual nudges are always labeled.'); return; }
    for (const match of matches) {
      const profile = profileFor(match.profile_id), row = node('button', 'history-row'), label = node('span');
      label.append(node('strong', '', profile.name), node('small', '', match.messages.at(-1)?.text.slice(0, 80) || 'Say something small.'));
      row.append(image(profile, 0, 'mini-avatar'), label); row.addEventListener('click', () => showConversation(profile)); parent.append(row);
    }
  });
  if (tab === 'account') return openDialog('His best six feet forward.', parent => {
    const hero = node('div', 'profile-detail'), avatar = { ...profiles[0], ...account, seed: 48, photos: profiles[0].photos, palette: ['#b2beb4', '#ede7d0', '#76866c', '#60574a'] };
    const picture = node('img'); picture.src = studio.get(avatar).toDataURL('image/jpeg', .85); picture.alt = 'Francis, the fictional subject fly';
    const text = node('div'); text.append(node('h3', '', `${account.name}, ${account.adult_days} adult days`), node('p', '', account.job), node('p', '', account.intentions)); hero.append(picture, text); parent.append(hero);
    for (const prompt of account.prompts) { const box = node('div', 'prompt-block'); box.append(node('span', '', prompt.question), node('p', '', prompt.answer)); parent.append(box); }
    parent.append(node('p', 'dialog-note', 'Male Drosophila melanogaster · MaleCNS v1.0 · 166,700 neurons · 25,582,938 directed connections. No real dating account.'));
  });
}

function showReceipt(receipt) {
  const profile = profileFor(receipt.profile_id);
  return openDialog(`${receipt.choice === 'pass' ? 'Passed on' : 'Liked'} ${profile.name}.`, parent => {
    parent.append(node('p', 'method-copy', reasonText[receipt.reason]));
    const grid = node('div', 'receipt-grid');
    for (const [label, value] of [['Baseline', `${fmt(receipt.baseline_hz)} Hz`], ['Response', `${fmt(receipt.response_hz)} Hz`], ['Delta', `${fmt(receipt.delta_hz)} Hz`], ['Threshold', `+${fmt(receipt.threshold_hz)} Hz`], ['Exposure', `${receipt.exposure_ms} ms`], ['Source', receipt.source]]) { const cell = node('div'); cell.append(node('span', '', label), node('strong', '', value)); grid.append(cell); }
    parent.append(grid, node('p', 'dialog-note', `Policy ${receipt.policy_version}. Tonic current ${receipt.tonic_mv} mV. ${receipt.learning ? 'Experimental learning enabled.' : 'Plastic weights frozen.'} Trial ${receipt.id}.`));
    const actions = node('div', 'detail-actions'); actions.append(button('Replay observed pixels', () => showReplay(receipt), 'primary'), button('View profile', () => showProfile(profile))); parent.append(actions);
  }, 'DECISION RECEIPT');
}
async function showReplay(receipt) {
  await openDialog('Exactly what he saw.', async parent => {
    const response = await client.request(`/api/wing/observations?trial=${encodeURIComponent(receipt.id)}`), frames = response.observations;
    if (!frames.length) { empty(parent, 'No observed frames.', 'An early manual decision may have no neural observations. Nothing is fabricated for replay.'); return; }
    const picture = node('img', 'replay-screen'), label = node('p', 'method-copy'), controls = node('div', 'replay-controls'), range = node('input');
    picture.alt = 'Archived 90 by 160 pixel neural input'; range.type = 'range'; range.min = 0; range.max = frames.length - 1; range.value = 0; range.setAttribute('aria-label', 'Recorded observation');
    const update = () => { const f = frames[Number(range.value)]; picture.src = `/api/wing/frames/${f.input_sha256}`; label.textContent = `${Number(range.value) + 1} / ${frames.length} · ${f.stage} · ${fmt(f.pam11_hz)} Hz · ${f.sim_ms} ms neural time`; };
    range.addEventListener('input', update); controls.append(node('span', '', 'Scrub'), range); parent.append(picture, controls, label, node('p', 'dialog-note', 'Recorded pixels and measurements. Scrubbing does not advance, rewind, or stimulate the live brain. For exact native-kernel replay use scripts/replay_dating.py.')); update();
  }, 'RECORDED OBSERVATIONS');
}

function methodContent(parent) {
  const copy = node('div', 'method-copy');
  copy.innerHTML = '<h3>A screen, not a personality test.</h3><p>The same composited profile canvas appears on both phones and is captured at 90 × 160 pixels. The full MaleCNS spiking network advances only after accepted, visible observations. The model does not understand names, prompts, intentions, or English messages.</p><h3>Measured first. Interpreted second.</h3><p>The mean firing rate of 15 PAM11 dopamine neurons is compared with a neutral baseline. A like requires a positive delta above the reference-calibrated threshold and a positive response in at least two of three photo windows. A silent model records an insufficient-signal pass, not a biological rejection.</p><h3>No reward-shaped circular logic.</h3><p>Automatic video stimulation is disabled. Optional tonic current is identical for every profile and explicitly experimental. Evaluation freezes plasticity. Optional learning supplies current only after a committed neural like receives a fictional mutual match, then runs an unscored washout. Learned preference has not been established.</p><h3>The social world is fiction.</h3><p>All 36 profiles are fictional adult female flies. Reciprocal likes and replies use a seeded simulation independent of neural scoring. You write Francis’s messages; the brain is not generating language. Manual likes, passes, and roses are recorded as operator overrides.</p><h3>A small, local experiment.</h3><p>The browser and Python/C++ model run on this machine. Dataset checksums, decision receipts, frame hashes, lossless sensory images, and paired neural/dating checkpoints make the run inspectable. No account, cloud inference, payment, or real dating service is involved.</p>';
  parent.append(copy);
}
function settings() {
  return openDialog('Inside the experiment.', parent => {
    const d = status?.dating, copy = node('div', 'method-copy');
    copy.append(node('p', '', `Current session: ${d?.session_id || 'loading'}. Seed ${d?.seed ?? '—'}. Tonic ${d?.tonic_mv ?? '—'} mV. ${d?.learning ? 'Experimental outcome learning.' : 'Frozen evaluation.'}`));
    const pre = node('pre'); pre.textContent = 'uv run flywirehead run\nuv run flywirehead run --experience shorts\nuv run flywirehead run --dopamine-tonic 8 --run-dir runs/wing-tonic8\nuv run flywirehead run --learning --run-dir runs/wing-learning\nuv run python scripts/assay_dating.py\nuv run python scripts/replay_dating.py runs/wing'; copy.append(pre);
    copy.append(node('p', '', 'Use separate run directories to compare experimental conditions. Changing model settings in an existing session is refused. Tonic-driven visual selectivity and useful learning remain unvalidated.'));
    parent.append(copy);
    const controls = node('div', 'detail-actions'); controls.append(button('Export JSON', () => { window.location.assign('/api/wing/export'); }), button('Export CSV', () => { window.location.assign('/api/wing/export?format=csv'); }), button(recorder ? 'Stop recording' : 'Record chamber', recordChamber)); parent.append(controls);
    const compare = node('div', 'method-copy'); compare.append(node('h3', '', 'Compare an exported session'));
    const input = node('input'); input.type = 'file'; input.accept = '.json,application/json'; input.setAttribute('aria-label', 'Choose a WING session export');
    input.addEventListener('change', async () => {
      try {
        const file = input.files[0]; if (!file || file.size > 20 * 1024 * 1024) throw new Error('Choose a session JSON smaller than 20 MB.');
        const other = JSON.parse(await file.text()); if (other.version !== 1 || !Array.isArray(other.session?.decisions)) throw new Error('This is not a WING session export.');
        const rows = node('div', 'receipt-grid');
        for (const [label, session] of [['This session', status.dating], ['Imported session', other.session]]) {
          const decisions = session.decisions.filter(d => d.source === 'neural'), likes = decisions.filter(d => d.choice !== 'pass').length;
          const cell = node('div'); cell.append(node('span', '', label), node('strong', '', `${likes} / ${decisions.length} likes`), node('p', 'dialog-note', `${session.tonic_mv} mV tonic · ${session.learning ? 'learning' : 'frozen'} · seed ${session.seed}`)); rows.append(cell);
        }
        compare.querySelector('.receipt-grid')?.remove(); compare.append(rows, node('p', '', 'Descriptive comparison only. Different profile orders, inputs, thresholds, or model conditions prevent causal conclusions.'));
      } catch (error) { toast(error.message); }
    }); compare.append(input); parent.append(compare);
  }, 'LOCAL SETTINGS / NO CLOUD');
}
function recordChamber() {
  if (recorder) { recorder.stop(); return; }
  if (!globalThis.MediaRecorder || !$('#scene').captureStream) return toast('This browser does not support canvas recording.');
  try {
    const stream = $('#scene').captureStream(30), chunks = [], mimeType = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const current = recorder;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => { download(new Blob(chunks, { type: current.mimeType }), `wing-chamber.${current.mimeType.includes('mp4') ? 'mp4' : 'webm'}`); stream.getTracks().forEach(track => track.stop()); recorder = null; $('#cinema-button').textContent = 'Cinema'; toast('Recording saved locally.'); };
    recorder.start(); $('#cinema-button').textContent = 'Stop recording'; closeDialog(); toast('Recording the chamber. Click Stop recording to save the clip.');
  } catch (error) { toast(error.message); recorder = null; }
}

$('#pause-button').addEventListener('click', () => act(status?.paused ? 'resume' : 'pause'));
$('#step-button').addEventListener('click', () => act('step'));
$('#save-button').addEventListener('click', async () => { if (await act('save')) toast('Brain and dating state saved together.'); });
$('#settings-button').addEventListener('click', settings);
$('#method-button').addEventListener('click', () => openDialog('A little science. A lot of fiction.', methodContent, 'HOW WING WORKS'));
$('#history-button').addEventListener('click', () => openDialog('Every decision has a receipt.', parent => renderHistory([...(status?.dating?.decisions || [])].reverse(), parent), 'THE DECISION JOURNAL'));
for (const el of document.querySelectorAll('[data-choice]')) el.addEventListener('click', () => act(el.dataset.choice));
for (const el of document.querySelectorAll('[data-tab]')) el.addEventListener('click', () => showTab(el.dataset.tab));
$('#camera-button').addEventListener('click', () => { camera = (camera + 1) % 3; lab?.setView(camera); });
$('#cinema-button').addEventListener('click', () => { if (recorder) recorder.stop(); else document.body.classList.toggle('cinema'); });
let pointer = null;
$('#scene').addEventListener('pointerdown', event => { pointer = [event.clientX, event.clientY]; $('#scene').setPointerCapture(event.pointerId); });
$('#scene').addEventListener('pointermove', event => { if (!pointer) return; lab?.orbit(event.clientX - pointer[0], event.clientY - pointer[1]); pointer = [event.clientX, event.clientY]; });
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('#scene').addEventListener(name, () => { pointer = null; });
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || dialog.open || /INPUT|TEXTAREA|BUTTON|SELECT|A/.test(document.activeElement?.tagName)) return;
  if (event.code === 'Space') { event.preventDefault(); void act(status?.paused ? 'resume' : 'pause'); }
  if (event.code === 'KeyC') $('#camera-button').click();
  if (event.code === 'KeyS') $('#save-button').click();
});

function contextLost(event) {
  event.preventDefault(); visualFailed = true; rendered = false; client.stop();
  $('#scene-error').hidden = false; $('#scene-error').textContent = 'Visual input suspended: the WebGL context was lost. Reload to reconnect safely.';
  if (status?.phase === 'ready' && !client.commandPending) void act('pause');
}
$('#scene').addEventListener('webglcontextlost', contextLost);
const clock = createFrameClock();
function animate(now) {
  if (visualFailed) return;
  const dt = clock(now), d = status?.dating, active = status?.phase === 'ready' && !status.paused && !document.hidden && !dialog.open;
  if (active) time += dt;
  try {
    if (action && active) action.progress = reduced ? 1 : Math.min(1, action.progress + dt / 1.25);
    screen?.render(d, active ? dt : 0, action);
    if (screen?.error) throw new Error(screen.error);
    const t = status?.telemetry;
    lab?.render(time, active ? dt : 0, { paused: !active, pam11Hz: t?.pam11_hz || 0, motorHz: t?.motor_hz || 0, turnHz: t?.turn_hz || 0 }, screen?.swipeProgress ?? 1, action);
    rendered = Boolean(lab && screen?.renderedKey);
    if (action?.progress === 1 && active && !action.acknowledging && !client.commandPending) {
      action.acknowledging = true;
      const original = action;
      void act('advance', {}, `advance-${d.session_id}-${d.trial_number}`).then(result => { if (!result && action === original) original.acknowledging = false; });
    }
  } catch (error) {
    rendered = false; $('#scene-error').hidden = false; $('#scene-error').textContent = `Visual input suspended: ${error.message}`;
    console.error(error); client.stop(); return;
  }
  requestAnimationFrame(animate);
}

async function boot() {
  try {
    const response = await fetch('/api/wing/catalog'); if (!response.ok) throw new Error('Start the dating server with uv run flywirehead run.');
    const data = await response.json(); profiles = data.profiles; account = data.account;
    studio = new PortraitStudio(); studio.canvas.addEventListener('webglcontextlost', contextLost);
    screen = new WingScreen($('#wing-screen'), studio, profiles, reduced);
    screen.render(null, 0); lab = createLab($('#scene'), screen.canvas, { dating: true });
    update(); requestAnimationFrame(animate); client.start();
  } catch (error) { $('#scene-error').hidden = false; $('#scene-error').textContent = error.message; $('#connection-label').textContent = 'VISUAL INPUT UNAVAILABLE'; console.error(error); }
}
window.addEventListener('pagehide', () => { client.stop(); studio?.dispose(); lab?.dispose(); if (recorder?.state === 'recording') recorder.stop(); }, { once: true });
void boot();
