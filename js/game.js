(() => {
  const canvas = document.getElementById("game-canvas");
  const frame = document.getElementById("game-frame");

  if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Missing #game-canvas element");
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }

  const WIDTH = 400;
  const HEIGHT = 600;
  const FIXED_DT = 1 / 60;
  const FIXED_DT_MS = 1000 / 60;
  const MAX_REALTIME_DELTA_MS = 100;

  const STORAGE_KEY = "pixel-playground-doodle-best-score";
  const PLAYER_WIDTH = 28;
  const PLAYER_HEIGHT = 36;
  const PLAYER_ACCELERATION = 2400;
  const PLAYER_DRAG = 1900;
  const PLAYER_MAX_SPEED = 285;
  const GRAVITY = -1650;
  const JUMP_VELOCITY = 805;
  const CAMERA_FOLLOW_Y = 220;
  const LOSS_BUFFER = 150;
  const SCORE_UNIT = 18;

  const WORLD_MARGIN = 16;
  const PLATFORM_HEIGHT = 12;
  const PLATFORM_BUFFER = 280;
  const PLATFORM_PRUNE_BELOW = 160;
  const START_SEED = 1337;

  const KEY_BINDINGS = {
    ArrowLeft: "left",
    ArrowRight: "right",
    KeyA: "left",
    KeyD: "right",
  };

  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const persistedState = loadPersistedState();

  const state = {
    mode: "menu",
    timeMs: 0,
    cameraY: 0,
    maxHeightReached: 0,
    score: 0,
    bestScore: persistedState.bestScore,
    storageAvailable: persistedState.storageAvailable,
    rngSeed: START_SEED,
    player: {
      x: WIDTH / 2,
      y: 0,
      vx: 0,
      vy: 0,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      facing: 1,
    },
    runStartY: 0,
    platforms: [],
    highestPlatformY: 0,
    lastPlatformId: 0,
    input: {
      left: false,
      right: false,
    },
    accumulatorMs: 0,
    lastTimestampMs: 0,
    useManualClock: false,
    displayRect: null,
  };

  function loadPersistedState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = Number.parseInt(raw || "0", 10);
      return {
        bestScore: Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
        storageAvailable: true,
      };
    } catch (error) {
      return {
        bestScore: 0,
        storageAvailable: false,
      };
    }
  }

  function saveBestScore(nextBest) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(nextBest));
      state.storageAvailable = true;
    } catch (error) {
      state.storageAvailable = false;
    }
  }

  function nextRandom() {
    state.rngSeed = (Math.imul(1664525, state.rngSeed) + 1013904223) >>> 0;
    return state.rngSeed / 4294967296;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function approach(value, target, amount) {
    if (value < target) {
      return Math.min(target, value + amount);
    }
    if (value > target) {
      return Math.max(target, value - amount);
    }
    return value;
  }

  function worldToScreenY(y) {
    return HEIGHT - (y - state.cameraY);
  }

  function wrapPlayer() {
    const halfWidth = state.player.width / 2;
    if (state.player.x < -halfWidth) {
      state.player.x = WIDTH + halfWidth;
    } else if (state.player.x > WIDTH + halfWidth) {
      state.player.x = -halfWidth;
    }
  }

  function addPlatform(x, y, width) {
    const platform = {
      id: ++state.lastPlatformId,
      x,
      y,
      width,
      height: PLATFORM_HEIGHT,
    };
    state.platforms.push(platform);
    state.highestPlatformY = Math.max(state.highestPlatformY, y);
    return platform;
  }

  function seedOpeningPlatforms() {
    const openingPattern = [
      { dx: -18, gap: 58, width: 100 },
      { dx: 34, gap: 64, width: 96 },
      { dx: -42, gap: 70, width: 92 },
      { dx: 48, gap: 76, width: 90 },
      { dx: -56, gap: 82, width: 88 },
      { dx: 62, gap: 86, width: 86 },
      { dx: -54, gap: 92, width: 84 },
      { dx: 46, gap: 96, width: 82 },
    ];

    const baseWidth = 116;
    const baseX = WIDTH / 2 - baseWidth / 2;
    const baseY = 42;
    addPlatform(baseX, baseY, baseWidth);

    let previousCenterX = baseX + baseWidth / 2;
    let currentY = baseY;

    for (const segment of openingPattern) {
      const width = segment.width;
      currentY += segment.gap;
      previousCenterX = clamp(
        previousCenterX + segment.dx,
        WORLD_MARGIN + width / 2,
        WIDTH - WORLD_MARGIN - width / 2
      );
      addPlatform(previousCenterX - width / 2, currentY, width);
    }
  }

  function generateNextPlatform() {
    const previous = state.platforms[state.platforms.length - 1];
    const progress = clamp(state.maxHeightReached / 2200, 0, 1);
    const width = clamp(102 - progress * 26 - nextRandom() * 16, 68, 104);
    const gap = clamp(60 + nextRandom() * 26 + progress * 24, 58, 116);
    const previousCenterX = previous.x + previous.width / 2;
    const maxCenterShift = clamp(112 - progress * 18, 74, 112);
    const shift = (nextRandom() * 2 - 1) * maxCenterShift;
    const centerX = clamp(
      previousCenterX + shift,
      WORLD_MARGIN + width / 2,
      WIDTH - WORLD_MARGIN - width / 2
    );
    const y = previous.y + gap;
    addPlatform(centerX - width / 2, y, width);
  }

  function ensurePlatformsAhead() {
    const targetY = state.cameraY + HEIGHT + PLATFORM_BUFFER;
    while (state.highestPlatformY < targetY) {
      generateNextPlatform();
    }
  }

  function prunePlatforms() {
    const threshold = state.cameraY - PLATFORM_PRUNE_BELOW;
    state.platforms = state.platforms.filter((platform) => platform.y + platform.height >= threshold);
  }

  function resetRun() {
    state.timeMs = 0;
    state.cameraY = 0;
    state.maxHeightReached = 0;
    state.score = 0;
    state.rngSeed = START_SEED;
    state.platforms = [];
    state.highestPlatformY = 0;
    state.lastPlatformId = 0;
    state.accumulatorMs = 0;

    seedOpeningPlatforms();
    ensurePlatformsAhead();

    const spawnPlatform = state.platforms[0];
    state.player.x = spawnPlatform.x + spawnPlatform.width / 2;
    state.player.y = spawnPlatform.y + spawnPlatform.height + state.player.height / 2;
    state.player.vx = 0;
    state.player.vy = -40;
    state.player.facing = 1;
    state.runStartY = state.player.y;
  }

  function startGame() {
    resetRun();
    state.mode = "playing";
  }

  function finishRun() {
    state.mode = "gameover";
    state.input.left = false;
    state.input.right = false;

    if (state.score > state.bestScore) {
      state.bestScore = state.score;
      saveBestScore(state.bestScore);
    }
  }

  function startOrRestart() {
    if (state.mode === "playing") {
      return;
    }
    startGame();
  }

  function updatePlaying(dt) {
    const axis = Number(state.input.right) - Number(state.input.left);
    if (axis !== 0) {
      state.player.vx += axis * PLAYER_ACCELERATION * dt;
      state.player.facing = axis > 0 ? 1 : -1;
    } else {
      state.player.vx = approach(state.player.vx, 0, PLAYER_DRAG * dt);
    }
    state.player.vx = clamp(state.player.vx, -PLAYER_MAX_SPEED, PLAYER_MAX_SPEED);

    const previousFeetY = state.player.y - state.player.height / 2;
    state.player.x += state.player.vx * dt;
    wrapPlayer();

    state.player.vy += GRAVITY * dt;
    state.player.y += state.player.vy * dt;

    if (state.player.vy <= 0) {
      const feetY = state.player.y - state.player.height / 2;
      const feetLeft = state.player.x - state.player.width * 0.36;
      const feetRight = state.player.x + state.player.width * 0.36;

      for (const platform of state.platforms) {
        const platformTop = platform.y + platform.height;
        if (previousFeetY < platformTop || feetY > platformTop) {
          continue;
        }
        if (feetRight < platform.x || feetLeft > platform.x + platform.width) {
          continue;
        }
        state.player.y = platformTop + state.player.height / 2;
        state.player.vy = JUMP_VELOCITY;
        break;
      }
    }

    state.maxHeightReached = Math.max(state.maxHeightReached, state.player.y - state.runStartY);
    state.score = Math.max(0, Math.floor(state.maxHeightReached / SCORE_UNIT));

    const desiredCameraY = Math.max(0, state.player.y - CAMERA_FOLLOW_Y);
    state.cameraY = Math.max(state.cameraY, desiredCameraY);

    ensurePlatformsAhead();
    prunePlatforms();

    if (state.player.y + state.player.height / 2 < state.cameraY - LOSS_BUFFER) {
      finishRun();
    }
  }

  function stepSimulation(deltaMs) {
    const clampedDelta = Math.max(0, deltaMs);
    state.timeMs += clampedDelta;
    state.accumulatorMs += clampedDelta;

    while (state.accumulatorMs >= FIXED_DT_MS) {
      if (state.mode === "playing") {
        updatePlaying(FIXED_DT);
      }
      state.accumulatorMs -= FIXED_DT_MS;
    }
  }

  function drawNotebookBackground() {
    ctx.fillStyle = "#f7f1df";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.fillRect(0, 0, WIDTH, 96);

    ctx.strokeStyle = "rgba(145, 185, 214, 0.5)";
    ctx.lineWidth = 1;
    for (let y = 56; y < HEIGHT; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(WIDTH, y + 0.5);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(209, 111, 98, 0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(50, 0);
    ctx.lineTo(50, HEIGHT);
    ctx.stroke();

    ctx.save();
    ctx.strokeStyle = "rgba(31, 49, 64, 0.14)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(300, 70);
    ctx.bezierCurveTo(336, 20, 386, 40, 360, 88);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(316, 120);
    ctx.bezierCurveTo(344, 108, 360, 120, 350, 144);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlatform(platform) {
    const screenTop = worldToScreenY(platform.y + platform.height);
    const centerY = screenTop + platform.height / 2;
    const left = platform.x;
    const right = platform.x + platform.width;

    ctx.save();
    ctx.lineCap = "round";

    ctx.strokeStyle = "#1f3140";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(left + 3, centerY + 1);
    ctx.quadraticCurveTo((left + right) / 2, centerY - 4, right - 3, centerY + 1);
    ctx.stroke();

    ctx.strokeStyle = "#78b86c";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(left + 6, centerY - 1);
    ctx.quadraticCurveTo((left + right) / 2, centerY - 6, right - 6, centerY - 1);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left + 10, centerY - 4);
    ctx.quadraticCurveTo((left + right) / 2, centerY - 8, right - 10, centerY - 4);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer() {
    const playerLeft = state.player.x - state.player.width / 2;
    const playerBottom = state.player.y - state.player.height / 2;
    const screenTop = worldToScreenY(playerBottom + state.player.height);

    ctx.save();
    ctx.translate(playerLeft, screenTop);

    ctx.fillStyle = "#f2db6c";
    ctx.strokeStyle = "#1f3140";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.ellipse(state.player.width / 2, state.player.height / 2, 15, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#1f3140";
    const eyeOffset = state.player.facing >= 0 ? 4 : -4;
    ctx.beginPath();
    ctx.arc(10 + eyeOffset * 0.2, 14, 2.3, 0, Math.PI * 2);
    ctx.arc(18 + eyeOffset * 0.2, 14, 2.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(9, 24);
    ctx.quadraticCurveTo(14, 27 + (state.mode === "playing" ? 1 : 0), 19, 24);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(7, 34);
    ctx.lineTo(4, 44);
    ctx.moveTo(21, 34);
    ctx.lineTo(24, 44);
    ctx.moveTo(6, 22);
    ctx.lineTo(-2, 28);
    ctx.moveTo(22, 22);
    ctx.lineTo(30, 28);
    ctx.stroke();

    ctx.restore();
  }

  function drawHud() {
    ctx.save();
    ctx.fillStyle = "#1f3140";
    ctx.font = "bold 21px Trebuchet MS, Verdana, sans-serif";
    ctx.fillText(`Score ${state.score}`, 20, 34);

    ctx.font = "bold 15px Trebuchet MS, Verdana, sans-serif";
    ctx.fillStyle = "#d16f62";
    ctx.fillText(`Best ${state.bestScore}`, 20, 56);

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(31, 49, 64, 0.82)";
    ctx.fillText("F fullscreen", WIDTH - 18, 34);
    ctx.restore();
  }

  function drawPanel(title, bodyLines, footerText) {
    const panelX = 60;
    const panelY = 144;
    const panelWidth = WIDTH - 120;
    const panelHeight = 246;

    ctx.save();
    ctx.translate(panelX, panelY);

    ctx.fillStyle = "rgba(239, 231, 212, 0.95)";
    ctx.strokeStyle = "#1f3140";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(14, 6);
    ctx.lineTo(panelWidth - 18, 0);
    ctx.quadraticCurveTo(panelWidth + 4, 12, panelWidth - 4, 34);
    ctx.lineTo(panelWidth - 10, panelHeight - 18);
    ctx.quadraticCurveTo(panelWidth - 12, panelHeight + 8, panelWidth - 36, panelHeight - 4);
    ctx.lineTo(26, panelHeight + 2);
    ctx.quadraticCurveTo(0, panelHeight - 6, 8, panelHeight - 34);
    ctx.lineTo(0, 24);
    ctx.quadraticCurveTo(2, 4, 14, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#1f3140";
    ctx.textAlign = "center";
    ctx.font = "bold 30px Trebuchet MS, Verdana, sans-serif";
    ctx.fillText(title, panelWidth / 2, 58);

    ctx.font = "17px Trebuchet MS, Verdana, sans-serif";
    let y = 102;
    for (const line of bodyLines) {
      ctx.fillText(line, panelWidth / 2, y);
      y += 30;
    }

    ctx.font = "bold 16px Trebuchet MS, Verdana, sans-serif";
    ctx.fillStyle = "#d16f62";
    ctx.fillText(footerText, panelWidth / 2, panelHeight - 26);
    ctx.restore();
  }

  function drawMenu() {
    drawPanel(
      "Sky Scribble",
      [
        "Arrow keys or A / D to drift",
        "Land on platforms to auto-bounce",
        "Wrap around the page edges",
        `Best score: ${state.bestScore}`,
      ],
      "Press space, enter, or click to start"
    );
  }

  function drawGameOver() {
    drawPanel(
      "Notebook Crash",
      [
        `Run score: ${state.score}`,
        `Best score: ${state.bestScore}`,
        state.storageAvailable ? "Best score saves in this browser" : "Storage blocked: best score is session only",
      ],
      "Press space, enter, or click to restart"
    );
  }

  function render() {
    drawNotebookBackground();

    for (const platform of state.platforms) {
      const top = platform.y + platform.height;
      if (top < state.cameraY - 40 || platform.y > state.cameraY + HEIGHT + 60) {
        continue;
      }
      drawPlatform(platform);
    }

    drawPlayer();
    drawHud();

    if (state.mode === "menu") {
      drawMenu();
    } else if (state.mode === "gameover") {
      drawGameOver();
    }
  }

  function syncLayout() {
    state.displayRect = canvas.getBoundingClientRect();
  }

  function toggleFullscreen() {
    if (!frame) {
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    frame.requestFullscreen?.().catch(() => {});
  }

  function handleKeyChange(code, isPressed) {
    const binding = KEY_BINDINGS[code];
    if (!binding) {
      return false;
    }
    state.input[binding] = isPressed;
    return true;
  }

  window.addEventListener("keydown", (event) => {
    if (handleKeyChange(event.code, true)) {
      event.preventDefault();
      return;
    }

    if (event.repeat) {
      return;
    }

    if (event.code === "Space" || event.code === "Enter") {
      event.preventDefault();
      startOrRestart();
      return;
    }

    if (event.code === "KeyF") {
      toggleFullscreen();
    }
  });

  window.addEventListener("keyup", (event) => {
    if (handleKeyChange(event.code, false)) {
      event.preventDefault();
    }
  });

  window.addEventListener("blur", () => {
    state.input.left = false;
    state.input.right = false;
  });

  canvas.addEventListener("pointerdown", () => {
    startOrRestart();
  });

  window.addEventListener("resize", syncLayout);
  document.addEventListener("fullscreenchange", syncLayout);

  function frameStep(timestampMs) {
    if (!state.lastTimestampMs) {
      state.lastTimestampMs = timestampMs;
    }
    const deltaMs = clamp(timestampMs - state.lastTimestampMs, 0, MAX_REALTIME_DELTA_MS);
    state.lastTimestampMs = timestampMs;

    if (!state.useManualClock) {
      stepSimulation(deltaMs);
    }
    render();
    window.requestAnimationFrame(frameStep);
  }

  window.render_game_to_text = () => {
    const visiblePlatforms = state.platforms
      .filter((platform) => {
        const top = platform.y + platform.height;
        return top >= state.cameraY - 24 && platform.y <= state.cameraY + HEIGHT + 24;
      })
      .slice(0, 14)
      .map((platform) => ({
        id: platform.id,
        x: Math.round(platform.x),
        y: Math.round(platform.y),
        width: Math.round(platform.width),
        height: platform.height,
      }));

    return JSON.stringify({
      mode: state.mode,
      coordinateSystem: {
        origin: "world bottom-left relative to the starting platform area",
        xPositive: "right",
        yPositive: "up",
      },
      cameraY: Math.round(state.cameraY),
      visibleWorld: {
        minY: Math.round(state.cameraY),
        maxY: Math.round(state.cameraY + HEIGHT),
      },
      score: state.score,
      bestScore: state.bestScore,
      player: {
        x: Math.round(state.player.x),
        y: Math.round(state.player.y),
        vx: Math.round(state.player.vx),
        vy: Math.round(state.player.vy),
        width: state.player.width,
        height: state.player.height,
      },
      platforms: visiblePlatforms,
    });
  };

  window.advanceTime = (ms) => {
    state.useManualClock = true;
    state.lastTimestampMs = 0;
    stepSimulation(ms);
    render();
  };

  resetRun();
  syncLayout();
  render();
  window.requestAnimationFrame(frameStep);
})();
