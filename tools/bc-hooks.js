
// ---- TEST ONLY: tools/serve.cjs appends this file to js/main.js when the page is served with ?fake=<id>
// (tools/harness.html does that). It is never part of the build: the game itself has no test switches.
let __auto = null;   // swing this many seconds off perfect on every pitch (null = don't)
function __autoTick() {
  if (__auto == null || phase !== "play" || P.swung) return;
  if ((P.state === "ready" || P.state === "feed" || P.state === "flight") && time >= P.release + P.T - D_HIT + __auto) swing();
}
(function tick() { __autoTick(); requestAnimationFrame(tick); })();
window.BC = {
  start: (lv) => startGame(lv || 0),
  begin: () => startGame(level), net: Net, avatar: () => !!av,
  swing,
  auto: (err) => { __auto = err == null ? null : err; },
  state: () => ({ phase, mode: B.mode, clip: B.clip, t: +B.t.toFixed(2), pitch: P.state, kind: P.kind, mph: P.mph && +P.mph.toFixed(1), judged: P.judged, n: R.n, score: R.score, last: R.hits.length ? R.hits[R.hits.length - 1] : null, ball: live.mode, bp: live.mesh.position.toArray().map((x) => +x.toFixed(2)) }),
  now: () => time,
  pause: (on) => { paused = on !== false; },
  step: (n, dt, noRender) => { for (let i = 0; i < n; i++) { step(dt || 1 / 60); __autoTick(); } if (!noRender) renderer.render(scene, camera); },
  info: { HIT, MISS, D_HIT, ROOT, CONTACT, START },
  cam: (p, l) => { PLAY_CAM.pos.fromArray(p); if (l) PLAY_CAM.look.fromArray(l); camera.position.copy(PLAY_CAM.pos); look.copy(PLAY_CAM.look); },
  R, P
};
