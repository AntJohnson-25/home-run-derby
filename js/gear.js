// The bat and the batting helmet.
//
// The baseball clips carry no bat, so its pose comes from the hands each frame:
// - two hands on it (palms close together): the bat runs along the left palm -> right palm
//   line (right hand on top, a right-handed batter), knob just below the left hand;
// - one hand on it (the other let go, e.g. the follow-through or carrying it on the walk-out):
//   it is fixed in the hand with the tighter fist, in the grip measured in the stance;
// blended by how far apart the palms are.
import * as THREE from "three";

export const BAT_LEN = 0.84;          // 33 inches
export const SWEET = 0.66;            // sweet spot, metres from the knob
const KNOB_BELOW = 0.07;              // knob below the bottom hand's palm

function batTexture() {
  const c = document.createElement("canvas");
  c.width = 8; c.height = 256;
  const g = c.getContext("2d");
  // v runs knob (bottom, v=0) -> end cap (top, v=1); canvas y is flipped.
  const grd = g.createLinearGradient(0, 256, 0, 0);
  grd.addColorStop(0, "#2a2018"); grd.addColorStop(0.36, "#2a2018");
  grd.addColorStop(0.365, "#c99a5e"); grd.addColorStop(0.7, "#d8ab6c"); grd.addColorStop(1, "#b98848");
  g.fillStyle = grd; g.fillRect(0, 0, 8, 256);
  // Tape wraps.
  g.fillStyle = "rgba(255,255,255,0.08)";
  for (let y = 256 * 0.64; y < 256; y += 6) g.fillRect(0, y, 8, 2);
  // Brand band on the barrel.
  g.fillStyle = "#1c1410"; g.fillRect(0, 256 * (1 - 0.8), 8, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function batGeometry() {
  // Radius along the bat (metres), sampled evenly so the lathe's v is proportional to length.
  const r = (y) => {
    if (y < 0.012) return 0.027;                                 // knob
    if (y < 0.03) return 0.027 - (y - 0.012) / 0.018 * 0.0145;
    if (y < 0.3) return 0.0125;                                  // handle
    if (y < 0.62) { const u = (y - 0.3) / 0.32; return 0.0125 + (0.0335 - 0.0125) * u * u * (3 - 2 * u); }
    if (y < 0.825) return 0.0335;                                // barrel
    return 0.0335 * Math.sqrt(Math.max(0, 1 - ((y - 0.825) / 0.015) ** 2)) ;
  };
  const pts = [new THREE.Vector2(0, 0)];
  const N = 84;
  for (let i = 0; i <= N; i++) { const y = BAT_LEN * i / N; pts.push(new THREE.Vector2(Math.max(0.0005, r(y)), y)); }
  pts.push(new THREE.Vector2(0, BAT_LEN));
  return new THREE.LatheGeometry(pts, 14);
}

const FIST = ["Index1", "Index2", "Middle1", "Middle2", "Ring1", "Ring2"];
const smooth = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

// The hands the bat follows: the driver athlete's own, or (HopLobby) the avatar's. Avatars have no
// finger bones, so which hand still holds the bat (the tighter fist) is always read from the driver.
export function athleteHands(ch) {
  const a = new THREE.Vector3();
  return {
    palm(side, out) {
      out.setFromMatrixPosition(ch.bone(side + "Hand").matrixWorld);
      a.setFromMatrixPosition(ch.bone(side + "HandMiddle1").matrixWorld);
      return out.lerp(a, 0.6);
    },
    handQuat(side, out) { return ch.bone(side + "Hand").getWorldQuaternion(out); },
    fist(side) {
      const M = ch.M;
      let s = 0;
      for (const f of FIST) { const i = M.BN[side + "Hand" + f]; s += ch.bones[i].quaternion.angleTo(M.restQ[i]); }
      return s;
    }
  };
}
export function avatarHands(av, ch) {
  return { palm: (side, out) => av.palm(side, out), handQuat: (side, out) => av.handQuat(side, out), fist: athleteHands(ch).fist };
}

export class Bat {
  constructor(hands, scene) {
    this.hands = hands;
    this.mesh = new THREE.Mesh(batGeometry(), new THREE.MeshStandardMaterial({ map: batTexture(), roughness: 0.45, metalness: 0.05 }));
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.local = { Left: new THREE.Vector3(), Right: new THREE.Vector3() };
    this.dir = new THREE.Vector3(0, 1, 0);
    this.knob = new THREE.Vector3();
    this.hand = "Left";
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this._L = new THREE.Vector3(); this._R = new THREE.Vector3(); this._d = new THREE.Vector3(); this._o = new THREE.Vector3();
  }

  palm(side, out) { return this.hands.palm(side, out); }
  fist(side) { return this.hands.fist(side); }

  // Call with the character in a two-handed pose (the stance): records the grip in each hand.
  calibrate() {
    this.palm("Left", this._L); this.palm("Right", this._R);
    const d = this._d.subVectors(this._R, this._L).normalize();
    for (const side of ["Left", "Right"]) {
      this.hands.handQuat(side, this._q);
      this.local[side].copy(d).applyQuaternion(this._q.invert());
    }
  }

  // Pose the bat from the character's current (world-updated) skeleton.
  update() {
    const L = this.palm("Left", this._L), R = this.palm("Right", this._R);
    const two = this._d.subVectors(R, L);
    const sep = two.length();
    two.normalize();
    const w = smooth(0.26, 0.42, sep);
    if (w > 0) {
      // Which hand still has it: the tighter fist, with some hysteresis.
      const fl = this.fist("Left"), fr = this.fist("Right");
      if (this.hand === "Left" && fr > fl + 0.6) this.hand = "Right";
      else if (this.hand === "Right" && fl > fr + 0.6) this.hand = "Left";
    } else this.hand = "Left";
    const side = this.hand;
    this.hands.handQuat(side, this._q);
    const one = this._o.copy(this.local[side]).applyQuaternion(this._q);
    this.dir.copy(two).lerp(one, w).normalize();
    // Knob: below the bottom (left) hand when two-handed; below the holding hand when one-handed.
    const hold = side === "Left" ? L : R;
    this._a.copy(L).addScaledVector(this.dir, -KNOB_BELOW);
    this._b.copy(hold).addScaledVector(this.dir, -KNOB_BELOW);
    this.knob.copy(this._a).lerp(this._b, w);
    this.mesh.position.copy(this.knob);
    this.mesh.quaternion.setFromUnitVectors(this._a.set(0, 1, 0), this.dir);
  }

  sweetSpot(out) { return out.copy(this.knob).addScaledVector(this.dir, SWEET); }
}

// Batting helmet on the head bone: a shell, a brim and the ear flap on the left (pitcher-side) ear.
export function addHelmet(ch, color) {
  const M = ch.M;
  const head = ch.bone("Head"), top = ch.bone("HeadTop_End");
  const hh = top.position.length();   // head joint -> crown, model units (cm)
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: color || 0x16306b, roughness: 0.25, metalness: 0.1 });
  const R = hh * 0.6;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), mat);
  shell.scale.set(1.0, 0.95, 1.1);
  shell.castShadow = true;
  g.add(shell);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.78, R * 0.82, R * 0.05, 20, 1, false, -Math.PI * 0.42, Math.PI * 0.84), mat);
  brim.position.set(0, -R * 0.12, R * 0.62);
  brim.rotation.x = 0.12;
  brim.castShadow = true;
  g.add(brim);
  // SphereGeometry's phi = PI is +x: the character's left in the head's rest frame.
  const flap = new THREE.Mesh(new THREE.SphereGeometry(R * 1.02, 14, 10, Math.PI * 0.72, Math.PI * 0.56, Math.PI * 0.45, Math.PI * 0.3), mat);
  flap.material = mat.clone();
  flap.material.side = THREE.DoubleSide;
  flap.scale.set(1.0, 1.1, 1.05);
  g.add(flap);
  // Logo dot.
  const logo = new THREE.Mesh(new THREE.CircleGeometry(R * 0.18, 16), new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.4 }));
  logo.position.set(0, R * 0.42, R * 0.93);
  logo.rotation.x = -0.45;
  g.add(logo);
  g.position.copy(top.position).multiplyScalar(0.52);
  g.position.z += hh * 0.04;
  head.add(g);
  return { group: g, R, hh, shell, brim, flap };
}
