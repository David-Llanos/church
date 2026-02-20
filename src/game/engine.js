import {
  HOME_LENGTH,
  MAX_PROGRESS,
  PLAYER_COLORS,
  START_INDEXES,
  TRACK_LENGTH,
  isSafeTrackIndex,
} from "./constants.js";

function deepClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function nextPlayerIndex(state, current = state.currentPlayerIndex) {
  return (current + 1) % state.playerCount;
}

function pushLog(state, message) {
  state.log.push(message);
  if (state.log.length > 120) {
    state.log = state.log.slice(-120);
  }
}

function playerLabel(state, playerIndex) {
  const player = state.players[playerIndex];
  return `Player ${playerIndex + 1} (${player.color})`;
}

function pieceLabel(piece) {
  return `piece ${piece.slot + 1}`;
}

function getPlayer(state, playerIndex) {
  return state.players[playerIndex];
}

function getPiece(state, playerIndex, pieceId) {
  return getPlayer(state, playerIndex).pieces.find((piece) => piece.id === pieceId) || null;
}

export function getTrackIndexForProgress(startIndex, progress) {
  if (progress < 0 || progress >= TRACK_LENGTH) {
    return null;
  }

  return (startIndex + progress) % TRACK_LENGTH;
}

function isOnTrack(piece) {
  return piece.progress >= 0 && piece.progress < TRACK_LENGTH;
}

function isInHomeLane(piece) {
  return piece.progress >= TRACK_LENGTH && piece.progress < MAX_PROGRESS;
}

function getTrackOccupants(state, trackIndex) {
  const occupants = [];

  state.players.forEach((player, playerIndex) => {
    player.pieces.forEach((piece) => {
      const currentIndex = getTrackIndexForProgress(player.startIndex, piece.progress);
      if (currentIndex === trackIndex) {
        occupants.push({ playerIndex, piece });
      }
    });
  });

  return occupants;
}

function getOwnTrackCount(state, playerIndex, trackIndex, movingPieceId = null) {
  return getPlayer(state, playerIndex).pieces.filter((piece) => {
    if (piece.id === movingPieceId) {
      return false;
    }

    return getTrackIndexForProgress(getPlayer(state, playerIndex).startIndex, piece.progress) === trackIndex;
  }).length;
}

function getBarrierOwnersAtTrackIndex(state, trackIndex) {
  const counts = new Map();

  getTrackOccupants(state, trackIndex).forEach(({ playerIndex }) => {
    counts.set(playerIndex, (counts.get(playerIndex) || 0) + 1);
  });

  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([playerIndex]) => playerIndex),
  );
}

function canMovePiece(state, playerIndex, piece, steps) {
  if (!Number.isInteger(steps) || steps <= 0) {
    return { ok: false, reason: "invalid_steps" };
  }

  if (piece.progress === MAX_PROGRESS) {
    return { ok: false, reason: "already_finished" };
  }

  const player = getPlayer(state, playerIndex);

  if (piece.progress === -1) {
    if (steps !== 5) {
      return { ok: false, reason: "need_five_to_exit" };
    }

    const startIndex = player.startIndex;
    const barrierOwners = getBarrierOwnersAtTrackIndex(state, startIndex);

    if (barrierOwners.size > 0 && !barrierOwners.has(playerIndex)) {
      return { ok: false, reason: "start_blocked_by_barrier" };
    }

    const ownCount = getOwnTrackCount(state, playerIndex, startIndex);
    if (ownCount >= 2) {
      return { ok: false, reason: "start_has_own_barrier" };
    }

    return {
      ok: true,
      destinationProgress: 0,
      destinationTrackIndex: startIndex,
      fromNest: true,
    };
  }

  const destinationProgress = piece.progress + steps;

  if (destinationProgress > MAX_PROGRESS) {
    return { ok: false, reason: "needs_exact_roll" };
  }

  for (let offset = 1; offset <= steps; offset += 1) {
    const traversedProgress = piece.progress + offset;

    if (traversedProgress >= TRACK_LENGTH) {
      break;
    }

    const traversedTrackIndex = getTrackIndexForProgress(player.startIndex, traversedProgress);
    const barrierOwners = getBarrierOwnersAtTrackIndex(state, traversedTrackIndex);

    if (barrierOwners.size > 0) {
      return { ok: false, reason: "blocked_by_barrier" };
    }
  }

  if (destinationProgress < TRACK_LENGTH) {
    const destinationTrackIndex = getTrackIndexForProgress(player.startIndex, destinationProgress);
    const ownCount = getOwnTrackCount(state, playerIndex, destinationTrackIndex, piece.id);

    if (ownCount >= 2) {
      return { ok: false, reason: "cannot_stack_more_than_two" };
    }

    return {
      ok: true,
      destinationProgress,
      destinationTrackIndex,
      fromNest: false,
    };
  }

  return {
    ok: true,
    destinationProgress,
    destinationTrackIndex: null,
    fromNest: false,
  };
}

function executeMoveOnState(state, playerIndex, pieceId, steps) {
  const piece = getPiece(state, playerIndex, pieceId);
  if (!piece) {
    return null;
  }

  const movement = canMovePiece(state, playerIndex, piece, steps);
  if (!movement.ok) {
    return null;
  }

  const previousProgress = piece.progress;
  piece.progress = movement.destinationProgress;

  let captured = 0;
  if (movement.destinationTrackIndex !== null && !isSafeTrackIndex(movement.destinationTrackIndex)) {
    state.players.forEach((opponent, opponentIndex) => {
      if (opponentIndex === playerIndex) {
        return;
      }

      opponent.pieces.forEach((opponentPiece) => {
        const opponentTrackIndex = getTrackIndexForProgress(opponent.startIndex, opponentPiece.progress);
        if (opponentTrackIndex === movement.destinationTrackIndex) {
          opponentPiece.progress = -1;
          captured += 1;
        }
      });
    });
  }

  return {
    pieceId,
    pieceSlot: piece.slot,
    fromProgress: previousProgress,
    toProgress: movement.destinationProgress,
    captured,
    reachedHome: movement.destinationProgress === MAX_PROGRESS,
  };
}

function simulateMove(state, playerIndex, pieceId, steps) {
  const simulatedState = deepClone(state);
  const result = executeMoveOnState(simulatedState, playerIndex, pieceId, steps);

  if (!result) {
    return null;
  }

  return { simulatedState, result };
}

function optionSignature(option) {
  const moveSignature = option.moves.map((move) => `${move.pieceId}:${move.steps}`).join("|");
  return `${option.kind}:${moveSignature}`;
}

function buildSplitOptions(state, playerIndex, firstSteps, secondSteps) {
  const options = [];
  const firstMoves = getPlayer(state, playerIndex).pieces
    .map((piece) => simulateMove(state, playerIndex, piece.id, firstSteps))
    .filter(Boolean);

  firstMoves.forEach((firstMove) => {
    getPlayer(firstMove.simulatedState, playerIndex).pieces.forEach((piece) => {
      const secondMove = simulateMove(firstMove.simulatedState, playerIndex, piece.id, secondSteps);
      if (!secondMove) {
        return;
      }

      const firstPiece = getPiece(state, playerIndex, firstMove.result.pieceId);
      const secondPiece = getPiece(state, playerIndex, secondMove.result.pieceId);

      options.push({
        kind: "split",
        moves: [
          { pieceId: firstMove.result.pieceId, steps: firstSteps },
          { pieceId: secondMove.result.pieceId, steps: secondSteps },
        ],
        label:
          `${pieceLabel(firstPiece)} by ${firstSteps}, then ` +
          `${pieceLabel(secondPiece)} by ${secondSteps}`,
      });
    });
  });

  return options;
}

function buildTurnOptions(state, playerIndex, dice) {
  const [dieA, dieB] = dice;
  const options = [];
  const seen = new Set();

  const combinedSteps = dieA + dieB;
  getPlayer(state, playerIndex).pieces.forEach((piece) => {
    const simulation = simulateMove(state, playerIndex, piece.id, combinedSteps);
    if (!simulation) {
      return;
    }

    options.push({
      kind: "combined",
      moves: [{ pieceId: piece.id, steps: combinedSteps }],
      label: `${pieceLabel(piece)} by ${combinedSteps} (dice total)`,
    });
  });

  const splitOrders = dieA === dieB ? [[dieA, dieB]] : [[dieA, dieB], [dieB, dieA]];
  splitOrders.forEach(([first, second]) => {
    buildSplitOptions(state, playerIndex, first, second).forEach((option) => {
      options.push(option);
    });
  });

  if (options.length === 0) {
    const singleDice = dieA === dieB ? [dieA] : [dieA, dieB];
    singleDice.forEach((steps) => {
      getPlayer(state, playerIndex).pieces.forEach((piece) => {
        const simulation = simulateMove(state, playerIndex, piece.id, steps);
        if (!simulation) {
          return;
        }

        options.push({
          kind: "single",
          moves: [{ pieceId: piece.id, steps }],
          label: `${pieceLabel(piece)} by ${steps} (fallback single die)`,
        });
      });
    });
  }

  const deduped = [];
  options.forEach((option) => {
    const signature = optionSignature(option);
    if (seen.has(signature)) {
      return;
    }

    seen.add(signature);
    deduped.push({
      ...option,
      id: `opt-${deduped.length + 1}`,
    });
  });

  return deduped;
}

function applyMoveEvents(state, playerIndex, moveResult) {
  const player = getPlayer(state, playerIndex);
  const movedPiece = getPiece(state, playerIndex, moveResult.pieceId);
  pushLog(
    state,
    `${playerLabel(state, playerIndex)} moved ${pieceLabel(movedPiece)} by ${
      moveResult.toProgress - moveResult.fromProgress
    }`,
  );

  if (moveResult.captured > 0) {
    pushLog(
      state,
      `${playerLabel(state, playerIndex)} captured ${moveResult.captured} pawn(s) and earned ${
        moveResult.captured * 20
      } bonus steps`,
    );

    for (let i = 0; i < moveResult.captured; i += 1) {
      state.pendingBonuses.push(20);
    }
  }

  if (moveResult.reachedHome) {
    pushLog(state, `${playerLabel(state, playerIndex)} got a pawn home and earned a 10-step bonus`);
    state.pendingBonuses.push(10);
  }
}

function hasPlayerWon(state, playerIndex) {
  return getPlayer(state, playerIndex).pieces.every((piece) => piece.progress === MAX_PROGRESS);
}

function setWinner(state, playerIndex) {
  state.phase = "game_over";
  state.winnerIndex = playerIndex;
  state.turnOptions = [];
  state.dice = null;
  state.pendingBonuses = [];
  state.lastRollWasDouble = false;
  pushLog(state, `${playerLabel(state, playerIndex)} wins the game`);
}

function finishTurn(state) {
  state.turnOptions = [];
  state.dice = null;

  if (state.lastRollWasDouble) {
    state.doubleChainCount += 1;
    state.phase = "await_roll";
    pushLog(state, `${playerLabel(state, state.currentPlayerIndex)} rolled doubles and goes again`);
    state.lastRollWasDouble = false;
    return;
  }

  state.currentPlayerIndex = nextPlayerIndex(state);
  state.doubleChainCount = 0;
  state.phase = "await_roll";
  state.lastRollWasDouble = false;
  pushLog(state, `Turn passes to ${playerLabel(state, state.currentPlayerIndex)}`);
}

function getMostAdvancedTrackPiece(state, playerIndex) {
  const pieces = getPlayer(state, playerIndex).pieces.filter(
    (piece) => piece.progress >= 0 && piece.progress < TRACK_LENGTH,
  );

  if (pieces.length === 0) {
    return null;
  }

  return pieces.sort((left, right) => {
    if (right.progress !== left.progress) {
      return right.progress - left.progress;
    }

    return right.slot - left.slot;
  })[0];
}

function resolvePendingBonuses(state) {
  while (state.pendingBonuses.length > 0) {
    const bonusAmount = state.pendingBonuses[0];
    const legalChoices = getLegalBonusChoices(state, bonusAmount);

    if (legalChoices.length === 0) {
      pushLog(
        state,
        `${playerLabel(state, state.currentPlayerIndex)} cannot use bonus ${bonusAmount}; skipping it`,
      );
      state.pendingBonuses.shift();
      continue;
    }

    state.phase = "await_bonus";
    return;
  }

  finishTurn(state);
}

function getLegalBonusChoices(state, bonusAmount) {
  const playerIndex = state.currentPlayerIndex;
  const player = getPlayer(state, playerIndex);

  return player.pieces
    .map((piece) => {
      const simulation = simulateMove(state, playerIndex, piece.id, bonusAmount);
      if (!simulation) {
        return null;
      }

      return {
        pieceId: piece.id,
        pieceSlot: piece.slot,
        label: `${pieceLabel(piece)} by ${bonusAmount}`,
      };
    })
    .filter(Boolean);
}

function rollDie(rng) {
  const raw = Number(rng());
  if (!Number.isFinite(raw)) {
    return 1;
  }

  const normalized = Math.max(0, Math.min(0.999999, raw));
  return Math.floor(normalized * 6) + 1;
}

function validateSetup({ playerCount, piecesPerPlayer }) {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 4) {
    throw new Error("playerCount must be an integer between 2 and 4");
  }

  if (!Number.isInteger(piecesPerPlayer) || piecesPerPlayer < 1 || piecesPerPlayer > 4) {
    throw new Error("piecesPerPlayer must be an integer between 1 and 4");
  }
}

export function createGame({ playerCount = 4, piecesPerPlayer = 4 } = {}) {
  validateSetup({ playerCount, piecesPerPlayer });

  const players = Array.from({ length: playerCount }).map((_, playerIndex) => ({
    id: playerIndex,
    color: PLAYER_COLORS[playerIndex],
    startIndex: START_INDEXES[playerIndex],
    pieces: Array.from({ length: piecesPerPlayer }).map((__, pieceSlot) => ({
      id: `p${playerIndex}-${pieceSlot}`,
      slot: pieceSlot,
      progress: -1,
    })),
  }));

  return {
    playerCount,
    piecesPerPlayer,
    players,
    currentPlayerIndex: 0,
    phase: "await_roll",
    dice: null,
    turnOptions: [],
    pendingBonuses: [],
    doubleChainCount: 0,
    lastRollWasDouble: false,
    winnerIndex: null,
    log: [
      `Game ready for ${playerCount} players with ${piecesPerPlayer} piece(s) each`,
      "Players need a 5 to leave nest",
    ],
  };
}

export function rollDice(state, rng = Math.random) {
  if (state.phase !== "await_roll") {
    throw new Error("Dice can only be rolled during await_roll phase");
  }

  const nextState = deepClone(state);
  const dieA = rollDie(rng);
  const dieB = rollDie(rng);

  nextState.dice = [dieA, dieB];
  nextState.lastRollWasDouble = dieA === dieB;

  pushLog(nextState, `${playerLabel(nextState, nextState.currentPlayerIndex)} rolled ${dieA} and ${dieB}`);

  if (nextState.lastRollWasDouble && nextState.doubleChainCount === 2) {
    pushLog(nextState, `${playerLabel(nextState, nextState.currentPlayerIndex)} rolled three doubles in a row`);

    const punishedPiece = getMostAdvancedTrackPiece(nextState, nextState.currentPlayerIndex);
    if (punishedPiece) {
      punishedPiece.progress = -1;
      pushLog(
        nextState,
        `${playerLabel(nextState, nextState.currentPlayerIndex)} sent ${pieceLabel(punishedPiece)} back to nest`,
      );
    } else {
      pushLog(nextState, "No eligible piece on track for triple-doubles penalty");
    }

    nextState.phase = "await_roll";
    nextState.dice = null;
    nextState.turnOptions = [];
    nextState.pendingBonuses = [];
    nextState.currentPlayerIndex = nextPlayerIndex(nextState);
    nextState.doubleChainCount = 0;
    nextState.lastRollWasDouble = false;
    pushLog(nextState, `Turn passes to ${playerLabel(nextState, nextState.currentPlayerIndex)}`);
    return nextState;
  }

  nextState.turnOptions = buildTurnOptions(nextState, nextState.currentPlayerIndex, nextState.dice);

  if (nextState.turnOptions.length === 0) {
    pushLog(nextState, `${playerLabel(nextState, nextState.currentPlayerIndex)} has no legal move`);
    finishTurn(nextState);
    return nextState;
  }

  nextState.phase = "await_action";
  return nextState;
}

export function applyTurnOption(state, optionId) {
  if (state.phase !== "await_action") {
    throw new Error("Turn option can only be applied during await_action phase");
  }

  const selectedOption = state.turnOptions.find((option) => option.id === optionId);
  if (!selectedOption) {
    throw new Error(`Turn option ${optionId} was not found`);
  }

  const nextState = deepClone(state);
  nextState.turnOptions = [];

  selectedOption.moves.forEach((move) => {
    const result = executeMoveOnState(nextState, nextState.currentPlayerIndex, move.pieceId, move.steps);

    if (!result) {
      throw new Error(`Move failed for piece ${move.pieceId} by ${move.steps}`);
    }

    applyMoveEvents(nextState, nextState.currentPlayerIndex, result);

    if (hasPlayerWon(nextState, nextState.currentPlayerIndex)) {
      setWinner(nextState, nextState.currentPlayerIndex);
    }
  });

  if (nextState.phase === "game_over") {
    return nextState;
  }

  resolvePendingBonuses(nextState);
  return nextState;
}

export function getBonusChoices(state) {
  if (state.phase !== "await_bonus") {
    return [];
  }

  const bonusAmount = state.pendingBonuses[0];
  return getLegalBonusChoices(state, bonusAmount);
}

export function applyBonusMove(state, pieceId) {
  if (state.phase !== "await_bonus") {
    throw new Error("Bonus move can only be applied during await_bonus phase");
  }

  const bonusAmount = state.pendingBonuses[0];
  const choices = getLegalBonusChoices(state, bonusAmount);

  if (!choices.some((choice) => choice.pieceId === pieceId)) {
    throw new Error(`Piece ${pieceId} is not a legal target for bonus ${bonusAmount}`);
  }

  const nextState = deepClone(state);
  nextState.pendingBonuses.shift();

  const result = executeMoveOnState(nextState, nextState.currentPlayerIndex, pieceId, bonusAmount);
  if (!result) {
    throw new Error(`Could not apply bonus ${bonusAmount} to piece ${pieceId}`);
  }

  applyMoveEvents(nextState, nextState.currentPlayerIndex, result);

  if (hasPlayerWon(nextState, nextState.currentPlayerIndex)) {
    setWinner(nextState, nextState.currentPlayerIndex);
    return nextState;
  }

  resolvePendingBonuses(nextState);
  return nextState;
}

export function skipBonus(state) {
  if (state.phase !== "await_bonus") {
    throw new Error("Bonus can only be skipped during await_bonus phase");
  }

  const nextState = deepClone(state);
  const skippedBonus = nextState.pendingBonuses.shift();
  pushLog(
    nextState,
    `${playerLabel(nextState, nextState.currentPlayerIndex)} skipped bonus ${skippedBonus}`,
  );

  resolvePendingBonuses(nextState);
  return nextState;
}

export function getPieceCoordinatesData(state) {
  return state.players.flatMap((player, playerIndex) =>
    player.pieces.map((piece) => {
      if (piece.progress === -1) {
        return {
          playerIndex,
          pieceId: piece.id,
          slot: piece.slot,
          zone: "nest",
          trackIndex: null,
          laneIndex: null,
        };
      }

      if (isOnTrack(piece)) {
        return {
          playerIndex,
          pieceId: piece.id,
          slot: piece.slot,
          zone: "track",
          trackIndex: getTrackIndexForProgress(player.startIndex, piece.progress),
          laneIndex: null,
        };
      }

      if (isInHomeLane(piece)) {
        return {
          playerIndex,
          pieceId: piece.id,
          slot: piece.slot,
          zone: "home_lane",
          trackIndex: null,
          laneIndex: piece.progress - TRACK_LENGTH,
        };
      }

      return {
        playerIndex,
        pieceId: piece.id,
        slot: piece.slot,
        zone: "home",
        trackIndex: null,
        laneIndex: HOME_LENGTH,
      };
    }),
  );
}
