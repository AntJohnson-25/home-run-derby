# Batting Cage: context

One-button batting cage game (Three.js 0.170, same stack as timber-and-stone/pickleball). The batter is the
user's own athlete from Timber & Stone (`assets/chars/fit.json`, copied as-is). Animations = the user's
Mixamo baseball set (`Animations-characters\baseball-animations`, copied into `Source/`). Built 2026-10-05
at the user's request ("use the character from timber and stone, space bar to swing, you build I will test").

## Update 2026-10-06: ANT is a pickable batter
- User's own character "Ant" (`G:\3D-Me\3D-AntDawg.fbx`, built in `Animations-characters\ant`, README there):
  `assets/chars/ant.json`. Title has a BATTER picker (ANT / THE ATHLETE); grip and contact are measured at
  load, so a switch reloads with `?char=ant|fit` (localStorage `battingcage_char`). Default stays the athlete.
- Verified headless: Ant on deck behind the title (helmet + bat fit), PERFECT swing -> 412 ft home run
  (Work/shots/ant_*.png). Deliverable rebuilt (5.5 MB). Not hand-played.

## Status 2026-10-05
- **Built, not yet hand-played by the user.** Deliverable: `Deliverables/Batting-Cage.html` (4.6 MB,
  double-click, file:// works, phone + desktop) + `.zip` with README. Dev page `index.html` needs
  `node tools/serve.cjs 8170` (opened from file:// it forwards to the deliverable).
- Verified headless: perfect / early / late / whiff / take / strike-three reaction / full 15-pitch bucket ->
  results card / title / phone portrait (Work/shots/). No git, not hosted.

## How it plays
- 15 pitches a bucket. Machine light amber -> green -> pitch. Space (or tap) swings once per pitch.
- Five machine speeds (main.js `LEVELS`): 45/58 mph straight, 70/84/95 mph mix in changeups, curves, sliders.
- Judged on timing only: err = (press + D_HIT) - ball-at-plate time. |err| <= 20 ms PERFECT, 45 GREAT,
  70 GOOD, 95 WEAK, beyond = whiff. Early -> pulled (+x, left field), late -> opposite field; >45 deg = foul.
  Exit velo / launch angle -> carry (drag + backspin lift, calibrated ~410 ft at 103 mph/27 deg) -> HR vs fence.
- Streak (HR / line drive / deep fly in a row) multiplies points x1.5 at 3, x2 at 5. Every 3rd whiff plays
  the Strike clip's full reaction. Best score per speed in localStorage `battingcage`.
- Hitting the ball through the L-screen window into the machine = +50 "HIT THE MACHINE!".

## Animation facts (measured, see Work/probe*.js)
- The baseball FBXs are exported centred on the origin (feet at y ~ -95 cm), so build-clips.mjs takes hips
  rest height = hips - the mesh floor. Without that the character renders ~8x too high.
- Clip frame: the batter faces **-x** (the plate), the pitch comes from **+z**; right-handed, right hand on top.
  The world uses the clip frame unrotated: plate at the origin, machine at z = 16.6, camera behind the back net.
- Hit: hands loaded at 1.07 s, swing from 1.10, bat over the plate at ~1.425 s (measured at load: first frame
  the bat points along -x), then he drops the bat and runs (cut at 1.95, blended back to stance).
- Strike: same loaded pose at 0.85 s, whiff swing, then a ~5 s reaction ending exactly in the stance.
- Walk In / Step In both end in the stance (root offsets computed so they land on the spot); Walk Out leaves.
  Title = On Deck loop at the Step In start spot; first entrance = Step In, later buckets = Walk In from 0.8 s.
- On contact the hit clip's speed is set so the bat arrives exactly when the ball does (0.9x-3.4x), so bat
  and ball always visibly meet; the grade still comes from the nominal timing error.
- No bat in the clips: js/gear.js puts it on the palm-to-palm line when both hands are on it, and fixes it in
  the tighter fist when one hand lets go (calibrated in the stance). Helmet is built on the Head bone.

## Pipeline
1. `node tools/build-clips.mjs all` -> Work/clips/*.json (reads Source/*.fbx; needs Work/node_modules/three).
2. `node tools/pack-clips.mjs` -> assets/clips.json.
3. `node tools/build-deliverable.mjs` after ANY change.
Node = `G:\ICM Workspace\tools\node\node.exe`.

## Testing
- `node tools/serve.cjs 8170`, http://localhost:8170/ (`?play=1&level=0..4` skips the title).
- Headless: `& tools\edge.ps1 -Port 9350`, then `node tools/shot.cjs --port=9350 --url=... --eval=... --shot=...`.
- Call `BC.pause()` first: the page's own rAF loop otherwise keeps running between steps.
  `Work/swingtest.js` (window.ERR, window.AFTER), `Work/bucket.js` (whole bucket), `Work/strike3.js`.
- `Work/view.html?clips=hit&t=0,0.5&top=1` = clip contact sheets (follows the hips; top = from above).

## Known rough edges / ideas not built
- Location doesn't matter (every pitch is a strike; only timing). Balls/strikes + check swings would need
  a second input.
- The title panel covers most of the batter on a phone in portrait.
