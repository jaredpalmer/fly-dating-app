import * as THREE from 'three';
import { createMotionResponse } from './motion.js';
import { createGarden } from './garden.js';
import { frontRightLegPose, sampleSwipe } from './swipe.js';
import { frontRightActionPose, sampleAction } from './wing-motion.js';

const C = { lime: 0xc4f86a };
const seed = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const vec = (p) => new THREE.Vector3(...p);

export function createLab(canvas, feedCanvas, { dating = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.setClearColor(0xc9e4ce);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xc9e4ce, .025);
  const camera = new THREE.PerspectiveCamera(37, 1, .1, 100);
  const group = new THREE.Group();
  scene.add(group);
  const material = (color, props = {}) => new THREE.MeshStandardMaterial({ color, roughness: .56, metalness: .28, ...props });
  const dark = material(0x203b37), metal = material(0x78988b, { metalness: .42, roughness: .4 });
  const glow = (color, strength = 1) => material(color, { emissive: color, emissiveIntensity: strength, roughness: .4 });
  const lime = glow(C.lime, 2);
  function mesh(geometry, mat, at, parent = group) { const m = new THREE.Mesh(geometry, mat); m.position.set(...at); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
  function box(size, at, mat = dark, parent = group) { return mesh(new THREE.BoxGeometry(...size), mat, at, parent); }
  function orb(size, at, mat, parent = group, detail = 2) { const m = mesh(new THREE.IcosahedronGeometry(1, detail), mat, at, parent); m.scale.set(...size); return m; }
  function rod(a, b, radius = .025, mat = metal, parent = group, radial = 6) { const start = vec(a), end = vec(b); const m = mesh(new THREE.CylinderGeometry(radius * .82, radius, start.distanceTo(end), radial), mat, start.clone().add(end).multiplyScalar(.5).toArray(), parent); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize()); return m; }
  function wire(points, radius, mat, parent = group) { return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(vec)), 44, radius, 6, false), mat, [0, 0, 0], parent); }
  function label(text, width, height, at, parent = group, color = '#b3d3c5', bg = '#111e23', font = 22) { const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * height / width); const ctx = c.getContext('2d'); if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height); } ctx.font = `${font}px monospace`; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; text.split('\n').forEach((s, i, arr) => ctx.fillText(s, 256, c.height / 2 + (i - (arr.length - 1) / 2) * font * 1.65)); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; const m = mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tx, transparent: true, toneMapped: false }), at, parent); return m; }

  scene.add(new THREE.HemisphereLight(0xf0ffed, 0x678a4c, 2.1));
  const key = new THREE.DirectionalLight(0xffebc2, 3.5); key.position.set(-3, 8, 5); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: .1, far: 24 }); key.shadow.bias = -.001; scene.add(key);
  const rim = new THREE.DirectionalLight(0xd1f6e0, 2.2); rim.position.set(-4, 3, -5); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xf5ffe5, .9); fill.position.set(4, 3, 6); scene.add(fill);
  const feedLight = new THREE.PointLight(0xcbe8db, 5, 8, 2); feedLight.position.set(1.5, 3, 1); scene.add(feedLight);

  // A sunlit garden surrounds a pale observation platform.
  box([90, .12, 90], [0, -.95, 0], material(0x89a66b, { roughness: 1, metalness: 0 }));
  const garden = createGarden(group);
  box([9.1, .27, 5.1], [0, .25, .15], material(0xc5d3af, { roughness: .68, metalness: .08 }));
  box([9.16, .035, 5.14], [0, .39, .15], material(0xe2e9cb, { roughness: .63, metalness: .05 }));
  box([9.04, .025, .03], [0, .28, 2.72], glow(0xdcf5b5, .35));
  box([.03, .025, 5], [-4.55, .28, .15], glow(0xdcf5b5, .35));
  for (const x of [-3.7, 3.7]) for (const z of [-1.7, 2]) box([.16, 1.2, .16], [x, -.37, z], metal);
  const deskLines = new THREE.GridHelper(8.9, 20, 0xa4b79a, 0xc0d0b0); deskLines.position.set(0, .414, .15); deskLines.scale.z = .57; deskLines.material.transparent = true; deskLines.material.opacity = .35; group.add(deskLines);
  // A mint-colored isolation pad separates the fly from the warm platform.
  box([4.05, .045, 2.8], [-1.38, .435, .22], material(0x9cbda5, { roughness: .82, metalness: .05 }));
  for (const z of [-1.15, 1.59]) box([4.05, .015, .017], [-1.38, .46, z], material(0xd9ebc4, { metalness: .15 }));
  const padText = label('F–001   /   NEURAL INTERFACE', 1.72, .15, [-1.52, .47, 1.42], group, '#456950', null, 30); padText.rotation.x = -Math.PI / 2;
  // A rigid overhead boom carries the cable directly above the cranial implant.
  const tetherAnchor = vec([-.738, 3.27, .2]);
  rod([-2.55, .45, -1.03], [-2.55, 3.43, -1.03], .06, metal);
  rod([-2.55, 3.43, -1.03], [-.738, 3.43, -1.03], .055, metal);
  rod([-.738, 3.43, -1.03], [-.738, 3.43, .2], .055, metal);
  box([.48, .1, .44], [-2.55, .5, -1.03], dark);
  for (const at of [[-2.55, 3.43, -1.03], [-.738, 3.43, -1.03]]) orb([.085, .085, .085], at, metal, group, 1);
  rod([-.738, 3.49, .2], tetherAnchor.toArray(), .075, dark);
  rod([-.738, 3.32, .2], [ -.738, 3.285, .2], .081, lime);
  // Original low-poly Drosophila, facing its terminal.
  const fly = new THREE.Group(); fly.position.set(-1.35, 1.43, .35); fly.rotation.y = .24; group.add(fly);
  const shell = material(0x293e46, { flatShading: true, metalness: .3, roughness: .55 });
  const flyMetal = material(0x243239, { metalness: .38, roughness: .48 }), flyDark = material(0x101619, { metalness: .12, roughness: .65 });
  const abdomen = orb([.91, .39, .43], [-.83, -.02, 0], material(0x142429, { flatShading: true, metalness: .24, roughness: .58 }), fly);
  for (let i = 0; i < 5; i++) { const ring = mesh(new THREE.TorusGeometry(.36 - i * .035, .035, 4, 14), material([0x314843, 0x3e493d, 0x304447, 0x39413b, 0x2b3b40][i], { metalness: .3, roughness: .56 }), [-.65 - i * .17, -.01, 0], fly); ring.rotation.y = Math.PI / 2; ring.scale.z = .94; }
  const thorax = orb([.66, .53, .5], [-.05, .08, 0], shell, fly);
  const head = new THREE.Group(); head.position.set(.63, .19, 0); fly.add(head);
  orb([.41, .4, .4], [0, 0, 0], material(0x40515a, { flatShading: true, metalness: .28, roughness: .5 }), head);
  const eyeMaterial = material(0x9e1837, { flatShading: true, roughness: .29, metalness: .45, emissive: 0x3c0614, emissiveIntensity: .4 });
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = orb([.28, .37, .255], [.12, .04, .29 * side], eyeMaterial, head, 2); eyes.push(eye);
    orb([.065, .045, .045], [.21, .25, .47 * side], material(0xe7a8a0, { roughness: .1, emissive: 0x995069 }), head, 1);
    wire([[.25, .3, side * .15], [.48, .49, side * .21], [.7, .57, side * .37]], .012, flyMetal, head);
    orb([.038, .027, .027], [.7, .57, side * .37], flyDark, head, 1);
  }
  rod([.28, -.17, 0], [.51, -.35, 0], .045, flyMetal, head); orb([.06, .08, .11], [.51, -.35, 0], flyDark, head, 1);
  // Fine thorax bristles catch the monitor light.
  for (let i = 0; i < 72; i++) { const a = seed(i + 4) * Math.PI * 2, b = seed(i + 51) * Math.PI; const p = [Math.cos(a) * Math.sin(b) * .64 - .05, Math.abs(Math.cos(b)) * .51 + .1, Math.sin(a) * Math.sin(b) * .49]; if (p[0] > .3) continue; rod(p, [p[0] + (p[0] + .05) * .19, p[1] + .08 + seed(i) * .08, p[2] * 1.14], .006, flyDark, fly, 3); }
  const legs = [];
  let rightForeleg;
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    const leg = new THREE.Group(); fly.add(leg); const x = .33 - i * .46;
    const a = [x, -.17, side * .3], b = [x + (.52 - i * .48), -.37, side * .75], c = [x + (.59 - i * .35), -.94, side * .99], d = [c[0] + .24, -.96, c[2] + side * .08];
    const upper = rod(a, b, .034, flyMetal, leg), joint = orb([.055, .055, .055], b, shell, leg, 1);
    const lower = rod(b, c, .022, flyMetal, leg), foot = rod(c, d, .012, flyDark, leg); legs.push(leg);
    // Forward is +X, so anatomical right is +Z: the visible front leg.
    if (side === 1 && i === 0) rightForeleg = { group: leg, upper, joint, lower, foot };
  }
  const boneStart = new THREE.Vector3(), boneEnd = new THREE.Vector3(), boneUp = new THREE.Vector3(0, 1, 0);
  function poseBone(bone, a, b) {
    boneStart.set(...a); boneEnd.set(...b);
    bone.position.copy(boneStart).add(boneEnd).multiplyScalar(.5);
    boneEnd.sub(boneStart);
    bone.scale.y = boneEnd.length() / bone.geometry.parameters.height;
    bone.quaternion.setFromUnitVectors(boneUp, boneEnd.normalize());
  }
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Group(); wing.position.set(-.18, .41, .23 * side); fly.add(wing);
    const points = [[0, 0, 0], [-.75, .07, .38 * side], [-1.72, .01, 1.1 * side], [-2.03, -.035, 1.05 * side], [-2.21, -.04, .83 * side], [-1.77, -.03, .41 * side], [-.66, -.015, .03 * side]];
    const vertices = []; for (let i = 1; i < points.length - 1; i++) vertices.push(...points[0], ...points[i], ...points[i + 1]);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geo.computeVertexNormals();
    const m = mesh(geo, material(0xa9dce2, { transparent: true, opacity: .48, side: THREE.DoubleSide, roughness: .2, metalness: .5, flatShading: true }), [0, 0, 0], wing); m.castShadow = false;
    const vein = material(0x77999b, { transparent: true, opacity: .68, metalness: .5 });
    const line = [...points, points[0]]; for (let j = 0; j < line.length - 1; j++) rod(line[j], line[j + 1], .009, vein, wing, 4);
    for (let j = 2; j < 6; j++) rod([-.1, 0, .025 * side], points[j], .006, vein, wing, 3);
    rod([-.83, .01, .31 * side], [-1.23, .025, .7 * side], .007, vein, wing, 3);
    rod([-1.38, -.02, .31 * side], [-1.68, .01, .87 * side], .007, vein, wing, 3);
    wings.push(wing);
  }
  const harness = mesh(new THREE.TorusGeometry(.515, .035, 5, 18, Math.PI * 1.5), dark, [-.13, .06, 0], fly); harness.rotation.y = Math.PI / 2;
  // The implant is seated in the crown between the eyes, not on the thorax.
  mesh(new THREE.CylinderGeometry(.12, .15, .11, 12), metal, [0, .39, 0], head);
  const cranialRing = mesh(new THREE.TorusGeometry(.125, .019, 6, 18), lime, [0, .444, 0], head);
  cranialRing.rotation.x = Math.PI / 2;
  rod([0, .445, 0], [0, .65, 0], .05, dark, head, 12);
  for (const y of [.49, .545, .6]) mesh(new THREE.CylinderGeometry(.066, .066, .025, 10), metal, [0, y, 0], head);
  const electrode = orb([.059, .025, .059], [0, .635, 0], glow(C.lime, 2), head, 1);
  const socketTip = new THREE.Vector3(0, .675, 0);
  const tetherCurve = new THREE.CatmullRomCurve3([
    tetherAnchor.clone(), vec([-.69, 3.05, .22]), vec([-.75, 2.66, .2]), vec([-.738, 2.295, .2])
  ]);
  const tetherSegments = 28, tetherSides = 8, tetherRadius = .039;
  const tether = mesh(new THREE.TubeGeometry(tetherCurve, tetherSegments, tetherRadius, tetherSides, false), material(0x172b2b, { roughness: .39, metalness: .15 }), [0, 0, 0]);
  const stripeGeometry = new THREE.BufferGeometry();
  stripeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((tetherSegments + 1) * 3), 3));
  group.add(new THREE.Line(stripeGeometry, new THREE.LineBasicMaterial({ color: C.lime, transparent: true, opacity: .9 })));
  const tetherPoint = new THREE.Vector3();
  function updateTether() {
    // Follow the moving implant while keeping the upper end fixed to the boom.
    head.localToWorld(tetherCurve.points[3].copy(socketTip));
    group.worldToLocal(tetherCurve.points[3]);
    tetherCurve.points[2].copy(tetherCurve.points[3]).add(new THREE.Vector3(-.025, .34, 0));
    tetherCurve.updateArcLengths();
    const frames = tetherCurve.computeFrenetFrames(tetherSegments, false);
    const positions = tether.geometry.attributes.position, normals = tether.geometry.attributes.normal;
    for (let i = 0; i <= tetherSegments; i++) {
      tetherCurve.getPointAt(i / tetherSegments, tetherPoint);
      const n = frames.normals[i], b = frames.binormals[i];
      for (let j = 0; j <= tetherSides; j++) {
        const angle = j / tetherSides * Math.PI * 2, c = -Math.cos(angle), s = Math.sin(angle);
        const nx = c * n.x + s * b.x, ny = c * n.y + s * b.y, nz = c * n.z + s * b.z;
        const index = i * (tetherSides + 1) + j;
        positions.setXYZ(index, tetherPoint.x + tetherRadius * nx, tetherPoint.y + tetherRadius * ny, tetherPoint.z + tetherRadius * nz);
        normals.setXYZ(index, nx, ny, nz);
      }
      stripeGeometry.attributes.position.setXYZ(i, tetherPoint.x, tetherPoint.y, tetherPoint.z + tetherRadius + .002);
    }
    positions.needsUpdate = normals.needsUpdate = stripeGeometry.attributes.position.needsUpdate = true;
    tether.geometry.computeBoundingSphere();
    stripeGeometry.computeBoundingSphere();
  }
  updateTether();

  // A standalone phone: rounded aluminum edge, black glass, and ordinary controls.
  function phoneOutline(width, height, radius) {
    const x = width / 2, y = height / 2, r = radius, shape = new THREE.Shape();
    shape.moveTo(-x + r, -y); shape.lineTo(x - r, -y);
    shape.quadraticCurveTo(x, -y, x, -y + r); shape.lineTo(x, y - r);
    shape.quadraticCurveTo(x, y, x - r, y); shape.lineTo(-x + r, y);
    shape.quadraticCurveTo(-x, y, -x, y - r); shape.lineTo(-x, -y + r);
    shape.quadraticCurveTo(-x, -y, -x + r, -y);
    return shape;
  }
  // Bring the phone closer along the fly's forward axis and turn its glass toward the head.
  const terminal = new THREE.Group(); terminal.position.set(dating ? .18 : 1.45, 0, dating ? .28 : -.34); terminal.rotation.set(.08, -.9, 0); group.add(terminal);
  const phoneEdge = material(0x677279, { roughness: .26, metalness: .9 });
  mesh(new THREE.ExtrudeGeometry(phoneOutline(1.8, 3.3, .2), { depth: .1, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: .018, bevelThickness: .018, curveSegments: 12 }), phoneEdge, [0, 0, -.05], terminal);
  mesh(new THREE.ShapeGeometry(phoneOutline(1.77, 3.27, .19), 12), material(0x030508, { roughness: .16, metalness: .35 }), [0, 0, .07], terminal);
  box([.27, .028, .008], [-.04, 1.53, .078], dark, terminal);
  orb([.027, .027, .008], [.2, 1.53, .082], material(0x172c3b, { roughness: .08, metalness: .65 }), terminal, 2);
  box([.36, .018, .006], [0, -1.53, .078], material(0xb9c1c5), terminal);
  box([.023, .3, .058], [.919, .61, 0], phoneEdge, terminal);
  for (const y of [.72, .31]) box([.023, .24, .058], [-.919, y, 0], phoneEdge, terminal);

  const feedTexture = new THREE.CanvasTexture(feedCanvas);
  feedTexture.colorSpace = THREE.SRGBColorSpace;
  const screenMaterial = new THREE.MeshBasicMaterial({ map: feedTexture, toneMapped: false });
  const screen = mesh(new THREE.PlaneGeometry(1.62, 2.88), screenMaterial, [0, 0, .079], terminal); screen.castShadow = false;
  terminal.position.y += .417 - new THREE.Box3().setFromObject(terminal).min.y;
  // Capture the same composited portrait display, including the swipe transition.
  const sensoryTarget = new THREE.WebGLRenderTarget(90, 160);
  sensoryTarget.texture.colorSpace = THREE.SRGBColorSpace;
  const sensoryScene = new THREE.Scene();
  const sensoryCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  sensoryCamera.position.z = 1;
  sensoryScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), screenMaterial));
  const sensoryPixels = new Uint8Array(90 * 160 * 4);
  const dustGeo = new THREE.BufferGeometry(), dustPos = new Float32Array(90 * 3);
  for (let i = 0; i < 90; i++) { dustPos[i * 3] = seed(i + 600) * 10 - 5; dustPos[i * 3 + 1] = seed(i + 700) * 6; dustPos[i * 3 + 2] = seed(i + 900) * 8 - 4; }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3)); const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffefad, size: .032, transparent: true, opacity: .7 })); group.add(dust);

  const views = [{ theta: .36, phi: 1.17, radius: 12.6, target: [0, 1.35, 0] }, { theta: .67, phi: 1.24, radius: 7.1, target: [-1.12, 1.55, .2] }, { theta: .02, phi: 1.45, radius: 6.9, target: [.9, 1.9, 0] }];
  let viewIndex = 0, orbit = { ...views[0], target: [...views[0].target] }, targetOrbit = { ...orbit }, lastWidth = 0, lastHeight = 0;
  function resize() { const { width, height } = canvas.getBoundingClientRect(); if (width === lastWidth && height === lastHeight) return; lastWidth = width; lastHeight = height; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motion = createMotionResponse();
  function render(time, dt, state, swipeProgress = 1, action = null) {
    resize();
    const move = reduced ? 0 : time;
    // Display mappings only: backend telemetry is never generated by the animation.
    const response = motion.step(state, reduced ? 0 : dt);
    const motor = response.motor, excitement = response.reward, phase = reduced ? 0 : response.phase;
    fly.position.y = 1.43 + Math.sin(move * 2.3) * .014 + Math.sin(phase * .5) * motor * .055;
    fly.rotation.z = Math.sin(phase * .25) * motor * .035;
    fly.rotation.y = .24 + response.turn * .045;
    head.rotation.y = response.turn * .28;
    head.rotation.z = Math.sin(move * .7) * .018 + response.turn * .09;
    updateTether();
    wings.forEach((w, i) => { w.rotation.x = (i ? 1 : -1) * (Math.sin(phase) * (.025 + motor * .78) + motor * .1); });
    legs.forEach((l, i) => { l.rotation.x = Math.sin(phase * .3 + i * 1.5) * (.013 + motor * .075); });
    const gesture = reduced ? 1 : swipeProgress;
    let tap = null;
    if (dating && action) {
      const u = action.choice === 'pass' ? 43 / 360 : action.choice === 'rose' ? 272 / 360 : 317 / 360;
      tap = fly.worldToLocal(screen.localToWorld(new THREE.Vector3((u - .5) * 1.62, (.5 - 418 / 640) * 2.88, .015))).toArray();
    }
    const pose = action && !reduced ? frontRightActionPose(action.progress, action.choice, tap) : frontRightLegPose(gesture);
    rightForeleg.group.rotation.x *= 1 - (action && !reduced ? sampleAction(action.progress).reach : sampleSwipe(gesture).reach);
    poseBone(rightForeleg.upper, pose[0], pose[1]); rightForeleg.joint.position.set(...pose[1]);
    poseBone(rightForeleg.lower, pose[1], pose[2]); poseBone(rightForeleg.foot, pose[2], pose[3]);
    electrode.material.emissiveIntensity = 1.4 + Math.sin(move * 6) * .4 + excitement * 3;
    dust.rotation.y = move * .012;
    dust.position.y = Math.sin(move * .25) * .13;
    garden.animate(move);
    const smooth = 1 - Math.exp(-dt * 5);
    for (const k of ['theta', 'phi', 'radius']) orbit[k] += (targetOrbit[k] - orbit[k]) * smooth;
    orbit.target = orbit.target.map((v, i) => v + (targetOrbit.target[i] - v) * smooth);
    const narrow = Math.max(1, 1.52 / camera.aspect), radius = orbit.radius * (narrow > 1 ? Math.pow(narrow, .52) : 1);
    camera.position.set(orbit.target[0] + radius * Math.sin(orbit.phi) * Math.sin(orbit.theta), orbit.target[1] + radius * Math.cos(orbit.phi), orbit.target[2] + radius * Math.sin(orbit.phi) * Math.cos(orbit.theta));
    camera.lookAt(...orbit.target);
    feedTexture.needsUpdate = true;
    feedLight.intensity = 4 + Math.sin(time * 1.8) * .6 + excitement * 6;
    feedLight.color.set(0xb5d9df);
    renderer.setRenderTarget(null); renderer.render(scene, camera);
  }
  resize();
  return {
    render,
    captureFrame() {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(sensoryTarget);
      renderer.render(sensoryScene, sensoryCamera);
      renderer.readRenderTargetPixels(sensoryTarget, 0, 0, 90, 160, sensoryPixels);
      renderer.setRenderTarget(previous);
      return sensoryPixels.slice();
    },
    setView(index) { viewIndex = index % views.length; targetOrbit = { ...views[viewIndex], target: [...views[viewIndex].target] }; return viewIndex; },
    orbit(dx, dy) { targetOrbit.theta = THREE.MathUtils.clamp(targetOrbit.theta - dx * .005, -.7, 1.3); targetOrbit.phi = THREE.MathUtils.clamp(targetOrbit.phi - dy * .003, .7, 1.65); },
    dispose() { renderer.dispose(); }
  };
}
