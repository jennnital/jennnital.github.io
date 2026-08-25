// Assembloid Space — scroll-driven hero scene
// A glass petri dish, a microelectrode array (MEA) grid, and floating metaball
// "organoid" blobs. The three layers sit stacked at the top of the page and
// separate fluidly as you scroll (assemble <-> explode). No auto-rotation.
//
// The MEA is interactive: raycasting against the electrode point cloud lets you
// hover and select a channel, which fires a spike ripple across its neighbours.
// Everything is composited through an EffectComposer so the dish, the organoids
// and the electrodes carry a soft bloom.
// Palette: white / grey / pink on a soft pale-grey ground.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BG = 0xe9e3e5;
const MEA_RADIUS = 3.05;

// Bloom is computed against a black backdrop (see render()) so the pale page
// ground never blows out — only the objects themselves halo.
const BLOOM = { strength: 0.9, radius: 0.8, threshold: 0.55, intensity: 0.8 };

const host = document.getElementById('scene');
const stageEl = document.getElementById('stage');
const readoutEl = document.getElementById('mea-readout');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer, scene, camera;
let bloomComposer, finalComposer, mixPass;
let dish, mea, metaballs;
let hoverRing, selectRing, selectDot;
const clock = new THREE.Clock();
const pointer = new THREE.Vector2(0, 0);      // parallax, -1..1
const pointerClient = { x: 0, y: 0 };         // last cursor position, CSS px
const ndc = new THREE.Vector2(-2, -2);        // raycasting, -1..1
const raycaster = new THREE.Raycaster();

let scrollT = 0;   // eased scroll progress 0..1
let scrollTarget = 0;
let narrow = 0;    // 0 on wide screens, 1 on phone-shaped ones

// --- MEA state -------------------------------------------------------------
let meaBase = null;      // rest positions (Float32Array, xyz per channel)
let meaColor = null;     // colour attribute buffer
let channelCount = 0;
let hoverIndex = -1;
let selectedIndex = -1;
let pointerInside = false;
let needsPick = false;
let readoutHold = 0;     // keeps the read-out up briefly after a tap
const spikes = [];       // { index, x, z, t0 }

const GREY = new THREE.Color(0x9c8b94);
const PINK = new THREE.Color(0xe2739f);
const HOT = new THREE.Color(0xff6aa8).multiplyScalar(1.6);
const _c = new THREE.Color();
const _v = new THREE.Vector3();

const smoothstep = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const channelLabel = (i) => 'CH ' + String(i + 1).padStart(3, '0');

// Narrow viewports need the camera further back, or the dish runs off frame.
function updateFraming() {
  const aspect = window.innerWidth / window.innerHeight;
  narrow = THREE.MathUtils.clamp((1.45 - aspect) / 0.85, 0, 1);
}

function updateScrollTarget() {
  const range = (stageEl ? stageEl.offsetHeight : window.innerHeight * 2) - window.innerHeight;
  scrollTarget = range > 0 ? THREE.MathUtils.clamp(window.scrollY / range, 0, 1) : 0;
}

// ---------------------------------------------------------------------------
// MEA electrode grid
// ---------------------------------------------------------------------------

function buildMEA() {
  const cols = 44, rows = 44;
  const pos = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const u = i / (cols - 1);
      const v = j / (rows - 1);
      const x = (u - 0.5) * 2 * MEA_RADIUS;
      const z = (v - 0.5) * 2 * MEA_RADIUS;
      if (x * x + z * z > MEA_RADIUS * MEA_RADIUS) continue;   // keep the disc
      const y = (Math.cos(u * Math.PI * 5) + Math.sin(v * Math.PI * 7)) * 0.06;
      pos.push(x, y, z);
    }
  }
  channelCount = pos.length / 3;
  meaBase = new Float32Array(pos);

  const positions = new Float32Array(meaBase);           // live, wave-displaced
  meaColor = new Float32Array(channelCount * 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(meaColor, 3));
  geo.computeBoundingSphere();

  const mat = new THREE.PointsMaterial({
    size: 0.1, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

// A very light standing wave across the array — barely-there breathing, plus
// the colour pass that carries hover, selection and spike ripples.
function updateMEA(t) {
  const posAttr = mea.geometry.attributes.position;
  const arr = posAttr.array;
  const wave = reducedMotion ? 0 : 1;

  for (let i = 0; i < channelCount; i++) {
    const k = i * 3;
    const x = meaBase[k], z = meaBase[k + 2];
    arr[k + 1] = meaBase[k + 1] + wave * (
      Math.sin(x * 1.05 + t * 0.5) * 0.042 +
      Math.cos(z * 0.85 - t * 0.38) * 0.032 +
      Math.sin((x + z) * 0.6 + t * 0.22) * 0.018
    );

    // base colour: grey, warming to pink at the crests
    const tint = THREE.MathUtils.clamp((arr[k + 1] + 0.12) * 2.2, 0, 1);
    _c.copy(GREY).lerp(PINK, tint);

    // spike ripples radiating from selected channels
    let hot = 0;
    for (let s = 0; s < spikes.length; s++) {
      const sp = spikes[s];
      const age = t - sp.t0;
      const d = Math.hypot(x - sp.x, z - sp.z);
      const r = age * 2.6;
      const band = (d - r) / 0.34;
      hot += Math.exp(-band * band) * Math.exp(-age * 1.15);
    }
    if (i === hoverIndex) hot = Math.max(hot, 0.75);
    if (i === selectedIndex) hot = Math.max(hot, 1.0);
    if (hot > 0) _c.lerp(HOT, Math.min(hot, 1));

    meaColor[k] = _c.r; meaColor[k + 1] = _c.g; meaColor[k + 2] = _c.b;
  }

  posAttr.needsUpdate = true;
  mea.geometry.attributes.color.needsUpdate = true;

  for (let s = spikes.length - 1; s >= 0; s--) {
    if (t - spikes[s].t0 > 3.4) spikes.splice(s, 1);
  }
}

// Position of a channel in the array's own space, wave displacement included.
// The markers are children of the array, so no conversion is needed.
function channelPosition(index, out) {
  const arr = mea.geometry.attributes.position.array;
  const k = index * 3;
  return out.set(arr[k], arr[k + 1], arr[k + 2]);
}

function buildMarkers() {
  const ringGeo = new THREE.TorusGeometry(0.17, 0.018, 8, 40);
  ringGeo.rotateX(-Math.PI / 2);

  hoverRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xff7ab5).multiplyScalar(2.1), transparent: true, opacity: 0.9, depthWrite: false,
  }));
  hoverRing.visible = false;

  selectRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xff4f9c).multiplyScalar(2.6), transparent: true, opacity: 0.95, depthWrite: false,
  }));
  selectRing.visible = false;

  selectDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.062, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8fc2).multiplyScalar(3.0) })
  );
  selectDot.visible = false;

  return [hoverRing, selectRing, selectDot];
}

// ---------------------------------------------------------------------------
// Organoids + dish
// ---------------------------------------------------------------------------

function buildMetaballs() {
  // Pink, fleshy, slightly translucent: light scatters a little way in and
  // picks up the deeper flesh tone on the way out.
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xff8fae,
    roughness: 0.32,
    metalness: 0.0,
    transmission: 0.45,
    thickness: 2.2,
    ior: 1.36,
    attenuationColor: new THREE.Color(0xc1305c),
    attenuationDistance: 0.85,
    clearcoat: 0.85,
    clearcoatRoughness: 0.4,
    sheen: 1.0,
    sheenColor: new THREE.Color(0xffc6dd),
    sheenRoughness: 0.55,
    iridescence: 0.22,
    iridescenceIOR: 1.25,
    emissive: new THREE.Color(0xff6f9f),
    emissiveIntensity: 0.12,
  });
  const mc = new MarchingCubes(52, material, true, false, 90000);
  mc.isolation = 80;
  mc.scale.set(2.4, 1.7, 2.4);
  return mc;
}

function updateMetaballs(t) {
  const mc = metaballs;
  mc.reset();
  const strength = 0.5, subtract = 12;
  const balls = [
    [0.5 + Math.cos(t * 0.55) * 0.14, 0.52 + Math.sin(t * 0.7) * 0.12, 0.5 + Math.sin(t * 0.5) * 0.14],
    [0.5 + Math.cos(t * 0.4 + 2) * 0.17, 0.48 + Math.cos(t * 0.6) * 0.10, 0.5 + Math.cos(t * 0.65 + 1) * 0.16],
    [0.5 + Math.sin(t * 0.6 + 1) * 0.13, 0.55 + Math.sin(t * 0.45 + 3) * 0.13, 0.5 + Math.sin(t * 0.55 + 2) * 0.15],
    [0.5 + Math.sin(t * 0.35 + 4) * 0.10, 0.5 + Math.cos(t * 0.5 + 1) * 0.09, 0.5 + Math.cos(t * 0.4 + 5) * 0.12],
  ];
  for (const b of balls) mc.addBall(b[0], b[1], b[2], strength, subtract);
  mc.update();
}

// A whisper of a vertical gradient: flat colour gives glass nothing to bend,
// so the dish only reads as glass once there is a gradient behind it.
function makeBackdrop() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#f2ecee');
  grad.addColorStop(0.5, '#e9e3e5');
  grad.addColorStop(1, '#e0d8dc');
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A shallow pool of culture medium in the base of the dish. It is opaque, so
// the glass wall refracts it — which is what sells the dish as glass.
function makeMedium() {
  const geo = new THREE.CylinderGeometry(3.34, 3.28, 0.1, 96);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xcd8ba4, roughness: 0.9, metalness: 0.0,
    specularIntensity: 0.22,
    clearcoat: 0.2, clearcoatRoughness: 0.6,
    sheen: 0.25, sheenColor: new THREE.Color(0xffd9e8),
    envMapIntensity: 0.18,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.5;
  return mesh;
}

function makeDish(gltf) {
  const source = gltf && gltf.scene && gltf.scene.getObjectByName('Circle.001_Petridish_0');
  let geo;
  if (source && source.geometry) {
    geo = source.geometry.clone();
    geo.rotateX(-Math.PI / 2);
    geo.center();
    geo.computeBoundingBox();
    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    const s = 7.4 / Math.max(size.x, size.z);
    geo.scale(s, s, s);
    geo.computeVertexNormals();
  } else {
    geo = new THREE.CylinderGeometry(3.7, 3.7, 1.0, 64, 1, true);
  }
  // Clear borosilicate: fully transmissive, near-mirror smooth, with just a
  // breath of pink in the glass body and a bright specular edge.
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0.0,
    roughness: 0.015,
    transmission: 1.0,
    thickness: 0.6,
    ior: 1.52,
    transparent: true,
    opacity: 1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    specularIntensity: 1.0,
    iridescence: 0.3,
    iridescenceIOR: 1.32,
    attenuationColor: new THREE.Color(0xfbe6ee),
    attenuationDistance: 8,
    envMapIntensity: 1.3,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, glass);
}

// ---------------------------------------------------------------------------
// Post-processing: base render + additive bloom
// ---------------------------------------------------------------------------

function buildComposers(w, h) {
  const renderPass = new RenderPass(scene, camera);

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(renderPass);
  bloomComposer.addPass(bloomPass);

  mixPass = new ShaderPass(new THREE.ShaderMaterial({
    uniforms: {
      baseTexture: { value: null },
      bloomTexture: { value: bloomComposer.renderTarget2.texture },
      bloomIntensity: { value: BLOOM.intensity },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D baseTexture;
      uniform sampler2D bloomTexture;
      uniform float bloomIntensity;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(baseTexture, vUv) + bloomIntensity * texture2D(bloomTexture, vUv);
      }
    `,
  }), 'baseTexture');

  finalComposer = new EffectComposer(renderer);
  finalComposer.addPass(new RenderPass(scene, camera));
  finalComposer.addPass(mixPass);
  finalComposer.addPass(new OutputPass());
}

// ---------------------------------------------------------------------------

function init(gltf) {
  const w = window.innerWidth, h = window.innerHeight;

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = makeBackdrop();
  scene.fog = new THREE.Fog(BG, 20, 40);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
  camera.position.set(0, 3.2, 15.6);
  camera.lookAt(0, 0.6, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xe7c3d0, 1.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(6, 12, 8); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffd7e6, 0.9);
  rim.position.set(-8, 4, -6); scene.add(rim);

  dish = makeDish(gltf);
  dish.add(makeMedium());
  mea = buildMEA();
  metaballs = buildMetaballs();
  scene.add(dish, mea, metaballs);
  for (const m of buildMarkers()) mea.add(m);

  raycaster.params.Points.threshold = 0.12;

  buildComposers(w, h);

  updateFraming();
  camera.position.z += narrow * 8.5;
  updateScrollTarget();
  scrollT = scrollTarget;

  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', updateScrollTarget, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerleave', clearHover);

  renderer.setAnimationLoop(animate);
}

function onResize() {
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  bloomComposer.setSize(w, h);
  finalComposer.setSize(w, h);
  updateFraming();
  updateScrollTarget();
}

function onPointerMove(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  ndc.x = pointer.x;
  ndc.y = -pointer.y;
  pointerClient.x = e.clientX;
  pointerClient.y = e.clientY;
  pointerInside = true;
  needsPick = true;
}

function clearHover() {
  pointerInside = false;
  hoverIndex = -1;
}

// Selecting a channel: raycast the electrode cloud and fire a spike ripple.
function onPointerDown(e) {
  if (!mea) return;
  if (e.target && e.target.closest && e.target.closest('a, button, input, select, textarea, label')) return;
  if (scrollTarget > 0.55) return;              // hero has scrolled away

  ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
  ndc.y = -((e.clientY / window.innerHeight) * 2 - 1);
  const hit = pick();
  if (hit < 0) return;

  selectedIndex = hit;
  const k = hit * 3;
  if (spikes.length > 5) spikes.shift();
  spikes.push({ index: hit, x: meaBase[k], z: meaBase[k + 2], t0: clock.getElapsedTime() });
  showReadout(e.clientX, e.clientY, channelLabel(hit) + ' · recording');
  readoutHold = clock.getElapsedTime() + 2.4;
  // A finger leaves no cursor behind, so drop the hover state after a tap.
  if (e.pointerType === 'touch') pointerInside = false;
}

function pick() {
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(mea, false);
  return hits.length ? hits[0].index : -1;
}

function showReadout(x, y, text) {
  if (!readoutEl) return;
  readoutEl.textContent = text;
  readoutEl.style.transform = `translate(${x + 16}px, ${y - 34}px)`;
  readoutEl.classList.add('is-visible');
}

function hideReadout() {
  if (readoutEl) readoutEl.classList.remove('is-visible');
}

function updateMarkers(t, p) {
  const faded = p > 0.55;

  if (hoverIndex >= 0 && !faded) {
    channelPosition(hoverIndex, _v);
    hoverRing.position.copy(_v);
    hoverRing.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
    hoverRing.visible = true;
  } else {
    hoverRing.visible = false;
  }

  if (selectedIndex >= 0 && !faded) {
    channelPosition(selectedIndex, _v);
    selectRing.position.copy(_v);
    selectDot.position.copy(_v);
    const pulse = 1.15 + Math.sin(t * 3.2) * 0.18;
    selectRing.scale.setScalar(pulse);
    selectRing.visible = true;
    selectDot.visible = true;
  } else {
    selectRing.visible = false;
    selectDot.visible = false;
  }
}

function layout(p) {
  // At rest (p = 0) the stack already reads as a gentle "bloom" — small
  // organoids up top, title band in the middle, MEA + dish below. Scrolling
  // pushes the three layers further apart.
  dish.position.y = -2.3 - p * 2.6;
  mea.position.y = 0.15 + p * 0.7;
  metaballs.position.y = 3.15 + p * 4.4 + Math.sin(clock.elapsedTime * 0.6) * 0.12;

  // Camera dollies back and up so everything stays framed as it spreads.
  const camZ = 15.6 + narrow * 8.5 + p * 7.0;
  const camY = 3.2 + p * 3.4 + pointer.y * 0.35;
  const camX = pointer.x * 0.9;
  camera.position.x += (camX - camera.position.x) * 0.06;
  camera.position.y += (camY - camera.position.y) * 0.06;
  camera.position.z += (camZ - camera.position.z) * 0.06;
  camera.lookAt(0, 0.6 + p * 1.9, 0);
}

function fadeHero(p) {
  const sticky = document.querySelector('.stage-sticky');
  if (!sticky) return;
  const o = 1 - smoothstep(0.0, 0.42, p);
  sticky.style.opacity = String(o);
  sticky.style.transform = `translateY(${p * -30}px)`;
}

// Bloom is gathered from the objects alone: the pale ground and fog are pulled
// out for the bloom pass, then restored for the beauty pass.
function render() {
  const bg = scene.background;
  const fog = scene.fog;
  scene.background = null;
  scene.fog = null;
  bloomComposer.render();
  scene.background = bg;
  scene.fog = fog;
  finalComposer.render();
}

function animate() {
  const t = clock.getElapsedTime();
  scrollT += (scrollTarget - scrollT) * 0.08; // fluid easing

  // Nothing to draw once the opaque page content has covered the scene.
  if (stageEl && window.scrollY > stageEl.offsetHeight) return;

  updateMetaballs(t);
  layout(scrollT);

  if (needsPick && pointerInside && scrollTarget < 0.55) {
    hoverIndex = pick();
    needsPick = false;
    if (hoverIndex >= 0) {
      const label = hoverIndex === selectedIndex
        ? channelLabel(hoverIndex) + ' · recording'
        : channelLabel(hoverIndex);
      showReadout(pointerClient.x, pointerClient.y, label);
      document.body.style.cursor = 'crosshair';
    } else {
      hideReadout();
      document.body.style.cursor = '';
    }
  } else if (scrollTarget >= 0.55 || !pointerInside) {
    hoverIndex = -1;
    if (t > readoutHold) hideReadout();
    document.body.style.cursor = '';
  }

  updateMEA(t);
  updateMarkers(t, scrollT);
  fadeHero(scrollTarget);
  render();
}

function boot() {
  if (!host) return;
  const loader = new GLTFLoader();
  loader.load(
    './models/petridish_and_loop.glb',
    (gltf) => { try { init(gltf); } catch (err) { console.error(err); } },
    undefined,
    (err) => { console.error('Model load failed; using fallback dish.', err); init(null); }
  );
}

boot();
