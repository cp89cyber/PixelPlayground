# PixelPlayground

`Sky Scribble` is a static doodle-inspired endless jumper built with plain HTML, CSS, and JavaScript. It runs directly in the browser with no build step and keeps your best local score in `localStorage`.

## Run locally

Serve the repo with any static file server. Two simple options:

```bash
python3 -m http.server 4173
```

or

```bash
npx serve .
```

Then open `http://localhost:4173` in your browser.

## Controls

- `ArrowLeft` / `A`: move left
- `ArrowRight` / `D`: move right
- `Space` / `Enter` / click canvas: start or restart
- `F`: toggle fullscreen

## Gameplay

- Land on platforms while falling to bounce automatically.
- Climb as high as possible while the camera scrolls upward.
- Wrapping lets you drift off one side of the page and appear on the other.
- The run ends when you fall too far below the visible playfield.

## Test hooks

The game exposes two browser globals for automation:

- `window.render_game_to_text()`
- `window.advanceTime(ms)`
