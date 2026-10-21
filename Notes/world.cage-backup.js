// The batting cage: turf, the batter's box and plate, a net tunnel on steel arches, the
// pitching machine behind its L-screen, a radar sign, and a ballpark at golden hour outside.
// All procedural (canvas textures + simple geometry), no image files.
//
// World frame: home plate at the origin, the pitch travels from the machine (+z) towards
// the plate (-z). A right-handed batter stands on +x (the left of the screen from behind the plate).
import * as THREE from "three";

export const CAGE = { w: 5.2, h: 3.9, back: -3.1, end: 20.5 };   // net tunnel, metres
export const MACHINE = { z: 16.6, release: new THREE.Vector3(0, 1.12, 16.25), screenZ: 15.6 };

let seed = 11;
export function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

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
  tex.turf = canvasTex(256, 256, (g, w, h) => speckle(g, w, h, "#3f7d36", ["#468a3b", "#38712f", "#4f9442", "#356b2d"], 3200, 1.2), 14, 40);
  tex.grass = canvasTex(256, 256, (g, w, h) => {
    // Mowed stripes.
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#4c8a3a" : "#56973f"; g.fillRect(0, i * h / 8, w, h / 8); }
    for (let i = 0; i < 1500; i++) { g.fillStyle = ["rgba(30,60,20,0.25)", "rgba(120,170,80,0.2)"][i % 2]; g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
  }, 30, 30);
  tex.dirt = canvasTex(256, 256, (g, w, h) => speckle(g, w, h, "#a8744a", ["#9a6941", "#b7855a", "#8c5d38", "#c39468", "#7e5434"], 3200, 1.6), 2);
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
  tex.fence = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = "#1f4a33"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#e9c84a"; g.fillRect(0, 0, w, 5);
    g.fillStyle = "rgba(255,255,255,0.8)"; g.font = "bold 30px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("375", w * 0.2, h * 0.58); g.fillText("400", w * 0.5, h * 0.58); g.fillText("375", w * 0.8, h * 0.58);
  });
}

export function buildSky(scene) {
  const geo = new THREE.SphereGeometry(400, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3f7fd0) }, horizon: { value: new THREE.Color(0xffd9a8) } },
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 2.4, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.6)), 1.0); }"
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  scene.add(sky);
}

export function buildLights(scene) {
  scene.add(new THREE.HemisphereLight(0xdbeaff, 0x5a6b3a, 1.1));
  // Low evening sun from behind the batter's left, so the shadow falls across the box.
  const sun = new THREE.DirectionalLight(0xffe2b8, 2.7);
  sun.position.set(9, 11, -7);
  sun.target.position.set(0, 0, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const s = sun.shadow.camera;
  s.left = -6; s.right = 6; s.top = 8; s.bottom = -8; s.near = 1; s.far = 40;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  // Soft fill from the plate side, so his face isn't lost against the low sun.
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.7);
  fill.position.set(-6, 4, 2);
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

export function buildGround(scene) {
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ map: tex.grass, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.01;
  grass.receiveShadow = true;
  scene.add(grass);
  // Turf runner inside the cage.
  const turf = new THREE.Mesh(new THREE.PlaneGeometry(CAGE.w, CAGE.end - CAGE.back), new THREE.MeshStandardMaterial({ map: tex.turf, roughness: 1 }));
  turf.rotation.x = -Math.PI / 2;
  turf.position.set(0, 0, (CAGE.end + CAGE.back) / 2);
  turf.receiveShadow = true;
  scene.add(turf);
  // Dirt around the plate, chalk boxes, home plate.
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(2.3, 40), new THREE.MeshStandardMaterial({ map: tex.dirt, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.set(0, 0.003, 0.1);
  dirt.receiveShadow = true;
  scene.add(dirt);
  const chalk = new THREE.MeshBasicMaterial({ color: 0xf4f1e8, polygonOffset: true, polygonOffsetFactor: -4 });
  const line = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), chalk);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.006, z);
    scene.add(m);
  };
  for (const s of [-1, 1]) {
    const x0 = s * 0.37, x1 = s * 1.59, z0 = -0.9, z1 = 0.95;
    line((x0 + x1) / 2, z0, 1.22, 0.05); line((x0 + x1) / 2, z1, 1.22, 0.05);
    line(x0, (z0 + z1) / 2, 0.05, 1.85); line(x1, (z0 + z1) / 2, 0.05, 1.85);
  }
  const plate = new THREE.Shape();
  plate.moveTo(-0.216, 0.216); plate.lineTo(0.216, 0.216); plate.lineTo(0.216, 0); plate.lineTo(0, -0.216); plate.lineTo(-0.216, 0); plate.closePath();
  const pm = new THREE.Mesh(new THREE.ExtrudeGeometry(plate, { depth: 0.015, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0xf7f5ee, roughness: 0.6 }));
  pm.rotation.x = Math.PI / 2;
  pm.position.set(0, 0.016, 0);
  pm.receiveShadow = true;
  scene.add(pm);
}

// The net tunnel. Returns the net materials (so the game can bulge nothing, but fade them).
export function buildCage(scene) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x3b4148, roughness: 0.5, metalness: 0.6 });
  const W = CAGE.w / 2, H = CAGE.h;
  for (let z = CAGE.back; z <= CAGE.end + 0.01; z += (CAGE.end - CAGE.back) / 7) {
    rod(new THREE.Vector3(-W, 0, z), new THREE.Vector3(-W, H, z), 0.045, steel, g);
    rod(new THREE.Vector3(W, 0, z), new THREE.Vector3(W, H, z), 0.045, steel, g);
    rod(new THREE.Vector3(-W, H, z), new THREE.Vector3(W, H, z), 0.04, steel, g);
  }
  for (const x of [-W, W]) rod(new THREE.Vector3(x, H, CAGE.back), new THREE.Vector3(x, H, CAGE.end), 0.035, steel, g);
  const netMat = (rx, ry) => {
    const t = tex.net.clone();
    t.needsUpdate = true;
    t.repeat.set(rx, ry);
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.9 });
  };
  const L = CAGE.end - CAGE.back, CZ = (CAGE.end + CAGE.back) / 2;
  const cell = 0.13;
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(L, H), netMat(L / cell / 4, H / cell / 4));
    side.rotation.y = Math.PI / 2;
    side.position.set(s * W, H / 2, CZ);
    g.add(side);
  }
  const top = new THREE.Mesh(new THREE.PlaneGeometry(CAGE.w, L), netMat(CAGE.w / cell / 4, L / cell / 4));
  top.rotation.x = Math.PI / 2;
  top.position.set(0, H, CZ);
  g.add(top);
  for (const z of [CAGE.back, CAGE.end]) {
    const end = new THREE.Mesh(new THREE.PlaneGeometry(CAGE.w, H), netMat(CAGE.w / cell / 4, H / cell / 4));
    end.position.set(0, H / 2, z);
    // The camera looks through the back net from just behind it: keep that one faint.
    if (z === CAGE.back) end.material.opacity = 0.22;
    g.add(end);
  }
  scene.add(g);
}

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
    // Wheels lie flat-ish (horizontal axis would throw a knuckle): spin about y.
    w.rotation.z = Math.PI / 2;
    g.add(w);
    wheels.push(w);
    // Motor can.
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
  // Pad on the screen's top bar.
  box(2.0, 0.08, 0.08, new THREE.MeshStandardMaterial({ color: 0x1f5fb8, roughness: 0.6 }), 0, 2.1, 0, sg);
  scene.add(sg);
  return { wheels, light };
}

// Radar sign over the machine end of the cage: pitch speed + last exit velocity.
export function buildRadar(scene) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 96;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.56, 0.08), [0, 0, 0, 0, 0, 0].map((_, i) => i === 5 ? new THREE.MeshBasicMaterial({ map: t }) : new THREE.MeshStandardMaterial({ color: 0x111316 })));
  m.position.set(-1.25, CAGE.h + 0.55, CAGE.end - 0.2);
  m.rotation.y = Math.PI;
  scene.add(m);
  const draw = (pitch, exit) => {
    const g = c.getContext("2d");
    g.fillStyle = "#0b0c0e"; g.fillRect(0, 0, 256, 96);
    g.font = "bold 13px Arial"; g.fillStyle = "#8aa0b4"; g.textAlign = "center";
    g.fillText("PITCH", 64, 18); g.fillText("EXIT VELO", 192, 18);
    g.font = "bold 50px 'Courier New', monospace"; g.fillStyle = "#ffb000";
    g.fillText(pitch ? String(pitch) : "--", 64, 72); g.fillStyle = "#47e06a"; g.fillText(exit ? String(exit) : "--", 192, 72);
    g.fillStyle = "#333"; g.fillRect(127, 10, 2, 76);
    t.needsUpdate = true;
  };
  draw(0, 0);
  return draw;
}

// The ballpark outside: an outfield wall beyond the cage end, light towers, a backstop, trees.
export function buildPark(scene) {
  const wallMat = new THREE.MeshStandardMaterial({ map: tex.fence, roughness: 0.9 });
  const R = 62;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 3, 48, 1, true, -Math.PI / 4, Math.PI / 2), wallMat);
  wall.material.side = THREE.BackSide;
  wall.position.set(0, 1.5, 0);
  wall.rotation.y = Math.PI;
  scene.add(wall);
  // Light towers.
  const steel = new THREE.MeshStandardMaterial({ color: 0x5b636b, roughness: 0.6, metalness: 0.4 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xfff0c8, emissiveIntensity: 0.8 });
  for (const [x, z] of [[-34, 40], [34, 40], [-30, -12], [30, -12]]) {
    const t = new THREE.Group();
    t.position.set(x, 0, z);
    const pole = cyl(0.35, 26, steel, t);
    pole.position.y = 13;
    const bank = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.2, 0.4), steel);
    bank.position.y = 26.5;
    t.add(bank);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), lamp);
      l.position.set(-1.35 + i * 1.35, 26.0 + j * 1.0, 0.21);
      t.add(l);
    }
    t.lookAt(0, 26, 10);
    scene.add(t);
  }
  // Trees as a dark ring beyond the wall.
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), 90);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2, d = 75 + rnd() * 40;
    const r = 4 + rnd() * 5;
    m.compose(p.set(Math.sin(a) * d, r * 0.8, Math.cos(a) * d), q, s.set(r, r * 1.2, r));
    leaves.setMatrixAt(i, m);
    leaves.setColorAt(i, col.setHSL(0.27 + rnd() * 0.06, 0.4, 0.17 + rnd() * 0.08));
  }
  scene.add(leaves);
  // A second cage beside ours, and a bench, for company.
  const bench = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.8 });
  box(2.4, 0.06, 0.4, wood, 0, 0.46, 0, bench);
  box(2.4, 0.3, 0.05, wood, 0, 0.75, -0.2, bench);
  for (const x of [-1.05, 1.05]) box(0.06, 0.46, 0.4, steel, x, 0.23, 0, bench);
  bench.position.set(4.2, 0, -1.4);
  bench.rotation.y = -Math.PI / 2;
  scene.add(bench);
}

export function ballMaterial() { return new THREE.MeshStandardMaterial({ map: tex.ball, roughness: 0.55 }); }
