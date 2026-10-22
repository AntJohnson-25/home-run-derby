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
import { unlockAudio, setAudio, sfx, machineHum } from "./audio.js";
import { loadAvatar } from "./avatar.js";
import { Net, PERIOD } from "./net.js";
import { BallFX, Flags } from "./fx.js";

// HopLobby: init starts now, alongside the downloads. Opened on its own it resolves as standalone.
const HL = window.HopLobby;
// The machine speed is a lobby option (the host picks it before launch); HopLobby runs the lobby, Ready and the rematch.
const SPEED_OPTION = { key: "speed", label: "Machine speed", type: "choice", default: "1", choices: [
  { value: "0", label: "Rookie: 45 mph" }, { value: "1", label: "High School: 58 mph" }, { value: "2", label: "College: 70 mph + changeups" },
  { value: "3", label: "Pro: 84 mph + curveballs" }, { value: "4", label: "All-Star: 95 mph + sliders" }] };
const hlInit = HL ? HL.init({ build: "home-run-derby", lobbyOptions: [SPEED_OPTION], options: { speed: "1" } }).catch((e) => { console.warn(e); return null; }) : Promise.resolve(null);
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
scene.fog = new THREE.Fog(0x131c3c, 110, 480);
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.2, 600);
let baseFov = 46, zoom = 1;   // zoom < 1 = telephoto, used to follow a long ball
function fit() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  // Portrait phones: widen the view so the batter and the machine both fit.
  baseFov = camera.aspect < 0.8 ? 66 : camera.aspect < 1.2 ? 56 : 46;
  camera.fov = baseFov * zoom;
  camera.updateProjectionMatrix();
}
addEventListener("resize", fit);
fit();

// The night ballpark (from the G: Home Run Derby).
await W.loadAdImages();
W.makeTextures();
W.buildSky(scene);
const sun = W.buildLights(scene);
W.buildGround(scene);
const park = W.buildStadium(scene);
const machine = W.buildMachine(scene);
const radar = (pitch, exit) => park.board({ pitch, exit });
const fx = new BallFX(scene, camera, W.tex.glow);
const flags = new Flags(scene, camera);

// ---- batter --------------------------------------------------------------------------------------
// Grip and contact are measured from the batter's own body at load.
// The athlete only plays the clips (unseen); every player appears as their own HopLobby avatar.
const charId = "fit";
$("ld-msg").textContent = "Warming up the hitter...";
progress(0.1, "Rolling out the machine");
const [M, ctx] = await Promise.all([loadPlayer(charId), hlInit]);
progress(0.5, "Warming up the hitter");
const lobbyLevel = Math.max(0, Math.min(LEVELS.length - 1, ctx && ctx.options && ctx.options.speed != null ? parseInt(ctx.options.speed, 10) || 0 : 1));
const ch = new Character(M);
scene.add(ch.root);
const nb = M.nb;
const qT = new Float32Array(nb * 4), qOut = new Float32Array(nb * 4), qSnap = new Float32Array(nb * 4), qTmp = new Float32Array(nb * 4);
const hT = new THREE.Vector3(), hOut = new THREE.Vector3(), hSnap = new THREE.Vector3(), hTmp = new THREE.Vector3();
const restInto = (q) => { for (let j = 0; j < nb; j++) M.restQ[j].toArray(q, j * 4); };
function clipPose(name, time, q, h) { restInto(q); sampleClip(M, M.clips[name], time, q, h); }
const dur = (n) => M.clips[n].dur;

// In HopLobby the batter is the player's own avatar. The athlete then plays the clips unseen and
// the avatar copies him (avatar.js). Opened on its own, or if the avatar can't be read, the athlete
// bats himself, in his helmet.
const inLobby = !!(ctx && !ctx.standalone);
let av = null;
if (inLobby) {
  try {
    const buf = await HL.avatar(ctx.playerId, { format: "glb" });
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
// phase "title" = waiting between load and the first pitch (the on-deck scene); HopLobby draws the lobby over it.
let phase = "title", time = 0, level = lobbyLevel;
const save = (() => { try { return JSON.parse(localStorage.getItem("home-run-derby:save") || "{}"); } catch (e) { return {}; } })();
save.best = save.best || {};
function persist() { try { localStorage.setItem("home-run-derby:save", JSON.stringify(save)); } catch (e) { /* private mode */ } }
const R = { score: 0, n: 0, streak: 0, bestStreak: 0, hits: [], hr: 0, longest: 0, maxEV: 0, evs: [], whiffs: 0, total: 0 };
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

// ---- balls -----------------------------------------------------------------------------------------
const ballGeo = new THREE.SphereGeometry(BALL_R, 14, 10), ballMat = W.ballMaterial();
const balls = [];      // loose balls lying on the field (after they've done their thing)
const live = { mesh: new THREE.Mesh(ballGeo, ballMat), v: new THREE.Vector3(), mode: "hidden", rest: 0, batted: false, hitMachine: false };
live.mesh.castShadow = true;
live.mesh.visible = false;
scene.add(live.mesh);
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

// Free flight: drag + backspin lift (one integrator, also run ahead by predict() so the board
// and the ball agree), then the ground, the L-screen, the machine, the wall and the stands.
const UP = new THREE.Vector3(0, 1, 0), _lift = new THREE.Vector3();
const FH = 1 / 240;   // fixed physics step
let phys = 0;
function aero(p, v, batted) {
  const s = v.length();
  if (batted && p.y > BALL_R + 0.01) {
    // Lift: perpendicular to v, in the vertical plane through v.
    _lift.copy(UP).addScaledVector(v, -v.y / Math.max(1e-6, s * s)).normalize().multiplyScalar(0.003 * s * s);
    v.addScaledVector(_lift, FH);
    v.addScaledVector(v, -0.006 * s * FH);
  }
  v.y -= G * FH;
  p.addScaledVector(v, FH);
  return s;
}
const polar = (p) => ({ r: Math.hypot(p.x, p.z), a: Math.atan2(p.x, p.z) / DEG });
// Run a batted ball ahead to find where it lands: { dist (ft), land, cross, blocked, apex, hang }.
// `cross` = where it reaches the wall's radius. Over the wall it keeps going to the landing spot
// (the projected distance); into the wall it ends there.
function predict(p0, v0) {
  const p = p0.clone(), v = v0.clone();
  let apex = p.y, t = 0, cross = null;
  const sz = W.MACHINE.screenZ;
  while (t < 12) {
    const oz = p.z;
    aero(p, v, true); t += FH;
    apex = Math.max(apex, p.y);
    if (oz < sz && p.z >= sz && Math.abs(p.x) < 1.0 && p.y < 2.1 && !(Math.abs(p.x) < 0.28 && p.y < 1.35)) return { dist: Math.hypot(p.x, p.z) * W.FT, land: p.clone(), cross: null, blocked: true, apex, hang: t };
    const q = polar(p);
    if (!cross && q.r >= W.wallR(q.a)) {
      cross = { y: p.y, r: q.r, a: q.a, p: p.clone(), t };
      if (p.y <= W.WALL_H) return { dist: q.r * W.FT, land: p.clone(), cross, apex, hang: t };
    }
    if (p.y <= BALL_R && v.y < 0) break;
  }
  return { dist: Math.hypot(p.x, p.z) * W.FT, land: p.clone(), cross, apex, hang: t };
}
function wallThud(b) {
  sfx("clang"); b.wallHit = true;
}
function flyBall(b, dt) {
  const p = b.mesh.position, v = b.v;
  phys += dt;
  for (let n = 0; phys >= FH && n < 48; n++, phys -= FH) {
    const s = aero(p, v, b.batted);
    const oz = p.z - v.z * FH;
    const fast = s > 3;
    // The backstop behind the plate (a missed pitch is caught before it gets there; this is for safety).
    if (p.z < W.BACKSTOP_Z + BALL_R) { p.z = W.BACKSTOP_Z + BALL_R; v.z *= -0.1; v.x *= 0.4; v.y *= 0.4; if (fast) sfx("net", Math.min(1, s / 25)); }
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
      if (b.batted && !b.landed) { b.landed = true; onLanded(b); }
      p.y = BALL_R;
      if (v.y < -1.2) { v.y *= -0.42; v.x *= 0.78; v.z *= 0.78; sfx("bounce", Math.min(1, -v.y / 6)); }
      else { v.y = 0; v.x *= 1 - 2.5 * FH; v.z *= 1 - 2.5 * FH; }
    }
    if (b.batted) {
      const q = polar(p), Rw = W.wallR(q.a);
      if (q.r > Rw - BALL_R && !b.over) {
        if (p.y <= W.WALL_H) {
          // Into the wall: bounce back off it.
          const nx = p.x / q.r, nz = p.z / q.r, vr = v.x * nx + v.z * nz;
          p.x = nx * (Rw - BALL_R); p.z = nz * (Rw - BALL_R);
          if (vr > 0) { v.x -= 1.35 * vr * nx; v.z -= 1.35 * vr * nz; v.y *= 0.8; if (!b.wallHit) wallThud(b); }
        } else { b.over = true; onOverWall(b); }
      }
      // Gone into the seats.
      if (b.over && q.r > Rw + 0.5 && p.y < W.standY(q.r - Rw)) { live.mesh.visible = false; live.mode = "hidden"; return 0; }
    }
  }
  b.mesh.rotation.x += v.z * dt * 8; b.mesh.rotation.z -= v.x * dt * 8;
  return v.length();
}
// A batted ball touched the ground for the first time, or went over the wall.
function onLanded(b) {
  if (b.pred && !b.over && !b.pred.cross) {
    // A ball that dies near the plate would put its marker in front of the machine: hang that one above it.
    if (b.pred.dist < 150) flags.add(Math.round(b.pred.dist) + " FT", new THREE.Vector3(0, 3.5, W.MACHINE.z), false, true);
    else flags.add(Math.round(b.pred.dist) + " FT", b.mesh.position.clone().setY(1.6), false);
  }
  showDist(b.pred ? Math.round(b.pred.dist) : null, true);
}
function onOverWall(b) {
  const pr = b.pred;
  if (!pr) return;
  if (!b.foul) flags.add("HR " + Math.round(pr.dist) + " FT", b.mesh.position.clone().setY(W.WALL_H + 2.2), true);
  showDist(Math.round(pr.dist), true);
}
let distFinalAt = -1;   // game time the final distance went up (the card clears itself a few seconds later)
function showDist(ft, final) {
  const d = $("dist");
  d.classList.toggle("final", !!final);
  if (ft == null) { d.classList.add("hidden"); distFinalAt = -1; return; }
  if (final) distFinalAt = time;
  d.classList.remove("hidden");
  $("dist-n").textContent = ft;
}
function retireLive() {
  // Leave the ball lying where it stopped; keep the floor from filling up.
  if (live.mode === "hidden") return;
  fx.stop();
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
const fence = W.fenceFt;
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
// pr = predict(): the distance is where the ball really lands (or hits the wall); a home run is
// a ball that reaches the wall's radius above the wall.
function classify(o, pr) {
  const foul = Math.abs(o.spray) > 45;
  const dist = Math.round(pr.dist);
  o.dist = dist;
  o.hang = +pr.hang.toFixed(1);
  if (foul) { o.kind = "FOUL BALL"; o.pts = 2; o.fair = false; }
  else if (pr.cross && pr.cross.y > W.WALL_H) { o.kind = dist >= 440 ? "MOONSHOT!" : "HOME RUN!"; o.pts = 100 + Math.max(0, Math.round((dist - 330) / 2)); o.hr = true; }
  else if (pr.cross) { o.kind = "OFF THE WALL"; o.pts = 70; o.wall = true; }
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
  if (phase !== "play" || P.swung || inputOff) return;
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
  const o = judge(pending.err);
  pending = null;
  R.n++;
  // Launch from the bat. Spray > 0 = pulled = towards +x (left field for a right-handed hitter).
  const v = o.ev * 0.44704 * (o.grade === "WEAK" ? 0.75 : 1);
  bat.sweetSpot(live.mesh.position);
  live.v.set(Math.sin(o.spray * DEG) * Math.cos(o.la * DEG), Math.sin(o.la * DEG), Math.cos(o.spray * DEG) * Math.cos(o.la * DEG)).multiplyScalar(v);
  live.pred = predict(live.mesh.position, live.v);
  classify(o, live.pred);
  live.mode = "free"; live.batted = true; live.hitMachine = false; live.rest = 0;
  live.landed = false; live.over = false; live.wallHit = false; live.foul = !o.fair;
  phys = 0;
  P.state = "batted"; P.t = 0;
  B.speed = 1.0;   // let the follow-through play out at the clip's own pace
  const q = o.grade === "PERFECT" ? 1 : o.grade === "GREAT" ? 0.85 : o.grade === "GOOD" ? 0.6 : 0.25;
  sfx("crack", q);
  shake = 0.05 + q * 0.12;
  fx.start("hit", clamp((o.ev - 55) / 60, 0.1, 1));
  showDist(0, false);
  radar(Math.round(P.mph), o.ev);
  scoreHit(o);
}

// ---- scoring + HUD -----------------------------------------------------------------------------------
function mult() { return R.streak >= 5 ? 2 : R.streak >= 3 ? 1.5 : 1; }
function scoreHit(o) {
  const goodHit = o.hr || o.wall || o.kind === "LINE DRIVE" || o.kind === "DEEP FLY";
  if (goodHit) R.streak++; else R.streak = 0;
  R.bestStreak = Math.max(R.bestStreak, R.streak);
  const pts = Math.round(o.pts * (goodHit ? mult() : 1));
  R.score += pts;
  R.hits.push(o);
  R.evs.push(o.ev);
  R.maxEV = Math.max(R.maxEV, o.ev);
  R.total += o.dist;
  R.longest = Math.max(R.longest, o.dist);
  if (o.hr) { R.hr++; sfx("hr"); }
  else if (goodHit) sfx("good");
  park.board({ last: o, hr: R.hr, longest: R.longest, hits: R.hits.length, n: R.n, total: R.total });
  const sub = `${o.dist} FT &middot; ${o.ev} MPH &middot; ${o.la}&deg;`;
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
  $("hits").textContent = `HITS ${R.hits.length}/${R.n}`;
  $("far").textContent = R.longest ? `LONGEST ${R.longest} FT` : "";
  $("hrs").textContent = `HR ${R.hr}`;
  $("tot").textContent = R.total ? `${R.total.toLocaleString("en-US")} FT TOTAL` : "";
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
  Object.assign(R, { score: 0, n: 0, streak: 0, bestStreak: 0, hits: [], hr: 0, longest: 0, maxEV: 0, evs: [], whiffs: 0, total: 0 });
  drawSpray($("spray"), [], false);
  flags.clear();
  showDist(null);
  park.board({ pitch: 0, exit: 0, last: null, hr: 0, longest: 0, hits: 0, n: 0, total: 0 });
  updateHud();
}
function startGame(lv) {
  level = lv;
  unlockAudio();
  resetRound();
  P.k = 0;
  if (!online()) bucketSeed = (Math.random() * 2147483646 + 1) | 0;
  renderBoard();
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
  submitBoards(level, R.score, R.longest);
  if (inLobby && !Net.online() && HL.isHost) setTimeout(() => sendResults([{ id: ctx.playerId, s: R.score, hr: R.hr, lg: R.longest }]), 5000);
  setTimeout(() => {
    renderBoard();
    $("r-score").textContent = R.score;
    $("r-best").textContent = newBest && R.score > 0 ? "NEW BEST!" : "Best: " + (save.best[level] || 0);
    const ev = R.evs.length ? Math.round(R.evs.reduce((a, b) => a + b, 0) / R.evs.length) : 0;
    const hard = R.evs.filter((e) => e >= 95).length;
    $("r-stats").innerHTML = [
      ["PITCHES HIT", R.hits.length + " / " + BUCKET], ["HOME RUNS", R.hr], ["LONGEST", R.longest ? R.longest + " ft" : "--"],
      ["TOTAL DISTANCE", R.total ? R.total.toLocaleString("en-US") + " ft" : "--"], ["AVG DISTANCE", R.hits.length ? Math.round(R.total / R.hits.length) + " ft" : "--"],
      ["MAX EXIT VELO", R.maxEV ? R.maxEV + " mph" : "--"], ["AVG EXIT VELO", ev ? ev + " mph" : "--"], ["HARD HIT (95+)", hard],
      ["BEST STREAK", R.bestStreak], ["WHIFFS", R.whiffs]
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
    drawSpray($("r-spray"), R.hits, true);
    $("r-level").textContent = LEVELS[level].name + " · " + LEVELS[level].mph + " MPH";
    $("results").classList.remove("hidden");
  }, 1800);
}

// ---- HopLobby leaderboards -----------------------------------------------------------------------
// One board per machine speed for the bucket score (a 45 mph bucket and a 95 mph one aren't comparable)
// plus "longest" (the longest hit, in feet). Declared in Notes/leaderboards.json (Dev Mode Test setup
// and, later, the submission). HopLobby keeps each player's best; guests can read but not submit.
const LB_IDS = ["rookie", "high-school", "college", "pro", "all-star"];
const lbOK = () => !!(HL && ctx && !ctx.standalone && HL.supports && HL.supports("leaderboards"));
async function submitBoards(lv, score, longest) {
  const box = $("r-lb");
  box.innerHTML = "";
  if (!lbOK()) return;
  const id = "score-" + LB_IDS[lv];
  try {
    const sub = await HL.leaderboards.submit(id, score);
    if (longest > 0) HL.leaderboards.submit("longest", longest).catch((e) => console.warn("leaderboard", e));
    const page = await HL.leaderboards.top(id, { limit: 5 });
    const rank = sub && sub.entry ? sub.entry.rank : page && page.you ? page.you.rank : null;
    const rows = (page.entries || []).map((r) => `<div class="lbr${r.isYou ? " you" : ""}"><span>${r.rank}</span><b>${esc(r.name)}</b><em>${r.score}</em></div>`).join("");
    box.innerHTML = `<div class="lbh">${LEVELS[lv].name} LEADERBOARD${rank ? " · YOU'RE #" + rank + (sub.best ? " · NEW BEST" : "") : ""}</div>${rows}`;
  } catch (e) {
    console.warn("leaderboard", e);
    // A guest can't post a score; say so instead of leaving the box empty.
    if (e && e.code === "sign_in_required") box.innerHTML = `<div class="lbh">SIGN IN TO HOPLOBBY TO POST YOUR SCORE</div>`;
  }
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
    }
  } else if (P.state === "ready") {
    if (P.t >= 0.62) {
      P.state = "feed"; P.t = 0;
      lightCol.color.setHex(0x30ff60); lightCol.emissive.setHex(0x10c040);
      live.mesh.visible = true; live.mode = "feed"; live.batted = false;
      live.landed = live.over = live.wallHit = live.foul = false; live.pred = null;
      phys = 0;
    }
  } else if (P.state === "feed") {
    const u = Math.min(1, P.t / 0.36);
    live.mesh.position.copy(chuteTop).lerp(R0, u * u);
    if (time >= P.release) {
      P.state = "flight"; P.t = 0; live.mode = "pitch";
      sfx("thunk");
      fx.start("pitch");
      showDist(null);
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
    // A pitch that got by: the catcher takes it behind the plate.
    if (P.state === "passed" && P.judged !== "hit" && live.mode === "free" && live.mesh.position.z < CONTACT.z - 1.4) {
      live.mesh.visible = false; live.mode = "hidden"; sfx("thunk");
    }
    const due = online() && Net.now() >= Net.readyAt(P.k) - 300;   // the next pitch is coming
    if (live.mode === "hidden" || due || P.t > (P.state === "batted" ? 9 : 2.2)) {
      retireLive();
      P.state = "wait"; P.wait = 0.9;
    }
  }
}
function resolveMiss() {
  if (P.judged === "hit") return;   // the bat is on its way; contact() resolves it
  R.n++;
  park.board({ n: R.n, hits: R.hits.length });
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
    if (phase === "results" && !inLobby) location.reload();   // opened on its own: another bucket
    else swing();
  }
});
renderer.domElement.addEventListener("pointerdown", (e) => { if (phase === "play") { e.preventDefault(); unlockAudio(); swing(); } });
$("swing-btn").addEventListener("pointerdown", (e) => { e.preventDefault(); unlockAudio(); swing(); });

// HopLobby runs the lobby, Ready, the countdown and the rematch. This frame is one round: it starts by itself
// (alone, straight away; in a lobby on the host's start message, see net.js) and ends with endGame(results).
function lobbyUi() { document.body.classList.toggle("online", Net.online()); }
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
function sendResults(rows) {
  if (!inLobby || !HL.endGame) return;
  const entries = rows.map((r, i) => ({ playerId: r.id, place: i + 1, score: r.s, label: (r.hr ? r.hr + " HR · " : "") + (r.lg ? r.lg + " ft" : "no hits") }));
  try { HL.endGame({ title: "Home Run Derby · " + LEVELS[level].name, entries }); } catch (e) { console.warn("endGame", e); }
}
const netHandlers = {
  board: renderBoard,
  start(m) {
    bucketSeed = m.seed;
    startGame(m.lv);
    // This frame was reloaded mid-bucket: carry on with the score it had.
    const s = Net.saved(m.id);
    if (s) { R.score = s.s; R.hr = s.hr; R.longest = s.lg; updateHud(); }
  },
  finish(rows) { setTimeout(() => sendResults(rows), 5000); }   // everyone is done: leave the results card up a moment
};
// Double-tap zoom on the controls is stopped by touch-action: manipulation in the CSS. Don't
// preventDefault touchend on buttons here: on phones that cancels the click, so no menu button works.

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
  // Highlighter on the pitch, fireball on a hit (a ball nearly at rest loses it).
  const glowing = (live.mode === "pitch" || (live.mode === "free" && live.v.length() > 2.5)) && live.mesh.visible;
  fx.update(dt, live.mesh.position, glowing);
  flags.update();
  park.tick(time);
  // The distance readout counts up while the ball is in the air.
  if (live.batted && live.mode === "free" && !live.landed && !live.over && live.mesh.visible) showDist(Math.round(Math.hypot(live.mesh.position.x, live.mesh.position.z) * W.FT), false);
  // Never let a finished hit's card (foul, grounder, fly, wall, HR) linger: clear it after a few seconds,
  // and whenever a new pitch is live with no batted ball in the air.
  if (!$("dist").classList.contains("hidden")) {
    const pitchLive = P.state === "ready" || P.state === "feed" || P.state === "flight";
    if ((distFinalAt >= 0 && time - distFinalAt > 3) || (pitchLive && !live.batted) || phase !== "play") showDist(null);
  }

  // --- camera
  if (phase === "title") {
    // Sway in front of him (he faces -x), at the plate; he sits right of centre, clear of the panel.
    const a = Math.sin(time * 0.15) * 0.45 + 0.35;
    camPos.set(DECK.x - 3.0 * Math.cos(a), 1.45, DECK.z + 3.0 * Math.sin(a));
    _v.set(DECK.x - 0.4, 1.05, DECK.z - 0.75);
    camera.position.lerp(camPos, 1 - Math.exp(-3 * dt));
    look.lerp(_v, 1 - Math.exp(-4 * dt));
  } else {
    camPos.copy(PLAY_CAM.pos);
    _v.copy(PLAY_CAM.look);
    // Follow a batted ball, and zoom in on it as it gets away (telephoto, like the broadcast).
    let zt = 1;
    if (live.batted && live.mode === "free" && live.mesh.visible) {
      const far = Math.hypot(live.mesh.position.x, live.mesh.position.z);
      const k = far > 14 ? 0.92 : 0.35;
      _w.copy(live.mesh.position).sub(_v).multiplyScalar(k); _v.add(_w);
      zt = 1 - 0.55 * smooth(clamp((far - 20) / 70, 0, 1));
    }
    zoom += (zt - zoom) * (1 - Math.exp(-(zt < zoom ? 2.2 : 3.5) * dt));
    camera.position.lerp(camPos, 1 - Math.exp(-2.5 * dt));
    look.lerp(_v, 1 - Math.exp(-(live.batted ? 4 : 2.5) * dt));
  }
  const fov = baseFov * (phase === "title" ? 1 : zoom);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.lookAt(look);
  if (shake > 0 && !shakeOff()) { camera.position.x += (Math.random() - 0.5) * shake * 0.12; camera.position.y += (Math.random() - 0.5) * shake * 0.12; shake = Math.max(0, shake - dt * 0.8); }
}

// Camera shake follows HopLobby's Shake setting and the player's reduced-motion wish.
const shakeOff = () => !!HL && ((HL.settings && HL.settings.shake === false) || (HL.device && HL.device.reducedMotion));
let last = performance.now(), slow = 0, paused = false, hlPaused = false, inputOff = false, gfxAuto = true;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (paused || hlPaused) return;   // HopLobby's menu (paused: the test server's step hook drives the sim instead)
  if (dt > 0.05) dt = 0.05;
  step(dt);
  renderer.render(scene, camera);
  // A slow machine drops resolution only when the player left graphics on Auto.
  if (gfxAuto && phase === "play" && dt > 0.034) { slow += dt; if (slow > 3 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); slow = 0; } }
  else slow = Math.max(0, slow - dt * 0.5);
}

updateHud();
drawSpray($("spray"), [], false);
camera.position.set(DECK.x - 2.8, 1.45, DECK.z + 1.0);
look.set(DECK.x - 0.4, 1.05, DECK.z - 0.75);
play("deck", "onDeck", { root: DECK, loop: true, blend: 0 });
fade = 0;
step(0);
qOut.set(qT); hOut.copy(hT);
$("loading").classList.add("hidden");
// HopLobby: its Esc menu (settings + keys), graphics presets and volume, then ready(). Alone, the menu
// pauses the bucket; in a lobby the pitches keep coming on the shared clock, so only the input stops.
Net.init(ctx, netHandlers, level);
lobbyUi();
function applyGraphics(g) {
  if (!g) return;
  const shadows = g.shadows !== "off";
  gfxAuto = !!g.auto;
  pixelRatio = Math.min(devicePixelRatio || 1, g.pixelRatio, isTouch ? 1.6 : 2);
  renderer.setPixelRatio(pixelRatio);
  if (renderer.shadowMap.enabled !== shadows) { renderer.shadowMap.enabled = shadows; scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); }); }
  sun.castShadow = shadows;
  const sz = g.shadows === "soft" ? 1024 : 512;
  if (sun.shadow.mapSize.x !== sz) { sun.shadow.mapSize.set(sz, sz); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  camera.far = 600 * g.drawDistance; camera.updateProjectionMatrix();
  scene.fog.far = 480 * g.drawDistance;
  fx.setParticles(g.particles);
  renderer.setSize(innerWidth, innerHeight);
}
function applyAudio() { const a = (HL && HL.settings && HL.settings.audio) || {}; setAudio((a.master == null ? 1 : a.master) * (a.sfx == null ? 1 : a.sfx), !!a.muted); }
if (HL && HL.menu) {
  HL.menu.set({
    controls: [{ title: "Home Run Derby", keys: [
      { keys: [isTouch ? "Tap" : "Space"], action: "Swing: time it with the machine's green light" },
      { keys: ["Early / late"], action: "Early pulls the ball, late pushes it the other way" }
    ] }],
    controlsNote: "Right on the money clears the wall. Fifteen pitches a bucket; the best bucket wins.",
    shared: ["graphics", "audio", "shake"],
    actions: [{ id: "credits", label: "Credits" }]
  }).catch((e) => console.warn("menu", e));
  HL.on("menuAction", (id) => { if (id === "credits") $("credits").classList.remove("hidden"); });
}
$("credits-close").addEventListener("click", () => $("credits").classList.add("hidden"));
if (HL && HL.graphics) { applyGraphics(HL.graphics); HL.on("graphics", applyGraphics); }
if (HL) { applyAudio(); HL.on("settings", applyAudio); }
if (HL && HL.on) {
  HL.on("pause", () => { inputOff = true; if (!Net.online()) hlPaused = true; });
  HL.on("resume", () => { inputOff = false; hlPaused = false; });
}
if (Net.out) {
  // Not in this round (HopLobby started it without us): wait for the next one.
  $("ld-msg").textContent = "This round has started. You're in the next one.";
  $("loading").classList.remove("hidden");
} else if (!Net.online()) startGame(level);   // alone: straight in. In a lobby the host's start message does it.
requestAnimationFrame(frame);
progress(1);
if (HL) HL.ready();
