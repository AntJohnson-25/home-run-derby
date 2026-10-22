// For tools/shot.cjs --evalfile on Work/index.html?fake=A&lobby=A: step a solo bucket until a perfect swing has
// sent a ball well into the air, then draw that frame (for the cover).
(() => {
  BC.pause(true);
  BC.auto(0.004);
  let flying = 0;
  for (let i = 0; i < 6000; i++) {
    BC.step(1, 1 / 60, true);
    const s = BC.state();
    if (s.last && s.last.hr && s.ball === "free") { if (++flying > 26) break; } else flying = 0;
  }
  BC.step(1, 1 / 60);
  return JSON.stringify(BC.state().last);
})()
