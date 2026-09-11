import { FORELEG_REST } from './swipe.js';

const length = a => Math.hypot(...a);
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const mix = (a, b, p) => a.map((v, i) => v + (b[i] - v) * p);
const smooth = x => { const p = Math.max(0, Math.min(1, x)); return p * p * (3 - 2 * p); };

export function sampleAction(progress) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 1;
  return { reach: smooth(p / .32) * (1 - smooth((p - .65) / .35)), tapped: p >= .38 };
}

export function frontRightActionPose(progress, choice = 'like', targetTip = null) {
  const { reach } = sampleAction(progress), [shoulder, restJoint, restAnkle, restTip] = FORELEG_REST;
  if (reach === 0) return FORELEG_REST.map(p => [...p]);
  const originalFoot = subtract(restTip, restAnkle), aim = [.2, .1, -.1], aimedFoot = aim.map(v => v * length(originalFoot) / length(aim));
  const upper = length(subtract(restJoint, shoulder)), lower = length(subtract(restAnkle, restJoint));
  let target = targetTip ? subtract(targetTip, aimedFoot) : choice === 'pass' ? [1.24, .19, .95] : choice === 'rose' ? [1.03, .44, .64] : [1.15, .4, .58];
  const targetOffset = subtract(target, shoulder), targetDistance = length(targetOffset), reachable = Math.max(Math.abs(upper - lower) + .001, Math.min(upper + lower - .001, targetDistance));
  if (targetDistance > 0) target = shoulder.map((v, i) => v + targetOffset[i] * reachable / targetDistance);
  const ankle = mix(restAnkle, target, reach), offset = subtract(ankle, shoulder), distance = length(offset), direction = offset.map(v => v / distance);
  const pole = mix(subtract(restJoint, shoulder), [0, 0, 1], reach), dot = pole.reduce((sum, v, i) => sum + v * direction[i], 0);
  const bend = pole.map((v, i) => v - direction[i] * dot), bendLength = length(bend);
  const along = (upper ** 2 - lower ** 2 + distance ** 2) / (2 * distance), height = Math.sqrt(Math.max(0, upper ** 2 - along ** 2));
  const joint = shoulder.map((v, i) => v + direction[i] * along + bend[i] / bendLength * height);
  const foot = mix(originalFoot, aim, reach), scale = length(originalFoot) / length(foot);
  return [[...shoulder], joint, ankle, ankle.map((v, i) => v + foot[i] * scale)];
}
