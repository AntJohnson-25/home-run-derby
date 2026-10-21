// TEST ONLY (not shipped: it lives in tools/, outside Work/). A stand-in for the HopLobby SDK so
// several game frames in one browser can play a lobby together: the relay is a BroadcastChannel.
// main.js imports it only when the page is opened with ?fake=<id> (tools/harness.html does that).
//   ?fake=A&lobby=A,B,C   this frame is A; the lobby is A, B and C (the first one hosts)
//   &opts={"speed":"2"}  lobby options     &late  this frame (re)joined mid-round
const q = new URLSearchParams(location.search);
const me = q.get("fake");
const NAMES = { A: "Ant Dawg", B: "Joshua", C: "Kim", D: "Sam" };
let present = (q.get("lobby") || "A,B").split(",");
let host = present[0];
const bc = new BroadcastChannel("fk-lobby");
const L = {};
let provider = null;
const emit = (e, ...a) => (L[e] || []).slice().forEach((f) => { try { f(...a); } catch (err) { console.error("listener " + e, err); } });
const players = () => present.map((id) => ({ id, name: NAMES[id] || id, isHost: id === host, isYou: id === me, signedIn: true }));
const GFX = { level: q.get("g") || "medium", auto: false, pixelRatio: 1, shadows: "simple", antialias: true, effects: true, particles: 1, drawDistance: 0.8, textureScale: 1 };

const HL = {
  version: 1, release: "fake",
  context: null,
  get players() { return players(); },
  get me() { return players().find((p) => p.isYou) || null; },
  get isHost() { return host === me; },
  graphics: GFX,
  settings: { audio: { master: 1, music: 0, sfx: 0.5, muted: true }, graphics: GFX.level, graphicsLevel: GFX.level },
  prefs: {},
  device: { touch: false, mobile: false, reducedMotion: false },
  async init(o) {
    this.context = {
      sdk: 1, release: "fake", gameId: "dev", lobbyCode: "TEST01", playerId: me, hostId: host, players: players(), locale: "en",
      dev: true, standalone: false, lateJoin: false, joinedLate: q.has("late"), session: null,
      options: Object.assign({}, (o && o.options) || {}, JSON.parse(q.get("opts") || "{}"))
    };
    return this.context;
  },
  progress() {}, ready() { console.log("[fake] ready " + me); },
  send(d, to) { bc.postMessage({ from: me, to, d: JSON.parse(JSON.stringify(d)) }); return true; },
  now() { return Date.now(); },
  on(e, f) { (L[e] = L[e] || []).push(f); return () => this.off(e, f); },
  off(e, f) { L[e] = (L[e] || []).filter((x) => x !== f); },
  avatar(id) { return fetch(id === "B" || id === "D" ? "/tools/test-avatar-tpose.glb" : "/tools/test-avatar.glb").then((r) => r.arrayBuffer()); },
  menu: { async set() { return {}; }, open() { return false; } },
  leaderboards: { async submit() { return { entry: { rank: 1 }, best: true }; }, async top() { return { entries: [] }; } },
  syncState(fn) { provider = fn; return () => { provider = null; }; },
  requestState() { bc.postMessage({ from: me, req: "state" }); },
  endGame(r) { window.__ended = r; console.log("[fake] endGame " + JSON.stringify(r)); },
  reportError(e, where) { console.warn("[fake] reportError", where, e); },
  exit() {},
  supports() { return true; },
  session: { get: () => null, async ready() { return null; }, async end(r) { HL.endGame(r); return null; } }
};

function drop(id) {
  if (!present.includes(id)) return;
  present = present.filter((x) => x !== id);
  const was = host;
  if (host === id) host = present[0];
  emit("leave", { id, name: NAMES[id] || id });
  emit("players", players(), host);
  if (host !== was) emit("host", host, was);
}
bc.onmessage = (ev) => {
  const m = ev.data;
  if (m.leave) return drop(m.leave);
  if (m.req === "state") { if (host === me && provider) bc.postMessage({ from: me, to: m.from, state: provider(m.from) }); return; }
  if (m.state !== undefined) { if (m.to === me) emit("state", m.state, m.from); return; }
  if (m.to !== undefined && m.to !== null && !(Array.isArray(m.to) ? m.to.includes(me) : m.to === me)) return;
  emit("message", m.d, m.from);
};
// The harness makes a player leave: everyone (this frame too) drops them.
window.fkLeave = (id) => { bc.postMessage({ leave: id }); drop(id); };
globalThis.HopLobby = HL;
