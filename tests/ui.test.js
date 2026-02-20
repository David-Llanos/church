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
    <div id="actions"></div>
    <div id="bonus"></div>
    <ol id="log"></ol>
    <svg id="board" viewBox="0 0 720 720"></svg>
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
});
