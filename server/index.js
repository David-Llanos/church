import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import {
  applyBonusMove,
  applyTurnOption,
  createGame,
  rollDice,
  skipBonus,
} from "../src/game/engine.js";

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "3001", 10);
const MAX_PLAYERS_PER_ROOM = 4;
const ROOM_ID_LENGTH = 6;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, "../dist");

const clients = new Map();
const rooms = new Map();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

function shouldLogServer() {
  return process.env.QUIET_SERVER_LOGS !== "1";
}

function serverInfo(message, details = null) {
  if (!shouldLogServer()) {
    return;
  }

  if (details === null) {
    console.info(`[Parchis Server] ${message}`);
    return;
  }

  console.info(`[Parchis Server] ${message}`, details);
}

function serverWarn(message, details = null) {
  if (!shouldLogServer()) {
    return;
  }

  if (details === null) {
    console.warn(`[Parchis Server] ${message}`);
    return;
  }

  console.warn(`[Parchis Server] ${message}`, details);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sanitizeRoomId(value) {
  if (typeof value !== "string") {
    return null;
  }

  const candidate = value.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,16}$/.test(candidate)) {
    return null;
  }

  return candidate;
}

function makeRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let index = 0; index < ROOM_ID_LENGTH; index += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  if (rooms.has(id)) {
    return makeRoomId();
  }

  return id;
}

function sanitizeName(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim().slice(0, 24);
  return trimmed.length > 0 ? trimmed : fallback;
}

function reindexRoomSeats(room) {
  room.players.forEach((player, clientId) => {
    player.seatIndex = room.seatOrder.indexOf(clientId);
  });
}

function getActiveTurnClientId(room) {
  if (!room.game) {
    return null;
  }

  const currentPlayerIndex = room.game.state.currentPlayerIndex;
  return room.seatOrder[currentPlayerIndex] || null;
}

function getRoomPlayerList(room) {
  return room.seatOrder
    .map((clientId) => room.players.get(clientId))
    .filter(Boolean)
    .map((player) => ({
      clientId: player.clientId,
      name: player.name,
      joinedAt: player.joinedAt,
      seatIndex: player.seatIndex,
      isHost: player.clientId === room.hostClientId,
    }));
}

function serializeRoom(room) {
  return {
    id: room.id,
    createdAt: room.createdAt,
    hostClientId: room.hostClientId,
    players: getRoomPlayerList(room),
    playerCount: room.players.size,
    maxPlayers: MAX_PLAYERS_PER_ROOM,
    game: room.game
      ? {
          startedAt: room.game.startedAt,
          state: room.game.state,
          activeTurnClientId: getActiveTurnClientId(room),
        }
      : null,
  };
}

function serializeLobby() {
  return [...rooms.values()].map((room) => {
    const host = room.players.get(room.hostClientId);
    return {
      id: room.id,
      createdAt: room.createdAt,
      hostName: host?.name || "Unknown",
      playerCount: room.players.size,
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      openSlots: MAX_PLAYERS_PER_ROOM - room.players.size,
    };
  });
}

function sendToClient(clientId, message) {
  const client = clients.get(clientId);
  if (!client || client.ws.readyState !== client.ws.OPEN) {
    return;
  }

  client.ws.send(JSON.stringify(message));
}

function sendError(clientId, message) {
  sendToClient(clientId, { type: "error", payload: { message } });
  serverWarn(`Rejected request for client ${clientId.slice(0, 8)}: ${message}`);
}

function broadcastToRoom(roomId, message) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  room.players.forEach((player) => {
    sendToClient(player.clientId, message);
  });
}

function broadcastLobby() {
  const lobby = serializeLobby();
  clients.forEach((client) => {
    sendToClient(client.clientId, { type: "lobby_state", payload: { rooms: lobby } });
  });
}

function publishRoomState(roomId, systemMessage = null) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  broadcastToRoom(roomId, {
    type: "room_state",
    payload: {
      room: serializeRoom(room),
      ...(systemMessage ? { systemMessage } : {}),
    },
  });
}

function leaveCurrentRoom(clientId, reason) {
  const client = clients.get(clientId);
  if (!client || !client.roomId) {
    return;
  }

  const roomId = client.roomId;
  const room = rooms.get(roomId);
  client.roomId = null;

  if (!room) {
    return;
  }

  const departedPlayer = room.players.get(clientId);
  room.players.delete(clientId);
  room.seatOrder = room.seatOrder.filter((seatClientId) => seatClientId !== clientId);
  reindexRoomSeats(room);

  if (room.players.size === 0) {
    rooms.delete(roomId);
    broadcastLobby();
    return;
  }

  if (room.game) {
    room.game = null;
  }

  if (room.hostClientId === clientId) {
    room.hostClientId = room.seatOrder[0] || null;
  }

  const playerName = departedPlayer?.name || `Player ${clientId.slice(0, 5)}`;
  const gameResetMessage = `${playerName} ${reason}; game was reset`;
  serverInfo("Player left room", {
    roomId,
    clientId,
    reason,
    remainingPlayers: room.players.size,
    gameReset: true,
  });
  publishRoomState(roomId, gameResetMessage);
  broadcastLobby();
}

function joinRoom(clientId, roomId, playerName) {
  const client = clients.get(clientId);
  const room = rooms.get(roomId);

  if (!client || !room) {
    return false;
  }

  if (client.roomId && client.roomId !== roomId) {
    leaveCurrentRoom(clientId, "left the room");
  }

  if (room.game && !room.players.has(clientId)) {
    sendError(clientId, "Cannot join room while a game is running");
    return false;
  }

  if (room.players.size >= MAX_PLAYERS_PER_ROOM && !room.players.has(clientId)) {
    sendError(clientId, "Room is full");
    return false;
  }

  if (!room.seatOrder.includes(clientId)) {
    room.seatOrder.push(clientId);
  }

  const seatIndex = room.seatOrder.indexOf(clientId);
  const resolvedName = sanitizeName(playerName, `Player ${room.players.size + 1}`);
  room.players.set(clientId, {
    clientId,
    name: resolvedName,
    joinedAt: new Date().toISOString(),
    seatIndex,
  });
  reindexRoomSeats(room);
  client.roomId = roomId;

  if (!room.hostClientId) {
    room.hostClientId = clientId;
  }

  sendToClient(clientId, {
    type: "join_success",
    payload: { roomId, clientId, playerName: resolvedName },
  });

  serverInfo("Player joined room", {
    roomId,
    clientId,
    seatIndex,
    playerName: resolvedName,
    playerCount: room.players.size,
  });
  publishRoomState(roomId, `${resolvedName} joined`);
  broadcastLobby();
  return true;
}

function createRoom(clientId, preferredRoomId, playerName) {
  const client = clients.get(clientId);
  if (!client) {
    return;
  }

  const roomId = sanitizeRoomId(preferredRoomId) || makeRoomId();
  if (rooms.has(roomId)) {
    sendError(clientId, `Room ${roomId} already exists`);
    return;
  }

  rooms.set(roomId, {
    id: roomId,
    createdAt: new Date().toISOString(),
    hostClientId: clientId,
    players: new Map(),
    seatOrder: [],
    game: null,
  });

  serverInfo("Created room", {
    roomId,
    hostClientId: clientId,
    requestedRoomId: preferredRoomId || null,
  });
  sendToClient(clientId, { type: "room_created", payload: { roomId } });
  joinRoom(clientId, roomId, playerName);
}

function getRoomAndClientByActor(clientId) {
  const client = clients.get(clientId);
  if (!client || !client.roomId) {
    return { client: null, room: null };
  }

  const room = rooms.get(client.roomId) || null;
  return { client, room };
}

function isActorTurn(room, clientId) {
  if (!room || !room.game) {
    return false;
  }

  const seatIndex = room.seatOrder.indexOf(clientId);
  return seatIndex >= 0 && room.game.state.currentPlayerIndex === seatIndex;
}

function describeNextStep(state) {
  if (!state) {
    return "none";
  }

  if (state.phase === "await_roll") {
    return "active player must roll dice";
  }

  if (state.phase === "await_action") {
    const optionCount = Array.isArray(state.turnOptions) ? state.turnOptions.length : 0;
    return `active player must choose a legal move option (${optionCount} available)`;
  }

  if (state.phase === "await_bonus") {
    const bonus = Array.isArray(state.pendingBonuses) ? state.pendingBonuses[0] : null;
    return `active player must resolve bonus${bonus ? ` (${bonus})` : ""}`;
  }

  if (state.phase === "game_over") {
    return "game over";
  }

  return `phase ${state.phase}`;
}

function applyGameStateUpdate(room, nextState, actionKind) {
  room.game.state = nextState;
  const activeTurnClientId = getActiveTurnClientId(room);
  const nextStep = describeNextStep(room.game.state);
  serverInfo("Applied game action", {
    roomId: room.id,
    actionKind,
    phase: room.game.state.phase,
    currentPlayerIndex: room.game.state.currentPlayerIndex,
    activeTurnClientId,
    dice: room.game.state.dice,
    nextStep,
  });
  publishRoomState(
    room.id,
    `Applied action ${actionKind}; next actor: ${activeTurnClientId || "none"}; next step: ${nextStep}`,
  );
}

function startRoomGame(room, clientId, piecesPerPlayer) {
  if (room.hostClientId !== clientId) {
    sendError(clientId, "Only the host can start a game");
    return;
  }

  if (room.players.size < 2) {
    sendError(clientId, "At least two players are required");
    return;
  }

  const parsedPieces = Number.parseInt(String(piecesPerPlayer ?? "4"), 10);
  if (!Number.isInteger(parsedPieces) || parsedPieces < 1 || parsedPieces > 4) {
    sendError(clientId, "piecesPerPlayer must be between 1 and 4");
    return;
  }

  room.game = {
    startedAt: new Date().toISOString(),
    state: createGame({
      playerCount: room.players.size,
      piecesPerPlayer: parsedPieces,
    }),
  };
  serverInfo("Online game started", {
    roomId: room.id,
    hostClientId: clientId,
    playerCount: room.players.size,
    piecesPerPlayer: parsedPieces,
  });
  publishRoomState(room.id, "Online match started");
}

function handleGameAction(clientId, action) {
  const { room } = getRoomAndClientByActor(clientId);
  if (!room) {
    sendError(clientId, "Join a room before sending actions");
    return;
  }

  if (!action || typeof action.kind !== "string") {
    sendError(clientId, "Action must include a kind");
    return;
  }

  serverInfo("Received game action", {
    roomId: room.id,
    clientId,
    actionKind: action.kind,
    action,
  });

  if (action.kind === "start_game") {
    startRoomGame(room, clientId, action.piecesPerPlayer);
    return;
  }

  if (!room.game) {
    sendError(clientId, "Host must start an online game first");
    return;
  }

  if (!isActorTurn(room, clientId)) {
    serverWarn("Out-of-turn action blocked", {
      roomId: room.id,
      clientId,
      expectedClientId: getActiveTurnClientId(room),
      actionKind: action.kind,
    });
    sendError(clientId, "It is not your turn");
    return;
  }

  try {
    if (action.kind === "roll_dice") {
      applyGameStateUpdate(room, rollDice(room.game.state, Math.random), action.kind);
      return;
    }

    if (action.kind === "apply_turn_option") {
      if (typeof action.optionId !== "string" || action.optionId.length === 0) {
        sendError(clientId, "optionId is required");
        return;
      }
      applyGameStateUpdate(room, applyTurnOption(room.game.state, action.optionId), action.kind);
      return;
    }

    if (action.kind === "apply_bonus_move") {
      if (typeof action.pieceId !== "string" || action.pieceId.length === 0) {
        sendError(clientId, "pieceId is required");
        return;
      }
      applyGameStateUpdate(room, applyBonusMove(room.game.state, action.pieceId), action.kind);
      return;
    }

    if (action.kind === "skip_bonus") {
      applyGameStateUpdate(room, skipBonus(room.game.state), action.kind);
      return;
    }

    sendError(clientId, `Unknown action kind: ${action.kind}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed";
    serverWarn("Action failed with error", {
      roomId: room.id,
      clientId,
      actionKind: action.kind,
      message,
    });
    sendError(clientId, message);
  }
}

function handleSocketMessage(clientId, rawMessage) {
  let parsed;
  try {
    parsed = JSON.parse(rawMessage.toString("utf8"));
  } catch (error) {
    sendError(clientId, "Invalid JSON payload");
    return;
  }

  const { type, payload = {} } = parsed || {};
  if (typeof type !== "string") {
    sendError(clientId, "Message must include a string type");
    return;
  }

  const client = clients.get(clientId);
  if (!client) {
    return;
  }

  switch (type) {
    case "ping": {
      sendToClient(clientId, { type: "pong", payload: { ts: Date.now() } });
      break;
    }
    case "list_rooms": {
      sendToClient(clientId, { type: "lobby_state", payload: { rooms: serializeLobby() } });
      break;
    }
    case "create_room": {
      createRoom(clientId, payload.roomId, payload.playerName);
      break;
    }
    case "join_room": {
      const roomId = sanitizeRoomId(payload.roomId);
      if (!roomId || !rooms.has(roomId)) {
        sendError(clientId, "Room does not exist");
        break;
      }

      joinRoom(clientId, roomId, payload.playerName);
      break;
    }
    case "leave_room": {
      if (!client.roomId) {
        sendError(clientId, "You are not currently in a room");
        break;
      }

      leaveCurrentRoom(clientId, "left the room");
      sendToClient(clientId, { type: "leave_success", payload: {} });
      break;
    }
    case "player_action": {
      handleGameAction(clientId, payload.action || null);
      break;
    }
    default: {
      sendError(clientId, `Unknown message type: ${type}`);
      break;
    }
  }
}

function getStaticResponse(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const body = readFileSync(filePath);
  return { body, contentType };
}

function maybeServeStatic(req, res) {
  if (!existsSync(DIST_DIR)) {
    sendJson(res, 200, {
      ok: true,
      message: "Server is running. Build the frontend with `npm run build` to serve static assets.",
    });
    return true;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const normalized = path.normalize(path.join(DIST_DIR, requestedPath));
  const relative = path.relative(DIST_DIR, normalized);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    sendJson(res, 403, { ok: false, message: "Forbidden" });
    return true;
  }

  if (existsSync(normalized) && statSync(normalized).isFile()) {
    const { body, contentType } = getStaticResponse(normalized);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(body);
    return true;
  }

  const indexPath = path.join(DIST_DIR, "index.html");
  if (existsSync(indexPath)) {
    const { body, contentType } = getStaticResponse(indexPath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(body);
    return true;
  }

  sendJson(res, 404, { ok: false, message: "Not Found" });
  return true;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    sendJson(res, 200, {
      ok: true,
      serverTime: new Date().toISOString(),
      roomCount: rooms.size,
      clientCount: clients.size,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/rooms") {
    sendJson(res, 200, { rooms: serializeLobby() });
    return;
  }

  maybeServeStatic(req, res);
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws) => {
  const clientId = randomUUID();
  ws.isAlive = true;

  clients.set(clientId, {
    clientId,
    ws,
    roomId: null,
  });

  sendToClient(clientId, {
    type: "welcome",
    payload: {
      clientId,
      serverTime: new Date().toISOString(),
      maxPlayersPerRoom: MAX_PLAYERS_PER_ROOM,
    },
  });
  sendToClient(clientId, { type: "lobby_state", payload: { rooms: serializeLobby() } });

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (message) => {
    handleSocketMessage(clientId, message);
  });

  ws.on("close", () => {
    leaveCurrentRoom(clientId, "disconnected");
    clients.delete(clientId);
    broadcastLobby();
  });
});

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }

    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

server.listen(PORT, HOST, () => {
  if (process.env.QUIET_SERVER_LOGS === "1") {
    return;
  }

  const address = server.address();
  const boundPort = typeof address === "string" || !address ? PORT : address.port;
  console.log(`Parchis realtime server listening at http://${HOST}:${boundPort}`);
  console.log(`WebSocket endpoint: ws://${HOST}:${boundPort}/ws`);
});

server.on("close", () => {
  clearInterval(heartbeatInterval);
});

export { server };
