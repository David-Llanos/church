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
const DEFAULT_LOBBY_STATUS = "Not connected";
const ONLINE_LOG_PREFIX = "[Parchis Online]";

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
  onlineStatus: document.querySelector("#online-status"),
  socketEndpoint: document.querySelector("#socket-endpoint"),
  playerName: document.querySelector("#player-name"),
  roomId: document.querySelector("#room-id"),
  connectOnline: document.querySelector("#connect-online"),
  createRoom: document.querySelector("#create-room"),
  joinRoom: document.querySelector("#join-room"),
  leaveRoom: document.querySelector("#leave-room"),
  refreshRooms: document.querySelector("#refresh-rooms"),
  roomList: document.querySelector("#room-list"),
  roomDetails: document.querySelector("#room-details"),
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
const lobbyState = {
  ws: null,
  connection: "disconnected",
  clientId: null,
  rooms: [],
  currentRoom: null,
  statusMessage: DEFAULT_LOBBY_STATUS,
};

const trackCoordinates = buildTrackCoordinates();
const laneCoordinates = buildLaneCoordinates();
const nestCoordinates = buildNestCoordinates();
const homeCoordinates = buildHomeCoordinates();

const staticLayer = createSvgElement("g", { id: "board-static" });
const tokenLayer = createSvgElement("g", { id: "board-tokens" });
stateRefs.board.append(staticLayer, tokenLayer);

if (stateRefs.playerName) {
  stateRefs.playerName.value = `Player-${Math.floor(Math.random() * 900 + 100)}`;
}

drawBoardSkeleton();
render();

stateRefs.startButton.addEventListener("click", () => {
  const piecesPerPlayer = Number.parseInt(stateRefs.pieceCount.value, 10);
  if (isOnlineRoomJoined()) {
    sendGameAction({
      kind: "start_game",
      piecesPerPlayer,
    });
    return;
  }

  const playerCount = Number.parseInt(stateRefs.playerCount.value, 10);

  gameState = createGame({ playerCount, piecesPerPlayer });
  render();
});

stateRefs.rollButton.addEventListener("click", () => {
  if (sendGameAction({ kind: "roll_dice" })) {
    return;
  }

  transition(() => rollDice(gameState, consumeRandom));
});

stateRefs.actions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-option-id]");
  if (!button) {
    return;
  }

  const optionId = button.dataset.optionId;
  if (sendGameAction({ kind: "apply_turn_option", optionId })) {
    return;
  }

  transition(() => applyTurnOption(gameState, optionId));
});

stateRefs.bonus.addEventListener("click", (event) => {
  const pieceButton = event.target.closest("button[data-piece-id]");
  if (pieceButton) {
    const pieceId = pieceButton.dataset.pieceId;
    if (sendGameAction({ kind: "apply_bonus_move", pieceId })) {
      return;
    }

    transition(() => applyBonusMove(gameState, pieceId));
    return;
  }

  const skipButton = event.target.closest("button[data-skip-bonus]");
  if (skipButton) {
    if (sendGameAction({ kind: "skip_bonus" })) {
      return;
    }

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

if (stateRefs.connectOnline) {
  stateRefs.connectOnline.addEventListener("click", () => {
    connectLobby();
  });
}

if (stateRefs.refreshRooms) {
  stateRefs.refreshRooms.addEventListener("click", () => {
    sendLobbyMessage("list_rooms");
  });
}

if (stateRefs.createRoom) {
  stateRefs.createRoom.addEventListener("click", () => {
    const payload = { playerName: getPlayerName() };
    const preferredRoomId = normalizeRoomId(stateRefs.roomId?.value || "");
    if (preferredRoomId) {
      payload.roomId = preferredRoomId;
    }

    sendLobbyMessage("create_room", payload);
  });
}

if (stateRefs.joinRoom) {
  stateRefs.joinRoom.addEventListener("click", () => {
    joinRoomFromInput();
  });
}

if (stateRefs.leaveRoom) {
  stateRefs.leaveRoom.addEventListener("click", () => {
    sendLobbyMessage("leave_room");
  });
}

if (stateRefs.roomList) {
  stateRefs.roomList.addEventListener("click", (event) => {
    const joinButton = event.target.closest("button[data-room-id]");
    if (!joinButton) {
      return;
    }

    const roomId = normalizeRoomId(joinButton.dataset.roomId || "");
    if (!roomId) {
      return;
    }

    if (stateRefs.roomId) {
      stateRefs.roomId.value = roomId;
    }

    sendLobbyMessage("join_room", {
      roomId,
      playerName: getPlayerName(),
    });
  });
}

if (stateRefs.roomId) {
  stateRefs.roomId.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    joinRoomFromInput();
  });
}

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
  renderLobbyPanel();
  renderLog();
  renderTokens();
}

function onlineLog(message, details = null) {
  if (details === null) {
    console.info(`${ONLINE_LOG_PREFIX} ${message}`);
    return;
  }

  console.info(`${ONLINE_LOG_PREFIX} ${message}`, details);
}

function onlineWarn(message, details = null) {
  if (details === null) {
    console.warn(`${ONLINE_LOG_PREFIX} ${message}`);
    return;
  }

  console.warn(`${ONLINE_LOG_PREFIX} ${message}`, details);
}

function onlineError(message, details = null) {
  if (details === null) {
    console.error(`${ONLINE_LOG_PREFIX} ${message}`);
    return;
  }

  console.error(`${ONLINE_LOG_PREFIX} ${message}`, details);
}

function getRoomPlayerByClientId(room, clientId) {
  if (!room || !clientId) {
    return null;
  }

  return (room.players || []).find((player) => player.clientId === clientId) || null;
}

function formatRoomPlayer(player) {
  if (!player) {
    return "unknown";
  }

  const seat = Number.isInteger(player.seatIndex) ? `P${player.seatIndex + 1}` : "P?";
  const name = player.name || "player";
  return `${seat} ${name}`;
}

function describeClientNextStep(state) {
  if (!state) {
    return "none";
  }

  if (state.phase === "await_roll") {
    return "roll dice";
  }

  if (state.phase === "await_action") {
    const optionCount = Array.isArray(state.turnOptions) ? state.turnOptions.length : 0;
    return `choose legal move (${optionCount} option${optionCount === 1 ? "" : "s"})`;
  }

  if (state.phase === "await_bonus") {
    const bonus = Array.isArray(state.pendingBonuses) ? state.pendingBonuses[0] : null;
    return `resolve bonus${bonus ? ` (${bonus})` : ""}`;
  }

  if (state.phase === "game_over") {
    return "game over";
  }

  return state.phase;
}

function logTurnSnapshot(reason = "Room state updated") {
  const room = lobbyState.currentRoom;
  if (!room) {
    onlineLog(`${reason} | room: none`);
    return;
  }

  if (!room.game || !room.game.state) {
    onlineLog(`${reason} | room ${room.id} | waiting for host to start`);
    return;
  }

  const activePlayer = getRoomPlayerByClientId(room, room.game.activeTurnClientId);
  const localPlayer = getRoomPlayerByClientId(room, lobbyState.clientId);
  const isLocalTurn = room.game.activeTurnClientId === lobbyState.clientId;
  const diceLabel = Array.isArray(room.game.state.dice) ? room.game.state.dice.join("+") : "not rolled";
  const nextStep = describeClientNextStep(room.game.state);
  const summary =
    `${reason} | room ${room.id} | phase=${room.game.state.phase} | ` +
    `active=${formatRoomPlayer(activePlayer)} | local=${formatRoomPlayer(localPlayer)} | ` +
    `${isLocalTurn ? "YOUR TURN" : "waiting"} | dice=${diceLabel} | next=${nextStep}`;

  onlineLog(summary);
}

function isOnlineConnected() {
  return lobbyState.connection === "connected";
}

function isOnlineRoomJoined() {
  return isOnlineConnected() && Boolean(lobbyState.currentRoom);
}

function getOnlineGame() {
  return lobbyState.currentRoom?.game || null;
}

function isLocalHost() {
  if (!lobbyState.currentRoom || !lobbyState.clientId) {
    return false;
  }

  return lobbyState.currentRoom.hostClientId === lobbyState.clientId;
}

function getLocalSeatIndex() {
  if (!lobbyState.currentRoom || !lobbyState.clientId) {
    return -1;
  }

  const localPlayer = (lobbyState.currentRoom.players || []).find(
    (player) => player.clientId === lobbyState.clientId,
  );
  return Number.isInteger(localPlayer?.seatIndex) ? localPlayer.seatIndex : -1;
}

function isLocalPlayersTurn() {
  const onlineGame = getOnlineGame();
  if (!onlineGame || !lobbyState.clientId) {
    return true;
  }

  return onlineGame.activeTurnClientId === lobbyState.clientId;
}

function sendGameAction(action) {
  if (!isOnlineRoomJoined()) {
    return false;
  }

  if (action.kind !== "start_game") {
    if (!getOnlineGame()) {
      lobbyState.statusMessage = "Host must start online game first";
      onlineWarn("Blocked action: host has not started online match", action);
      renderLobbyPanel();
      return true;
    }

    if (!isLocalPlayersTurn()) {
      lobbyState.statusMessage = "Wait for your turn";
      onlineWarn("Blocked out-of-turn action", action);
      renderLobbyPanel();
      return true;
    }
  }

  onlineLog(`Sending action ${action.kind}`, action);
  sendLobbyMessage("player_action", { action });
  return true;
}

function getSocketUrl() {
  if (typeof window !== "undefined" && typeof window.__PARCHIS_WS_URL__ === "string") {
    return window.__PARCHIS_WS_URL__;
  }

  const host = window.location.hostname || "localhost";
  const isSecure = window.location.protocol === "https:";
  const protocol = isSecure ? "wss" : "ws";
  const port = window.location.port === "5173" ? "3001" : window.location.port;
  const portSuffix = port ? `:${port}` : "";

  return `${protocol}://${host}${portSuffix}/ws`;
}

function getPlayerName() {
  const raw = stateRefs.playerName?.value || "";
  const trimmed = raw.trim().slice(0, 24);
  if (trimmed.length > 0) {
    return trimmed;
  }

  if (stateRefs.playerName) {
    stateRefs.playerName.value = "Player";
  }
  return "Player";
}

function normalizeRoomId(value) {
  const candidate = String(value || "").trim().toUpperCase();
  if (candidate.length === 0) {
    return "";
  }

  if (!/^[A-Z0-9_-]{3,16}$/.test(candidate)) {
    return "";
  }

  return candidate;
}

function joinRoomFromInput() {
  const roomId = normalizeRoomId(stateRefs.roomId?.value || "");
  if (!roomId) {
    lobbyState.statusMessage = "Enter a valid room ID first";
    renderLobbyPanel();
    return;
  }

  sendLobbyMessage("join_room", {
    roomId,
    playerName: getPlayerName(),
  });
}

function connectLobby() {
  if (lobbyState.ws && (lobbyState.ws.readyState === WebSocket.OPEN || lobbyState.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const socketUrl = getSocketUrl();
  lobbyState.connection = "connecting";
  lobbyState.statusMessage = `Connecting to ${socketUrl}`;
  renderLobbyPanel();

  let ws;
  try {
    ws = new WebSocket(socketUrl);
  } catch (error) {
    lobbyState.connection = "disconnected";
    lobbyState.statusMessage = "Could not create WebSocket connection";
    renderLobbyPanel();
    return;
  }

  lobbyState.ws = ws;

  ws.addEventListener("open", () => {
    lobbyState.connection = "connected";
    lobbyState.statusMessage = "Connected to multiplayer server";
    onlineLog(`WebSocket connected to ${socketUrl}`);
    render();
    sendLobbyMessage("list_rooms");
  });

  ws.addEventListener("message", (event) => {
    handleLobbyMessage(event.data);
  });

  ws.addEventListener("error", () => {
    lobbyState.statusMessage = "Network error while using multiplayer server";
    onlineError("WebSocket error");
    render();
  });

  ws.addEventListener("close", () => {
    if (lobbyState.ws === ws) {
      lobbyState.ws = null;
    }
    lobbyState.connection = "disconnected";
    lobbyState.clientId = null;
    lobbyState.currentRoom = null;
    lobbyState.statusMessage = "Disconnected";
    const playerCount = Number.parseInt(stateRefs.playerCount?.value || "4", 10);
    const piecesPerPlayer = Number.parseInt(stateRefs.pieceCount?.value || "4", 10);
    gameState = createGame({
      playerCount: Number.isInteger(playerCount) ? playerCount : 4,
      piecesPerPlayer: Number.isInteger(piecesPerPlayer) ? piecesPerPlayer : 4,
    });
    onlineWarn("WebSocket disconnected");
    render();
  });
}

function sendLobbyMessage(type, payload = {}) {
  if (!lobbyState.ws || lobbyState.ws.readyState !== WebSocket.OPEN) {
    lobbyState.statusMessage = "Connect to multiplayer server first";
    onlineWarn(`Blocked outbound message ${type}: socket not connected`, payload);
    renderLobbyPanel();
    return false;
  }

  onlineLog(`Sending message ${type}`, payload);
  lobbyState.ws.send(JSON.stringify({ type, payload }));
  return true;
}

function handleLobbyMessage(rawMessage) {
  let message;
  try {
    message = JSON.parse(String(rawMessage));
  } catch (error) {
    lobbyState.statusMessage = "Received invalid multiplayer payload";
    onlineError("Received invalid multiplayer payload", { rawMessage: String(rawMessage) });
    renderLobbyPanel();
    return;
  }

  const payload = message?.payload || {};

  if (message.type === "welcome") {
    lobbyState.clientId = payload.clientId || null;
    onlineLog(`Connected as client ${lobbyState.clientId || "unknown"}`);
  } else if (message.type === "lobby_state") {
    lobbyState.rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
    onlineLog(`Lobby update: ${lobbyState.rooms.length} room(s) available`);
  } else if (message.type === "room_created") {
    if (stateRefs.roomId && payload.roomId) {
      stateRefs.roomId.value = payload.roomId;
    }
    if (payload.roomId) {
      lobbyState.statusMessage = `Created room ${payload.roomId}`;
      onlineLog(`Created room ${payload.roomId}`);
    }
  } else if (message.type === "join_success") {
    if (stateRefs.roomId && payload.roomId) {
      stateRefs.roomId.value = payload.roomId;
    }
    if (payload.playerName && stateRefs.playerName) {
      stateRefs.playerName.value = payload.playerName;
    }
    lobbyState.statusMessage = `Joined room ${payload.roomId}`;
    onlineLog(`Joined room ${payload.roomId} as ${payload.playerName || "player"}`);
  } else if (message.type === "room_state") {
    lobbyState.currentRoom = payload.room || null;
    if (payload.room?.game?.state) {
      gameState = payload.room.game.state;
    } else if (payload.room && payload.room.playerCount >= 2) {
      const piecesPerPlayer = Number.parseInt(stateRefs.pieceCount?.value || "4", 10);
      gameState = createGame({
        playerCount: Math.min(4, Math.max(2, payload.room.playerCount)),
        piecesPerPlayer: Number.isInteger(piecesPerPlayer) ? piecesPerPlayer : 4,
      });
    }
    if (payload.systemMessage) {
      lobbyState.statusMessage = payload.systemMessage;
    }
    logTurnSnapshot(payload.systemMessage || "Room state updated");
  } else if (message.type === "leave_success") {
    lobbyState.currentRoom = null;
    lobbyState.statusMessage = "You left the room";
    onlineLog("You left the room");
    const playerCount = Number.parseInt(stateRefs.playerCount?.value || "4", 10);
    const piecesPerPlayer = Number.parseInt(stateRefs.pieceCount?.value || "4", 10);
    gameState = createGame({
      playerCount: Number.isInteger(playerCount) ? playerCount : 4,
      piecesPerPlayer: Number.isInteger(piecesPerPlayer) ? piecesPerPlayer : 4,
    });
  } else if (message.type === "error") {
    lobbyState.statusMessage = payload.message || "Server rejected request";
    onlineWarn(`Server error: ${lobbyState.statusMessage}`);
  } else if (message.type === "player_action") {
    lobbyState.statusMessage = `Action received from ${payload.actorClientId?.slice(0, 8) || "player"}`;
    onlineLog("Received player_action event", payload);
  }

  render();
}

function renderLobbyPanel() {
  if (!stateRefs.onlineStatus) {
    return;
  }

  const connectionLabel = lobbyState.connection;
  stateRefs.onlineStatus.textContent = `Status: ${connectionLabel} | ${lobbyState.statusMessage}`;

  if (stateRefs.socketEndpoint) {
    stateRefs.socketEndpoint.textContent = `Endpoint: ${getSocketUrl()}`;
  }

  if (stateRefs.connectOnline) {
    stateRefs.connectOnline.disabled = lobbyState.connection !== "disconnected";
  }

  const connected = lobbyState.connection === "connected";
  const onlineJoined = isOnlineRoomJoined();
  const onlineGame = getOnlineGame();

  if (stateRefs.createRoom) {
    stateRefs.createRoom.disabled = !connected;
  }
  if (stateRefs.joinRoom) {
    stateRefs.joinRoom.disabled = !connected;
  }
  if (stateRefs.leaveRoom) {
    stateRefs.leaveRoom.disabled = !connected || !lobbyState.currentRoom;
  }
  if (stateRefs.refreshRooms) {
    stateRefs.refreshRooms.disabled = !connected;
  }
  if (stateRefs.playerCount) {
    stateRefs.playerCount.disabled = onlineJoined;
  }
  if (stateRefs.pieceCount) {
    stateRefs.pieceCount.disabled = onlineJoined && !!onlineGame;
  }
  if (stateRefs.startButton) {
    stateRefs.startButton.disabled = onlineJoined && !isLocalHost();
    stateRefs.startButton.textContent = onlineJoined ? "Start Online Match" : "Start New Game";
  }
  if (stateRefs.rollButton && onlineJoined) {
    stateRefs.rollButton.disabled = !onlineGame || !isLocalPlayersTurn() || gameState.phase !== "await_roll";
  }

  if (stateRefs.roomList) {
    stateRefs.roomList.innerHTML = "";
    if (lobbyState.rooms.length === 0) {
      const item = document.createElement("li");
      item.textContent = connected ? "No open rooms yet." : "Connect to load rooms.";
      stateRefs.roomList.append(item);
    } else {
      lobbyState.rooms.forEach((room) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "lobby-room-button";
        button.dataset.roomId = room.id;
        button.textContent = `${room.id} (${room.playerCount}/${room.maxPlayers}) host: ${room.hostName}`;
        item.append(button);
        stateRefs.roomList.append(item);
      });
    }
  }

  if (stateRefs.roomDetails) {
    if (!lobbyState.currentRoom) {
      stateRefs.roomDetails.textContent = "Current room: none";
    } else {
      const playerNames = (lobbyState.currentRoom.players || [])
        .map((player) => {
          const seatLabel = Number.isInteger(player.seatIndex) ? `P${player.seatIndex + 1}` : "P?";
          return `${seatLabel} ${player.name}${player.isHost ? " (host)" : ""}`;
        })
        .join(", ");
      const activeTurnClientId = lobbyState.currentRoom.game?.activeTurnClientId;
      const activeTurnPlayer = (lobbyState.currentRoom.players || []).find(
        (player) => player.clientId === activeTurnClientId,
      );
      const activeLabel = activeTurnPlayer
        ? ` | active: P${activeTurnPlayer.seatIndex + 1} ${activeTurnPlayer.name}`
        : "";
      stateRefs.roomDetails.textContent =
        `Current room: ${lobbyState.currentRoom.id} | players: ${playerNames || "none"}${activeLabel}`;
    }
  }
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

  const onlineTurnBlocked = isOnlineRoomJoined() && !isLocalPlayersTurn();
  if (onlineTurnBlocked) {
    const localSeatIndex = getLocalSeatIndex();
    if (localSeatIndex >= 0) {
      stateRefs.status.textContent += ` | your seat: P${localSeatIndex + 1} (waiting)`;
    }
  }

  stateRefs.rollButton.disabled = gameState.phase !== "await_roll" || onlineTurnBlocked;
}

function renderActionPanel() {
  stateRefs.actions.innerHTML = "";

  if (isOnlineRoomJoined() && !getOnlineGame()) {
    stateRefs.actions.append(createParagraph("Start an online match to enable moves."));
    return;
  }

  if (isOnlineRoomJoined() && !isLocalPlayersTurn()) {
    stateRefs.actions.append(createParagraph("Waiting for the active player."));
    return;
  }

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

  if (isOnlineRoomJoined() && !getOnlineGame()) {
    stateRefs.bonus.append(createParagraph("No pending bonus."));
    return;
  }

  if (isOnlineRoomJoined() && !isLocalPlayersTurn()) {
    stateRefs.bonus.append(createParagraph("Waiting for the active player."));
    return;
  }

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
