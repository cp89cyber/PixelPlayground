Original prompt: make a static doodle jump clone

## Progress Log

- Scaffolded a zero-build static site with `index.html`, `styles.css`, and `js/game.js`.
- Implemented the first pass of the endless-jumper core: menu, play, game-over flow, keyboard input, click-to-start, fullscreen toggle, seeded platform generation, upward camera, score tracking, and best-score persistence.
- Added the required browser automation hooks: `window.render_game_to_text()` and `window.advanceTime(ms)`.
- Tuned the opening platform pattern and landing collision width after the first browser run exposed an overly punishing start path.

## Verification

- Ran the static app under `python3 -m http.server 4173`.
- Verified the menu screen, canvas rendering, and `render_game_to_text()` output with the Playwright client.
- Verified active play with deterministic stepping and inspected the gameplay screenshot plus state dump.
- Verified a representative game-over flow with a persisted best score and inspected the game-over screenshot plus state dump.
- Verified restart behavior in the same page session: final state returned to `playing` with a fresh run and preserved best score.
- Verified `localStorage` persistence across reload in a persistent Playwright browser context. The stored key and reloaded menu both reflected the saved best score.
- Observed no console-error artifacts during the automated runs.
- Retuned bounce physics to `GRAVITY = -1650` and `JUMP_VELOCITY = 805` to slow airtime while preserving jump height.
- Re-verified the bounce update with the Playwright client plus a deterministic Playwright probe: the first auto-bounce still triggers immediately, opening platforms remain reachable, wraparound still occurs during play, a forced miss still reaches game-over, restart returns to `playing` with the camera reset, and no new console errors appeared.

## Notes

- The stock web-game Playwright client launches a fresh browser context per invocation, so cross-run persistence had to be verified separately in one persistent Playwright session.
