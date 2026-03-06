# Online Multiplayer Scaffold (Render + WebSockets)

This project now includes a realtime backend at `server/index.js` using `ws`.

## Local development

Run frontend and backend in separate terminals:

```bash
npm run dev
```

```bash
npm run dev:server
```

- Frontend: `http://localhost:5173`
- Realtime backend:
  - HTTP health: `http://localhost:3001/healthz`
  - Room snapshot: `http://localhost:3001/api/rooms`
  - WebSocket: `ws://localhost:3001/ws`

Once both are running, use the **Online Lobby** panel in the app to:

- connect to the websocket service
- create a room (optional custom room ID)
- join a room from the room list or room ID input
- leave the current room

## Deploying on Render

This repo includes `render.yaml` for blueprint deploy.

1. Push this branch.
2. In Render, create a new Blueprint service from the repo.
3. Render will run:
   - Build: `npm ci && npm run build`
   - Start: `npm run start`
4. Backend will be available on your Render URL:
   - `GET /healthz`
   - `GET /api/rooms`
   - `WS /ws`

## WebSocket message protocol (initial scaffold)

Client messages:

```json
{ "type": "list_rooms" }
```

```json
{ "type": "create_room", "payload": { "playerName": "Alice" } }
```

```json
{ "type": "join_room", "payload": { "roomId": "ABC123", "playerName": "Bob" } }
```

```json
{ "type": "leave_room" }
```

```json
{ "type": "player_action", "payload": { "action": { "kind": "roll_dice" } } }
```

Server events:

- `welcome`
- `lobby_state`
- `room_created`
- `join_success`
- `room_state`
- `leave_success`
- `player_action`
- `error`

## Current scope

This now includes server-authoritative turn enforcement:

- In-memory rooms (up to 4 players)
- Host selection
- Seat assignment (`P1..P4`) by join order
- Join/leave/disconnect cleanup
- Online match start by host (`start_game`)
- Server-side game state transitions (`roll_dice`, move selection, bonus application)
- Turn validation: server rejects out-of-turn actions

Current limitations:

- In-memory room/game state (no persistence)
- If a player leaves mid-game, the room game is reset
