// The ball's 1990s video-game look: a highlighter glow so you can follow it, and once it's hit
// a fireball with a flame tail (white-hot core, yellow, orange, red, smoke). Plus the floating
// distance flags left where each hit landed. Everything is additive sprites sized by distance
// to the camera, so the ball stays visible a hundred metres out.
import * as THREE from "three";

const lerp = (a, b, t) => a + (b - a) * t;
const FLAME = [[1.0, 0.92, 0.45], [1.0, 0.68, 0.15], [1.0, 0.38, 0.06], [0.85, 0.14, 0.03], [0.3, 0.05, 0.03]];
function flameColor(u, out) {
  const x = Math.min(0.9999, Math.max(0, u)) * (FLAME.length - 1), i = Math.floor(x), f = x - i;
  const a = FLAME[i], b = FLAME[i + 1];
  return out.setRGB(lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f));
}

export class BallFX {
  constructor(scene, camera, glowTex) {
    this.cam = camera;
    this.mode = "off";
    this.power = 1;
    this.clock = 0;
    this.hist = [];            // newest first: { t, x, y, z }
    const add = (color, op) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, opacity: op, depthWrite: false, fog: false }));
      s.visible = false; s.renderOrder = 10;
      scene.add(s);
      return s;
    };
    this.halo = add(0xd8ff2a, 0.55);     // the highlighter
    this.core = add(0xfffbe0, 0.95);
    this.puffs = [];
    for (let i = 0; i < 26; i++) this.puffs.push(add(0xffaa22, 0.8));
    this._c = new THREE.Color();
    this._p = new THREE.Vector3();
  }
  // mode: "pitch" (highlighter + short comet) or "hit" (fireball). power 0..1 scales the fireball.
  start(mode, power) {
    this.mode = mode;
    this.power = power == null ? 1 : power;
    if (mode === "pitch") this.hist.length = 0;
  }
  stop() {
    this.mode = "off";
    this.halo.visible = this.core.visible = false;
    for (const p of this.puffs) p.visible = false;
    this.hist.length = 0;
  }
  at(age, out) {
    // Position `age` seconds ago, interpolated through the history.
    const h = this.hist;
    if (!h.length) return null;
    const t = this.clock - age;
    for (let i = 0; i < h.length; i++) {
      if (h[i].t <= t) {
        const a = h[i], b = h[i - 1] || a;
        const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
        return out.set(lerp(a.x, b.x, k), lerp(a.y, b.y, k), lerp(a.z, b.z, k));
      }
    }
    const l = h[h.length - 1];
    return out.set(l.x, l.y, l.z);
  }
  update(dt, pos, visible) {
    this.clock += dt;
    if (this.mode === "off" || !visible) { if (this.halo.visible) this.stop(); return; }
    this.hist.unshift({ t: this.clock, x: pos.x, y: pos.y, z: pos.z });
    while (this.hist.length > 90 || (this.hist.length > 2 && this.clock - this.hist[this.hist.length - 1].t > 0.9)) this.hist.pop();
    const hit = this.mode === "hit", pw = this.power;
    const d = this.cam.position.distanceTo(pos);
    // Sprite size: never smaller than the ball's glow, growing with distance so it stays a few pixels across.
    const unit = hit ? Math.max(0.3 + 0.16 * pw, d * (0.02 + 0.008 * pw)) : Math.max(0.12, d * 0.011);
    const flick = 1 + Math.sin(this.clock * 55) * 0.08 + Math.sin(this.clock * 23) * 0.06;
    this.halo.visible = this.core.visible = true;
    this.halo.position.copy(pos); this.core.position.copy(pos);
    if (hit) {
      this.halo.material.color.setRGB(1, 0.62 + 0.2 * pw, 0.12);
      this.halo.scale.setScalar(unit * 2.6 * flick);
      this.core.scale.setScalar(unit * 0.9);
    } else {
      this.halo.material.color.set(0xd8ff2a);
      this.halo.scale.setScalar(unit * 4.2);
      this.core.scale.setScalar(unit * 1.4);
    }
    const n = hit ? this.puffs.length : 7, span = hit ? 0.5 + 0.2 * pw : 0.11;
    for (let i = 0; i < this.puffs.length; i++) {
      const s = this.puffs[i];
      if (i >= n) { s.visible = false; continue; }
      const u = (i + 1) / n;
      const p = this.at(u * span, this._p);
      if (!p) { s.visible = false; continue; }
      s.visible = true;
      const dd = this.cam.position.distanceTo(p);
      const base = hit ? Math.max(0.3 + 0.16 * pw, dd * (0.02 + 0.008 * pw)) : Math.max(0.12, dd * 0.011);
      // Each puff wobbles sideways a little, more towards the tail: the flame flickers.
      const w = base * (0.25 + u * 0.7);
      s.position.set(p.x + Math.sin(this.clock * 31 + i * 2.1) * w, p.y + Math.cos(this.clock * 27 + i * 1.3) * w, p.z + Math.sin(this.clock * 19 + i * 3.7) * w * 0.6);
      s.scale.setScalar(base * (hit ? (2.4 - u * 1.3) : (1.6 - u * 0.9)) * (0.85 + 0.3 * Math.abs(Math.sin(this.clock * 38 + i * 1.9))));
      if (hit) { flameColor(u * 0.95, this._c); s.material.color.copy(this._c); s.material.opacity = Math.pow(1 - u, 0.75) * (0.62 + 0.33 * pw); }
      else { s.material.color.setRGB(1, lerp(1, 0.5, u), lerp(0.4, 0.05, u)); s.material.opacity = (1 - u) * 0.6; }
    }
  }
}

// Flags left where each hit landed: "412 FT" on a gold (home run) or white tag, sized to read at any distance.
export class Flags {
  constructor(scene, camera) { this.scene = scene; this.cam = camera; this.list = []; }
  add(text, pos, gold) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 96;
    const g = c.getContext("2d");
    g.fillStyle = gold ? "rgba(255,196,40,0.95)" : "rgba(255,255,255,0.92)";
    g.strokeStyle = gold ? "#7a4a00" : "#1d3263"; g.lineWidth = 6;
    g.beginPath(); g.roundRect(6, 6, 244, 84, 18); g.fill(); g.stroke();
    g.fillStyle = gold ? "#3a2200" : "#13213f"; g.font = "900 54px Impact, 'Arial Black', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 128, 52);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
    s.position.copy(pos);
    s.renderOrder = 9;
    this.scene.add(s);
    this.list.push(s);
    this.update();
    while (this.list.length > 15) this.drop(this.list.shift());
  }
  drop(s) { this.scene.remove(s); s.material.map.dispose(); s.material.dispose(); }
  clear() { for (const s of this.list) this.drop(s); this.list.length = 0; }
  update() {
    for (const s of this.list) { const k = Math.min(7, Math.max(0.7, this.cam.position.distanceTo(s.position) * 0.036)); s.scale.set(k * 2.6, k, 1); }
  }
}
