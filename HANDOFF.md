# Home Run Derby: handoff

HopLobby game id `home-run-derby`. Source builds from `hoplobby.json` (`build.output: "Work"`, static files, no build step;
three.js vendored). Default per-round frame (no `session` flag): HopLobby runs the lobby, Ready, countdown, results and rematch;
this game starts a round by itself, the host ends it with `endGame(results)`. Answers the submission's "I made this or hold the
rights to everything" tick.

## Assets and licences

| What | Where | Source | Licence |
| --- | --- | --- | --- |
| Game code (physics, scoring, net, HUD, audio, ballpark) | `Work/js/` | Written for this game with AI assistance (Claude) | Ours |
| three.js r170 + GLTFLoader, BufferGeometryUtils | `Work/vendor/` | threejs.org | MIT (`Work/vendor/three.LICENSE.txt`) |
| Baseball batting clips (idle, hit, strike, walk in/out, on deck) | `Work/assets/clips.json` | Adobe Mixamo animations, packed by the developer | Mixamo terms (free for commercial use in games) |
| Hidden driver body that plays the clips ("the athlete") | `Work/assets/chars/fit.json` | AI-generated: the developer's own character, made with Meshy (meshy.ai, image-to-3D) from their own image, rigged in Mixamo (carried over from their game Timber & Stone). Only seen if a player's avatar can't load | Meshy terms allow commercial use (paid plans: the developer owns it; free plan: CC BY 4.0). Credited in-game either way |
| Player characters | not bundled | `HopLobby.avatar()` at run time, copying the driver's pose | HopLobby |
| Ballpark, stands, scoreboard, machine, ball, fireball, flags | `Work/js/world.js`, `fx.js` | Built in code; textures drawn on canvas at run time | Ours |
| Stand and outfield panels | `Work/js/world.js` (`ADS`) | The game's own slogans drawn on canvas (no ads, sponsors, other sites or HopLobby logo) | Ours |
| Sound effects | `Work/js/audio.js` | Synthesised at run time (WebAudio) | Ours |
| Music | none | n/a | n/a |
| Cover | `Work/cover.jpg` | Screenshot of the game | Ours |

AI-generated assets: the athlete model (Meshy) only; no AI art, textures or audio otherwise (AI help on the code: Claude).
Credits are in the game: HopLobby's Esc menu > Credits. Fonts: system fonts only. The only outside script is the SDK from
`https://hoplobby.com/sdk/v1/hoplobby.js`. No trackers, sign-ins, payments or personal data. Browser storage:
`home-run-derby:save` (best bucket per speed, localStorage) and `home-run-derby:round` (this bucket's score, sessionStorage,
so a reloaded frame carries on).

## Testing

The game has no test switches. `node tools\serve.cjs 8790` serves the project; asked for with `?fake=<id>` a page gets the
stand-in SDK (`tools/fake-hoplobby.js`) and the `BC` test hooks (`tools/bc-hooks.js`, appended to `main.js` by the server).
`tools/harness.html?n=3&roster=A,B&auto&drive` plays a lobby; `fkReload("A")` reloads the host mid-bucket.

## Leaderboards

Six boards (`hoplobby.json`): one bucket-score board per machine speed and the longest hit in feet, `writes: "game"` (casual
boards; the browser can fake them, which HopLobby's validator notes).