// The batter: the user's image-to-3D athlete from timber-and-stone (assets/chars/fit.json,
// packed there by tools/pack-char.py: vertex colours, no texture) on the Mixamo rig, and clip playback.
//
// Clips (assets/clips.json, tools/build-clips.mjs) keep the hips' full travel ("hp", relative
// to the source rig's rest hips) because the walk-in/out and the swings move the body.
// Body bones take the clip rotation as-is (Mixamo rigs share bone axes); finger bones carry
// the source rest rotation and get retargeted: q = rest_here * rest_src^-1 * q_src.
import * as THREE from "three";
import { assetJSON } from "./assets.js";

export const UNIT = 0.01;   // model cm -> world metres (the model is 1.88 m to the crown)

// Pickable batters (title screen). Both are the user's own image-to-3D models on Mixamo rigs:
// "ant" = Ant in his black tracksuit (Animations-characters/ant, packed by its pack-ant.py).
export const PLAYERS = { fit: "The Athlete", ant: "Ant" };

export async function loadPlayer(id) {
  const [D, clips] = await Promise.all([assetJSON("chars/" + (PLAYERS[id] ? id : "fit") + ".json"), assetJSON("clips.json")]);
  return prepare(D, clips);
}

function prepare(D, clips) {
  const M = { D, BN: {} };
  D.bones.forEach((b, i) => { M.BN[b.name] = i; });
  const raw = atob(D.bin), bin = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
  D.bin = null;
  const nv = D.verts, buf = bin.buffer;
  let o = 0;
  const take = (Type, n) => { const a = new Type(buf, o, n); o += n * Type.BYTES_PER_ELEMENT; return a; };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(take(Float32Array, nv * 3), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(take(Uint8Array, nv * 4), 4, true));
  // Normals are packed 4-wide (one padding byte): a 3-wide view of them.
  geo.setAttribute("normal", new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(take(Int8Array, nv * 4), 4), 3, 0, true));
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(take(Uint8Array, nv * 4), 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(take(Uint8Array, nv * 4), 4, true));
  geo.setIndex(new THREE.BufferAttribute(take(D.wideIndex ? Uint32Array : Uint16Array, D.index), 1));
  geo.computeBoundingSphere();
  M.geo = geo;
  M.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0 });
  M.inverses = D.inverses.map((e) => new THREE.Matrix4().fromArray(e));
  M.nb = D.bones.length;
  M.restQ = D.bones.map((b) => new THREE.Quaternion().fromArray(b.q));
  M.hipsP = D.bones[M.BN.Hips].p;

  M.clips = {};
  const qSrcInv = new THREE.Quaternion(), qa = new THREE.Quaternion();
  for (const k of Object.keys(clips)) {
    const c = clips[k];
    if (c.pose) continue;
    const n = Math.round(c.dur * c.fps) + 1;
    const cl = { name: k, dur: c.dur, fps: c.fps, n, q: [], hy: null, hp: null, s: M.hipsP[1] / (c.hipsRest || M.hipsP[1]) };
    for (const tr of c.tracks) {
      const bi = M.BN[tr.b];
      if (bi === undefined) continue;
      if (tr.k === "q") {
        let v = new Float32Array(tr.v);
        if (tr.rest) {
          // Retarget the finger bend onto this rig's own finger rest.
          qSrcInv.fromArray(tr.rest).invert();
          const out = new Float32Array(v.length);
          for (let f = 0; f < n; f++) {
            qa.fromArray(v, f * 4);
            qa.premultiply(qSrcInv).premultiply(M.restQ[bi]);
            qa.toArray(out, f * 4);
          }
          v = out;
        }
        cl.q.push({ i: bi, v });
      } else if (tr.k === "hy") cl.hy = new Float32Array(tr.v);
      else if (tr.k === "hp") cl.hp = new Float32Array(tr.v);
    }
    M.clips[k] = cl;
  }
  return M;
}

// Pose of `cl` at time t into out (quaternions, nb*4) and hips (Vector3, model units).
// pingpong clips play forward then backward (jumping jacks, the boulder lift).
export function sampleClip(M, cl, t, out, hips, pingpong) {
  let x = t * cl.fps;
  const last = cl.n - 1;
  if (pingpong) {
    const p = x % (2 * last);
    x = p <= last ? p : 2 * last - p;
  }
  if (x < 0) x = 0;
  if (x > last) x = last;
  const a = Math.floor(x), b = Math.min(last, a + 1), u = x - a;
  for (const tr of cl.q) THREE.Quaternion.slerpFlat(out, tr.i * 4, tr.v, a * 4, tr.v, b * 4, u);
  const hp = M.hipsP;
  if (cl.hp) {
    const s = cl.s, A = cl.hp;
    hips.set(hp[0] + (A[a * 3] + (A[b * 3] - A[a * 3]) * u) * s,
      (A[a * 3 + 1] + (A[b * 3 + 1] - A[a * 3 + 1]) * u) * s,
      hp[2] + (A[a * 3 + 2] + (A[b * 3 + 2] - A[a * 3 + 2]) * u) * s);
  } else if (cl.hy) hips.set(hp[0], (cl.hy[a] + (cl.hy[b] - cl.hy[a]) * u) * cl.s, hp[2]);
  else hips.set(hp[0], hp[1], hp[2]);
}

const smooth = (x) => x * x * (3 - 2 * x);

export class Character {
  constructor(M) {
    this.M = M;
    const D = M.D;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.body.scale.setScalar(UNIT);
    this.root.add(this.body);
    this.bones = D.bones.map((b) => {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.position.fromArray(b.p); bone.quaternion.fromArray(b.q); bone.scale.fromArray(b.s);
      return bone;
    });
    D.bones.forEach((b, i) => (b.parent >= 0 ? this.bones[b.parent] : this.body).add(this.bones[i]));
    this.mesh = new THREE.SkinnedMesh(M.geo, M.mat);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.body.add(this.mesh);
    this.body.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones, M.inverses), new THREE.Matrix4());
    this.lq = new Float32Array(M.nb * 4);
    this.tmp = new Float32Array(M.nb * 4);
    this.phase = 0;
    this.idleT = 0;
    this._h = new THREE.Vector3();
    this._hs = new THREE.Vector3();
  }

  bone(name) { return this.bones[this.M.BN[name]]; }

  // Weighted blend of [clip, weight, time|null(phase)] into lq/hips.
  blend(set, lq, hips, pingpongs) {
    const M = this.M, nb = M.nb, tmp = this.tmp;
    for (let j = 0; j < nb; j++) M.restQ[j].toArray(lq, j * 4);
    let wsum = 0;
    hips.set(M.hipsP[0], M.hipsP[1], M.hipsP[2]);
    set.forEach(([cl, w, t], k) => {
      if (!cl || w <= 0.001) return;
      sampleClip(M, cl, t == null ? this.phase * cl.dur : t, tmp, this._hs, pingpongs && pingpongs[k]);
      wsum += w;
      const f = w / wsum;
      for (const tr of cl.q) THREE.Quaternion.slerpFlat(lq, tr.i * 4, lq, tr.i * 4, tmp, tr.i * 4, f);
      hips.lerp(this._hs, f);
    });
  }

  // Layer clip pose (qB, hB) over (qA, hA) with weight w into this character's bones.
  apply(qA, hA, qB, hB, w) {
    const M = this.M, nb = M.nb;
    const k = smooth(Math.max(0, Math.min(1, w)));
    if (qB && k > 0) for (let j = 0; j < nb; j++) THREE.Quaternion.slerpFlat(qA, j * 4, qA, j * 4, qB, j * 4, k);
    for (let j = 0; j < nb; j++) this.bones[j].quaternion.fromArray(qA, j * 4);
    this._h.copy(hA);
    if (hB && k > 0) this._h.lerp(hB, k);
    this.bones[M.BN.Hips].position.copy(this._h);
    this.root.updateMatrixWorld(true);
  }

  // A bone's position in the character's own frame (metres, x right?, y up, z forward).
  localPos(name, out) {
    out.setFromMatrixPosition(this.bone(name).matrixWorld);
    return this.root.worldToLocal(out);
  }
}
