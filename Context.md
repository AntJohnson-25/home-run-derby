# Batting Cage (HopLobby): context

## What this is

A HopLobby version of the user's Batting Cage, made 2026-10-12. The original stays untouched at
`G:\ICM Workspace\01-Projects\batting-cage`; its context is in `Notes/original-Context.md` (clips,
timing windows, scoring, the bat's grip). Only the runtime files were copied (5.6 MB): not
`Source/` (65 MB of FBX), the original's `Work/` or `Deliverables/`.

Multiplayer, as the user picked it: **everyone bats at once, each in their own cage, against the same
15 pitches at the same moments, with a live scoreboard.** The best bucket wins.

## Layout

- `Work/`: the game (ES modules, three.js 0.170). `hoplobby.js` = SDK 1.3.0.
  `vendor/jsm/` = three's GLTFLoader + BufferGeometryUtils, 0.170.0 from jsDelivr, self-hosted.
- `tools/serve.cjs`: `node tools\serve.cjs 8791 Work` serves the game alone (Dev Mode, tunnel);
  `node tools\serve.cjs 8790` serves the project (harness, test avatars).
- `tools/harness.html`: a fake HopLobby with two frames (from Swole Mates). A gets
  `test-avatar.glb`, B gets `test-avatar-tpose.glb` (made-up stand-ins, not real avatars).
- Node: `E:\claude-tmp\node\node.exe` (a copy; the one on G: starts slowly).

## The batter is the player's HopLobby avatar (`Work/js/avatar.js`)

- The user asked for the platform's characters ("use the mcp so we can use the platforms
  characters"). `HopLobby.avatar(playerId, { format: "glb" })`, once, before `ready()`.
- The baseball clips are Mixamo takes. The old athlete (`assets/chars/fit.json`) still plays
  them, hidden (the "driver"). Each frame the avatar copies him: per bone, the driver's world
  rotation away from his bind pose, on top of the avatar's rest swung onto his bind-pose
  directions. The rig is read by shape (Swole Mates' reader). The hips follow his, with the
  height scaled to the avatar's legs.
- The bat sits in the avatar's hands (`gear.js` `avatarHands`). Avatars have no fingers, so which
  hand still holds the bat comes from the driver's fists.
- **Fairness:** the swing TIMING (`D_HIT`) is measured on the driver's own bat, so every avatar is
  judged the same. Only the contact POINT (where the ball meets the bat) is measured on the avatar.
- No helmet on avatars (their own hair and items). Outside HopLobby (standalone) or if the avatar
  can't be read, the athlete bats in his helmet, as before. `?avatar=<glb url>` forces a test avatar.

## Multiplayer (`Work/js/net.js`)

- The host picks the speed (title screen) and presses PLAY BALL / ANOTHER BUCKET / FASTER
  MACHINE / Change speed. Guests see "WAITING FOR THE HOST" and "THE HOST STARTS THE NEXT BUCKET".
- `start` = { id, lv, seed, go }. Pitch k is drawn from `seed` (`pitchRng`, the same on every
  machine), and its light comes on at `go + k * 5.6 s` on the relay clock (`HopLobby.now()`). A
  machine that's late (a stall, a late join) skips the pitches it missed. The walk-in is cut short
  if the first light is due.
- Each player judges their own swings and sends `sc` (score, pitches, HR, longest, last result)
  after every pitch. It's a friendly board; the relay is unchecked and nothing is saved from it.
- keepUp once a second: the host repeats the lobby (and the start to anyone not in the bucket
  yet); a guest who hasn't heard the host says hi; scores repeat every 3 s.
- The Esc menu pauses only when you're alone. In a lobby the pitches keep coming.
- HUD: the live board under the spray chart (portraits from `HopLobby.avatar(id, { size: 64 })`).
  The hint and the timing meter moved up, clear of HopLobby's bottom-centre pill.

## Tested (2026-10-12, headless Edge, real GPU)

- Standalone with the test avatar: stance, load, a perfect swing -> line drive; the bat meets
  the ball.
- Harness, two players, a full 15-pitch HIGH SCHOOL bucket with auto swings (A perfect, B 35 ms
  late): both on the same pitch throughout, the boards matched (2763 vs 337), both reached the
  results together, guest buttons hidden, no errors.
- **NOT hand-played. Not in a real HopLobby lobby. No real avatar seen yet** (only the two
  made-up stand-ins; a real one may rest in a different pose or have odd proportions).

## Not HopLobby-compliant yet (fine for a Dev Mode test)

- English only (pt-PT expected).
- The fonts are system fonts (fine); best scores stay in localStorage.
- No `HANDOFF.md` licence table: Mixamo clips, the athlete (user's image-to-3D), three.js (MIT).
- Sounds are the original's synth SFX; no music.

## How to run

- Game: `Start-Process "E:\claude-tmp\node\node.exe" -ArgumentList 'tools\serve.cjs 8791 Work' -WorkingDirectory "E:\Hoplobby.dev\01-Projects\batting-cage" -WindowStyle Hidden`
- Dev Mode: https://hoplobby.com/dev-play?url=http://127.0.0.1:8791
- Friends: `& 'E:\claude-tmp\cloudflared\cloudflared.exe' tunnel --url http://127.0.0.1:8791 --http-host-header localhost:8791`
  (the user runs it; Claude Code's auto mode blocks tunnels).
- Harness: serve the project on 8790, open http://127.0.0.1:8790/tools/harness.html?both.
  Test hooks: `BC.begin(lv)`, `BC.auto(errSeconds)`, `BC.state()`, `BC.net.board()`.
- Headless: Powder Rush's `tools\edge.ps1 -Port 9456 -Gpu` + `tools\shot.js`. **Stop Edge after.**

## Next action

1. The user plays it in a real lobby (with friends via the tunnel) and says how it felt,
   and how their real avatar looks holding the bat.
2. Then: pt-PT strings, HANDOFF licence table, maybe a helmet sized to the avatar's head.

## Update 2026-10-20 (evening): Home Run Derby park + ads + leaderboards (Dev Mode tested only in headless)
- `Work/js/world.js` + `fx.js` are now the G: derby park (night ballpark, wall, stands, board, blimp, fireball, distance flags);
  main.js uses the derby ball flight (aero/predict/wall/stands, OFF THE WALL, distance scoring). Old cage code in
  `Notes/*.cage-backup.js`. Not ported: 4 Mixamo batters, slugger select (the batter is still the HopLobby avatar).
- ADS: `ADS_ON` in world.js (or `?ads=0`). On = ANTHONYJCTSG.ONLINE + CTSG-HTX.COM text ads + HopLobby primary logo
  (assets/brand). Off = plain "Home Run Derby" panels. HopLobby content policy bans sponsorship/promotion of other
  sites: TURN OFF BEFORE SUBMITTING.
- Result card (`.call`) moved low-left so it never covers the machine/ball path. Title/loading renamed "Home Run Derby".
- Leaderboards (writes:"game"): score-<speed> x5 + longest; defs in `Notes/leaderboards.json`; submitBoards() in main.js at
  bucket end; top 5 in #r-lb. Pass them to prepare_dev_mode `leaderboards` (kept per account). No hoplobby.json yet.
- Still unverified: leaderboards in a real lobby, multiplayer with the new physics, phones.

## Update 2026-10-20 (night): changes ported from the G: Going, Going, Gone
- fx.js = the G: copy (Flags high marker). main.js onLanded: a hit under 150 ft hangs its FT card at (0, 3.5, MACHINE.z) above the
  machine (one at a time) instead of in front of it. The HUD distance card clears itself 3 s after it lands (distFinalAt).
- PHONE BUG fixed here too: main.js preventDefault'd touchend on every button, which cancels the click on phones. Removed.
- Ads = a BLEND, 8 panels alternating the user's sites (ANTHONYJCTSG.ONLINE, CTSG-HTX.COM, CUSTOMBIZTOOLS.ONLINE, JULIA) with the
  HopLobby logo (SPONSORS in world.js). Backstop is now two rows of four (it was one row of six = 36 m on a 30 m net). Machine = HopLobby
  logo (ADS[1]); blimp = ADS[0] + ADS[3] (one of each). ADS_ON still switches it all off (?ads=0); HopLobby's policy bans promoting
  other sites, so check with the user before any Submit.
- NOT ported: the 4 Mixamo batters / slugger select / cover art (batter = HopLobby avatar), jersey patches, the Bleacher Seats soundtrack
  (and its loop fix: the audio.js here is still synth-only, no music), ELI / FLOYD / CUSTOM INQUIRIES / ANTHONYJCTSG.COM ads.
- Pre-port copies of fx/main/world: Notes/pre-ggg-port/. Verified headless (stepped with BC.pause/BC.step; software GL is too slow to
  play in real time): 28 ft foul + 9 ft foul card above the machine, card clears at 3 s, backstop/stand/blimp/machine ads. Not tested in Dev Mode.

- Dev Mode test 2026-10-20 (night): the user's friend could NOT join, so multiplayer is still unverified with the new derby physics.
  Cause not investigated. The Dev Mode link is localhost (reachable only from the user's PC); a friend needs the Cloudflare tunnel
  (cloudflared tunnel --url http://127.0.0.1:8791 --http-host-header localhost:8791, run by the user) plus a prepare_dev_mode link
  built on the https tunnel URL. Check that before debugging the game code. Server was stopped at the user's request.
