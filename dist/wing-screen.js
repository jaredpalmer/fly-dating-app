const INK = '#342c32', PLUM = '#694456', PAPER = '#fcfaf5';
const round = (context, x, y, width, height, radius = 10) => { context.beginPath(); context.roundRect(x, y, width, height, radius); };

export function wrapText(context, text, x, y, width, lineHeight, maxLines = 3) {
  const words = text.split(' '), lines = []; let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((value, i) => context.fillText(i === maxLines - 1 && lines.length > maxLines ? value.replace(/\s\S*$/, '') + '…' : value, x, y + i * lineHeight));
  return Math.min(lines.length, maxLines) * lineHeight;
}

function heart(context, x, y, size, fill = false) {
  context.save(); context.translate(x, y); context.scale(size / 24, size / 24); context.beginPath();
  context.moveTo(12, 20); context.bezierCurveTo(-5, 9, 4, -2, 12, 6); context.bezierCurveTo(20, -2, 29, 9, 12, 20);
  if (fill) context.fill(); else context.stroke(); context.restore();
}

export class WingScreen {
  constructor(canvas, studio, profiles, reducedMotion = false) {
    Object.assign(this, { canvas, studio, profiles, reducedMotion });
    this.ctx = canvas.getContext('2d');
    this.page = document.createElement('canvas'); this.page.width = 720; this.page.height = 1280;
    this.previous = document.createElement('canvas'); this.previous.width = 720; this.previous.height = 1280;
    this.key = ''; this.renderedKey = null; this.transition = 1; this.error = ''; this.lastDating = null;
  }
  get swipeProgress() { return this.transition; }
  paint(dating) {
    const c = this.page.getContext('2d'); c.setTransform(2, 0, 0, 2, 0, 0);
    c.fillStyle = PAPER; c.fillRect(0, 0, 360, 640);
    if (!dating || ['calibration', 'warmup', 'baseline', 'washout'].includes(dating.phase)) {
      c.fillStyle = '#808080'; c.fillRect(0, 0, 360, 640);
      c.fillStyle = '#efeee8'; c.textAlign = 'center'; c.font = 'italic 42px Georgia'; c.fillText('wing', 180, 268);
      c.font = '16px Georgia'; c.fillText('A little pause', 180, 317); c.fillText('between connections.', 180, 341);
      c.fillStyle = '#cacbc4'; c.font = '9px sans-serif'; c.fillText('NEUTRAL REFERENCE SCREEN', 180, 387);
      c.textAlign = 'left'; return;
    }
    if (dating.phase === 'complete') {
      c.fillStyle = PLUM; c.textAlign = 'center'; c.font = 'italic 46px Georgia'; c.fillText('Small world.', 180, 235);
      c.fillStyle = '#99998b'; c.font = '16px Georgia'; c.fillText('You have met everyone nearby.', 180, 282);
      c.font = '11px sans-serif'; c.fillText('Start another round from the inspector.', 180, 316); c.textAlign = 'left'; return;
    }
    const profile = this.profiles.find(p => p.id === dating.profile_id);
    if (!profile) throw new Error('This profile is missing from the local catalog.');
    const photo = dating.phase === 'decision' ? (dating.current_decision?.photo ?? dating.photo) : dating.photo;
    const image = this.studio.get(profile, photo, dating.context === 'date');
    c.fillStyle = PLUM; c.font = 'italic bold 31px Georgia'; c.fillText('wing', 19, 39);
    c.fillStyle = '#a5a094'; c.font = '8px sans-serif'; c.textAlign = 'right'; c.fillText(dating.context === 'date' ? 'THE FIRST DATE' : 'DESIGNED TO TAKE FLIGHT', 341, 31); c.textAlign = 'left';
    c.strokeStyle = '#e9e5da'; c.lineWidth = .7; c.beginPath(); c.moveTo(19, 53); c.lineTo(341, 53); c.stroke();
    c.fillStyle = INK; c.font = '28px Georgia'; c.fillText(profile.name, 19, 89);
    const nameWidth = c.measureText(profile.name).width; c.font = '14px sans-serif'; c.fillStyle = '#a49a94'; c.fillText(`${profile.adult_days} days`, 29 + nameWidth, 88);
    c.font = '9px sans-serif'; c.fillStyle = '#8d8c7e'; c.fillText(`${profile.job} · ${profile.distance_cm} cm away`, 20, 109);
    c.save(); round(c, 18, 123, 324, 318, 12); c.clip();
    c.drawImage(image, 0, 55, 640, 630, 18, 123, 324, 318); c.restore();
    c.save(); c.fillStyle = '#faf8f0df'; round(c, 70, 411, 135, 20, 10); c.fill(); c.fillStyle = '#676b57'; c.font = '8px sans-serif'; c.fillText(profile.district.toUpperCase(), 79, 424); c.restore();
    for (const x of [43, 272, 317]) { c.fillStyle = '#fffaf3'; c.beginPath(); c.arc(x, 418, 17, 0, Math.PI * 2); c.fill(); }
    c.strokeStyle = '#8e897c'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(38, 413); c.lineTo(48, 423); c.moveTo(48, 413); c.lineTo(38, 423); c.stroke();
    c.strokeStyle = '#aa7b74'; c.beginPath(); c.arc(272, 414, 5, 0, Math.PI * 2); c.moveTo(272, 419); c.lineTo(272, 427); c.moveTo(272, 424); c.lineTo(267, 421); c.stroke();
    c.strokeStyle = PLUM; c.fillStyle = PLUM; c.lineWidth = 1.5; heart(c, 307, 408, 20, dating.phase === 'decision' && dating.current_decision?.choice !== 'pass');
    for (let i = 0; i < 3; i++) { c.fillStyle = i === photo ? PLUM : '#e1dcd0'; round(c, 153 + i * 19, 452, 13, 3, 2); c.fill(); }
    c.fillStyle = '#9d978e'; c.font = '9px sans-serif'; c.fillText(profile.prompts[photo].question, 22, 482);
    c.fillStyle = INK; c.font = '23px Georgia'; wrapText(c, profile.prompts[photo].answer, 22, 510, 306, 27, 3);
    c.strokeStyle = '#e8e4d9'; c.beginPath(); c.moveTo(21, 596); c.lineTo(339, 596); c.stroke();
    c.fillStyle = '#9e9b8e'; c.font = '8px sans-serif'; c.fillText('FEMALE · D. MELANOGASTER · FICTIONAL', 21, 615);
    c.font = '7px sans-serif'; c.fillStyle = '#b0ac9e'; c.fillText('Original procedural portrait / adult fly', 21, 630);
  }
  render(dating, dt, action = null) {
    const key = dating?.screen_key || 'loading';
    if (key !== this.key) {
      this.previous.getContext('2d').drawImage(this.canvas, 0, 0);
      const scroll = dating?.phase === 'photo' && this.lastDating?.phase === 'photo' && dating.photo !== this.lastDating.photo;
      this.transition = scroll && !this.reducedMotion ? 0 : 1;
      this.renderedKey = null;
      try { this.paint(dating); this.error = ''; }
      catch (error) { this.error = error.message; return; }
      this.key = key; this.lastDating = dating ? { ...dating } : null;
    }
    if (!dating?.paused && !document.hidden) this.transition = Math.min(1, this.transition + dt / .9);
    const c = this.ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = PAPER; c.fillRect(0, 0, 720, 1280);
    if (this.transition < 1) {
      const p = 1 - (1 - this.transition) ** 3;
      c.drawImage(this.previous, 0, -p * 1280); c.drawImage(this.page, 0, (1 - p) * 1280);
    } else c.drawImage(this.page, 0, 0);
    if (action && action.progress > .3) {
      c.save(); c.translate(360, 580); c.rotate(action.choice === 'pass' ? .12 : -.12); c.scale(2, 2);
      c.strokeStyle = action.choice === 'pass' ? '#77796c' : PLUM; c.fillStyle = '#fffaf2eb'; c.lineWidth = 2.5;
      round(c, -86, -30, 172, 60, 5); c.fill(); c.stroke(); c.fillStyle = c.strokeStyle; c.textAlign = 'center'; c.font = 'bold 23px sans-serif';
      c.fillText(action.choice === 'pass' ? 'PASS' : action.choice === 'rose' ? 'ROSE SENT' : 'LIKED', 0, 8); c.restore();
    }
    this.renderedKey = this.error || this.transition < 1 ? null : key;
  }
}
