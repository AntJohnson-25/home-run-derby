// The Home Run Derby park: a night game. Turf and a dirt infield, a pitching machine on the
// mound behind its L-screen, an outfield wall at real distances (the same wallR() the ball
// physics uses), sloped stands with a crowd, light towers, a video board in centre field,
// ad panels on the wall and banners on the stands, and a blimp. (HopLobby copy of the G: park.)
// All procedural (canvas textures + simple geometry); the only image is the HopLobby logo on the ads.
//
// World frame: home plate at the origin, the pitch travels from the machine (+z) towards
// the plate (-z). A right-handed batter stands on +x (the left of the screen from behind the plate),
// so +x is left field. Angles are degrees from straight-away centre, + = left field.
import * as THREE from "three";

export const DEG = Math.PI / 180;
export const FT = 3.281;                         // feet per metre
export const WALL_H = 3.0;                       // outfield wall, metres
export const MACHINE = { z: 16.6, release: new THREE.Vector3(0, 1.12, 16.25), screenZ: 15.6 };
export const BACKSTOP_Z = -17;

// The panels round the park: the game's own slogans (HopLobby's content policy: no ads, sponsorships or
// promotion of other sites, and the HopLobby logo is never dressed up as a sponsor).
const ADS = [
  { bg: "#0f2d22", fg: "#fdf8ec", acc: "#ffb000", l1: "HOME RUN DERBY", l2: "STEP UP TO THE PLATE" },
  { bg: "#13213f", fg: "#fdf8ec", acc: "#ff6a00", l1: "BEST BUCKET WINS", l2: "SAME 15 PITCHES" },
  { bg: "#1d3263", fg: "#fdf8ec", acc: "#ffb000", l1: "HOME RUN DERBY", l2: "TIME YOUR SWING" },
  { bg: "#2b1646", fg: "#fdf8ec", acc: "#ffd34d", l1: "SWING FOR THE FENCES", l2: "15 PITCHES" }
];
const IM = {};
export function loadAdImages() { return Promise.resolve(); }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (x) => x * x * (3 - 2 * x);

let seed = 11;
export function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

// Fence distance in feet for a spray angle (the foul poles are 320, dead centre 375).
export const fenceFt = (a) => 320 + 55 * Math.cos(2 * clamp(a, -45, 45) * DEG);
// Wall radius in metres at angle a. Past the foul poles the park closes in round the plate.
export function wallR(a) {
  const m = Math.abs(a);
  if (m <= 45) return fenceFt(a) / FT;
  const pole = fenceFt(45) / FT;
  if (m <= 100) return pole + (62 - pole) * smooth((m - 45) / 55);
  return 62 + (46 - 62) * (m - 100) / 80;
}
// Height of the seating at r metres past the wall (the ball vanishes into it).
export const standY = (past) => WALL_H + 0.15 + Math.min(past, 24) * 0.5;

function canvasTex(w, h, draw, rx, ry) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (rx) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry || rx); }
  return t;
}
function speckle(g, w, h, base, cols, n, rmax) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(rnd() * cols.length) | 0];
    const r = 0.5 + rnd() * rmax;
    g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, 7); g.fill();
  }
}

export const tex = {};
export function makeTextures() {
  tex.grass = canvasTex(256, 256, (g, w, h) => {
    // Mowed stripes.
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#3f7d32" : "#4a8c38"; g.fillRect(0, i * h / 8, w, h / 8); }
    for (let i = 0; i < 1500; i++) { g.fillStyle = ["rgba(20,50,15,0.25)", "rgba(120,170,80,0.18)"][i % 2]; g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
  }, 40, 40);
  tex.dirt = canvasTex(256, 256, (g, w, h) => speckle(g, w, h, "#a8744a", ["#9a6941", "#b7855a", "#8c5d38", "#c39468", "#7e5434"], 3200, 1.6), 6);
  tex.net = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(25,25,25,0.95)"; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke();
    }
  });
  tex.net.wrapS = tex.net.wrapT = THREE.RepeatWrapping;
  tex.ball = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = "#f6f2e6"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#c8242c"; g.lineWidth = 2;
    for (const s of [0, 1]) {
      g.beginPath();
      for (let x = 0; x <= w; x += 2) { const y = h / 2 + Math.sin(x / w * Math.PI * 2 + s * Math.PI) * h * 0.28; x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
  });
  // The crowd: dark stands with a few hundred coloured shirts and the odd camera flash.
  tex.crowd = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = "#141b36"; g.fillRect(0, 0, w, h);
    const shirts = ["#c8242c", "#2b59c3", "#f2efe4", "#e9c84a", "#3a3f55", "#2f8f5a", "#d9722b", "#7d4cc2"];
    for (let row = 0; row < h / 9; row++) {
      g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, row * 9 + 7, w, 2);
      for (let x = rnd() * 6; x < w; x += 5 + rnd() * 4) {
        g.fillStyle = shirts[(rnd() * shirts.length) | 0];
        g.fillRect(x, row * 9 + 2, 4, 5);
        g.fillStyle = "#cfa07a"; g.fillRect(x + 0.5, row * 9, 3, 2.5);
      }
    }
    for (let i = 0; i < 70; i++) { g.fillStyle = "rgba(255,255,255,0.95)"; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  }, 1, 1);
  tex.crowd.wrapS = THREE.RepeatWrapping;
  tex.glow = canvasTex(64, 64, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,0.55)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
}

export function buildSky(scene) {
  const geo = new THREE.SphereGeometry(400, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x02050f) }, mid: { value: new THREE.Color(0x0a1536) }, horizon: { value: new THREE.Color(0x4a3a5c) } },
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; varying vec3 vP; void main(){ float y = clamp(normalize(vP).y, 0.0, 1.0); vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, y)); c = mix(c, top, smoothstep(0.12, 0.75, y)); gl_FragColor = vec4(c, 1.0); }"
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -2;
  scene.add(sky);
  // Stars.
  const n = 320, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, e = 0.12 + rnd() * 1.4;
    pos[i * 3] = Math.cos(a) * Math.cos(e) * 380; pos[i * 3 + 1] = Math.sin(e) * 380; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 380;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.7, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
  stars.renderOrder = -1;
  scene.add(stars);
}

export function buildLights(scene) {
  scene.add(new THREE.HemisphereLight(0xa9bdff, 0x24361a, 1.05));
  // Stadium lights: one strong key from high behind the plate, throwing the batter's shadow across the box.
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.5);
  sun.position.set(7, 30, -16);
  sun.target.position.set(0, 0, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const s = sun.shadow.camera;
  s.left = -7; s.right = 7; s.top = 9; s.bottom = -9; s.near = 5; s.far = 70;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  // Cool fill from the field side so the batter's front isn't lost.
  const fill = new THREE.DirectionalLight(0xc2d4ff, 0.75);
  fill.position.set(-6, 5, 22);
  scene.add(fill);
  return sun;
}

const box = (w, h, d, mat, x, y, z, parent) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
};
const cyl = (r, len, mat, parent, seg) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg || 8), mat);
  m.castShadow = true;
  parent.add(m);
  return m;
};
// A cylinder from a to b.
function rod(a, b, r, mat, parent) {
  const len = a.distanceTo(b);
  const m = cyl(r, len, mat, parent);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}
// A ribbon round the park between two profiles: radius r0f(a) at height y0 to r1f(a) at y1.
// The u coordinate runs along the arc in units of uLen metres.
function ring(parent, mat, a0, a1, da, r0f, y0, r1f, y1, uLen) {
  const pos = [], uv = [], idx = [];
  const n = Math.max(1, Math.round((a1 - a0) / da));
  let arc = 0, px = 0, pz = 0;
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n, ar = a * DEG, s = Math.sin(ar), c = Math.cos(ar);
    const R0 = r0f(a), R1 = r1f(a);
    if (i) arc += Math.hypot(R0 * s - px, R0 * c - pz);
    px = R0 * s; pz = R0 * c;
    pos.push(R0 * s, y0, R0 * c, R1 * s, y1, R1 * c);
    uv.push(arc / uLen, 0, arc / uLen, 1);
    if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

// ---- the field -------------------------------------------------------------------------------
export function buildGround(scene) {
  const flat = (geo, mat, x, y, z, layer) => {
    mat.polygonOffset = true; mat.polygonOffsetFactor = -layer; mat.polygonOffsetUnits = -layer;
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshStandardMaterial({ map: tex.grass, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.01;
  grass.receiveShadow = true;
  scene.add(grass);
  const dirtMat = () => new THREE.MeshStandardMaterial({ map: tex.dirt, roughness: 1 });
  // Infield skin, then the inner grass diamond on top of it, then the base paths.
  flat(new THREE.CircleGeometry(29, 56), dirtMat(), 0, 0.004, 17.5, 1);
  const diamond = new THREE.Shape();
  diamond.moveTo(0, 9); diamond.lineTo(15.5, 19.4); diamond.lineTo(0, 31); diamond.lineTo(-15.5, 19.4); diamond.closePath();
  // The shape is drawn in (x, z); the -90 degree turn would send its y to -z, so flip it back.
  // ShapeGeometry's uv is in metres, so tile the mowing at the field's own scale (one tile = 420 / 40 m).
  const gt = tex.grass.clone();
  gt.repeat.set(40 / 420, 40 / 420);
  gt.needsUpdate = true;
  const inner = flat(new THREE.ShapeGeometry(diamond), new THREE.MeshStandardMaterial({ map: gt, roughness: 1, color: 0xbfd8b0, side: THREE.DoubleSide }), 0, 0.006, 0, 2);
  inner.scale.y = -1;
  flat(new THREE.CircleGeometry(5.2, 28), dirtMat(), 0, 0.008, 0.1, 3);          // home plate circle
  flat(new THREE.CircleGeometry(2.9, 24), dirtMat(), 0, 0.008, MACHINE.z + 0.4, 3); // the mound
  for (const [x, z] of [[19.4, 19.4], [-19.4, 19.4], [0, 38.8]]) flat(new THREE.CircleGeometry(3, 20), dirtMat(), x, 0.008, z, 3);
  // Warning track along the wall.
  ring(scene, (() => { const m = dirtMat(); m.side = THREE.DoubleSide; return m; })(), -45, 45, 3, (a) => wallR(a) - 6, 0.012, (a) => wallR(a), 0.012, 8);

  // Chalk: batter's boxes, foul lines, bases, plate, the rubber.
  const chalk = new THREE.MeshBasicMaterial({ color: 0xf4f1e8, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const line = (x, z, w, d, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), chalk);
    m.rotation.x = -Math.PI / 2;
    if (rot) m.rotation.z = rot;
    m.position.set(x, 0.014, z);
    scene.add(m);
  };
  for (const s of [-1, 1]) {
    const x0 = s * 0.37, x1 = s * 1.59, z0 = -0.9, z1 = 0.95;
    line((x0 + x1) / 2, z0, 1.22, 0.05); line((x0 + x1) / 2, z1, 1.22, 0.05);
    line(x0, (z0 + z1) / 2, 0.05, 1.85); line(x1, (z0 + z1) / 2, 0.05, 1.85);
  }
  const L = wallR(45) + 1;
  for (const s of [-1, 1]) line(s * L / 2 * Math.SQRT1_2, L / 2 * Math.SQRT1_2, 0.1, L, s * Math.PI / 4);
  const plate = new THREE.Shape();
  plate.moveTo(-0.216, 0.216); plate.lineTo(0.216, 0.216); plate.lineTo(0.216, 0); plate.lineTo(0, -0.216); plate.lineTo(-0.216, 0); plate.closePath();
  const pm = new THREE.Mesh(new THREE.ExtrudeGeometry(plate, { depth: 0.015, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0xf7f5ee, roughness: 0.6 }));
  pm.rotation.x = Math.PI / 2;
  pm.position.set(0, 0.03, 0);
  pm.receiveShadow = true;
  scene.add(pm);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0xf7f5ee, roughness: 0.6 });
  for (const [x, z] of [[19.4, 19.4], [-19.4, 19.4], [0, 38.8]]) box(0.38, 0.1, 0.38, baseMat, x, 0.05, z, scene).rotation.y = Math.PI / 4;
  box(0.6, 0.03, 0.15, baseMat, 0, 0.03, MACHINE.z + 1.1, scene);
}

// ---- the machine ---------------------------------------------------------------------------------
// The pitching machine (two wheels on a tripod) behind an L-screen. Returns the parts the game animates.
export function buildMachine(scene) {
  const g = new THREE.Group();
  g.position.set(0, 0, MACHINE.z);
  const black = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6, metalness: 0.3 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1f5fb8, roughness: 0.45, metalness: 0.3 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.35, metalness: 0.8 });
  // Tripod.
  const hub = new THREE.Vector3(0, 0.78, 0);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + Math.PI / 2;
    rod(hub, new THREE.Vector3(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55), 0.025, black, g);
  }
  rod(hub, new THREE.Vector3(0, 0.98, 0), 0.04, silver, g);
  // Wheel housing: two wheels side by side, the ball passes between them.
  const wheels = [];
  const y = MACHINE.release.y, zl = MACHINE.release.z - MACHINE.z;
  for (const s of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(s * 0.21, y, zl + 0.05);
    const tire = cyl(0.17, 0.08, tyre, w, 20);
    tire.rotation.z = Math.PI / 2;
    const rim = cyl(0.1, 0.09, silver, w, 12);
    rim.rotation.z = Math.PI / 2;
    const spoke = box(0.095, 0.03, 0.18, silver, 0, 0, 0, w);
    spoke.castShadow = false;
    w.rotation.z = Math.PI / 2;
    g.add(w);
    wheels.push(w);
    const motor = cyl(0.07, 0.2, blue, g, 12);
    motor.position.set(s * 0.21, y - 0.15, zl + 0.05);
  }
  box(0.62, 0.05, 0.3, blue, 0, y - 0.05, zl + 0.05, g);
  // Feed chute (from behind and above).
  rod(new THREE.Vector3(0, y + 0.03, zl + 0.2), new THREE.Vector3(0, y + 0.45, zl + 0.7), 0.05, silver, g);
  // Hopper of balls.
  const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.16, 0.34, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x2d2f33, side: THREE.DoubleSide, roughness: 0.7 }));
  hop.position.set(0, y + 0.62, zl + 0.78);
  g.add(hop);
  const ballMat = new THREE.MeshStandardMaterial({ map: tex.ball, roughness: 0.6 });
  const bg = new THREE.SphereGeometry(0.037, 10, 8);
  for (let i = 0; i < 14; i++) {
    const b = new THREE.Mesh(bg, ballMat);
    const a = rnd() * 7, r = rnd() * 0.22;
    b.position.set(Math.cos(a) * r, y + 0.72 + rnd() * 0.08, zl + 0.78 + Math.sin(a) * r);
    g.add(b);
  }
  // Ready light on a mast.
  rod(new THREE.Vector3(0.36, 0, zl + 0.4), new THREE.Vector3(0.36, 1.6, zl + 0.4), 0.018, black, g);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), new THREE.MeshStandardMaterial({ color: 0x441111, emissive: 0x000000, roughness: 0.3 }));
  light.position.set(0.36, 1.66, zl + 0.4);
  g.add(light);
  scene.add(g);

  // L-screen: a steel frame with net, the low corner cut out where the ball comes through.
  const sg = new THREE.Group();
  sg.position.set(0, 0, MACHINE.screenZ);
  const frame = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.5, metalness: 0.5 });
  const P = (x, y) => new THREE.Vector3(x, y, 0);
  const pts = [P(-1.0, 0), P(-1.0, 2.1), P(1.0, 2.1), P(1.0, 0), P(0.28, 0), P(0.28, 1.35), P(-0.28, 1.35), P(-0.28, 0)];
  for (const [a, b] of [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7]]) rod(pts[a], pts[b], 0.03, frame, sg);
  const netM = new THREE.MeshBasicMaterial({ map: tex.net, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const panel = (x0, x1, y0, y1) => {
    const t = tex.net.clone(); t.needsUpdate = true; t.repeat.set((x1 - x0) / 0.4, (y1 - y0) / 0.4);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), netM.clone());
    m.material.map = t;
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    sg.add(m);
  };
  panel(-1.0, -0.28, 0, 2.1); panel(0.28, 1.0, 0, 2.1); panel(-0.28, 0.28, 1.35, 2.1);
  // Sponsor banners hung on the screen's two side panels (face the batter).
  const bt = adTexture(ADS[1], 256, 512, true);
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 1.32), new THREE.MeshBasicMaterial({ map: bt }));
    m.position.set(s * 0.64, 1.0, -0.035);
    m.rotation.y = Math.PI;
    sg.add(m);
  }
  box(2.0, 0.08, 0.08, new THREE.MeshStandardMaterial({ color: 0x1f5fb8, roughness: 0.6 }), 0, 2.1, 0, sg);
  scene.add(sg);
  return { wheels, light };
}

// ---- sponsor art ---------------------------------------------------------------------------------
const FONT = "'Copperplate Gothic Bold','Copperplate Gothic',Copperplate,'Arial Black',Impact,sans-serif";
function fitText(g, text, x, y, maxW, px, weight) {
  g.font = `${weight || 900} ${px}px ${FONT}`;
  while (g.measureText(text).width > maxW && px > 8) { px -= 2; g.font = `${weight || 900} ${px}px ${FONT}`; }
  g.fillText(text, x, y);
}
function drawAd(g, w, h, ad, portrait) {
  g.fillStyle = ad.bg; g.fillRect(0, 0, w, h);
  g.fillStyle = ad.acc; g.fillRect(0, 0, w, Math.max(4, h * 0.05)); g.fillRect(0, h - Math.max(4, h * 0.05), w, Math.max(4, h * 0.05));
  g.textAlign = "center"; g.textBaseline = "middle";
  if (ad.img) {
    // A logo ad: the picture alone, centred and never squashed (or its name if it didn't load).
    const im = IM[ad.img], bw = w * 0.88, bh = h * (portrait ? 0.5 : 0.76);
    if (im) {
      const k = Math.min(bw / im.width, bh / im.height), iw = im.width * k, ih = im.height * k;
      g.drawImage(im, (w - iw) / 2, (h - ih) / 2, iw, ih);
    } else { g.fillStyle = "#fdf8ec"; fitText(g, ad.alt || "", w / 2, h / 2, bw, h * 0.4); }
    return;
  }
  if (portrait) {
    g.fillStyle = ad.fg; fitText(g, ad.l1, w / 2, h * 0.45, w * 0.9, 90);
    g.fillStyle = ad.acc; fitText(g, ad.l2, w / 2, h * 0.6, w * 0.86, 30);
    return;
  }
  const cx = w / 2, mw = w * 0.92;
  g.fillStyle = ad.fg; fitText(g, ad.l1, cx, h * 0.40, mw, h * 0.34);
  g.fillStyle = ad.acc; fitText(g, ad.l2, cx, h * 0.72, mw, h * 0.2, 700);
}
function adTexture(ad, w, h, portrait) {
  return canvasTex(w, h, (g) => drawAd(g, w, h, ad, portrait));
}

// ---- the stadium ----------------------------------------------------------------------------------
// Returns { board(state) redraws the video board, tick(t) moves the blimp }.
export function buildStadium(scene) {
  const g = new THREE.Group();
  scene.add(g);
  // Wall: padded green with a yellow cap, ring-wide so it also closes the foul sides.
  ring(g, new THREE.MeshStandardMaterial({ color: 0x14452b, roughness: 0.9, side: THREE.DoubleSide }), -180, 180, 3, wallR, 0, wallR, WALL_H, 10);
  ring(g, new THREE.MeshBasicMaterial({ color: 0xe9c84a, side: THREE.DoubleSide }), -180, 180, 3, wallR, WALL_H, wallR, WALL_H + 0.18, 10);
  // Stands: the crowd slope, then the dark back wall and its rim.
  const crowdMat = new THREE.MeshBasicMaterial({ map: tex.crowd, color: 0xb4b9d0, side: THREE.DoubleSide });
  ring(g, crowdMat, -180, 180, 3, wallR, WALL_H + 0.18, (a) => wallR(a) + 24, 15.2, 40);
  ring(g, new THREE.MeshStandardMaterial({ color: 0x1b2036, roughness: 0.8, side: THREE.DoubleSide }), -180, 180, 3, (a) => wallR(a) + 24, 15.2, (a) => wallR(a) + 24, 23, 10);
  ring(g, new THREE.MeshStandardMaterial({ color: 0x2a3050, roughness: 0.7, side: THREE.DoubleSide }), -180, 180, 3, (a) => wallR(a) + 24, 23, (a) => wallR(a) + 18, 23, 10);

  // Sponsor panels along the outfield wall, four designs repeating.
  const adTex = ADS.map((ad) => adTexture(ad, 768, 256, false));
  const adMat = adTex.map((t) => new THREE.MeshBasicMaterial({ map: t, color: 0xe6e6ee }));
  const pw = 7.2, ph = 2.4;
  let k = 0;
  for (let a = -43; a <= 43.01; k++) {
    const R = wallR(a) - 0.9, ar = a * DEG;   // flat panel on a curved, faceted wall: stand off so the ends clear it
    const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), adMat[k % ADS.length]);
    m.position.set(Math.sin(ar) * R, 0.4 + ph / 2, Math.cos(ar) * R);
    m.rotation.y = ar + Math.PI;
    g.add(m);
    a += (pw + 0.5) / R / DEG;   // the next panel starts where this one ends, at this radius
  }
  // Big banners on the stands' back wall.
  const bannerTex = ADS.map((ad) => adTexture(ad, 1024, 256, false));
  let bi = 0;
  for (const a of [-40, -27, -14, 14, 27, 40]) {
    // Flat banners on a curved wall: the edges swing away from the batter, so hang them well in front
    // of the back wall (and not too wide) or the wall swallows the ends of the text.
    const R = wallR(a) + 19.5, ar = a * DEG;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(18, 4.5), new THREE.MeshBasicMaterial({ map: bannerTex[bi++ % ADS.length], color: 0xe6e6ee }));
    m.position.set(Math.sin(ar) * R, 19, Math.cos(ar) * R);
    m.rotation.y = ar + Math.PI;
    g.add(m);
  }

  // The video board in centre field.
  const BW = 1024, BH = 384;
  const bc = document.createElement("canvas");
  bc.width = BW; bc.height = BH;
  const bt = new THREE.CanvasTexture(bc);
  bt.colorSpace = THREE.SRGBColorSpace;
  bt.anisotropy = 4;
  const Rb = wallR(0) + 15;
  const bm = new THREE.Mesh(new THREE.PlaneGeometry(40, 15), new THREE.MeshBasicMaterial({ map: bt, fog: false }));
  bm.position.set(0, 25, Rb);
  bm.rotation.y = Math.PI;
  g.add(bm);
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a414c, roughness: 0.6, metalness: 0.5 });
  box(41.2, 0.8, 0.8, steel, 0, 32.6, Rb + 0.4, g); box(41.2, 0.8, 0.8, steel, 0, 17.4, Rb + 0.4, g);
  box(0.8, 15.6, 0.8, steel, -20.6, 25, Rb + 0.4, g); box(0.8, 15.6, 0.8, steel, 20.6, 25, Rb + 0.4, g);
  for (const x of [-14, 14]) box(1, 14, 1, steel, x, 10.4, Rb + 0.6, g);
  const state = { pitch: 0, exit: 0, last: null, hr: 0, longest: 0, hits: 0, n: 0, total: 0, score: 0 };
  function drawBoard(upd) {
    Object.assign(state, upd || {});
    const c = bc.getContext("2d");
    c.fillStyle = "#05070d"; c.fillRect(0, 0, BW, BH);
    // Header band.
    c.fillStyle = "#ff6a00"; c.fillRect(0, 0, BW, 62);
    c.fillStyle = "#13213f"; c.textBaseline = "middle"; c.textAlign = "left";
    c.font = `900 40px ${FONT}`; c.fillText("HOME RUN DERBY", 24, 33);
    c.textAlign = "right"; c.font = `700 20px ${FONT}`; c.fillText("15 PITCHES · BEST BUCKET WINS", BW - 24, 33);
    const L = state.last;
    c.textAlign = "center";
    c.fillStyle = "#8aa0b4"; c.font = "700 24px Arial, sans-serif"; c.fillText(L ? L.kind : "LAST HIT", 580, 100);
    c.fillStyle = L && L.hr ? "#ffd23f" : "#ffffff";
    c.font = "900 130px 'Courier New', monospace";
    c.fillText(L ? String(L.dist) : "---", 540, 188);
    c.font = "900 44px Arial Black, Impact, sans-serif"; c.fillStyle = "#ffb000"; c.fillText("FT", 790, 214);
    c.fillStyle = "#47e06a"; c.font = "700 28px 'Courier New', monospace";
    c.fillText(L ? `${L.ev} MPH EXIT  ·  ${L.la}° LAUNCH` : "WAITING ON A SWING", 580, 262);
    // Pitch speed, left column.
    c.fillStyle = "#8aa0b4"; c.font = "700 20px Arial, sans-serif"; c.fillText("PITCH", 76, 176);
    c.fillStyle = "#ffb000"; c.font = "900 64px 'Courier New', monospace"; c.fillText(state.pitch ? String(state.pitch) : "--", 76, 226);
    // Bottom stat strip.
    c.fillStyle = "#0d1426"; c.fillRect(0, 296, BW, 88);
    const cells = [["HOME RUNS", state.hr], ["HITS", `${state.hits} / ${state.n}`], ["LONGEST", state.longest ? state.longest + " FT" : "--"], ["TOTAL DIST", state.total ? state.total.toLocaleString("en-US") + " FT" : "--"]];
    cells.forEach(([k2, v], i) => {
      const x = BW / 8 + i * BW / 4;
      c.fillStyle = "#8aa0b4"; c.font = "700 20px Arial, sans-serif"; c.fillText(k2, x, 318);
      c.fillStyle = "#ffffff"; c.font = "900 38px 'Courier New', monospace"; c.fillText(String(v), x, 358);
    });
    bt.needsUpdate = true;
  }
  drawBoard();

  // Light towers round the rim.
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
  const glow = new THREE.SpriteMaterial({ map: tex.glow, color: 0xfff0c0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.9 });
  for (const a of [-155, -105, -62, -28, 28, 62, 105, 155]) {
    const R = wallR(a) + 27, ar = a * DEG;
    const t = new THREE.Group();
    t.position.set(Math.sin(ar) * R, 0, Math.cos(ar) * R);
    const pole = cyl(0.5, 40, steel, t); pole.position.y = 20;
    const bank = new THREE.Mesh(new THREE.BoxGeometry(9, 5.4, 0.6), steel);
    bank.position.y = 41; t.add(bank);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.7, 10), lampMat);
      l.position.set(-3.4 + i * 1.7, 39.6 + j * 1.7, 0.32);
      t.add(l);
    }
    const s = new THREE.Sprite(glow);
    s.scale.set(26, 16, 1); s.position.set(0, 41, 1.2);
    t.add(s);
    t.lookAt(0, 40, 10);
    g.add(t);
  }
  // Foul poles.
  const yellow = new THREE.MeshBasicMaterial({ color: 0xe9c84a });
  for (const s of [-1, 1]) {
    const r = wallR(45) - 0.2;
    const pole = cyl(0.12, 16, yellow, g, 6);
    pole.position.set(s * r * Math.SQRT1_2, 8, r * Math.SQRT1_2);
  }

  // A backstop behind the plate (the camera sits in front of it), with a sponsor banner on the padding.
  const bs = new THREE.Group();
  const netM = new THREE.MeshBasicMaterial({ map: tex.net.clone(), transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.8 });
  netM.map.repeat.set(30 / 0.5, 8 / 0.5); netM.map.needsUpdate = true;
  const nm = new THREE.Mesh(new THREE.PlaneGeometry(30, 8), netM);
  nm.position.set(0, 5.5, BACKSTOP_Z);
  bs.add(nm);
  // One 3.75:1 panel per sponsor (the texture's own aspect), so nothing is squashed or cropped.
  // Two rows of four across the 30 m net.
  const padTex = ADS.map((ad) => adTexture(ad, 1200, 320, false));
  padTex.forEach((t, i) => {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 2), new THREE.MeshBasicMaterial({ map: t }));
    pad.position.set(((i % 4) - 1.5) * 7.5, 1 + Math.floor(i / 4) * 2, BACKSTOP_Z + 0.02);
    bs.add(pad);
  });
  g.add(bs);

  // The blimp, with a sponsor on each flank.
  const blimp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ color: 0xdfe3ee, roughness: 0.6, emissive: 0x30343f }));
  body.scale.set(16, 4.6, 4.6);
  blimp.add(body);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x13213f, roughness: 0.6 });
  box(4.5, 6.6, 0.3, finMat, -14, 0, 0, blimp); box(4.5, 0.3, 6.6, finMat, -14, 0, 0, blimp);
  // Each flank is wide enough to read but narrow enough to sit clear of the hull's taper, and
  // stands off the hull (radius 4.6) so the body can't swallow the middle of the panel.
  const blimpAds = [ADS[0], ADS[3]].map((ad) => adTexture(ad, 768, 256, false));
  [1, -1].forEach((s, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 4), new THREE.MeshBasicMaterial({ map: blimpAds[i] }));
    m.position.set(0, 0.3, s * 4.75);
    m.rotation.y = s > 0 ? 0 : Math.PI;
    blimp.add(m);
  });
  blimp.position.set(-50, 70, 190);
  g.add(blimp);

  return {
    board: drawBoard,
    tick: (t) => { blimp.position.x = -50 + Math.sin(t * 0.03) * 70; blimp.position.y = 70 + Math.sin(t * 0.11) * 2; blimp.rotation.z = Math.sin(t * 0.11) * 0.02; }
  };
}

export function ballMaterial() { return new THREE.MeshStandardMaterial({ map: tex.ball, roughness: 0.55 }); }
