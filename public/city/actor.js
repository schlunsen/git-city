import * as THREE from 'three';
import { scene, clock } from './scene.js';
import { buildingMeshes, buildingByName } from './buildings.js';
import { ACCENT, KIND_COLORS } from './constants.js';
import { makeGlowTexture } from './toon.js';
import { actorState } from '../history.js';

const TRAVEL = 0.55, ACT = 1.0; // seconds at 1x: flight to a building, beam on it
export let actor = null;     // { group, sprite, halo, beam, beamMat, ring, ringMat, glowTex, idle, pos }
let bursts = [];             // transient particle bursts at beamed buildings
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
// App state the actor acts out, handed over once by app.js (initActor): the
// city version (a stale avatar download is dropped), the playback
// { timeline, play }, and the HUD callbacks for each step (feed card, clock).
let deps = { version: () => 0, playback: () => ({ timeline: null, play: null }), onStep() {}, onClock() {} };
export function initActor(d) { deps = { ...deps, ...d }; }

// ---------------------------------------------------------------------------
// Actor — the profile's avatar, Gource-style: it hovers over the plaza and,
// during playback, flies to each repository it touched and beams at it.
// ---------------------------------------------------------------------------

export function buildActor() {
  const group = new THREE.Group();
  const glowTex = makeGlowTexture();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: ACCENT, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.scale.set(13, 13, 1);
  group.add(halo);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: ACCENT, transparent: true, depthWrite: false }));
  sprite.scale.set(7.5, 7.5, 1);
  group.add(sprite);
  // Beam: a tapering cylinder hanging from the actor down to the roof.
  const beamMat = new THREE.MeshBasicMaterial({
    color: ACCENT, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const beamGeo = new THREE.CylinderGeometry(0.3, 1.1, 1, 14, 1, true);
  beamGeo.translate(0, -0.5, 0); // pivot at the top so scale.y grows downward
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.visible = false;
  group.add(beam);
  // Impact ring on the roof: expands and fades while the beam is on.
  const ringMat = new THREE.MeshBasicMaterial({
    color: ACCENT, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1.0, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  group.position.set(0, 20, 0);
  scene.add(group);
  actor = {
    group, sprite, halo, beam, beamMat, ring, ringMat, glowTex,
    idle: new THREE.Vector3(0, 20, 0), pos: new THREE.Vector3(0, 20, 0),
  };
}

// Round avatar with a teal rim, drawn onto the actor sprite. Falls back to the
// plain glowing orb when the avatar can't be fetched.
export function buildAvatar(user) {
  if (!actor) return;
  const mat = actor.sprite.material;
  if (mat.map && mat.map !== actor.glowTex) mat.map.dispose();
  mat.map = actor.glowTex;
  mat.color.set(ACCENT);
  mat.needsUpdate = true;
  const url = (user && user.avatar_url) || '';
  if (!url) return;
  const version = deps.version();
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (version !== deps.version()) return;
    const size = 256, canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const r = size / 2 - 16;
    ctx.save();
    ctx.beginPath(); ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, 16, 16, size - 32, size - 32);
    ctx.restore();
    ctx.lineWidth = 9; ctx.strokeStyle = '#64dedb';
    ctx.beginPath(); ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 6; ctx.strokeStyle = '#0a0d16'; // ink rim, like every other outline in town
    ctx.beginPath(); ctx.arc(size / 2, size / 2, r + 7, 0, Math.PI * 2); ctx.stroke();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
  };
  img.src = url;
}

function buildingAnchor(step, out) {
  const b = step && buildingByName.get(step.repo);
  if (!b) return out.copy(actor.idle);
  return out.set(b.mesh.position.x, b.h + 7, b.mesh.position.z);
}

export function updateActor(dt) {
  if (!actor) return;
  const { timeline, play } = deps.playback();
  const t = clock.getElapsed();
  actor.halo.material.opacity = 0.34 + Math.sin(t * 2.2) * 0.1;
  actor.halo.material.rotation = t * 0.3;
  let acting = 0, target = null;
  if (timeline && timeline.steps.length) {
    // Before the first play the actor rests on the plaza instead of acting step 0.
    const armed = play.playing || play.t > 0;
    const st = actorState(timeline.steps, armed ? play.t : -1, { travel: TRAVEL, act: TRAVEL + ACT });
    if (st.index >= 0) {
      const step = timeline.steps[st.index];
      const to = buildingAnchor(step, _v1);
      const from = st.from === null ? _v2.copy(actor.idle) : buildingAnchor(timeline.steps[st.from], _v2);
      const k = st.travel, e = k * k * (3 - 2 * k);
      actor.pos.lerpVectors(from, to, e);
      actor.pos.y += Math.sin(k * Math.PI) * Math.min(14, from.distanceTo(to) * 0.25);
      acting = st.travel >= 1 ? Math.max(0, 1 - (st.since - TRAVEL) / ACT) : 0;
      target = buildingByName.get(step.repo) || null;
      // One-shot effects fire exactly once per step, in playback order.
      if (st.index !== play.lastIndex) {
        if (st.index > play.lastIndex && st.index - play.lastIndex <= 3) deps.onStep(step);
        play.lastIndex = st.index;
        if (target) { target.pulse = 1; spawnBurst(target, KIND_COLORS[step.label] || '#c2cad8'); }
        deps.onClock(step, st.index);
      }
    } else {
      actor.pos.copy(actor.idle);
      if (play.lastIndex !== -1) { play.lastIndex = -1; deps.onClock(null, -1); }
    }
  } else {
    actor.pos.copy(actor.idle);
  }
  const bob = timeline && play.playing ? 0 : Math.sin(t * 1.2) * 0.5;
  actor.group.position.set(actor.pos.x, actor.pos.y + bob, actor.pos.z);

  if (acting > 0 && target) {
    const step = timeline.steps[play.lastIndex];
    const top = target.h + 0.6;
    const len = Math.max(0.1, actor.group.position.y - 3 - top);
    actor.beam.visible = true;
    actor.beam.position.y = -3;
    actor.beam.scale.set(1, len, 1);
    actor.beamMat.opacity = 0.3 + acting * 0.5;
    actor.beamMat.color.set(KIND_COLORS[step?.label] || '#64dedb');
    actor.ring.visible = true;
    actor.ring.position.set(target.mesh.position.x, top + 0.2, target.mesh.position.z);
    const sc = 1.5 + (1 - acting) * 7;
    actor.ring.scale.set(sc, sc, 1);
    actor.ringMat.opacity = acting * 0.8;
    actor.ringMat.color.copy(actor.beamMat.color);
  } else {
    actor.beam.visible = false;
    actor.ring.visible = false;
  }
  for (const b of buildingMeshes) if (b.pulse) b.pulse = Math.max(0, b.pulse - dt * 1.4);
  updateBursts(dt);
}

function spawnBurst(b, cssColor) {
  const N = 28;
  const pos = new Float32Array(N * 3), vel = [];
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 8;
    vel.push(new THREE.Vector3(Math.cos(a) * r, 5 + Math.random() * 9, Math.sin(a) * r));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(cssColor), size: 0.6, map: actor.glowTex, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.position.set(b.mesh.position.x, b.h + 0.8, b.mesh.position.z);
  scene.add(pts);
  bursts.push({ pts, geo, mat, vel, life: 0, ttl: 1.3 });
  if (bursts.length > 12) killBurst(bursts.shift());
}
function killBurst(bu) { scene.remove(bu.pts); bu.geo.dispose(); bu.mat.dispose(); }
function updateBursts(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const bu = bursts[i];
    bu.life += dt;
    const p = bu.geo.attributes.position.array;
    for (let j = 0; j < bu.vel.length; j++) {
      const v = bu.vel[j];
      v.y -= 14 * dt;
      p[j * 3] += v.x * dt; p[j * 3 + 1] += v.y * dt; p[j * 3 + 2] += v.z * dt;
    }
    bu.geo.attributes.position.needsUpdate = true;
    bu.mat.opacity = Math.max(0, 1 - bu.life / bu.ttl);
    if (bu.life >= bu.ttl) { killBurst(bu); bursts.splice(i, 1); }
  }
}
