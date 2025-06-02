/** @format */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const url = require('url');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;

const GAME_STATE_FILE = path.join(__dirname, 'game.json');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const loadGames = () => {
  if (
    !fs.existsSync(GAME_STATE_FILE) ||
    fs.readFileSync(GAME_STATE_FILE, 'utf8') === ''
  ) {
    fs.writeFileSync(GAME_STATE_FILE, '{}');
    return {};
  }
  return JSON.parse(fs.readFileSync(GAME_STATE_FILE, 'utf8'));
};

const saveGames = (games) => {
  fs.writeFileSync(GAME_STATE_FILE, JSON.stringify(games, null, 2));
};

let games = loadGames();

const connections = {};

const createNewGameState = () => ({
  boards: [
    Array(10)
      .fill(null)
      .map(() => Array(10).fill(0)),
    Array(10)
      .fill(null)
      .map(() => Array(10).fill(0)),
  ],
  players: [null, null],
  shipsPlaced: [false, false],
  turn: 0,
  status: 'waiting',
  winner: null,
});

app.post('/api/create-room', (req, res) => {
  // Gera um ID de sala único e curto
  const roomId = `sala_${Date.now().toString(36).slice(-4)}`;
  games[roomId] = createNewGameState();
  connections[roomId] = [null, null];
  saveGames(games);
  res.json({ success: true, roomId: roomId });
});

app.get('/api/validate-room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = games[roomId];

  if (!room) {
    return res
      .status(404)
      .json({ success: false, message: 'A sala não existe.' });
  }
  if (room.players.every((p) => p !== null)) {
    return res
      .status(403)
      .json({ success: false, message: 'A sala está cheia.' });
  }
  res.json({ success: true, message: 'Sala disponível!' });
});

wss.on('connection', (ws, req) => {
  const { query } = url.parse(req.url, true);
  const { roomId } = query;

  if (!roomId || !games[roomId]) {
    ws.send(JSON.stringify({ type: 'error', message: 'Sala inválida.' }));
    ws.close();
    return;
  }

  const room = games[roomId];
  const roomConnections = connections[roomId];

  const playerIndex = room.players.indexOf(null);
  if (playerIndex === -1) {
    ws.send(JSON.stringify({ type: 'error', message: 'A sala está cheia.' }));
    ws.close();
    return;
  }

  const playerId = `player_${Date.now().toString(36)}`;
  ws.roomId = roomId;
  ws.playerIndex = playerIndex;

  room.players[playerIndex] = playerId;

  roomConnections[playerIndex] = ws;

  console.log(
    `Jogador ${playerIndex} (${playerId}) conectado à sala ${roomId}`
  );
  ws.send(JSON.stringify({ type: 'assign_player', playerIndex }));

  if (room.players.every((p) => p !== null)) {
    room.status = 'setup';
  }
  broadcastToRoom(roomId);

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    const currentRoom = games[ws.roomId];
    if (!currentRoom) return;

    const playerIdx = ws.playerIndex;

    if (data.type === 'place_ships' && currentRoom.status === 'setup') {
      currentRoom.boards[playerIdx] = data.board;
      currentRoom.shipsPlaced[playerIdx] = true;

      if (currentRoom.shipsPlaced.every((placed) => placed)) {
        currentRoom.status = 'playing';
      }
      broadcastToRoom(ws.roomId);
    }

    if (data.type === 'fire') {
      if (currentRoom.status !== 'playing' || currentRoom.turn !== playerIdx)
        return;

      const { x, y } = data.coords;
      const opponentIndex = 1 - playerIdx;
      const targetBoard = currentRoom.boards[opponentIndex];
      const cell = targetBoard[y][x];

      if (cell === 1) {
        targetBoard[y][x] = 'X';

        if (!targetBoard.flat().includes(1)) {
          currentRoom.status = 'gameover';
          currentRoom.winner = playerIdx;
        }
      } else if (cell === 0) {
        targetBoard[y][x] = 'M';
      }

      if (currentRoom.status === 'playing') {
        currentRoom.turn = opponentIndex;
      }
      broadcastToRoom(ws.roomId);
    }
  });

  ws.on('close', () => {
    const currentRoom = games[ws.roomId];
    if (!currentRoom) return;

    console.log(`Jogador ${ws.playerIndex} desconectado da sala ${ws.roomId}.`);

    if (currentRoom.status !== 'waiting' && currentRoom.status !== 'gameover') {
      currentRoom.status = 'gameover';
      currentRoom.winner = 1 - ws.playerIndex;
    }

    currentRoom.players[ws.playerIndex] = null;
    connections[ws.roomId][ws.playerIndex] = null;

    if (connections[ws.roomId].every((c) => c === null)) {
      console.log(`Sala ${ws.roomId} está vazia. Removendo.`);
      delete games[ws.roomId];
      delete connections[ws.roomId];
    }

    broadcastToRoom(ws.roomId);
    saveGames(games);
  });
});

function broadcastToRoom(roomId) {
  const room = games[roomId];
  if (!room) return;

  const roomConnections = connections[roomId];

  roomConnections.forEach((ws, playerIndex) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const stateToSend = {
        ...room,

        boards: JSON.parse(JSON.stringify(room.boards)),
      };

      const opponentIndex = 1 - playerIndex;
      stateToSend.boards[opponentIndex] = stateToSend.boards[opponentIndex].map(
        (row) => row.map((cell) => (cell === 1 ? 0 : cell))
      );

      ws.send(JSON.stringify({ type: 'update', state: stateToSend }));
    }
  });
  saveGames(games);
}

server.listen(PORT, () => {
  console.log(`Servidor Batalha Naval rodando em http://localhost:${PORT}`);
});
