import { beforeEach, describe, expect, test, vi } from "vitest";

function buildDom() {
  document.body.innerHTML = `
    <select id="player-count">
      <option value="2">2</option>
      <option value="3">3</option>
      <option value="4" selected>4</option>
    </select>
    <select id="piece-count">
      <option value="1">1</option>
      <option value="2">2</option>
      <option value="3">3</option>
      <option value="4" selected>4</option>
    </select>
    <button id="start-game" type="button">Start</button>
    <button id="roll-dice" type="button">Roll</button>
    <p id="status"></p>
    <p id="dice"></p>
    <p id="hover-info"></p>
    <div id="actions"></div>
    <div id="bonus"></div>
    <ol id="log"></ol>
    <svg id="board" viewBox="0 0 720 720"></svg>
    <p id="online-status"></p>
    <p id="socket-endpoint"></p>
    <input id="player-name" />
    <input id="room-id" />
    <button id="connect-online" type="button">Connect</button>
    <button id="create-room" type="button">Create</button>
    <button id="join-room" type="button">Join</button>
    <button id="leave-room" type="button">Leave</button>
    <button id="refresh-rooms" type="button">Refresh</button>
    <ul id="room-list"></ul>
    <p id="room-details"></p>
  `;
}

async function loadUiModule() {
  vi.resetModules();
  return import("../src/main.js");
}

describe("UI controls", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    buildDom();
    delete window.__PARCHIS_TEST_API__;
  });

  test("setup controls start a game with selected players and pieces", async () => {
    await loadUiModule();

    const playerCount = document.querySelector("#player-count");
    const pieceCount = document.querySelector("#piece-count");
    playerCount.value = "3";
    pieceCount.value = "2";

    document.querySelector("#start-game").click();

    const state = window.__PARCHIS_TEST_API__.getState();
    expect(state.playerCount).toBe(3);
    expect(state.piecesPerPlayer).toBe(2);

    const tokens = document.querySelectorAll("#board .token");
    expect(tokens.length).toBe(6);
  });

  test("rolling dice renders legal move controls", async () => {
    await loadUiModule();

    window.__PARCHIS_TEST_API__.startGame({ playerCount: 2, piecesPerPlayer: 1 });
    window.__PARCHIS_TEST_API__.queueRandom([0.5, 0.0]); // 4 and 1

    document.querySelector("#roll-dice").click();

    expect(document.querySelector("#dice").textContent).toContain("4 + 1");
    expect(document.querySelectorAll("#actions button[data-option-id]").length).toBeGreaterThan(0);
  });

  test("clicking a legal move advances game state", async () => {
    await loadUiModule();

    window.__PARCHIS_TEST_API__.startGame({ playerCount: 2, piecesPerPlayer: 1 });
    window.__PARCHIS_TEST_API__.queueRandom([0.5, 0.0]);

    document.querySelector("#roll-dice").click();

    const firstMove = document.querySelector("#actions button[data-option-id]");
    firstMove.click();

    const state = window.__PARCHIS_TEST_API__.getState();
    expect(state.players[0].pieces[0].progress).toBeGreaterThanOrEqual(0);
  });

  test("online room_state in await_action renders legal move buttons for active player", async () => {
    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      static instances = [];

      constructor() {
        this.readyState = FakeWebSocket.CONNECTING;
        this.listeners = new Map();
        FakeWebSocket.instances.push(this);

        queueMicrotask(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.dispatch("open", {});
        });
      }

      addEventListener(type, listener) {
        if (!this.listeners.has(type)) {
          this.listeners.set(type, []);
        }

        this.listeners.get(type).push(listener);
      }

      send() {}

      close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatch("close", {});
      }

      dispatch(type, event) {
        (this.listeners.get(type) || []).forEach((listener) => listener(event));
      }
    }

    const originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket;
    window.WebSocket = FakeWebSocket;

    try {
      await loadUiModule();

      document.querySelector("#connect-online").click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const ws = FakeWebSocket.instances[0];
      ws.dispatch("message", {
        data: JSON.stringify({ type: "welcome", payload: { clientId: "host-1" } }),
      });
      ws.dispatch("message", {
        data: JSON.stringify({ type: "join_success", payload: { roomId: "ROOM1", playerName: "Host" } }),
      });
      ws.dispatch("message", {
        data: JSON.stringify({
          type: "room_state",
          payload: {
            room: {
              id: "ROOM1",
              hostClientId: "host-1",
              playerCount: 2,
              players: [
                { clientId: "host-1", name: "Host", seatIndex: 0, isHost: true },
                { clientId: "guest-1", name: "Guest", seatIndex: 1, isHost: false },
              ],
              game: {
                activeTurnClientId: "host-1",
                state: {
                  phase: "await_action",
                  currentPlayerIndex: 0,
                  doubleChainCount: 0,
                  dice: [4, 1],
                  pendingBonuses: [],
                  turnOptions: [
                    { id: "opt-1", label: "piece 1 by 5", moves: [{ pieceId: "p0-0", steps: 5 }] },
                    { id: "opt-2", label: "piece 2 by 5", moves: [{ pieceId: "p0-1", steps: 5 }] },
                  ],
                  players: [
                    {
                      color: "red",
                      pieces: [
                        { id: "p0-0", slot: 0, progress: -1 },
                        { id: "p0-1", slot: 1, progress: -1 },
                      ],
                    },
                    {
                      color: "yellow",
                      pieces: [
                        { id: "p1-0", slot: 0, progress: -1 },
                        { id: "p1-1", slot: 1, progress: -1 },
                      ],
                    },
                  ],
                  log: [],
                },
              },
            },
            systemMessage:
              "Applied action roll_dice; next actor: host-1; next step: active player must choose a legal move option (2 available)",
          },
        }),
      });

      expect(document.querySelector("#status").textContent).toContain("pick move");
      expect(document.querySelector("#dice").textContent).toContain("4 + 1");
      expect(document.querySelectorAll("#actions button[data-option-id]")).toHaveLength(2);
    } finally {
      globalThis.WebSocket = originalWebSocket;
      window.WebSocket = originalWebSocket;
    }
  });
});
