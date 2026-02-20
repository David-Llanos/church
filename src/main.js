import {
  applyBonusMove,
  applyTurnOption,
  createGame,
  getBonusChoices,
  getPieceCoordinatesData,
  rollDice,
  skipBonus,
} from "./game/engine.js";
import {
  HOME_LENGTH,
  PLAYER_COLORS,
  SAFE_TRACK_INDEXES,
  START_INDEXES,
  TRACK_LENGTH,
} from "./game/constants.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const stateRefs = {
  playerCount: document.querySelector("#player-count"),
  pieceCount: document.querySelector("#piece-count"),
  startButton: document.querySelector("#start-game"),
  rollButton: document.querySelector("#roll-dice"),
  status: document.querySelector("#status"),
  dice: document.querySelector("#dice"),
  actions: document.querySelector("#actions"),
  bonus: document.querySelector("#bonus"),
  log: document.querySelector("#log"),
  board: document.querySelector("#board"),
};

const playerCssClassByColor = {
  red: "player-red",
  yellow: "player-yellow",
  blue: "player-blue",
  green: "player-green",
};

const playerLightByColor = {
  red: "#f2b0a8",
  yellow: "#f5d98e",
  blue: "#9bc3f2",
  green: "#9dd8b8",
};

let queuedRandoms = [];
let gameState = createGame({ playerCount: 4, piecesPerPlayer: 4 });

const trackCoordinates = buildTrackCoordinates();
const laneCoordinates = buildLaneCoordinates();
const nestCoordinates = buildNestCoordinates();
const homeCoordinates = buildHomeCoordinates();

const staticLayer = createSvgElement("g", { id: "board-static" });
const tokenLayer = createSvgElement("g", { id: "board-tokens" });
stateRefs.board.append(staticLayer, tokenLayer);

drawBoardSkeleton();
render();

stateRefs.startButton.addEventListener("click", () => {
  const playerCount = Number.parseInt(stateRefs.playerCount.value, 10);
  const piecesPerPlayer = Number.parseInt(stateRefs.pieceCount.value, 10);

  gameState = createGame({ playerCount, piecesPerPlayer });
  render();
});

stateRefs.rollButton.addEventListener("click", () => {
  transition(() => rollDice(gameState, consumeRandom));
});

stateRefs.actions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-option-id]");
  if (!button) {
    return;
  }

  const optionId = button.dataset.optionId;
  transition(() => applyTurnOption(gameState, optionId));
});

stateRefs.bonus.addEventListener("click", (event) => {
  const pieceButton = event.target.closest("button[data-piece-id]");
  if (pieceButton) {
    const pieceId = pieceButton.dataset.pieceId;
    transition(() => applyBonusMove(gameState, pieceId));
    return;
  }

  const skipButton = event.target.closest("button[data-skip-bonus]");
  if (skipButton) {
    transition(() => skipBonus(gameState));
  }
});

window.__PARCHIS_TEST_API__ = {
  queueRandom(values) {
    if (!Array.isArray(values)) {
      return;
    }

    queuedRandoms = values.slice();
  },
  startGame(options = {}) {
    const playerCount = Number.isInteger(options.playerCount) ? options.playerCount : 4;
    const piecesPerPlayer = Number.isInteger(options.piecesPerPlayer) ? options.piecesPerPlayer : 4;
    gameState = createGame({ playerCount, piecesPerPlayer });
    render();
  },
  getState() {
    if (typeof structuredClone === "function") {
      return structuredClone(gameState);
    }

    return JSON.parse(JSON.stringify(gameState));
  },
};

function transition(updater) {
  try {
    gameState = updater();
    render();
  } catch (error) {
    // Keep UI reactive but leave state unchanged on invalid actions.
    console.error(error);
  }
}

function consumeRandom() {
  if (queuedRandoms.length > 0) {
    return queuedRandoms.shift();
  }

  return Math.random();
}

function render() {
  renderStatus();
  renderActionPanel();
  renderBonusPanel();
  renderLog();
  renderTokens();
}

function renderStatus() {
  if (gameState.phase === "game_over") {
    stateRefs.status.textContent =
      `Winner: Player ${gameState.winnerIndex + 1} (${gameState.players[gameState.winnerIndex].color})`;
  } else {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    stateRefs.status.textContent =
      `Player ${gameState.currentPlayerIndex + 1} (${currentPlayer.color}) | ` +
      `phase: ${describePhase(gameState.phase)} | doubles streak: ${gameState.doubleChainCount}`;
  }

  stateRefs.dice.textContent = gameState.dice
    ? `Dice: ${gameState.dice[0]} + ${gameState.dice[1]}`
    : "Dice: not rolled";

  stateRefs.rollButton.disabled = gameState.phase !== "await_roll";
}

function renderActionPanel() {
  stateRefs.actions.innerHTML = "";

  if (gameState.phase !== "await_action") {
    const message = createParagraph("Roll dice to generate legal moves.");
    stateRefs.actions.append(message);
    return;
  }

  gameState.turnOptions.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "move-button";
    button.dataset.optionId = option.id;
    button.textContent = option.label;
    stateRefs.actions.append(button);
  });
}

function renderBonusPanel() {
  stateRefs.bonus.innerHTML = "";

  if (gameState.phase !== "await_bonus") {
    stateRefs.bonus.append(createParagraph("No pending bonus."));
    return;
  }

  const bonusAmount = gameState.pendingBonuses[0];
  const title = createParagraph(`Apply bonus ${bonusAmount} to one piece:`);
  stateRefs.bonus.append(title);

  const choices = getBonusChoices(gameState);
  choices.forEach((choice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "move-button";
    button.dataset.pieceId = choice.pieceId;
    button.textContent = choice.label;
    stateRefs.bonus.append(button);
  });

  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "move-button";
  skip.dataset.skipBonus = "true";
  skip.textContent = "Skip bonus";
  stateRefs.bonus.append(skip);
}

function renderLog() {
  stateRefs.log.innerHTML = "";
  const lines = gameState.log.slice(-14);

  lines.forEach((line) => {
    const item = document.createElement("li");
    item.textContent = line;
    stateRefs.log.append(item);
  });
}

function drawBoardSkeleton() {
  staticLayer.innerHTML = "";

  staticLayer.append(
    createSvgElement("rect", {
      x: 16,
      y: 16,
      width: 688,
      height: 688,
      rx: 28,
      fill: "#f1ddba",
      stroke: "#8b6429",
      "stroke-width": 3,
    }),
  );

  const nestBoxes = [
    { x: 50, y: 50, color: "red" },
    { x: 530, y: 50, color: "yellow" },
    { x: 530, y: 530, color: "blue" },
    { x: 50, y: 530, color: "green" },
  ];

  nestBoxes.forEach((box, playerIndex) => {
    staticLayer.append(
      createSvgElement("rect", {
        x: box.x,
        y: box.y,
        width: 140,
        height: 140,
        rx: 20,
        fill: playerLightByColor[box.color],
        stroke: "#6a4a1c",
        "stroke-width": 2,
        "fill-opacity": 0.65,
      }),
    );

    nestCoordinates[playerIndex].forEach((coord) => {
      staticLayer.append(
        createSvgElement("circle", {
          cx: coord.x,
          cy: coord.y,
          r: 11,
          fill: "rgba(255, 255, 255, 0.65)",
          stroke: "#70512a",
          "stroke-width": 1,
        }),
      );
    });
  });

  trackCoordinates.forEach((coord, index) => {
    const segmentColor = segmentShade(index);
    const isStart = START_INDEXES.includes(index);

    const classes = ["track-cell"];
    if (SAFE_TRACK_INDEXES.has(index)) {
      classes.push("safe");
    }
    if (isStart) {
      classes.push("start");
    }

    staticLayer.append(
      createSvgElement("circle", {
        cx: coord.x,
        cy: coord.y,
        r: 9,
        class: classes.join(" "),
        fill: isStart ? playerLightByColor[PLAYER_COLORS[START_INDEXES.indexOf(index)]] : segmentColor,
      }),
    );

    if (SAFE_TRACK_INDEXES.has(index)) {
      staticLayer.append(
        createSvgElement("circle", {
          cx: coord.x,
          cy: coord.y,
          r: 2.4,
          fill: "#764a1f",
        }),
      );
    }
  });

  PLAYER_COLORS.forEach((color, playerIndex) => {
    laneCoordinates[playerIndex].forEach((coord, laneIndex) => {
      staticLayer.append(
        createSvgElement("circle", {
          cx: coord.x,
          cy: coord.y,
          r: 10,
          fill: laneIndex === HOME_LENGTH - 1 ? "#fff4dc" : playerLightByColor[color],
          stroke: "#6f4d1d",
          "stroke-width": 1.4,
          "fill-opacity": laneIndex === HOME_LENGTH - 1 ? 1 : 0.82,
        }),
      );
    });
  });

  drawCenterDiamond();
}

function drawCenterDiamond() {
  const triangles = [
    { points: "360,270 450,360 360,360", fill: playerLightByColor.yellow },
    { points: "270,360 360,270 360,360", fill: playerLightByColor.red },
    { points: "360,450 270,360 360,360", fill: playerLightByColor.green },
    { points: "450,360 360,450 360,360", fill: playerLightByColor.blue },
  ];

  triangles.forEach((triangle) => {
    staticLayer.append(
      createSvgElement("polygon", {
        points: triangle.points,
        fill: triangle.fill,
        stroke: "#5f451f",
        "stroke-width": 1.4,
      }),
    );
  });

  staticLayer.append(
    createSvgElement("circle", {
      cx: 360,
      cy: 360,
      r: 14,
      fill: "#fff5dd",
      stroke: "#5f451f",
      "stroke-width": 2,
    }),
  );
}

function renderTokens() {
  tokenLayer.innerHTML = "";

  const pieces = getPieceCoordinatesData(gameState);
  const grouped = new Map();

  pieces.forEach((piece) => {
    const coord = resolvePieceCoordinate(piece);
    const key = `${piece.zone}:${coord.x.toFixed(2)}:${coord.y.toFixed(2)}`;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push({ piece, coord });
  });

  grouped.forEach((entries) => {
    entries.forEach((entry, index) => {
      const offset = stackOffset(index);
      const player = gameState.players[entry.piece.playerIndex];
      tokenLayer.append(
        createSvgElement("circle", {
          cx: entry.coord.x + offset.x,
          cy: entry.coord.y + offset.y,
          r: 8.6,
          class: `token ${playerCssClassByColor[player.color]}`,
          "data-player": entry.piece.playerIndex,
          "data-piece-id": entry.piece.pieceId,
        }),
      );
    });
  });
}

function resolvePieceCoordinate(pieceData) {
  if (pieceData.zone === "track") {
    return trackCoordinates[pieceData.trackIndex];
  }

  if (pieceData.zone === "home_lane") {
    return laneCoordinates[pieceData.playerIndex][pieceData.laneIndex];
  }

  if (pieceData.zone === "home") {
    return homeCoordinates[pieceData.playerIndex][pieceData.slot];
  }

  return nestCoordinates[pieceData.playerIndex][pieceData.slot];
}

function stackOffset(index) {
  const offsets = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: -10, y: 0 },
    { x: 0, y: 10 },
    { x: 0, y: -10 },
  ];

  return offsets[index] || { x: (index % 3) * 7, y: Math.floor(index / 3) * 7 };
}

function describePhase(phase) {
  if (phase === "await_roll") {
    return "roll dice";
  }

  if (phase === "await_action") {
    return "pick move";
  }

  if (phase === "await_bonus") {
    return "apply bonus";
  }

  return phase;
}

function createParagraph(text) {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  paragraph.style.margin = "0";
  return paragraph;
}

function createSvgElement(tag, attributes) {
  const element = document.createElementNS(SVG_NS, tag);

  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, String(value));
  });

  return element;
}

function buildTrackCoordinates() {
  const center = 360;
  const radius = 282;

  return Array.from({ length: TRACK_LENGTH }).map((_, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / TRACK_LENGTH;

    return {
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
    };
  });
}

function buildLaneCoordinates() {
  const center = 360;
  const outerRadius = 230;
  const innerRadius = 84;

  return Array.from({ length: 4 }).map((_, playerIndex) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * START_INDEXES[playerIndex]) / TRACK_LENGTH;

    return Array.from({ length: HOME_LENGTH }).map((__, laneIndex) => {
      const t = laneIndex / (HOME_LENGTH - 1);
      const radius = outerRadius - (outerRadius - innerRadius) * t;

      return {
        x: center + Math.cos(angle) * radius,
        y: center + Math.sin(angle) * radius,
      };
    });
  });
}

function buildNestCoordinates() {
  const anchors = [
    { x: 120, y: 120 },
    { x: 600, y: 120 },
    { x: 600, y: 600 },
    { x: 120, y: 600 },
  ];

  const slotOffsets = [
    { x: -24, y: -24 },
    { x: 24, y: -24 },
    { x: -24, y: 24 },
    { x: 24, y: 24 },
  ];

  return anchors.map((anchor) =>
    slotOffsets.map((offset) => ({
      x: anchor.x + offset.x,
      y: anchor.y + offset.y,
    })),
  );
}

function buildHomeCoordinates() {
  const anchors = [
    { x: 325, y: 325 },
    { x: 395, y: 325 },
    { x: 395, y: 395 },
    { x: 325, y: 395 },
  ];

  const slotOffsets = [
    { x: -8, y: -8 },
    { x: 8, y: -8 },
    { x: -8, y: 8 },
    { x: 8, y: 8 },
  ];

  return anchors.map((anchor) =>
    slotOffsets.map((offset) => ({
      x: anchor.x + offset.x,
      y: anchor.y + offset.y,
    })),
  );
}

function segmentShade(index) {
  if (index < 17) {
    return "#f4d2cc";
  }
  if (index < 34) {
    return "#f7e5be";
  }
  if (index < 51) {
    return "#cee1f8";
  }
  return "#d3efde";
}
