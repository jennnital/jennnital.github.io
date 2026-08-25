// Assembloid Space — gallery
//
// Two views of the same set of projects:
//
//   1. The drift. A field of project planes scattered along a closed 3D curve;
//      the page scroll walks the camera along it and whatever comes near the
//      lens swells into focus. The technique is adapted from Gaspard Hedde's
//      "Scroll-Driven 3D Gallery Using a Blender Camera Path" (Codrops):
//      https://github.com/gaspoorf/curve-gallery — the curve here is generated
//      rather than exported from Blender, and the camera is driven by the
//      page's own scroll instead of hijacking the wheel.
//
//   2. The index. One card per project, each thumbnail rendered as a
//      microelectrode array that resolves under the pointer (see mea-thumb.js).
//
// Projects come from gallery-data.js; images live in images/gallery/.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { projects } from './gallery-data.js';
import { loadThumb, createStimThumb } from './mea-thumb.js';

const gsap = window.gsap;

const BG = 0xe9e3e5;
const BLOOM = { strength: 0.6, radius: 0.75, threshold: 0.62, intensity: 0.55 };

const TOTAL = 300;            // planes scattered along the curve
const CAM_Z = 10;             // camera offset along Z
const FOCUS_DIST = 5.5;       // distance at which planes start to scale up
const MAX_SCALE = 13;         // maximum scale factor for a plane in focus
const Z_GATE = 11;            // depth cut-off, keeps the per-frame work small
const LATERAL_RANGE = [-1.15, 1.15];
const DEPTH_RANGE = [-0.75, 0.75];
const SIZE_RANGE = [0.18, 0.42];

const host = document.getElementById('gallery-scene');
const stageEl = document.getElementById('gallery-stage');
const labelEl = document.getElementById('focus-label');
const indexEl = document.getElementById('project-index');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer, scene, camera, curve;
let bloomComposer, finalComposer;
const planes = [];
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2(-2, -2);

let focusTGate = 0;
let scrollT = 0;
let labelFor = -1;

const randomBetween = (min, max) => min + Math.random() * (max - min);

// ---------------------------------------------------------------------------
// The curve. A closed loop, wide in X, gentler in Y, with a little depth
// wobble so the planes do not all sit on one wall.
// ---------------------------------------------------------------------------

function buildCurve() {
  const pts = [];
  const N = 96;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    pts.push(new THREE.Vector3(
      Math.cos(a) * 34 + Math.cos(a * 3) * 7,
      Math.sin(a * 2) * 11 + Math.sin(a) * 4,
      Math.sin(a * 3) * 2.2
    ));
  }
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
}

// position, plus the in-plane normal, at a point on the curve
function curveFrame(t) {
  const pos = curve.getPoint(t);
  const tangent = curve.getTangent(t);
  return { pos, nx: -tangent.y, ny: tangent.x };
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

async function loadProjectTextures() {
  const sources = await Promise.all(projects.map((p) => loadThumb(p.image, p.title)));
  return sources.map((source) => {
    const tex = new THREE.Texture(source);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    return { tex, aspect: w && h ? w / h : 1 };
  });
}

function buildPlanes(textures) {
  const materials = textures.map(({ tex }) => new THREE.MeshBasicMaterial({
    map: tex, side: THREE.DoubleSide, toneMapped: true,
  }));

  for (let i = 0; i < TOTAL; i++) {
    const t = i / TOTAL;
    const { pos, nx, ny } = curveFrame(t);

    const which = i % projects.length;                  // every project recurs evenly
    const lateral = randomBetween(...LATERAL_RANGE);
    const depth = randomBetween(...DEPTH_RANGE);
    const size = randomBetween(...SIZE_RANGE);
    const aspect = textures[which].aspect;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size * aspect, size),
      materials[which]
    );
    mesh.position.set(pos.x + nx * lateral, pos.y + ny * lateral, pos.z + depth);

    mesh.userData.t = t;
    mesh.userData.project = which;
    mesh.userData.scale = 1;
    // pre-built easing per plane, exactly as the tutorial does
    const proxy = { value: 1 };
    const setScale = gsap.quickTo(proxy, 'value', {
      duration: 0.4,
      ease: 'power3.out',
      onUpdate: () => { mesh.scale.setScalar(proxy.value); mesh.userData.scale = proxy.value; },
    });
    mesh.userData.setScale = setScale;

    planes.push(mesh);
    scene.add(mesh);
  }
}

const focusScale = (distance, maxDistance, maxScale) => {
  const f = 1 - distance / maxDistance;
  return 1 + f ** 3 * (maxScale - 1);
};

// ---------------------------------------------------------------------------
// Post-processing — the same additive bloom the home page uses, so the
// gallery glows in the same family.
// ---------------------------------------------------------------------------

function buildComposers(w, h) {
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(new RenderPass(scene, camera));
  bloomComposer.addPass(bloomPass);

  const mixPass = new ShaderPass(new THREE.ShaderMaterial({
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

// ---------------------------------------------------------------------------
// Scroll → position on the curve
// ---------------------------------------------------------------------------

const camProxy = { t: 0 };
let setCamT = null;

function updateScrollTarget() {
  if (!stageEl) return;
  const range = stageEl.offsetHeight - window.innerHeight;
  const p = range > 0 ? THREE.MathUtils.clamp(window.scrollY / range, 0, 1) : 0;
  if (setCamT) setCamT(p * 0.999);
  // the label belongs to the drift, not to the index below it
  if (window.scrollY > stageEl.offsetHeight - window.innerHeight * 0.5) setLabel(-1);
}

// ---------------------------------------------------------------------------
// Labels and links
// ---------------------------------------------------------------------------

function openProject(index) {
  const p = projects[index];
  if (!p) return;
  if (/^https?:/i.test(p.href)) window.open(p.href, '_blank', 'noopener');
  else window.location.href = p.href;
}

function setLabel(index) {
  if (index === labelFor || !labelEl) return;
  labelFor = index;
  if (index < 0) {
    labelEl.classList.remove('is-visible');
    return;
  }
  const p = projects[index];
  labelEl.querySelector('.focus-meta').textContent = p.meta || '';
  labelEl.querySelector('.focus-title').textContent = p.title;
  labelEl.href = p.href;
  if (/^https?:/i.test(p.href)) { labelEl.target = '_blank'; labelEl.rel = 'noopener noreferrer'; }
  else { labelEl.removeAttribute('target'); labelEl.removeAttribute('rel'); }
  labelEl.classList.add('is-visible');
}

function onPointerMove(e) {
  ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
  ndc.y = -((e.clientY / window.innerHeight) * 2 - 1);
}

function onClick(e) {
  if (e.target && e.target.closest && e.target.closest('a, button')) return;
  if (!planes.length) return;
  ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
  ndc.y = -((e.clientY / window.innerHeight) * 2 - 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(planes, false);
  if (hits.length) openProject(hits[0].object.userData.project);
}

// ---------------------------------------------------------------------------

async function initScene() {
  const w = window.innerWidth, h = window.innerHeight;

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 10, 42);

  camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 200);
  camera.position.set(0, 0, CAM_Z);

  curve = buildCurve();
  focusTGate = (FOCUS_DIST * 1.5) / curve.getLength();

  const textures = await loadProjectTextures();
  buildPlanes(textures);
  buildComposers(w, h);

  setCamT = gsap.quickTo(camProxy, 't', { duration: 1, ease: 'power3.out' });

  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', updateScrollTarget, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('click', onClick);

  updateScrollTarget();
  camProxy.t = 0;
  renderer.setAnimationLoop(animate);
}

function onResize() {
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  bloomComposer.setSize(w, h);
  finalComposer.setSize(w, h);
  updateScrollTarget();
}

function animate() {
  // nothing to draw once the opaque index has covered the canvas
  if (stageEl && window.scrollY > stageEl.offsetHeight) return;

  scrollT = camProxy.t;
  const pos = curve.getPoint(scrollT);
  camera.position.set(pos.x, pos.y, pos.z + CAM_Z);

  let best = -1, bestScale = 2.2;
  for (const plane of planes) {
    const dx = camera.position.x - plane.position.x;
    const dy = camera.position.y - plane.position.y;
    const dz = Math.abs(camera.position.z - plane.position.z);
    const distXY = Math.sqrt(dx * dx + dy * dy);

    let dt = Math.abs(plane.userData.t - scrollT);
    if (dt > 0.5) dt = 1 - dt;

    const inFocus = dt < focusTGate && dz < Z_GATE && distXY < FOCUS_DIST;
    plane.userData.setScale(inFocus ? focusScale(distXY, FOCUS_DIST, MAX_SCALE) : 1);

    if (plane.userData.scale > bestScale) {
      bestScale = plane.userData.scale;
      best = plane.userData.project;
    }
  }
  setLabel(best);

  render();
}

// ---------------------------------------------------------------------------
// The index: one MEA card per project
// ---------------------------------------------------------------------------

async function buildIndex() {
  if (!indexEl) return;

  for (const p of projects) {
    const external = /^https?:/i.test(p.href);

    const card = document.createElement('a');
    card.className = 'gallery-card';
    card.href = p.href;
    if (external) { card.target = '_blank'; card.rel = 'noopener noreferrer'; }

    const canvas = document.createElement('canvas');
    canvas.className = 'gallery-card-canvas';
    canvas.setAttribute('aria-hidden', 'true');

    const meta = document.createElement('span');
    meta.className = 'gallery-card-meta';
    meta.textContent = p.meta || '';

    const title = document.createElement('span');
    title.className = 'gallery-card-title';
    title.textContent = p.title + (external ? ' ↗' : '');

    card.append(canvas, meta, title);
    indexEl.appendChild(card);

    // stagger the loads so a dozen decodes don't land in one frame
    loadThumb(p.image, p.title).then((source) => {
      createStimThumb(canvas, source, { title: p.title });
    });
  }
}

function boot() {
  buildIndex();
  if (!host) return;
  if (reducedMotion) {
    // Still show the field, just don't ask anyone to scroll through it.
    host.classList.add('is-static');
  }
  initScene().catch((err) => console.error('Gallery scene failed to start.', err));
}

boot();
