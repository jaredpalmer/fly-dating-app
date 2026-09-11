import * as THREE from 'three';

export function randomSource(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function createFlyModel(seed = 1, color = '#ad793b', female = true) {
  const group = new THREE.Group(), random = randomSource(seed);
  const body = new THREE.MeshStandardMaterial({ color, roughness: .58, metalness: .13 });
  const dark = new THREE.MeshStandardMaterial({ color: '#35291d', roughness: .65 });
  const eye = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(.005 + random() * .03, .65, .27), roughness: .28, metalness: .18 });
  const wing = new THREE.MeshPhysicalMaterial({ color: '#e5e5dc', roughness: .13, metalness: .1, transparent: true, opacity: .44, side: THREE.DoubleSide });
  const sphere = (size, position, material, detail = 2) => { const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, detail), material); mesh.scale.set(...size); mesh.position.set(...position); mesh.castShadow = true; group.add(mesh); return mesh; };
  const rod = (a, b, radius, material = dark) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * .6, radius, direction.length(), 5), material);
    mesh.position.copy(start.add(end).multiplyScalar(.5)); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); mesh.castShadow = true; group.add(mesh); return mesh;
  };
  const length = female ? .83 + random() * .12 : .73;
  sphere([length, .35, .36], [-.65, .44, 0], body, 3);
  for (let i = 0; i < 5; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.31 - i * .03, .026, 5, 28), dark);
    ring.rotation.y = Math.PI / 2; ring.position.set(-.58 - i * .16, .44, 0); ring.scale.z = .91; group.add(ring);
  }
  sphere([.48, .43, .39], [0, .59, 0], body, 3);
  sphere([.34, .33, .32], [.48, .69, 0], body, 3);
  for (const side of [-1, 1]) {
    sphere([.23, .29, .17], [.57, .72, .235 * side], eye, 3);
    const glint = new THREE.MeshStandardMaterial({ color: '#f5c4a3', roughness: .15 });
    sphere([.027, .033, .012], [.67, .87, .37 * side], glint, 1);
    rod([.67, .84, .1 * side], [.86, 1.03, .19 * side], .016);
    rod([.86, 1.03, .19 * side], [1.03, 1.13, .28 * side], .007);
    for (let i = 0; i < 3; i++) {
      const x = .23 - i * .36, reach = .5 - i * .38;
      const a = [x, .38, .23 * side], b = [x + reach, .26, .62 * side], c = [x + reach + .12, -.03, .87 * side], d = [x + reach + .33, -.04, .94 * side];
      rod(a, b, .028); rod(b, c, .017); rod(c, d, .01);
      sphere([.038, .037, .035], b, dark, 1);
    }
    const points = [[-.03, .89, .13 * side], [-.57, .91, .55 * side], [-1.48, .72, .91 * side], [-1.74, .58, .82 * side], [-1.79, .53, .54 * side], [-1.32, .67, .21 * side], [-.38, .84, .06 * side]];
    const vertices = [];
    for (let i = 1; i < points.length - 1; i++) vertices.push(...points[0], ...points[i], ...points[i + 1]);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, wing); group.add(mesh);
    const vein = new THREE.MeshStandardMaterial({ color: '#9b9879', transparent: true, opacity: .65 });
    for (let i = 0; i < points.length; i++) rod(points[i], points[(i + 1) % points.length], .008, vein);
    for (let i = 2; i < 5; i++) rod(points[0], points[i], .005, vein);
  }
  for (let i = 0; i < 65; i++) {
    const a = random() * Math.PI * 2, b = random() * Math.PI, x = Math.cos(a) * Math.sin(b) * .43;
    const p = [x, .59 + Math.abs(Math.cos(b)) * .42, Math.sin(a) * Math.sin(b) * .37];
    rod(p, [p[0] + x * .12, p[1] + .06 + random() * .07, p[2] * 1.13], .0035);
  }
  rod([.69, .53, 0], [.85, .4, 0], .025);
  return group;
}

export class PortraitStudio {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setSize(640, 760, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.cache = new Map();
  }
  get(profile, photo = 0, date = false) {
    const key = `${profile.id}:${photo}:${date}`;
    if (this.cache.has(key)) { const image = this.cache.get(key); this.cache.delete(key); this.cache.set(key, image); return image; }
    const spec = profile.photos[photo], random = randomSource(spec.seed), colors = profile.palette;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(colors[0]); scene.fog = new THREE.Fog(colors[0], 6, 15);
    const camera = new THREE.PerspectiveCamera(34, 640 / 760, .1, 30);
    const mat = (color, other = {}) => new THREE.MeshStandardMaterial({ color, roughness: .82, ...other });
    const add = (geo, material, at, scale = [1, 1, 1]) => { const mesh = new THREE.Mesh(geo, material); mesh.position.set(...at); mesh.scale.set(...scale); mesh.receiveShadow = true; mesh.castShadow = true; scene.add(mesh); return mesh; };
    scene.add(new THREE.HemisphereLight(colors[1], colors[2], 2.8));
    const light = new THREE.DirectionalLight('#fff0d5', 4.1); light.position.set(-3, 6, 4); light.castShadow = true; light.shadow.mapSize.set(1024, 1024); light.shadow.bias = -.001; scene.add(light);
    const rim = new THREE.DirectionalLight('#edf8ff', 2); rim.position.set(3, 3, -4); scene.add(rim);
    const setting = date ? 'picnic' : spec.setting;
    const floor = add(new THREE.PlaneGeometry(40, 40), mat(colors[0]), [0, -.18, 0]); floor.rotation.x = -Math.PI / 2;
    if (['pear', 'orange', 'berry'].includes(setting)) {
      const fruitColor = { pear: '#b4bc66', orange: '#d9904d', berry: '#ad4c57' }[setting];
      const fruit = add(new THREE.SphereGeometry(1, 48, 32), mat(fruitColor), [-.4, -.65, -.2], [2.7, .75, 2]);
      fruit.rotation.z = -.06;
      for (let i = 0; i < 30; i++) {
        const x = (random() - .5) * 4, z = (random() - .5) * 3;
        add(new THREE.SphereGeometry(.016 + random() * .025, 4, 3), mat('#807449'), [x, .025, z], [1, .18, 1]);
      }
    } else if (setting === 'picnic' || setting === 'window') {
      const plane = add(new THREE.BoxGeometry(8, .16, 7), mat(setting === 'window' ? '#e1dacc' : colors[1]), [0, -.06, 0]);
      for (let i = -4; i < 5; i++) {
        const stripe = add(new THREE.PlaneGeometry(.28, 7), mat(setting === 'window' ? '#c9c0ab' : colors[0]), [i * .65, .027, 0]); stripe.rotation.x = -Math.PI / 2;
        if (setting === 'picnic') { const cross = stripe.clone(); cross.rotation.z = Math.PI / 2; scene.add(cross); }
      }
      if (setting === 'picnic') add(new THREE.IcosahedronGeometry(.35, 1), mat('#d3a366'), [1.8, .18, -1.1]);
    } else {
      const leaf = add(new THREE.SphereGeometry(1, 32, 16), mat(colors[2]), [0, -.11, 0], [3.2, .14, 1.85]); leaf.rotation.y = .35;
      for (let i = -5; i <= 5; i++) {
        const vein = add(new THREE.CylinderGeometry(.008, .015, 2.1, 4), mat('#b6be83'), [i * .4, .045, 0]); vein.rotation.z = Math.PI / 2; vein.rotation.y = -.5;
      }
      if (setting === 'dew') for (let i = 0; i < 5; i++) add(new THREE.SphereGeometry(.08 + random() * .09, 16, 12), new THREE.MeshPhysicalMaterial({ color: '#dbecef', transmission: .7, transparent: true, opacity: .65, roughness: .02, metalness: .1 }), [(random() - .5) * 3.5, .09, (random() - .5) * 2]);
    }
    for (let i = 0; i < 16; i++) {
      const x = (random() - .5) * 13, z = -2 - random() * 5, y = random() * 3;
      const leaf = add(new THREE.SphereGeometry(1, 10, 8), mat(i % 3 ? colors[2] : colors[1]), [x, y, z], [.35 + random() * .6, .08, .7 + random()]);
      leaf.rotation.set(random() * 2, random() * 3, random());
      if (setting === 'flower' || i % 5 === 0) for (let j = 0; j < 5; j++) {
        const a = j / 5 * Math.PI * 2;
        add(new THREE.SphereGeometry(.32, 12, 8), mat(colors[1]), [x + Math.cos(a) * .35, y + .3 + Math.sin(a) * .35, z], [1, .7, .4]);
      }
    }
    const fly = createFlyModel(profile.seed, colors[3], profile.sex !== 'male');
    fly.rotation.y = [-.2, .6, -.7][photo] + (random() - .5) * .18;
    fly.position.y = .08; scene.add(fly);
    camera.position.set(...[[3.5, 2.1, 4.8], [3.2, 3.1, 4.1], [4.5, 1.6, 2.6]][photo]);
    camera.lookAt(-.2, .55, 0);
    this.renderer.render(scene, camera);
    const image = document.createElement('canvas'); image.width = 640; image.height = 760;
    image.getContext('2d').drawImage(this.canvas, 0, 0);
    const context = image.getContext('2d');
    const shade = context.createLinearGradient(0, 0, 0, 760); shade.addColorStop(0, '#ffffff12'); shade.addColorStop(.65, '#00000000'); shade.addColorStop(1, '#29331d30'); context.fillStyle = shade; context.fillRect(0, 0, 640, 760);
    this.cache.set(key, image);
    if (this.cache.size > 18) this.cache.delete(this.cache.keys().next().value);
    const materials = new Set(), geometries = new Set();
    scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    return image;
  }
  dispose() { this.renderer.dispose(); this.cache.clear(); }
}
