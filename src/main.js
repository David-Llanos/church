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
const BOARD_CENTER = 360;
const DEFAULT_HOVER_INFO = "Hover a piece to inspect details.";

const stateRefs = {
  playerCount: document.querySelector("#player-count"),
  pieceCount: document.querySelector("#piece-count"),
  startButton: document.querySelector("#start-game"),
  rollButton: document.querySelector("#roll-dice"),
  status: document.querySelector("#status"),
  dice: document.querySelector("#dice"),
  hoverInfo: document.querySelector("#hover-info"),
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

tokenLayer.addEventListener("pointerover", (event) => {
  const token = event.target.closest("circle.token");
  if (!token) {
    return;
  }

  if (stateRefs.hoverInfo) {
    stateRefs.hoverInfo.textContent = token.dataset.hoverText || DEFAULT_HOVER_INFO;
  }
});

tokenLayer.addEventListener("pointerout", (event) => {
  if (!event.target.closest("circle.token")) {
    return;
  }

  if (stateRefs.hoverInfo) {
    stateRefs.hoverInfo.textContent = DEFAULT_HOVER_INFO;
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
  if (stateRefs.hoverInfo) {
    stateRefs.hoverInfo.textContent = stateRefs.hoverInfo.textContent || DEFAULT_HOVER_INFO;
  }

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
          r: 13,
          fill: "rgba(255, 255, 255, 0.65)",
          stroke: "#70512a",
          "stroke-width": 1,
        }),
      );
    });
  });

  trackCoordinates.forEach((coord, index) => {
    const segmentColor = segmentShade(index);
    const startSlot = START_INDEXES.indexOf(index);
    const isStart = startSlot !== -1;

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
        r: 11.5,
        class: classes.join(" "),
        fill: isStart ? playerLightByColor[PLAYER_COLORS[startSlot]] : segmentColor,
      }),
    );

    if (isStart) {
      const labelPosition = getRadialLabelPosition(coord, 28);
      staticLayer.append(
        createSvgText(
          {
            x: labelPosition.x,
            y: labelPosition.y,
            class: "board-label start-label",
            "text-anchor": "middle",
            "dominant-baseline": "middle",
          },
          `START P${startSlot + 1}`,
        ),
      );
    }

    if (SAFE_TRACK_INDEXES.has(index)) {
      staticLayer.append(
        createSvgElement("circle", {
          cx: coord.x,
          cy: coord.y,
          r: 2.8,
          fill: "#764a1f",
        }),
      );

      if (!isStart) {
        const labelPosition = getRadialLabelPosition(coord, 22);
        staticLayer.append(
          createSvgText(
            {
              x: labelPosition.x,
              y: labelPosition.y,
              class: "board-label safe-label",
              "text-anchor": "middle",
              "dominant-baseline": "middle",
            },
            "SAFE",
          ),
        );
      }
    }
  });

  PLAYER_COLORS.forEach((color, playerIndex) => {
    laneCoordinates[playerIndex].forEach((coord, laneIndex) => {
      staticLayer.append(
        createSvgElement("circle", {
          cx: coord.x,
          cy: coord.y,
          r: 11.2,
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
      const offset = stackOffset(index, entries.length);
      const player = gameState.players[entry.piece.playerIndex];
      const tokenX = entry.coord.x + offset.x;
      const tokenY = entry.coord.y + offset.y;
      const hoverSummary = buildPieceHoverSummary(entry.piece, player);
      const hoverDetails = buildPieceHoverDetails(entry.piece, player);
      const token = createSvgElement("circle", {
        cx: tokenX,
        cy: tokenY,
        r: 10.5,
        class: `token ${playerCssClassByColor[player.color]}`,
        "data-player": entry.piece.playerIndex,
        "data-piece-id": entry.piece.pieceId,
        "data-hover-text": hoverSummary,
      });
      token.setAttribute("aria-label", hoverSummary);
      token.append(createSvgTitle(hoverDetails));

      tokenLayer.append(
        token,
      );

      tokenLayer.append(
        createSvgText(
          {
            x: tokenX,
            y: tokenY,
            class: "token-label",
            "text-anchor": "middle",
            "dominant-baseline": "middle",
          },
          `${entry.piece.playerIndex + 1}-${entry.piece.slot + 1}`,
        ),
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

function stackOffset(index, stackSize) {
  if (stackSize <= 1) {
    return { x: 0, y: 0 };
  }

  const angle = -Math.PI / 2 + (2 * Math.PI * index) / stackSize;
  const radius = 10 + Math.min(stackSize, 8) * 1.9;

  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
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

function createSvgText(attributes, text) {
  const element = createSvgElement("text", attributes);
  element.textContent = text;
  return element;
}

function createSvgTitle(text) {
  const title = createSvgElement("title", {});
  title.textContent = text;
  return title;
}

function buildPieceHoverSummary(pieceData, player) {
  return `P${pieceData.playerIndex + 1} ${player.color} | Piece ${pieceData.slot + 1} | ${describePieceLocation(pieceData)}`;
}

function buildPieceHoverDetails(pieceData, player) {
  const location = describePieceLocation(pieceData);
  return `Player ${pieceData.playerIndex + 1} (${player.color})\nPiece ${pieceData.slot + 1}\n${location}`;
}

function describePieceLocation(pieceData) {
  if (pieceData.zone === "track") {
    return `Track space ${pieceData.trackIndex + 1}`;
  }

  if (pieceData.zone === "home_lane") {
    return `Home lane ${pieceData.laneIndex + 1}/${HOME_LENGTH}`;
  }

  if (pieceData.zone === "home") {
    return "In home triangle";
  }

  return "In nest";
}

function getRadialLabelPosition(coord, distance) {
  const vectorX = coord.x - BOARD_CENTER;
  const vectorY = coord.y - BOARD_CENTER;
  const vectorSize = Math.hypot(vectorX, vectorY) || 1;

  return {
    x: coord.x + (vectorX / vectorSize) * distance,
    y: coord.y + (vectorY / vectorSize) * distance,
  };
}

function buildTrackCoordinates() {
  const radius = 282;

  return Array.from({ length: TRACK_LENGTH }).map((_, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / TRACK_LENGTH;

    return {
      x: BOARD_CENTER + Math.cos(angle) * radius,
      y: BOARD_CENTER + Math.sin(angle) * radius,
    };
  });
}

function buildLaneCoordinates() {
  const outerRadius = 230;
  const innerRadius = 84;

  return Array.from({ length: 4 }).map((_, playerIndex) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * START_INDEXES[playerIndex]) / TRACK_LENGTH;

    return Array.from({ length: HOME_LENGTH }).map((__, laneIndex) => {
      const t = laneIndex / (HOME_LENGTH - 1);
      const radius = outerRadius - (outerRadius - innerRadius) * t;

      return {
        x: BOARD_CENTER + Math.cos(angle) * radius,
        y: BOARD_CENTER + Math.sin(angle) * radius,
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
