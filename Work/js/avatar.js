// The batter is the player's own HopLobby avatar (a platform rule). The baseball clips are
// Mixamo takes on the old athlete's rig, so that rig (the "driver", chars.js) still plays every
// clip, hidden, and each frame its pose is copied onto the avatar:
//  - the avatar's rig is read from the skeleton's shape (19 bones; the names aren't relied on),
//    the same reader as Swole Mates' rig.js;
//  - each driver bone's world rotation away from its bind pose goes onto the matching avatar
//    bone, after the avatar's own rest (T, A or arms down) is swung onto the driver's bind-pose
//    directions;
//  - the hips go where the driver's hips are, their height scaled to the avatar's legs.
// The bat rides the avatar's hands (gear.js), so the contact point is measured on the avatar.
import * as THREE from "three";
import { GLTFLoader } from "../vendor/jsm/loaders/GLTFLoader.js";

const NB = 19;
const HIPS = 0, SPINE = 1, CHEST = 2, NECK = 3, HEAD = 4;
// Logical bones on the driver (Mixamo names), in the reader's order.
const SRC = ["Hips", "Spine", "Spine2", "Neck", "Head",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "RightUpLeg", "RightLeg", "RightFoot", "LeftUpLeg", "LeftLeg", "LeftFoot"];
// The bone each segment points at; -1 = no direction of its own (takes its parent's swing).
const TIP = [-1, CHEST, NECK, HEAD, -1, 6, 7, 8, -1, 10, 11, 12, -1, 14, 15, -1, 17, 18, -1];
const PARENT_SWING = { 4: 3, 8: 7, 12: 11, 15: 14, 18: 17 };
export const AV_R_HAND = 8, AV_L_HAND = 12;

// ---- the rig: by HopLobby's bone names, else by shape -------------------------------------------
// Real avatars carry fingers and toes too (51 bones); the names of the 19 we use are documented.
const NAMES = ["hips", "spine", "chest", "neck", "head", "shoulderR", "upperArmR", "forearmR", "handR",
  "shoulderL", "upperArmL", "forearmL", "handL", "thighR", "shinR", "footR", "thighL", "shinL", "footL"];
function readRigByName(bones) {
  const byName = new Map(bones.map((b) => [b.name, b]));
  const map = NAMES.map((n) => byName.get(n) || null);
  return map.every(Boolean) ? map : null;
}
function readRig(bones) {
  const named = readRigByName(bones);
  if (named) return named;
  if (bones.length < 10) return null;
  const isBone = (o) => o && o.isBone;
  const kids = (b) => b.children.filter(isBone);
  const wp = new Map();
  bones.forEach((b) => wp.set(b, b.getWorldPosition(new THREE.Vector3())));
  const count = (b) => { let n = 1; kids(b).forEach((k) => { n += count(k); }); return n; };
  const roots = bones.filter((b) => !isBone(b.parent)).sort((a, b) => count(b) - count(a));
  const hips = roots[0];
  if (!hips) return null;
  const under = []; (function walk(b) { under.push(b); kids(b).forEach(walk); })(hips);
  const head = under.slice().sort((a, b) => wp.get(b).y - wp.get(a).y)[0];
  const path = [];
  for (let b = head; b; b = isBone(b.parent) ? b.parent : null) { path.push(b); if (b === hips) break; }
  if (path[path.length - 1] !== hips) return null;
  const onPath = new Set(path);
  // A limb runs down to where it branches: a hand with fingers ends the arm.
  const chain = (b) => { const c = [b]; let k = kids(b); while (k.length === 1) { c.push(k[0]); k = kids(k[0]); } return c; };
  const arms = [], legs = [];
  path.forEach((b) => kids(b).forEach((k) => { if (!onPath.has(k)) (b === hips ? legs : arms).push(chain(k)); }));
  if (arms.length < 2 || legs.length < 2) return null;
  // Right = +X in the avatar's own frame (it faces -Z).
  const side = (c) => wp.get(c[Math.min(c.length - 1, 2)]).x;
  arms.sort((a, b) => side(b) - side(a));
  legs.sort((a, b) => side(b) - side(a));
  const armR = arms[0], armL = arms[arms.length - 1], legR = legs[0], legL = legs[legs.length - 1];
  if (armR.length < 3 || armL.length < 3 || legR.length < 3 || legL.length < 3) return null;
  if (wp.get(armR[armR.length - 1]).x <= 0) return null;
  const arm = (c) => { const n = c.length; return [n >= 4 ? c[n - 4] : null, c[n - 3], c[n - 2], c[n - 1]]; };
  const leg = (c) => [c[0], c[1], c[2]];
  const chest = armR[0].parent;
  const ci = path.indexOf(chest);
  if (ci < 0) return null;
  const lower = path.slice(ci + 1, path.length - 1), upper = path.slice(1, ci);
  const a = arm(armR), b = arm(armL), l = leg(legR), m = leg(legL);
  return [hips, lower.length ? lower[lower.length - 1] : null, chest, upper.length ? upper[upper.length - 1] : null, head,
    a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3], l[0], l[1], l[2], m[0], m[1], m[2]];
}

// ---- loading -------------------------------------------------------------------------------------
// A .glb (ArrayBuffer) -> an avatar ready to follow the driver, or null if its rig isn't readable.
export async function loadAvatar(buffer, driver, scene) {
  const gltf = await new GLTFLoader().parseAsync(buffer.slice(0), "");
  const root = gltf.scene;
  // Avatars face -Z; the driver's bind pose faces +Z: turn the avatar to match.
  root.rotation.set(0, Math.PI, 0);
  root.position.set(0, 0, 0);
  scene.add(root);
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const bones = [];
  root.traverse((o) => { if (o.isBone) bones.push(o); });
  // The rig reader works in the avatar's own frame (right = +X): read it before turning... the
  // turn is a rotation about Y, so read positions in the root's local space instead.
  const map = readRigLocal(bones, root);
  if (!map) { scene.remove(root); return null; }
  return new Avatar(root, bones, map, driver);
}
function readRigLocal(bones, root) {
  const q = root.quaternion.clone();
  root.quaternion.identity(); root.updateMatrixWorld(true);
  const map = readRig(bones);
  root.quaternion.copy(q); root.updateMatrixWorld(true);
  return map;
}

const _q = new THREE.Quaternion(), _p = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3();

class Avatar {
  constructor(root, bones, map, driver) {
    this.root = root;
    this.map = map;
    this.driver = driver;
    // Bones in parent-first order, each with its parent's index (-1 = above the skeleton).
    const order = [];
    (function walk(o) { if (o.isBone) order.push(o); o.children.forEach(walk); })(root);
    this.order = order;
    const idx = new Map(order.map((b, i) => [b, i]));
    this.oParent = order.map((b) => (idx.has(b.parent) ? idx.get(b.parent) : -1));
    this.oLogical = order.map((b) => map.indexOf(b));
    this.wq = order.map(() => new THREE.Quaternion());
    // The (static) frames above the skeleton.
    this.topQ = new Map(); this.topInv = new Map();
    order.forEach((b, i) => {
      if (this.oParent[i] >= 0) return;
      this.topQ.set(b, b.parent.getWorldQuaternion(new THREE.Quaternion()));
      this.topInv.set(b, b.parent.matrixWorld.clone().invert());
    });
    const restWQ = map.map((b) => (b ? b.getWorldQuaternion(new THREE.Quaternion()) : null));
    const restWP = map.map((b) => (b ? b.getWorldPosition(new THREE.Vector3()) : null));
    this.hipsH = Math.max(0.3, restWP[HIPS].y);
    this.handLen = { R: segLen(restWP, 7, 8), L: segLen(restWP, 11, 12) };

    // The driver, in its bind pose (world): rotations, positions, hips height.
    const D = driver;
    const dRest = this.dRest = [], dPos = [];
    D.posed(() => {
      SRC.forEach((n, i) => { const b = D.bone(n); dRest[i] = b.getWorldQuaternion(new THREE.Quaternion()); dPos[i] = b.getWorldPosition(new THREE.Vector3()); });
    });
    this.dRestInv = dRest.map((q) => q.clone().invert());
    this.dHipsH = Math.max(0.3, dPos[HIPS].y);

    // The avatar's rest, swung onto the driver's bind-pose directions, segment by segment.
    const sw = [];
    for (let i = 0; i < NB; i++) {
      sw[i] = new THREE.Quaternion();
      const t = TIP[i];
      if (t >= 0 && map[i] && map[t]) {
        const a = _v.copy(restWP[t]).sub(restWP[i]), d = _w.copy(dPos[t]).sub(dPos[i]);
        if (a.lengthSq() > 1e-8 && d.lengthSq() > 1e-8) sw[i].setFromUnitVectors(a.normalize(), d.normalize());
      }
    }
    for (let i = 0; i < NB; i++) if (PARENT_SWING[i] !== undefined) sw[i].copy(sw[PARENT_SWING[i]]);
    // Torso: keep only half the correction (an avatar's spine may lean on purpose).
    [SPINE, CHEST, NECK, HEAD].forEach((i) => sw[i].slerp(new THREE.Quaternion(), 0.5));
    this.tRest = map.map((b, i) => (b ? sw[i].clone().multiply(restWQ[i]) : null));
    this.restWPHips = restWP[HIPS].clone();
  }

  // Copy the driver's current pose (its matrices must be up to date).
  follow() {
    const D = this.driver, order = this.order, wq = this.wq;
    for (let k = 0; k < order.length; k++) {
      const b = order[k], par = this.oParent[k], li = this.oLogical[k];
      const parentQ = par >= 0 ? wq[par] : this.topQ.get(b);
      if (li >= 0 && this.tRest[li]) {
        D.bone(SRC[li]).getWorldQuaternion(_q).multiply(this.dRestInv[li]);   // driver's turn from its bind pose
        _q.multiply(this.tRest[li]);                                           // onto the avatar
        b.quaternion.copy(_p.copy(parentQ).invert().multiply(_q));
      }
      wq[k].copy(parentQ).multiply(b.quaternion);
    }
    // Hips: over the driver's hips, at the avatar's own height.
    const hips = this.map[HIPS];
    D.bone("Hips").getWorldPosition(_v);
    _v.y *= this.hipsH / this.dHipsH;
    hips.position.copy(_v.applyMatrix4(this.topInv.get(hips) || new THREE.Matrix4()));
    this.root.updateMatrixWorld(true);
  }

  // For the bat (gear.js): the palm, a little past the wrist along the hand.
  palm(side, out) {
    const i = side === "Right" ? AV_R_HAND : AV_L_HAND, hand = this.map[i], fore = this.map[i - 1];
    out.setFromMatrixPosition(hand.matrixWorld);
    _w.setFromMatrixPosition(fore.matrixWorld);
    const len = this.handLen[side === "Right" ? "R" : "L"];
    return out.addScaledVector(_w.sub(out).normalize(), -len * 0.18 - 0.035);
  }
  handQuat(side, out) { return this.map[side === "Right" ? AV_R_HAND : AV_L_HAND].getWorldQuaternion(out); }
  head() { return this.map[HEAD]; }
}
function segLen(p, a, b) { return p[a] && p[b] ? p[a].distanceTo(p[b]) : 0.25; }
