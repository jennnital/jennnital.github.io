// Assembloid Space — scroll-driven hero scene
// A glass petri dish, a microelectrode array (MEA) grid, and floating metaball
// "organoid" blobs. The three layers sit stacked at the top of the page and
// separate fluidly as you scroll (assemble ↔ explode). No auto-rotation.
// Palette: white / grey / pink on a soft pale-grey ground.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const BG = 0xe9e3e5;

const host = document.getElementById('scene');
const stageEl = document.getElementById('stage');

let renderer, scene, camera;
let dish, mea, metaballs;
let running = true;
const clock = new THREE.Clock();
const pointer = new THREE.Vector2(0, 0);

let scrollT = 0;   // eased scroll progress 0..1
let scrollTarget = 0;

const smoothstep = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function updateScrollTarget() {
  const range = (stageEl ? stageEl.offsetHeight : window.innerHeight * 2) - window.innerHeight;
  scrollTarget = range > 0 ? THREE.MathUtils.clamp(window.scrollY / range, 0, 1) : 0;
}

function buildMEA() {
  const cols = 44, rows = 44;
  const n = cols * rows;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const radius = 3.05;
  const c = new THREE.Color();
  const pink = new THREE.Color(0xe98ab0);
  let k = 0;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const u = i / (cols - 1);
      const v = j / (rows - 1);
      const x = (u - 0.5) * 2 * radius;
      const z = (v - 0.5) * 2 * radius;
      const inDisc = (x * x + z * z) <= radius * radius;
      const y = (Math.cos(u * Math.PI * 5) + Math.sin(v * Math.PI * 7)) * 0.06;
      positions[3 * k] = x;
      positions[3 * k + 1] = inDisc ? y : 99999;
      positions[3 * k + 2] = z;
      const t = THREE.MathUtils.clamp((y + 0.12) * 2.2, 0, 1);
      c.setHex(0xbfb2b8).lerp(pink, t);
      colors[3 * k] = c.r; colors[3 * k + 1] = c.g; colors[3 * k + 2] = c.b;
      k++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 0.085, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  return new THREE.Points(geo, mat);
}

function buildMetaballs() {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xf6ccda, roughness: 0.38, metalness: 0.0,
    transmission: 0.22, thickness: 1.0, clearcoat: 0.5, clearcoatRoughness: 0.45,
    sheen: 0.6, sheenColor: new THREE.Color(0xffe3ee), ior: 1.33,
  });
  const mc = new MarchingCubes(56, material, true, false, 90000);
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
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0.0, roughness: 0.12,
    transmission: 0.92, thickness: 0.8, ior: 1.45, transparent: true, opacity: 1,
    clearcoat: 0.4, clearcoatRoughness: 0.2,
    attenuationColor: new THREE.Color(0xf3d3de), attenuationDistance: 4,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, glass);
}

function init(gltf) {
  const w = window.innerWidth, h = window.innerHeight;

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
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
  mea = buildMEA();
  metaballs = buildMetaballs();
  scene.add(dish, mea, metaballs);

  updateScrollTarget();
  scrollT = scrollTarget;

  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', updateScrollTarget, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  renderer.setAnimationLoop(animate);
}

function onResize() {
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  updateScrollTarget();
}

function onPointerMove(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
}

function layout(p) {
  // At rest (p = 0) the stack already reads as a gentle "bloom" — small
  // organoids up top, title band in the middle, MEA + dish below. Scrolling
  // pushes the three layers further apart.
  dish.position.y = -2.3 - p * 2.6;
  mea.position.y = 0.15 + p * 0.7;
  metaballs.position.y = 3.15 + p * 4.4 + Math.sin(clock.elapsedTime * 0.6) * 0.12;

  // Camera dollies back and up so everything stays framed as it spreads.
  const camZ = 15.6 + p * 7.0;
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

function animate() {
  if (!running) return;
  const t = clock.getElapsedTime();
  scrollT += (scrollTarget - scrollT) * 0.08; // fluid easing
  updateMetaballs(t);
  layout(scrollT);
  fadeHero(scrollTarget);
  renderer.render(scene, camera);
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
