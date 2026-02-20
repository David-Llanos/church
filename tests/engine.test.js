import { describe, expect, test } from "vitest";

import {
  applyBonusMove,
  applyTurnOption,
  createGame,
  getBonusChoices,
  rollDice,
} from "../src/game/engine.js";
import { MAX_PROGRESS } from "../src/game/constants.js";

function rngFrom(values) {
  const sequence = [...values];
  return () => sequence.shift() ?? 0;
}

describe("engine setup", () => {
  test("creates configured player and piece counts", () => {
    const state = createGame({ playerCount: 3, piecesPerPlayer: 2 });

    expect(state.players).toHaveLength(3);
    expect(state.players[0].pieces).toHaveLength(2);
    expect(state.phase).toBe("await_roll");
  });
});

describe("nest and movement rules", () => {
  test("keeps pawn in nest when no move can use 5", () => {
    const initial = createGame({ playerCount: 2, piecesPerPlayer: 1 });
    const state = rollDice(initial, rngFrom([0.33, 0.0])); // 2 and 1

    expect(state.phase).toBe("await_roll");
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.players[0].pieces[0].progress).toBe(-1);
  });

  test("allows leaving nest with a total of 5", () => {
    const initial = createGame({ playerCount: 2, piecesPerPlayer: 1 });
    const rolled = rollDice(initial, rngFrom([0.5, 0.0])); // 4 and 1

    const moveByFive = rolled.turnOptions.find((option) => option.moves[0]?.steps === 5);
    const moved = applyTurnOption(rolled, moveByFive.id);

    expect(moved.players[0].pieces[0].progress).toBeGreaterThanOrEqual(0);
  });
});

describe("capture, safe, and bonuses", () => {
  test("captures on unsafe square and grants 20-step bonus", () => {
    const state = createGame({ playerCount: 2, piecesPerPlayer: 1 });

    state.phase = "await_action";
    state.players[0].pieces[0].progress = 3;
    state.players[1].pieces[0].progress = 55; // Player 2 start 17 => track 4
    state.turnOptions = [
      {
        id: "capture-1",
        kind: "single",
        label: "capture",
        moves: [{ pieceId: "p0-0", steps: 1 }],
      },
    ];

    const captured = applyTurnOption(state, "capture-1");

    expect(captured.players[1].pieces[0].progress).toBe(-1);
    expect(captured.phase).toBe("await_bonus");
    expect(captured.pendingBonuses[0]).toBe(20);
  });

  test("does not capture on safe square", () => {
    const state = createGame({ playerCount: 2, piecesPerPlayer: 1 });

    state.phase = "await_action";
    state.players[0].pieces[0].progress = 7; // target track 8 (safe)
    state.players[1].pieces[0].progress = 59; // player2 track 8
    state.turnOptions = [
      {
        id: "safe-1",
        kind: "single",
        label: "safe",
        moves: [{ pieceId: "p0-0", steps: 1 }],
      },
    ];

    const afterMove = applyTurnOption(state, "safe-1");

    expect(afterMove.players[1].pieces[0].progress).toBe(59);
    expect(afterMove.pendingBonuses).toHaveLength(0);
  });

  test("reaching home grants 10-step bonus when player has other active pieces", () => {
    const state = createGame({ playerCount: 2, piecesPerPlayer: 2 });

    state.phase = "await_action";
    state.players[0].pieces[0].progress = MAX_PROGRESS - 1;
    state.players[0].pieces[1].progress = 0;
    state.turnOptions = [
      {
        id: "home-1",
        kind: "single",
        label: "home",
        moves: [{ pieceId: "p0-0", steps: 1 }],
      },
    ];

    const afterHome = applyTurnOption(state, "home-1");

    expect(afterHome.phase).toBe("await_bonus");
    expect(afterHome.pendingBonuses[0]).toBe(10);
    expect(getBonusChoices(afterHome).map((choice) => choice.pieceId)).toContain("p0-1");
  });

  test("bonus move can be applied to legal piece", () => {
    const state = createGame({ playerCount: 2, piecesPerPlayer: 2 });

    state.phase = "await_bonus";
    state.pendingBonuses = [10];
    state.players[0].pieces[0].progress = 5;
    state.players[0].pieces[1].progress = -1;

    const afterBonus = applyBonusMove(state, "p0-0");

    expect(afterBonus.players[0].pieces[0].progress).toBe(15);
  });
});

describe("double roll rules", () => {
  test("third consecutive doubles sends most advanced track piece to nest and passes turn", () => {
    const state = createGame({ playerCount: 2, piecesPerPlayer: 2 });

    state.doubleChainCount = 2;
    state.players[0].pieces[0].progress = 11;
    state.players[0].pieces[1].progress = 2;

    const result = rollDice(state, rngFrom([0.0, 0.0])); // 1 and 1

    expect(result.players[0].pieces[0].progress).toBe(-1);
    expect(result.currentPlayerIndex).toBe(1);
    expect(result.phase).toBe("await_roll");
    expect(result.doubleChainCount).toBe(0);
  });
});
