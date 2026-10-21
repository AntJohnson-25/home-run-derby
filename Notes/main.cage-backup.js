// Batting Cage: the user's athlete (from Timber & Stone) in a net tunnel against a pitching
// machine. Space swings. The swing is judged on timing alone: where the bat would meet the
// ball against when the ball actually gets there. Early pulls it, late pushes it the other way.
//
// Clips (Mixamo baseball set, assets/clips.json): walkIn/stepIn/walkOut get him in and out of
// the box, idle is the stance, hit = load + swing + contact (the bat meets the ball at a time
// and place measured from the clip itself), strike = the swing-and-miss and his reaction,
// onDeck = practice swings behind the title screen.
import * as THREE from "three";
import * as W from "./world.js";
import { loadPlayer, Character, sampleClip, UNIT, PLAYERS } from "./chars.js";
import { Bat, addHelmet, athleteHands, avatarHands } from "./gear.js";
import { unlockAudio, toggleMute, sfx, machineHum } from "./audio.js";
import { loadAvatar } from "./avatar.js";
import { Net, PERIOD } from "./net.js";

const Q = new URLSearchParams(location.search);
// HopLobby: init starts now, alongside the downloads. Opened on its own it resolves as standalone.
const HL = window.HopLobby;
const hlInit = HL ? HL.init({ build: "batting-cage" }).catch((e) => { console.warn(e); return null; }) : Promise.resolve(null);
const progress = (f, label) => { try { if (HL) HL.progress(f, label); } catch (e) { /* not in HopLobby */ } };
const $ = (id) => document.getElementById(id);
const isTouch = matchMedia("(pointer: coarse)").matches;
if (isTouch) document.body.classList.add("touch");
const smooth = (x) => x * x * (3 - 2 * x);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const DEG = Math.PI / 180;

// ---- tuning ----------------------------------------------------------------------------------
const LEVELS = [
  { name: "ROOKIE", mph: 45, vary: 2, mix: [] },
  { name: "HIGH SCHOOL", mph: 58, vary: 3, mix: [] },
  { name: "COLLEGE", mph: 70, vary: 3, mix: [["CHANGEUP", 0.22, -12, 0]] },
  { name: "PRO", mph: 84, vary: 3, mix: [["CHANGEUP", 0.25, -12, 0], ["CURVEBALL", 0.2, -10, 0.32]] },
  { name: "ALL-STAR", mph: 95, vary: 3, mix: [["CHANGEUP", 0.25, -13, 0], ["SLIDER", 0.2, -8, -0.28], ["CURVEBALL", 0.15, -16, 0.38]] }
];
const BUCKET = 15;                 // pitches per round
const LOAD_T = 1.07;               // hit clip: hands loaded, bat cocked
const HIT_SW0 = 1.10, STRIKE_SW0 = 0.85;   // swing starts (same loaded pose in both clips)
const SWING_SPEED = 1.7;           // the mocap swing is slow; real bat speed
const HIT_END = 1.95, STRIKE_END = 1.62;
const LOAD_SPEED = 1.25;
const WIN = 0.095;                 // timing window (s) for any contact at all
const BALL_R = 0.037;
const G = 9.81;

// ---- renderer + scene --------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
let pixelRatio = Math.min(devicePixelRatio || 1, isTouch ? 1.6 : 1.25);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$("app").appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xf2d6b0, 60, 220);
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.05, 600);
function fit() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  // Portrait phones: widen the view so the batter and the machine both fit.
  camera.fov = camera.aspect < 0.8 ? 66 : camera.aspect < 1.2 ? 56 : 46;
  camera.updateProjectionMatrix();
}
addEventListener("resize", fit);
fit();

W.makeTextures();
W.buildSky(scene);
const sun = W.buildLights(scene);
W.buildGround(scene);
W.buildCage(scene);
const machine = W.buildMachine(scene);
const radar = W.buildRadar(scene);
W.buildPark(scene);

// ---- batter --------------------------------------------------------------------------------------
// Chosen on the title screen (?char= overrides). Grip and contact are measured from the
// batter's own body at load, so switching batter reloads the page with the new one.
const CHAR_KEY = "battingcage_char";
const charId = (() => {
  const q = Q.get("char");
  if (PLAYERS[q]) return q;
  try { const s = localStorage.getItem(CHAR_KEY); if (PLAYERS[s]) return s; } catch (e) { /* private mode */ }
  return "fit";
})();
$("ld-msg").textContent = "Warming up the hitter...";
progress(0.1, "Rolling out the machine");
const [M, ctx] = await Promise.all([loadPlayer(charId), hlInit]);
progress(0.5, "Warming up the hitter");
const ch = new Character(M);
scene.add(ch.root);
const nb = M.nb;
const qT = new Float32Array(nb * 4), qOut = new Float32Array(nb * 4), qSnap = new Float32Array(nb * 4), qTmp = new Float32Array(nb * 4);
const hT = new THREE.Vector3(), hOut = new THREE.Vector3(), hSnap = new THREE.Vector3(), hTmp = new THREE.Vector3();
const restInto = (q) => { for (let j = 0; j < nb; j++) M.restQ[j].toArray(q, j * 4); };
function clipPose(name, time, q, h) { restInto(q); sampleClip(M, M.clips[name], time, q, h); }
const dur = (n) => M.clips[n].dur;

// In HopLobby the batter is the player's own avatar (?avatar=<glb url> stands in for testing).
// The athlete then plays the clips unseen and the avatar copies him (avatar.js). Opened on its
// own, or if the avatar can't be read, the athlete bats himself, in his helmet.
const inLobby = !!(ctx && !ctx.standalone);
let av = null;
if (inLobby || Q.get("avatar")) {
  try {
    const buf = Q.get("avatar")
      ? await fetch(Q.get("avatar")).then((r) => { if (!r.ok) throw new Error("avatar " + r.status); return r.arrayBuffer(); })
      : await HL.avatar(ctx.playerId, { format: "glb" });
    const driver = {
      bone: (n) => ch.bone(n),
      posed(fn) { restInto(qT); hT.fromArray(M.hipsP); ch.apply(qT, hT, null, null, 0); fn(); }
    };
    av = await loadAvatar(buf, driver, scene);
    if (!av) console.warn("avatar rig not recognised: the athlete bats");
  } catch (e) { console.warn("avatar", e); if (HL && HL.reportError) HL.reportError(e, "avatar"); }
}
if (av) { ch.mesh.visible = false; document.body.classList.add("avatar"); }
progress(0.8, "Into the cage");
const bat = new Bat(av ? avatarHands(av, ch) : athleteHands(ch), scene);
if (!av) addHelmet(ch);
// Pose the batter: the driver, then the avatar on top of it.
function poseBatter(q, h) { ch.apply(q, h, null, null, 0); if (av) av.follow(); }

// Grip, contact time and contact point, all measured from the clips with the root at the origin.
clipPose("idle", 0, qT, hT);
poseBatter(qT, hT);
bat.calibrate();
const stanceHips = hT.clone();
// The contact TIME comes from the athlete's own bat, so the timing is judged the same for every
// player whatever their avatar; the contact POINT is where the batter's (avatar's) bat is then.
const timingBat = new Bat(athleteHands(ch), new THREE.Scene());
timingBat.calibrate();
function measureContact(clip, t0, t1) {
  const p = new THREE.Vector3();
  for (let t = t0; t <= t1; t += 1 / 240) {
    clipPose(clip, t, qT, hT);
    poseBatter(qT, hT);
    timingBat.update();
    if (timingBat.dir.x < -0.72) { bat.update(); return { t, p: bat.sweetSpot(p) }; }
  }
  throw new Error("no contact frame in " + clip);
}
const HIT = measureContact("hit", 1.25, 1.7);
const MISS = measureContact("strike", 0.95, 1.4);
const D_HIT = (HIT.t - HIT_SW0) / SWING_SPEED;           // press -> bat on the ball
// Stand him so the contact point is over the plate, a little out in front of its centre.
const ROOT = new THREE.Vector3(-HIT.p.x, 0, 0.22 - HIT.p.z);
const CONTACT = HIT.p.clone().add(ROOT);
// Where to start a clip that travels so that it ends in the stance spot.
function endOffset(clip) {
  clipPose(clip, dur(clip), qT, hT);
  return new THREE.Vector3((hT.x - stanceHips.x) * UNIT, 0, (hT.z - stanceHips.z) * UNIT);
}
const START = { walkIn: ROOT.clone().sub(endOffset("walkIn")), stepIn: ROOT.clone().sub(endOffset("stepIn")) };
// He takes his on-deck cuts right where Step In starts, so the first entrance is seamless.
const DECK = START.stepIn.clone();
const WALKIN_T0 = 0.8;   // Walk In stands still for its first 0.8 s

// ---- batter animation state ----------------------------------------------------------------------
const B = { mode: "deck", clip: "onDeck", t: 0, speed: 1, root: DECK.clone(), end: null, loop: true, hold: null };
let fade = 0, fadeLen = 0.3;
function startTransition(len) { qSnap.set(qOut); hSnap.copy(hOut); fadeLen = len; fade = len; }
function play(mode, clip, opts) {
  opts = opts || {};
  B.mode = mode; B.clip = clip; B.t = opts.t || 0; B.speed = opts.speed || 1;
  B.root.copy(opts.root || ROOT); B.end = opts.end == null ? dur(clip) : opts.end;
  B.loop = !!opts.loop; B.hold = opts.hold == null ? null : opts.hold;
  B.done = opts.done || null;
  startTransition(opts.blend == null ? 0.25 : opts.blend);
}
const toStance = (blend) => play("stance", "idle", { loop: true, blend: blend == null ? 0.5 : blend });

// ---- game state --------------------------------------------------------------------------------
let phase = "title", time = 0, level = 0;
const save = (() => { try { return JSON.parse(localStorage.getItem("battingcage") || "{}"); } catch (e) { return {}; } })();
save.best = save.best || {};
function persist() { try { localStorage.setItem("battingcage", JSON.stringify(save)); } catch (e) { /* private mode */ } }
const R = { score: 0, n: 0, streak: 0, bestStreak: 0, hits: [], hr: 0, longest: 0, maxEV: 0, evs: [], whiffs: 0 };
// The pitch: state machine for the machine and the ball.
const P = { state: "off", t: 0, k: 0, kind: null, mph: 0, T: 0, release: 0, swung: false, judged: null, wait: 1.2 };
// Pitch k of a bucket comes from its own seeded draw, so in a lobby everyone gets the same pitches.
let bucketSeed = 1;
function pitchRng(k) {
  let s = (bucketSeed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const online = () => Net.online() && !!Net.match;
let pending = null;   // a hit waiting for the bat to arrive: { at, err, ... }
let autoSwing = null; // test hook: swing at err seconds off perfect on the next pitch

// ---- balls -----------------------------------------------------------------------------------------
const ballGeo = new THREE.SphereGeometry(BALL_R, 14, 10), ballMat = W.ballMaterial();
const balls = [];      // loose balls on the cage floor (after they've done their thing)
const live = { mesh: new THREE.Mesh(ballGeo, ballMat), v: new THREE.Vector3(), mode: "hidden", rest: 0, batted: false, hitMachine: false };
live.mesh.castShadow = true;
live.mesh.visible = false;
scene.add(live.mesh);
const trail = [];
for (let i = 0; i < 6; i++) {
  const m = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32 * (1 - i / 6), depthWrite: false }));
  m.scale.setScalar(1 - i * 0.1);
  m.visible = false;
  scene.add(m);
  trail.push(m);
}
const trailPts = [];
const R0 = W.MACHINE.release;
const chuteTop = new THREE.Vector3(0, R0.y + 0.45, R0.z + 0.45 + 0.05);

function pitchPos(t, out) {
  // Release (s=0) -> the contact point (s=1) in T seconds; a breaking ball bows out and back.
  const s = t / P.T;
  out.x = R0.x + (CONTACT.x - R0.x) * s + P.brk * 4 * (s - s * s);
  out.z = R0.z + (CONTACT.z - R0.z) * s;
  out.y = R0.y + P.vy * t - 0.5 * P.g * t * t;
  return out;
}
function pitchVel(t, out) {
  const s = t / P.T;
  out.set((CONTACT.x - R0.x) / P.T + P.brk * 4 * (1 - 2 * s) / P.T, P.vy - P.g * t, (CONTACT.z - R0.z) / P.T);
  return out;
}

// Free flight in the cage: drag, backspin lift, nets, turf, the L-screen and the machine.
const UP = new THREE.Vector3(0, 1, 0), _lift = new THREE.Vector3();
function flyBall(b, dt) {
  const p = b.mesh.position, v = b.v;
  const n = 4, h = dt / n, Wd = W.CAGE.w / 2 - BALL_R;
  for (let i = 0; i < n; i++) {
    const s = v.length();
    if (b.batted && p.y > BALL_R + 0.01) {
      // Lift: perpendicular to v, in the vertical plane through v.
      _lift.copy(UP).addScaledVector(v, -v.y / Math.max(1e-6, s * s)).normalize().multiplyScalar(0.003 * s * s);
      v.addScaledVector(_lift, h);
      v.addScaledVector(v, -0.006 * s * h);
    }
    v.y -= G * h;
    const oz = p.z;
    p.addScaledVector(v, h);
    const fast = s > 3;
    if (p.x > Wd || p.x < -Wd) { p.x = clamp(p.x, -Wd, Wd); v.x *= -0.12; v.y *= 0.45; v.z *= 0.35; if (fast) sfx("net", Math.min(1, s / 25)); }
    if (p.y > W.CAGE.h - BALL_R) { p.y = W.CAGE.h - BALL_R; v.y *= -0.1; v.x *= 0.4; v.z *= 0.4; if (fast) sfx("net", Math.min(1, s / 25)); }
    if (p.z > W.CAGE.end - BALL_R) { p.z = W.CAGE.end - BALL_R; v.z *= -0.1; v.x *= 0.4; v.y *= 0.4; if (fast) sfx("net", Math.min(1, s / 25)); }
    if (p.z < W.CAGE.back + BALL_R) { p.z = W.CAGE.back + BALL_R; v.z *= -0.1; v.x *= 0.4; v.y *= 0.4; if (fast) sfx("net", Math.min(1, s / 25)); }
    // L-screen (with the window the pitches come through).
    const sz = W.MACHINE.screenZ;
    if (oz < sz && p.z >= sz && Math.abs(p.x) < 1.0 && p.y < 2.1 && !(Math.abs(p.x) < 0.28 && p.y < 1.35)) {
      p.z = sz - BALL_R; v.z *= -0.12; v.x *= 0.4; v.y *= 0.4; if (fast) sfx("net", Math.min(1, s / 25));
    }
    // Through the window and into the machine.
    if (b.batted && !b.hitMachine && Math.abs(p.x) < 0.42 && p.y > 0.7 && p.y < 1.5 && p.z > W.MACHINE.z - 0.55 && p.z < W.MACHINE.z + 0.3) {
      b.hitMachine = true; v.z = -Math.abs(v.z) * 0.4; v.x += rand(-1, 1); sfx("clang"); machineBonus();
    }
    if (p.y < BALL_R) {
      p.y = BALL_R;
      if (v.y < -1.2) { v.y *= -0.42; v.x *= 0.78; v.z *= 0.78; sfx("bounce", Math.min(1, -v.y / 6)); }
      else { v.y = 0; v.x *= 1 - 2.5 * h; v.z *= 1 - 2.5 * h; }
    }
  }
  b.mesh.rotation.x += v.z * dt * 8; b.mesh.rotation.z -= v.x * dt * 8;
  return v.length();
}
function retireLive() {
  // Leave the ball lying where it stopped; keep the floor from filling up.
  if (live.mode === "hidden") return;
  const m = new THREE.Mesh(ballGeo, ballMat);
  m.position.copy(live.mesh.position); m.position.y = BALL_R;
  m.rotation.copy(live.mesh.rotation);
  m.castShadow = true;
  scene.add(m);
  balls.push(m);
  while (balls.length > 30) scene.remove(balls.shift());
  live.mesh.visible = false; live.mode = "hidden";
}

// ---- batted ball outcomes ----------------------------------------------------------------------
// Carry (feet) for exit velocity (mph) and launch angle, drag + backspin lift, from 1 m up.
function carry(ev, la) {
  let v = ev * 0.44704, a = la * DEG, vx = v * Math.cos(a), vy = v * Math.sin(a), x = 0, y = 1;
  const dt = 0.005;
  while (y > 0 && x < 260) {
    const s = Math.hypot(vx, vy);
    const ax = -0.006 * s * vx - 0.003 * s * vy, ay = -G - 0.006 * s * vy + 0.003 * s * vx;
    vx += ax * dt; vy += ay * dt; x += vx * dt; y += vy * dt;
  }
  return Math.round(x * 3.281);
}
const fence = (spray) => 330 + 70 * Math.cos(2 * clamp(spray, -45, 45) * DEG);
function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 0.5; }

function judge(err) {
  // err: seconds, bat-on-ball time minus ball-at-plate time. < 0 = early.
  const q = Math.abs(err);
  let ev, la, grade;
  const bonus = (P.mph - 60) * 0.22;
  if (q <= 0.02) { grade = "PERFECT"; ev = rand(99, 108) + bonus; la = rand(21, 33); }
  else if (q <= 0.045) { grade = "GREAT"; ev = rand(90, 101) + bonus; la = rand(10, 34); }
  else if (q <= 0.07) { grade = "GOOD"; ev = rand(76, 92) + bonus * 0.6; la = Math.random() < 0.5 ? rand(-6, 12) : rand(18, 44); }
  else { grade = "WEAK"; ev = rand(55, 75); la = Math.random() < 0.5 ? rand(-18, 4) : rand(42, 68); }
  ev = Math.round(clamp(ev, 40, 118));
  la = Math.round(la);
  const spray = Math.round(clamp(-(err / WIN) * 54 + gauss() * 4, -80, 80));
  return { err, grade, ev, la, spray };
}
function classify(o) {
  const foul = Math.abs(o.spray) > 45;
  let dist = carry(o.ev, Math.max(o.la, 1));
  if (o.la < 10) dist = Math.round(55 + o.ev * 1.35);    // a grounder: how far it gets through the infield
  o.dist = dist;
  if (foul) { o.kind = "FOUL BALL"; o.pts = 2; o.fair = false; }
  else if (o.la >= 10 && dist >= fence(o.spray)) { o.kind = dist >= 440 ? "MOONSHOT!" : "HOME RUN!"; o.pts = 100 + Math.max(0, Math.round((dist - 330) / 2)); o.hr = true; }
  else if (o.la < 10) { o.kind = "GROUND BALL"; o.pts = o.ev >= 95 ? 25 : 10; }
  else if (o.la <= 25) { o.kind = "LINE DRIVE"; o.pts = o.ev >= 95 ? 55 : 40; }
  else if (o.la <= 50) { o.kind = dist >= 300 ? "DEEP FLY" : "FLY BALL"; o.pts = dist >= 300 ? 30 : 15; }
  else { o.kind = "POP UP"; o.pts = 5; }
  if (o.fair == null) o.fair = true;
  return o;
}
function timingWord(err) {
  const q = Math.abs(err);
  if (q <= 0.02) return "PERFECT TIMING";
  const side = err < 0 ? "EARLY" : "LATE";
  if (q <= 0.045) return "A HAIR " + side;
  if (q <= 0.07) return side;
  return "WAY " + side;
}

// ---- swing ------------------------------------------------------------------------------------------
function swing() {
  if (phase !== "play" || P.swung) return;
  if (!(B.mode === "stance" || B.mode === "load")) return;
  P.swung = true;
  sfx("swing");
  const pitchLive = P.state === "ready" || P.state === "feed" || P.state === "flight";
  const ta = pitchLive ? P.release + P.T : null;
  const err = ta == null ? null : time + D_HIT - ta;
  if (err != null && Math.abs(err) <= WIN) {
    // Contact: run the hit clip so the bat gets there exactly when the ball does.
    const left = Math.max(0.05, ta - time);
    const sp = clamp((HIT.t - HIT_SW0) / left, 0.9, 3.4);
    play("swing", "hit", { t: HIT_SW0, speed: sp, end: HIT_END, blend: 0.05 });
    pending = { at: time + (HIT.t - HIT_SW0) / sp, err };
    P.judged = "hit";
  } else {
    play("swing", "strike", { t: STRIKE_SW0, speed: SWING_SPEED, end: STRIKE_END, blend: 0.05 });
    P.judged = err == null ? "practice" : "miss";
    P.missErr = err;
  }
  $("hint").classList.add("hidden");
}

function contact() {
  const o = classify(judge(pending.err));
  pending = null;
  R.n++;
  // Launch from the bat. Spray > 0 = pulled = towards +x (left field for a right-handed hitter).
  const v = o.ev * 0.44704 * (o.grade === "WEAK" ? 0.75 : 1);
  bat.sweetSpot(live.mesh.position);
  live.v.set(Math.sin(o.spray * DEG) * Math.cos(o.la * DEG), Math.sin(o.la * DEG), Math.cos(o.spray * DEG) * Math.cos(o.la * DEG)).multiplyScalar(v);
  live.mode = "free"; live.batted = true; live.hitMachine = false; live.rest = 0;
  P.state = "batted"; P.t = 0;
  B.speed = 1.0;   // let the follow-through play out at the clip's own pace
  const q = o.grade === "PERFECT" ? 1 : o.grade === "GREAT" ? 0.85 : o.grade === "GOOD" ? 0.6 : 0.25;
  sfx("crack", q);
  shake = 0.05 + q * 0.12;
  radar(Math.round(P.mph), o.ev);
  scoreHit(o);
}

// ---- scoring + HUD -----------------------------------------------------------------------------------
function mult() { return R.streak >= 5 ? 2 : R.streak >= 3 ? 1.5 : 1; }
function scoreHit(o) {
  const goodHit = o.hr || o.kind === "LINE DRIVE" || o.kind === "DEEP FLY";
  if (goodHit) R.streak++; else R.streak = 0;
  R.bestStreak = Math.max(R.bestStreak, R.streak);
  const pts = Math.round(o.pts * (goodHit ? mult() : 1));
  R.score += pts;
  R.hits.push(o);
  R.evs.push(o.ev);
  R.maxEV = Math.max(R.maxEV, o.ev);
  if (o.hr) { R.hr++; R.longest = Math.max(R.longest, o.dist); sfx("hr"); }
  else if (goodHit) sfx("good");
  const sub = o.kind === "FOUL BALL" ? `${o.ev} MPH OFF THE BAT` : `${o.dist} FT &middot; ${o.ev} MPH &middot; ${o.la}&deg;`;
  call(o.kind, sub, timingWord(o.err), "+" + pts + (goodHit && mult() > 1 ? `  (x${mult()} STREAK)` : ""), o.hr ? "hr" : goodHit ? "good" : "meh");
  meter(o.err);
  drawSpray($("spray"), R.hits, false);
  updateHud();
  Net.score(R, o.kind.replace("!", ""));
}
function machineBonus() {
  R.score += 50;
  setTimeout(() => call("HIT THE MACHINE!", "right back up the middle", "", "+50 BONUS", "hr"), 500);
  updateHud();
  Net.score(R, "HIT THE MACHINE");
}
let callT = null;
function call(big, sub, timing, pts, cls) {
  const c = $("call");
  c.className = "call " + (cls || "");
  c.innerHTML = `<div class="big">${big}</div>` + (sub ? `<div class="sub">${sub}</div>` : "") + (timing ? `<div class="tm">${timing}</div>` : "") + (pts ? `<div class="pts">${pts}</div>` : "");
  c.style.animation = "none"; void c.offsetWidth; c.style.animation = "";
  clearTimeout(callT);
  callT = setTimeout(() => c.classList.add("hidden"), 2600);
}
function meter(err) {
  const m = $("meter");
  m.classList.remove("hidden");
  const x = err == null ? null : clamp(err / (WIN * 1.6), -1, 1);
  $("meter-dot").style.left = x == null ? "50%" : (50 + x * 50).toFixed(1) + "%";
  $("meter-dot").classList.toggle("off", x == null || Math.abs(err) > WIN);
}
function updateHud() {
  $("score").textContent = R.score;
  $("lvl").textContent = LEVELS[level].name + " · " + LEVELS[level].mph + " MPH";
  const best = save.best[level] || 0;
  $("best").textContent = "BEST " + Math.max(best, R.score);
  $("streak").textContent = R.streak >= 2 ? `STREAK ${R.streak}` + (mult() > 1 ? ` · x${mult()}` : "") : "";
  $("dots").innerHTML = Array.from({ length: BUCKET }, (_, i) => `<i class="${i < R.n ? "used" : ""}"></i>`).join("");
}

// The spray chart: a ballpark from above, home plate at the bottom; left field on the left.
function drawSpray(cv, hits, big) {
  const g = cv.getContext("2d"), w = cv.width, h = cv.height;
  const cx = w / 2, cy = h - (big ? 14 : 8), s = (h - (big ? 26 : 16)) / 420;
  g.clearRect(0, 0, w, h);
  const at = (d, a) => [cx - Math.sin(a * DEG) * d * s, cy - Math.cos(a * DEG) * d * s];
  // Grass fan + fence.
  g.beginPath(); g.moveTo(cx, cy);
  for (let a = -45; a <= 45; a += 3) { const [x, y] = at(fence(a), a); g.lineTo(x, y); }
  g.closePath(); g.fillStyle = "rgba(76,138,58,0.85)"; g.fill();
  g.strokeStyle = "#e9c84a"; g.lineWidth = 2;
  g.beginPath(); for (let a = -45; a <= 45; a += 3) { const [x, y] = at(fence(a), a); a === -45 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
  // Infield dirt + diamond.
  g.fillStyle = "rgba(168,116,74,0.9)";
  g.beginPath(); g.moveTo(cx, cy); for (let a = -45; a <= 45; a += 5) { const [x, y] = at(155, a); g.lineTo(x, y); } g.closePath(); g.fill();
  g.fillStyle = "rgba(76,138,58,0.9)";
  g.beginPath(); for (const [d, a] of [[0, 0], [90, -45], [127, 0], [90, 45]]) { const [x, y] = at(d * 0.78 + (d ? 8 : 0), a); g.lineTo(x, y); } g.closePath(); g.fill();
  g.strokeStyle = "rgba(255,255,255,0.8)"; g.lineWidth = 1;
  for (const a of [-45, 45]) { g.beginPath(); g.moveTo(cx, cy); const [x, y] = at(340, a); g.lineTo(x, y); g.stroke(); }
  for (const o of hits) {
    const a = clamp(o.spray, -75, 75), [x, y] = at(o.dist, a);
    g.beginPath(); g.arc(x, y, big ? 5 : 3.5, 0, 7);
    g.fillStyle = o.hr ? "#ffd23f" : !o.fair ? "#9aa1a8" : o.kind === "LINE DRIVE" || o.kind === "DEEP FLY" ? "#ffffff" : "#d8e0e6";
    g.fill();
    g.lineWidth = 1.5; g.strokeStyle = o.hr ? "#7a4a00" : "rgba(0,0,0,0.55)"; g.stroke();
  }
}

// ---- rounds ------------------------------------------------------------------------------------------
function resetRound() {
  Object.assign(R, { score: 0, n: 0, streak: 0, bestStreak: 0, hits: [], hr: 0, longest: 0, maxEV: 0, evs: [], whiffs: 0 });
  drawSpray($("spray"), [], false);
  radar(0, 0);
  updateHud();
}
function startGame(lv) {
  level = lv;
  unlockAudio();
  resetRound();
  P.k = 0;
  if (!online()) bucketSeed = (Math.random() * 2147483646 + 1) | 0;
  renderBoard();
  $("title").classList.add("hidden");
  $("results").classList.add("hidden");
  $("hud").classList.remove("hidden");
  const first = phase === "title";
  phase = "intro";
  for (const b of balls) scene.remove(b);
  balls.length = 0;
  // From the title he steps in from his on-deck spot; after walking out he walks back in.
  if (first) play("stepIn", "stepIn", { root: START.stepIn, speed: 1.15, blend: 0.4, done: ready });
  else play("walkIn", "walkIn", { root: START.walkIn, t: WALKIN_T0, speed: 1.2, blend: 0.5, done: ready });
  $("hint").textContent = isTouch ? "TAP TO SWING" : "SPACE TO SWING";
  $("hint").classList.remove("hidden");
}
function ready() {
  toStance(0.3);
  phase = "play";
  P.state = "wait"; P.wait = 1.0;
  machineHum(true);
}
function endRound() {
  phase = "results";
  P.state = "off";
  machineHum(false);
  play("walkOut", "walkOut", { blend: 0.4, hold: dur("walkOut") });
  const best = save.best[level] || 0;
  const newBest = R.score > best;
  if (newBest) save.best[level] = R.score;
  save.longest = Math.max(save.longest || 0, R.longest);
  persist();
  sfx("round");
  Net.score(R, "DONE", true);
  setTimeout(() => {
    if (phase !== "results") return;   // the host already started the next bucket
    renderBoard();
    $("r-score").textContent = R.score;
    $("r-best").textContent = newBest && R.score > 0 ? "NEW BEST!" : "Best: " + (save.best[level] || 0);
    const ev = R.evs.length ? Math.round(R.evs.reduce((a, b) => a + b, 0) / R.evs.length) : 0;
    const hard = R.evs.filter((e) => e >= 95).length;
    $("r-stats").innerHTML = [
      ["HOME RUNS", R.hr], ["LONGEST", R.longest ? R.longest + " ft" : "--"], ["MAX EXIT VELO", R.maxEV ? R.maxEV + " mph" : "--"],
      ["AVG EXIT VELO", ev ? ev + " mph" : "--"], ["HARD HIT (95+)", hard], ["BALLS IN PLAY", R.hits.filter((o) => o.fair).length + " / " + BUCKET],
      ["BEST STREAK", R.bestStreak], ["WHIFFS", R.whiffs]
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
    drawSpray($("r-spray"), R.hits, true);
    $("r-level").textContent = LEVELS[level].name + " · " + LEVELS[level].mph + " MPH";
    $("r-up").classList.toggle("hidden", level >= LEVELS.length - 1);
    $("results").classList.remove("hidden");
  }, 1800);
}

// ---- pitch machine -------------------------------------------------------------------------------
function newPitch() {
  const L = LEVELS[level], rng = pitchRng(P.k);
  let kind = "FASTBALL", d = 0, brk = 0;
  let r = rng();
  for (const [k, p, dm, b] of L.mix) { if (r < p) { kind = k; d = dm; brk = b; break; } r -= p; }
  P.kind = kind;
  P.mph = L.mph + d + (rng() * 2 - 1) * L.vary;
  const v = P.mph * 0.44704;
  P.T = (R0.z - CONTACT.z) / v;
  P.g = G * (kind === "CURVEBALL" ? 1.25 : 0.82);   // backspin holds a fastball up; a curve drops
  P.vy = (CONTACT.y - R0.y + 0.5 * P.g * P.T * P.T) / P.T;
  P.brk = brk;
  P.swung = false; P.judged = null; P.missErr = null;
}
function machineStep(dt) {
  P.t += dt;
  const lightCol = machine.light.material;
  if (P.state === "wait") {
    lightCol.emissive.setHex(0x000000); lightCol.color.setHex(0x441111);
    P.wait -= dt;
    // Alone: the next pitch once he's set. In a lobby: on the shared clock (pitch k at readyAt(k)),
    // whatever he's doing; a pitch this machine was too late for (a stall, a late join) is skipped.
    let late = 0, go;
    if (online()) {
      late = (Net.now() - Net.readyAt(P.k)) / 1000;
      while (late > 0.5 && P.k < BUCKET) { P.k++; R.n = Math.max(R.n, P.k); late -= PERIOD; }
      go = late >= 0 || P.k >= BUCKET;
      if (P.k >= BUCKET && Net.now() < Net.readyAt(BUCKET)) go = false;
    } else go = P.wait <= 0 && B.mode === "stance" && fade <= 0;
    if (go) {
      if (P.k >= BUCKET) { endRound(); return; }
      newPitch();
      P.k++;
      P.state = "ready"; P.t = late;
      lightCol.color.setHex(0xffa020); lightCol.emissive.setHex(0xff7a00);
      sfx("ready");
      play("load", "hit", { t: 0, speed: LOAD_SPEED, end: LOAD_T, hold: LOAD_T, blend: 0.25 });
      P.release = time + 0.62 + 0.36 - late;
      if (autoSwing != null) { autoSwing.at = P.release + P.T - D_HIT + autoSwing.err; }
    }
  } else if (P.state === "ready") {
    if (P.t >= 0.62) {
      P.state = "feed"; P.t = 0;
      lightCol.color.setHex(0x30ff60); lightCol.emissive.setHex(0x10c040);
      live.mesh.visible = true; live.mode = "feed"; live.batted = false;
      trailPts.length = 0;
    }
  } else if (P.state === "feed") {
    const u = Math.min(1, P.t / 0.36);
    live.mesh.position.copy(chuteTop).lerp(R0, u * u);
    if (time >= P.release) {
      P.state = "flight"; P.t = 0; live.mode = "pitch";
      sfx("thunk");
      radar(Math.round(P.mph), 0);
    }
  } else if (P.state === "flight") {
    const t = time - P.release;
    if (t < P.T) pitchPos(t, live.mesh.position);
    else {
      // Past the hitting point: hand it to the physics (into the back net behind the plate).
      pitchPos(P.T, live.mesh.position);
      pitchVel(P.T, live.v);
      live.mode = "free";
      P.state = "passed"; P.t = 0;
      resolveMiss();
    }
  } else if (P.state === "passed" || P.state === "batted") {
    const due = online() && Net.now() >= Net.readyAt(P.k) - 300;   // the next pitch is coming
    if (live.mode === "hidden" || due || P.t > (P.state === "batted" ? 4.5 : 2.2)) {
      retireLive();
      P.state = "wait"; P.wait = 0.9;
    }
  }
}
function resolveMiss() {
  if (P.judged === "hit") return;   // the bat is on its way; contact() resolves it
  R.n++;
  if (P.judged === "miss") {
    R.whiffs++; R.streak = 0;
    sfx("whiff");
    call("SWING AND A MISS", P.kind + " · " + Math.round(P.mph) + " MPH", timingWord(P.missErr), "", "miss");
    meter(P.missErr);
  } else {
    call("TAKE", P.kind + " · " + Math.round(P.mph) + " MPH", "", "", "miss");
    if (B.mode === "load") toStance(0.6);
  }
  updateHud();
  Net.score(R, P.judged === "miss" ? "WHIFF" : "TAKE");
}

// ---- input ---------------------------------------------------------------------------------------
addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    if (e.repeat) return;
    unlockAudio();
    if (phase === "title") begin(level);
    else if (phase === "results" && !$("results").classList.contains("hidden")) begin(level);
    else swing();
  } else if (e.code === "KeyM") $("mute").classList.toggle("off", toggleMute());
  else if (phase === "title" && /^Digit[1-5]$/.test(e.code)) pickLevel(+e.code.slice(5) - 1);
});
renderer.domElement.addEventListener("pointerdown", (e) => { if (phase === "play") { e.preventDefault(); unlockAudio(); swing(); } });
$("swing-btn").addEventListener("pointerdown", (e) => { e.preventDefault(); unlockAudio(); swing(); });
$("mute").addEventListener("click", () => { unlockAudio(); $("mute").classList.toggle("off", toggleMute()); });
// In a lobby the host starts every bucket (for everyone) and picks the speed; the others wait.
function begin(lv) {
  if (!Net.online()) startGame(lv);
  else if (Net.isHost()) { unlockAudio(); Net.hostStart(lv); }
}
$("start").addEventListener("click", () => begin(level));
$("r-again").addEventListener("click", () => begin(level));
$("r-up").addEventListener("click", () => begin(Math.min(LEVELS.length - 1, level + 1)));
$("r-menu").addEventListener("click", () => { if (Net.online()) Net.hostMenu(); else toTitle(); });
function toTitle() {
  $("results").classList.add("hidden"); $("hud").classList.add("hidden");
  if (phase === "play" || phase === "intro") { P.state = "off"; machineHum(false); retireLive(); }
  phase = "title"; $("title").classList.remove("hidden");
  play("deck", "onDeck", { root: DECK, loop: true, blend: 0.5 });
  buildLevels(); lobbyUi();
}
function pickLevel(i) {
  if (Net.online() && !Net.isHost()) return;
  level = i; sfx("click"); buildLevels();
  if (Net.online()) Net.setLevel(i);
}

// ---- the lobby: who's here, who's winning ------------------------------------------------------------
function lobbyUi() {
  const on = Net.online(), host = Net.isHost();
  document.body.classList.toggle("online", on);
  document.body.classList.toggle("guest", on && !host);
  if (!on) return;
  if (phase === "title" && level !== Net.lv) { level = Net.lv; buildLevels(); }
  const n = HL.players.length;
  $("start").textContent = host ? "PLAY BALL" : "WAITING FOR THE HOST";
  $("lobby-line").textContent = n + (n === 1 ? " BATTER" : " BATTERS") + " IN THE CAGES · SAME 15 PITCHES · BEST BUCKET WINS";
  renderBoard();
}
const portraits = {};
function portrait(id) {
  if (portraits[id] !== undefined || !HL || !HL.avatar) return portraits[id] || "";
  portraits[id] = "";
  HL.avatar(id, { size: 64 }).then((url) => { portraits[id] = url; renderBoard(); }).catch(() => {});
  return "";
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
function renderBoard() {
  if (!Net.online()) { $("live").innerHTML = ""; $("r-board").innerHTML = ""; return; }
  const rows = Net.board();
  const html = rows.map((r, i) => {
    const pic = portrait(r.id);
    return `<div class="lb${r.you ? " you" : ""}"><span class="rk">${r.has ? i + 1 : "-"}</span>` +
      (pic ? `<img src="${pic}" alt="">` : `<i class="pic"></i>`) +
      `<b>${esc(r.name)}</b><em>${r.s}</em><small>${r.done ? "DONE" : r.has ? r.n + "/" + BUCKET : ""}${r.k && r.k !== "DONE" ? " · " + esc(r.k) : ""}${r.hr ? " · " + r.hr + " HR" : ""}</small></div>`;
  }).join("");
  $("live").innerHTML = html;
  $("r-board").innerHTML = html;
}
const netHandlers = {
  lobby: lobbyUi,
  board: renderBoard,
  start(m) {
    bucketSeed = m.seed;
    $("title").classList.add("hidden");
    startGame(m.lv);
  },
  menu: toTitle
};
// Batter picker: the current one is lit; picking the other reloads the page with it.
for (const b of document.querySelectorAll("#batters button")) {
  b.classList.toggle("on", b.dataset.char === charId);
  b.addEventListener("click", () => {
    if (b.dataset.char === charId) return;
    try { localStorage.setItem(CHAR_KEY, b.dataset.char); } catch (e) { /* private mode */ }
    const q = new URLSearchParams(location.search);
    q.set("char", b.dataset.char);
    location.search = q.toString();
  });
}
function buildLevels() {
  $("levels").innerHTML = LEVELS.map((L, i) => `<button class="lv${i === level ? " on" : ""}" data-i="${i}"><b>${L.name}</b><span>${L.mph} mph${L.mix.length ? " + off-speed" : ""}</span><em>${save.best[i] ? "best " + save.best[i] : ""}</em></button>`).join("");
  $("levels").querySelectorAll(".lv").forEach((b) => b.addEventListener("click", () => { unlockAudio(); pickLevel(+b.dataset.i); }));
}
// iPhone Safari ignores user-scalable=no: stop double-tap zoom on the controls.
document.addEventListener("touchend", (e) => { if (e.target.closest("button")) e.preventDefault(); }, { passive: false });

// ---- frame ---------------------------------------------------------------------------------------------
let shake = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const PLAY_CAM = { pos: new THREE.Vector3(-0.5, 1.5, -4.6), look: new THREE.Vector3(0.45, 1.05, 4.5) };
const look = PLAY_CAM.look.clone();

function step(dt) {
  time += dt;
  // --- batter clip time
  B.t += dt * B.speed;
  if (B.loop) B.t %= dur(B.clip);
  else if (B.t >= B.end) {
    if (B.hold != null) B.t = B.hold;
    else {
      const done = B.done;
      B.t = B.end;
      if (B.mode === "swing") {
        if (P.judged === "miss" && R.whiffs > 0 && R.whiffs % 3 === 0 && B.clip === "strike" && B.end < dur("strike")) {
          // Strike three: let him have his moment (the rest of the strike clip ends in his stance).
          B.end = dur("strike"); B.speed = 1.15;
          call("STRIKE THREE!", "shake it off", "", "", "miss");
        } else toStance(B.clip === "strike" && B.end >= dur("strike") ? 0.15 : 0.6);
      } else if (done) { B.done = null; done(); }
    }
  }
  // In a lobby the first light comes on the shared clock: a slow walk-in (or a late join) is cut short.
  if (phase === "intro" && online() && Net.now() >= Net.readyAt(0) - 700) { B.done = null; ready(); }
  if (autoSwing && autoSwing.at != null && time >= autoSwing.at) { autoSwing.at = null; swing(); }
  if (pending && time >= pending.at) contact();

  // --- pose
  clipPose(B.clip, B.t, qT, hT);
  hT.x += B.root.x / UNIT; hT.z += B.root.z / UNIT;
  if (fade > 0) {
    const k = smooth(clamp(1 - fade / fadeLen, 0, 1));
    for (let j = 0; j < nb; j++) THREE.Quaternion.slerpFlat(qOut, j * 4, qSnap, j * 4, qT, j * 4, k);
    hOut.copy(hSnap).lerp(hT, k);
    fade -= dt;
  } else { qOut.set(qT); hOut.copy(hT); }
  poseBatter(qOut, hOut);
  bat.update();

  // --- machine + ball
  if (phase === "play" || P.state === "passed" || P.state === "batted") machineStep(dt);
  for (const w of machine.wheels) w.rotation.x += dt * (phase === "play" ? 40 : 4);
  if (live.mode === "free") {
    const s = flyBall(live, dt);
    if (s < 0.08 && live.mesh.position.y <= BALL_R + 0.001) { live.rest += dt; if (live.rest > 0.4) retireLive(); }
  }
  // Trail behind a fast ball.
  const fast = (live.mode === "pitch" || live.mode === "free") && live.mesh.visible;
  if (fast) { trailPts.unshift(live.mesh.position.clone()); if (trailPts.length > 14) trailPts.pop(); } else trailPts.length = 0;
  const spd = live.mode === "pitch" ? 30 : live.v.length();
  trail.forEach((m, i) => {
    const p = trailPts[(i + 1) * 2];
    m.visible = !!p && spd > 8;
    if (p) m.position.copy(p);
  });

  // --- camera
  if (phase === "title") {
    // Sway in front of him (he faces -x), inside the cage; he sits right of centre, clear of the panel.
    const a = Math.sin(time * 0.15) * 0.45 + 0.35;
    camPos.set(DECK.x - 3.0 * Math.cos(a), 1.45, DECK.z + 3.0 * Math.sin(a));
    _v.set(DECK.x - 0.4, 1.05, DECK.z - 0.75);
    camera.position.lerp(camPos, 1 - Math.exp(-3 * dt));
    look.lerp(_v, 1 - Math.exp(-4 * dt));
  } else {
    camPos.copy(PLAY_CAM.pos);
    _v.copy(PLAY_CAM.look);
    // Follow a batted ball a little.
    if (live.batted && live.mode === "free") { _w.copy(live.mesh.position).sub(_v).multiplyScalar(0.35); _v.add(_w); }
    camera.position.lerp(camPos, 1 - Math.exp(-2.5 * dt));
    look.lerp(_v, 1 - Math.exp(-(live.batted ? 3 : 2.5) * dt));
  }
  camera.lookAt(look);
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.12; camera.position.y += (Math.random() - 0.5) * shake * 0.12; shake = Math.max(0, shake - dt * 0.8); }
}

let last = performance.now(), slow = 0, paused = false, hlPaused = false;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (paused || hlPaused) return;   // test hook (BC.step drives the sim instead) / HopLobby's menu
  if (dt > 0.05) dt = 0.05;
  step(dt);
  renderer.render(scene, camera);
  if (phase === "play" && dt > 0.034) { slow += dt; if (slow > 3 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); slow = 0; } }
  else slow = Math.max(0, slow - dt * 0.5);
}

buildLevels();
updateHud();
drawSpray($("spray"), [], false);
camera.position.set(DECK.x - 2.8, 1.45, DECK.z + 1.0);
look.set(DECK.x - 0.4, 1.05, DECK.z - 0.75);
play("deck", "onDeck", { root: DECK, loop: true, blend: 0 });
fade = 0;
step(0);
qOut.set(qT); hOut.copy(hT);
$("loading").classList.add("hidden");
if (Q.get("play")) startGame(+(Q.get("level") || 0));
else $("title").classList.remove("hidden");
requestAnimationFrame(frame);
// HopLobby: the lobby, its Esc menu, then ready(). Alone, the menu pauses the bucket; in a lobby
// the pitches keep coming on the shared clock, so it doesn't.
Net.init(ctx, netHandlers);
lobbyUi();
if (HL && HL.on) {
  HL.on("pause", () => { if (!Net.online()) hlPaused = true; });
  HL.on("resume", () => { hlPaused = false; });
}
progress(1);
if (HL) HL.ready();

// Test hooks.
window.BC = {
  start: (lv) => startGame(lv || 0),
  begin, net: Net, avatar: () => !!av,
  swing,
  auto: (err) => { autoSwing = err == null ? null : { err, at: null }; },
  state: () => ({ phase, mode: B.mode, clip: B.clip, t: +B.t.toFixed(2), pitch: P.state, kind: P.kind, mph: P.mph && +P.mph.toFixed(1), judged: P.judged, n: R.n, score: R.score, last: R.hits.length ? R.hits[R.hits.length - 1] : null, ball: live.mode, bp: live.mesh.position.toArray().map((x) => +x.toFixed(2)) }),
  now: () => time,
  pause: (on) => { paused = on !== false; },
  step: (n, dt, noRender) => { for (let i = 0; i < n; i++) step(dt || 1 / 60); if (!noRender) renderer.render(scene, camera); },
  info: { HIT, MISS, D_HIT, ROOT, CONTACT, START },
  cam: (p, l) => { PLAY_CAM.pos.fromArray(p); if (l) PLAY_CAM.look.fromArray(l); camera.position.copy(PLAY_CAM.pos); look.copy(PLAY_CAM.look); },
  R, P
};
