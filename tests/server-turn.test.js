// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import WebSocket from "ws";

function waitForMessage(client, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = setInterval(() => {
      const index = client.inbox.findIndex(predicate);
      if (index >= 0) {
        const [message] = client.inbox.splice(index, 1);
        clearInterval(poll);
        resolve(message);
        return;
      }

      if (Date.now() - start > timeoutMs) {
        clearInterval(poll);
        reject(new Error(`Timed out waiting for message on ${client.name}`));
      }
    }, 20);
  });
}

async function openClient(baseUrl, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl}/ws`);
    const client = { ws, name, inbox: [], clientId: null };

    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      client.inbox.push(message);
      if (message.type === "welcome") {
        client.clientId = message.payload.clientId;
        resolve(client);
      }
    });

    ws.on("error", reject);
  });
}

function closeClient(client) {
  return new Promise((resolve) => {
    if (!client || !client.ws || client.ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }

    client.ws.once("close", () => resolve());
    client.ws.close();
  });
}

function clearInbox(...clients) {
  clients.forEach((client) => {
    if (!client?.inbox) {
      return;
    }
    client.inbox.length = 0;
  });
}

async function createRoomWithGuest(host, guest, hostName = "Host", guestName = "Guest") {
  clearInbox(host, guest);

  host.ws.send(JSON.stringify({ type: "create_room", payload: { playerName: hostName } }));
  const roomCreated = await waitForMessage(host, (message) => message.type === "room_created");
  const roomId = roomCreated.payload.roomId;

  guest.ws.send(JSON.stringify({ type: "join_room", payload: { roomId, playerName: guestName } }));
  await waitForMessage(
    guest,
    (message) => message.type === "join_success" && message.payload.roomId === roomId,
  );

  return roomId;
}

describe("server turn enforcement", () => {
  let importedServer = null;
  let previousPort = null;
  let previousQuietLogs = null;
  let baseUrl = "";
  let host = null;
  let guest = null;

  beforeAll(async () => {
    previousPort = process.env.PORT;
    previousQuietLogs = process.env.QUIET_SERVER_LOGS;
    process.env.QUIET_SERVER_LOGS = "1";
    process.env.PORT = "0";
    const mod = await import("../server/index.js");
    importedServer = mod.server;

    if (importedServer.listening !== true) {
      await new Promise((resolve) => importedServer.once("listening", resolve));
    }

    const address = importedServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected tcp server address");
    }
    baseUrl = `ws://127.0.0.1:${address.port}`;

    host = await openClient(baseUrl, "host");
    guest = await openClient(baseUrl, "guest");
  });

  afterAll(async () => {
    await closeClient(host);
    await closeClient(guest);

    if (importedServer && importedServer.listening) {
      await new Promise((resolve) => importedServer.close(resolve));
    }

    if (previousPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }

    if (previousQuietLogs === undefined) {
      delete process.env.QUIET_SERVER_LOGS;
    } else {
      process.env.QUIET_SERVER_LOGS = previousQuietLogs;
    }
  });

  test("rejects roll_dice from non-active player", async () => {
    const roomId = await createRoomWithGuest(host, guest, "HostA", "GuestA");
    clearInbox(host, guest);

    host.ws.send(
      JSON.stringify({
        type: "player_action",
        payload: { action: { kind: "start_game", piecesPerPlayer: 1 } },
      }),
    );

    const startedState = await waitForMessage(
      host,
      (message) => message.type === "room_state" && message.payload.room?.game?.state?.phase === "await_roll",
    );
    expect(startedState.payload.room.game.state.currentPlayerIndex).toBe(0);
    expect(startedState.payload.room.game.activeTurnClientId).toBe(host.clientId);

    guest.ws.send(
      JSON.stringify({
        type: "player_action",
        payload: { action: { kind: "roll_dice" } },
      }),
    );
    const denied = await waitForMessage(guest, (message) => message.type === "error");
    expect(denied.payload.message).toBe("It is not your turn");

    host.ws.send(
      JSON.stringify({
        type: "player_action",
        payload: { action: { kind: "roll_dice" } },
      }),
    );
    const accepted = await waitForMessage(
      host,
      (message) =>
        message.type === "room_state" &&
        message.payload.room?.id === roomId &&
        typeof message.payload.systemMessage === "string" &&
        message.payload.systemMessage.includes("Applied action roll_dice"),
    );
    expect(accepted.payload.room.game).not.toBeNull();
  }, 15000);

  test("rejects start_game from non-host", async () => {
    const roomId = await createRoomWithGuest(host, guest, "HostB", "GuestB");
    clearInbox(host, guest);

    guest.ws.send(
      JSON.stringify({
        type: "player_action",
        payload: { action: { kind: "start_game", piecesPerPlayer: 1 } },
      }),
    );
    const denied = await waitForMessage(guest, (message) => message.type === "error");
    expect(denied.payload.message).toBe("Only the host can start a game");

    host.ws.send(
      JSON.stringify({
        type: "player_action",
        payload: { action: { kind: "start_game", piecesPerPlayer: 1 } },
      }),
    );
    const started = await waitForMessage(
      host,
      (message) =>
        message.type === "room_state" &&
        message.payload.room?.id === roomId &&
        message.payload.room?.game?.state?.phase === "await_roll",
    );
    expect(started.payload.room.game.state.currentPlayerIndex).toBe(0);
  }, 15000);

  test("resets room game when a player disconnects", async () => {
    const roomId = await createRoomWithGuest(host, guest, "HostC", "GuestC");
    clearInbox(host, guest);

    host.ws.send(
      JSON.stringify({
        type: "player_action",
        payload: { action: { kind: "start_game", piecesPerPlayer: 1 } },
      }),
    );
    await waitForMessage(
      host,
      (message) =>
        message.type === "room_state" &&
        message.payload.room?.id === roomId &&
        message.payload.room?.game?.state?.phase === "await_roll",
    );

    clearInbox(host, guest);
    await closeClient(guest);

    const resetNotice = await waitForMessage(
      host,
      (message) =>
        message.type === "room_state" &&
        message.payload.room?.id === roomId &&
        message.payload.room?.game === null,
    );
    expect(resetNotice.payload.systemMessage).toContain("game was reset");

    guest = await openClient(baseUrl, "guest");
  }, 15000);
});
