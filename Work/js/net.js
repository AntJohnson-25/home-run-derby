// Multiplayer over the HopLobby relay: everyone bats at once, each in their own cage, against
// the same 15 pitches at the same moments, with a live scoreboard. HopLobby runs the lobby, Ready,
// the countdown and the rematch; this frame is loaded for one round (the default, no `session`),
// so it only has to line the batters up and finish the round with endGame(results).
//  - Once the frames have loaded (everyone said "hi", or 8 s passed) the HOST sends `start`: a seed
//    (every machine draws the same pitches from it) and `go`, the relay clock's ms when pitch 0's
//    light comes on; pitch k comes PERIOD later each. So nobody waits on anybody, and a slow or
//    late machine just catches up (or skips the pitches it missed).
//  - Each player judges their own swings and sends their score after every pitch. The relay is
//    unchecked, so this is a friendly scoreboard (and the results card HopLobby shows); real
//    records are the leaderboards, written by the game for the signed-in player.
//  - When every player still here is done (or 20 s after the host is), the host ends the round.
//  - The batters are the round's roster (who readied up in HopLobby's lobby), not everyone in the lobby.
//  - A host that reloads mid-bucket picks the bucket back up from the players' hellos (they carry it)
//    instead of starting a new one; everyone's own score comes back from sessionStorage.
// Messages (each one is checked before use):
//   player -> host  { t: "hi", m?: { id, lv, seed, go } }         (re)joined: catch me up (m: the bucket I'm in)
//   host -> all     { t: "start", id, lv, seed, go }
//   player -> all   { t: "sc", id, s, n, hr, lg, k, done }       my score in bucket `id`
let HL = window.HopLobby;   // re-read in init(): the test harness swaps in a stand-in SDK after this module loads
export const PERIOD = 5.6;          // seconds between pitches
const KEEP_UP = 1000, LEVELS = 5, WAIT_HI = 8, FINISH_WAIT = 20, BUCKET = 15;
const SAVE_KEY = "home-run-derby:round";

const N = {
  role: "solo", out: false, lv: 0, match: null, lastHost: 0, lastHi: 0,
  scores: {},    // playerId -> { id: match id, s, n, hr, lg, k, done }
  mine: null, h: {}, present: {}, heard: {}, boot: 0, doneAt: 0, ended: false
};
const clock = () => performance.now() / 1000;
const finite = (v, lim) => typeof v === "number" && isFinite(v) && Math.abs(v) <= lim;
const me = () => (HL && HL.context ? HL.context.playerId : null);
const hostId = () => (HL && HL.context ? HL.context.hostId : null);

N.online = () => N.role !== "solo";
N.isHost = () => N.role === "host";
N.me = me;
N.now = () => (HL && HL.now ? HL.now() : Date.now());
N.nameOf = (id) => {
  const p = HL && HL.players.find((q) => q.id === id);
  return p ? String(p.name || "Player").slice(0, 18) : "Player";
};
// Relay-clock ms when pitch k's light comes on.
N.readyAt = (k) => N.match.go + k * PERIOD * 1000;

// The round's batters: HopLobby's roster for this round, or everyone on a page without sessions.
function players() {
  const s = HL.session && HL.session.get ? HL.session.get() : HL.context && HL.context.session;
  const r = s && Array.isArray(s.roster) && s.roster.length ? s.roster : null;
  return r ? HL.players.filter((p) => r.includes(p.id)) : HL.players;
}

N.init = function (ctx, handlers, lv) {
  HL = window.HopLobby;
  N.h = handlers || {};
  N.lv = Math.max(0, Math.min(LEVELS - 1, lv | 0));
  if (!ctx || ctx.standalone || !HL) { N.role = "solo"; return; }
  // Not in this round's roster: HopLobby brings this player in for the next one.
  if (!players().some((p) => p.id === ctx.playerId)) { N.role = "solo"; N.out = true; return; }
  if (players().length < 2) { N.role = "solo"; return; }
  N.role = ctx.hostId === ctx.playerId ? "host" : "client";
  N.boot = clock();
  notePresent();
  HL.on("message", onMessage);
  HL.on("players", onPlayers);
  HL.on("relay", (s) => { if (s === "open" && N.role === "client") hello(true); });
  if (!N.isHost()) hello(true);
  setInterval(keepUp, KEEP_UP);
};
function notePresent() { N.present = {}; players().forEach((p) => { N.present[p.id] = true; }); }
function hello(force) {
  const t = clock();
  if (!force && t - N.lastHi < 1) return;
  N.lastHi = t;
  HL.send(N.match ? { t: "hi", m: { id: N.match.id, lv: N.match.lv, seed: N.match.seed, go: N.match.go } } : { t: "hi" }, hostId());
}
const startMsg = () => ({ t: "start", id: N.match.id, lv: N.match.lv, seed: N.match.seed, go: N.match.go });
// A bucket description from the relay: { id, lv, seed, go } with every field checked, or null.
function readMatch(d) {
  if (!d || typeof d !== "object" || typeof d.id !== "string" || !finite(d.go, 1e14) || !finite(d.seed, 2147483647) || !finite(d.lv, LEVELS - 1) || d.lv < 0) return null;
  return { id: d.id.slice(0, 16), lv: d.lv | 0, seed: d.seed | 0, go: d.go };
}
// This player's own score in bucket `id`, kept across a reload of the frame.
N.saved = (id) => {
  try { const s = JSON.parse(sessionStorage.getItem(SAVE_KEY) || "null"); return s && s.id === id ? s : null; } catch (e) { return null; }
};

// The relay drops what's sent while it (re)connects and a loading game isn't listening yet, and
// nothing is re-sent for us: so once a second the host (re)sends the start to anyone whose score
// doesn't carry it yet, a player who hasn't heard the host says hello again, and everyone repeats
// their own score every few seconds.
let keepN = 0;
function keepUp() {
  keepN++;
  if (N.isHost()) {
    if (!N.match) {
      const others = players().filter((p) => p.id !== me());
      if ((others.length && others.every((p) => N.heard[p.id])) || clock() - N.boot > WAIT_HI) N.hostStart();
    } else players().forEach((p) => {
      if (p.id === me()) return;
      const s = N.scores[p.id];
      if (!s || s.id !== N.match.id) HL.send(startMsg(), p.id);
    });
    finishCheck();
  } else if (!N.match || clock() - N.lastHost > 4) hello(true);
  if (keepN % 3 === 0 && N.mine) HL.send(N.mine);
}

// ---- host ------------------------------------------------------------------------------------------
N.hostStart = function () {
  if (!N.isHost() || N.match) return;
  // 4.5 s: time for everyone to walk into the box before the first light.
  N.match = { id: Math.random().toString(36).slice(2, 10), lv: N.lv, seed: (Math.random() * 2147483646 + 1) | 0, go: Math.round(N.now() + 4500) };
  N.scores = {}; N.mine = null;
  HL.send(startMsg());
  if (N.h.start) N.h.start(N.match);
};
// Every batter still here has finished (or the wait ran out): end the round with the standings.
N.allDone = () => {
  const id = N.match && N.match.id;
  return !!id && players().every((p) => { const s = N.scores[p.id]; return s && s.id === id && s.done; });
};
function finishCheck() {
  if (N.ended || !N.match || !N.mine || !N.mine.done) return;
  if (!N.doneAt) N.doneAt = clock();
  if (N.allDone() || clock() - N.doneAt > FINISH_WAIT) { N.ended = true; if (N.h.finish) N.h.finish(N.board()); }
}

// ---- scores ------------------------------------------------------------------------------------------
// After every pitch: R = the bucket so far (main.js), kind = what that pitch did.
N.score = function (R, kind, done) {
  if (!N.online() || !N.match) return;
  N.mine = { t: "sc", id: N.match.id, s: R.score | 0, n: R.n | 0, hr: R.hr | 0, lg: R.longest | 0, k: String(kind || "").slice(0, 16), done: !!done };
  N.scores[me()] = N.mine;
  try { sessionStorage.setItem(SAVE_KEY, JSON.stringify(N.mine)); } catch (e) { /* storage off: a reload starts from 0 */ }
  HL.send(N.mine);
  if (N.h.board) N.h.board();
};
// Everyone in the round, best score first (players without a score yet at the bottom).
N.board = function () {
  const id = N.match && N.match.id, out = [];
  players().forEach((p) => {
    const s = N.scores[p.id];
    const cur = s && s.id === id ? s : null;
    out.push({ id: p.id, name: N.nameOf(p.id), you: p.id === me(), s: cur ? cur.s : 0, n: cur ? cur.n : 0, hr: cur ? cur.hr : 0, lg: cur ? cur.lg : 0, k: cur ? cur.k : "", done: cur ? cur.done : false, has: !!cur });
  });
  return out.sort((a, b) => (b.has - a.has) || (b.s - a.s) || (b.hr - a.hr) || (b.lg - a.lg));
};

// ---- the relay -------------------------------------------------------------------------------
function onMessage(d, from) {
  if (!d || typeof d !== "object" || typeof d.t !== "string" || typeof from !== "string") return;
  if (!N.isHost() && from === hostId()) N.lastHost = clock();
  if (d.t === "sc") {
    if (typeof d.id !== "string" || !N.present[from] || from === me()) return;
    if (![d.s, d.n, d.hr, d.lg].every((v) => finite(v, 1e6))) return;
    N.scores[from] = { id: d.id.slice(0, 16), s: d.s | 0, n: Math.max(0, Math.min(15, d.n | 0)), hr: d.hr | 0, lg: d.lg | 0, k: typeof d.k === "string" ? d.k.slice(0, 16) : "", done: !!d.done };
    if (N.h.board) N.h.board();
    return;
  }
  if (N.isHost()) {
    if (d.t === "hi" && N.present[from]) {
      // This frame was reloaded mid-bucket: carry on with the bucket the players are in, not a new one.
      const m = !N.match && HL.context && HL.context.joinedLate && readMatch(d.m);
      if (m && N.now() < m.go + (BUCKET * PERIOD + 30) * 1000) {
        N.match = m; N.lv = m.lv;
        N.mine = null;
        if (N.h.start) N.h.start(N.match);
      }
      N.heard[from] = true;
      if (N.match) HL.send(startMsg(), from);
      if (N.mine) HL.send(N.mine, from);
    }
    return;
  }
  // The rest only counts from the current host.
  if (from !== hostId()) return;
  if (d.t === "start") {
    const m = readMatch(d);
    if (!m || (N.match && N.match.id === m.id)) return;
    N.match = m;
    N.lv = N.match.lv;
    N.mine = null;
    if (N.h.start) N.h.start(N.match);
  }
}
function onPlayers(players, newHost) {
  notePresent();
  if (newHost === me() && !N.isHost()) { N.role = "host"; N.boot = clock(); }   // the host left: we take over the finish
  if (N.h.board) N.h.board();
}

export const Net = N;
