export const PLAYER_COLORS = ["red", "yellow", "blue", "green"];

export const TRACK_LENGTH = 68;
export const HOME_LENGTH = 7;
export const MAX_PROGRESS = TRACK_LENGTH + HOME_LENGTH;

export const START_INDEXES = [0, 17, 34, 51];

const SAFE_INDEX_LIST = [0, 8, 13, 17, 25, 30, 34, 42, 47, 51, 59, 64];

export const SAFE_TRACK_INDEXES = new Set(SAFE_INDEX_LIST);

export function isSafeTrackIndex(trackIndex) {
  return SAFE_TRACK_INDEXES.has(trackIndex);
}
