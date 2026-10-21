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
| Hidden driver body that plays the clips ("the athlete") | `Work/assets/chars/fit.json` | The developer's own character, built from their own image with an image-to-3D tool (carried over from their game Timber & Stone) | Developer's own work. TO CONFIRM: tool + its commercial terms |
| Player characters | not bundled | `HopLobby.avatar()` at run time, copying the driver's pose | HopLobby |
| Ballpark, stands, scoreboard, machine, ball, fireball, flags | `Work/js/world.js`, `fx.js` | Built in code; textures drawn on canvas at run time | Ours |
| Stand and outfield ad panels | `Work/js/world.js` (`SPONSORS`, `ADS_ON`) | Text panels for the developer's own sites (anthonyjctsg.online, ctsg-htx.com, custombiztools.online, Julia) plus the HopLobby logo | Developer's own; HopLobby brand kit for the logo |
| HopLobby logo + icon | `Work/assets/brand/` | Official HopLobby brand kit, unaltered, only in the stadium (never in the HUD) | HopLobby brand kit terms |
| Sound effects | `Work/js/audio.js` | Synthesised at run time (WebAudio) | Ours |
| Music | none | n/a | n/a |
| Cover | `Work/cover.jpg` | Screenshot of the game | Ours |

No AI-generated art, models or audio ship in the build (the only AI help is the code). Fonts: system fonts only. The only
outside script is the SDK from `https://hoplobby.com/sdk/v1/hoplobby.js`. No trackers, sign-ins, payments or personal data.
Browser storage: `home-run-derby:save` (best bucket per speed) only.

## Leaderboards

Six boards (`hoplobby.json`): one bucket-score board per machine speed and the longest hit in feet, `writes: "game"` (casual
boards; the browser can fake them, which HopLobby's validator notes).