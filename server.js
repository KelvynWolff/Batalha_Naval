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
const ROOMS_STATE_FILE = path.join(__dirname, 'rooms.json');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const loadAllRooms = () => {
    if (!fs.existsSync(ROOMS_STATE_FILE) || fs.readFileSync(ROOMS_STATE_FILE, 'utf8') === '') {
        return {};
    }
    return JSON.parse(fs.readFileSync(ROOMS_STATE_FILE));
};

const saveAllRooms = (rooms) => {
    fs.writeFileSync(ROOMS_STATE_FILE, JSON.stringify(rooms, null, 2));
};

let activeRooms = loadAllRooms();

const createEmptyBoard = () => Array(10).fill(null).map(() => Array(10).fill(0));

const createNewRoomState = (roomId) => ({
    roomId: roomId,
    players: [null, null],
    boards: [createEmptyBoard(), createEmptyBoard()],
    shipsPlaced: [false, false],
    turn: 0,
    status: 'waiting',
    winner: null
});

app.post('/api/create-room', (req, res) => {
    const roomId = `sala_${Date.now().toString(36)}`;
    activeRooms[roomId] = createNewRoomState(roomId);
    saveAllRooms(activeRooms);
    res.json({ success: true, roomId: roomId });
});

app.get('/api/validate-room/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = activeRooms[roomId];
    if (!room) {
        return res.json({ success: false, message: 'A sala não existe.' });
    }
    if (room.players.every(p => p !== null)) {
        return res.json({ success: false, message: 'A sala está cheia.' });
    }
    res.json({ success: true, message: 'Sala disponível!' });
});

wss.on('connection', (ws, req) => {
    const { query } = url.parse(req.url, true);
    const { roomId } = query;

    if (!roomId || !activeRooms[roomId]) {
        ws.send(JSON.stringify({ type: 'error', message: 'Sala inválida.' }));
        ws.close();
        return;
    }

    const room = activeRooms[roomId];
    ws.roomId = roomId;

    let playerIndex = room.players.indexOf(null);
    if (playerIndex === -1) {
        ws.send(JSON.stringify({ type: 'error', message: 'A sala está cheia.' }));
        ws.close();
        return;
    }

    room.players[playerIndex] = ws;
    console.log(`Jogador ${playerIndex} conectado à sala ${roomId}`);
    ws.send(JSON.stringify({ type: 'assign_player', playerIndex }));

    if (room.players.every(p => p !== null)) {
        room.status = 'setup';
    }
    broadcastToRoom(roomId);

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        const currentRoom = activeRooms[ws.roomId];
        if (!currentRoom) return;

        const playerIdx = currentRoom.players.indexOf(ws);

        if (data.type === 'place_ships') {
            currentRoom.boards[playerIdx] = data.board;
            currentRoom.shipsPlaced[playerIdx] = true;

            if (currentRoom.shipsPlaced.every(placed => placed)) {
                currentRoom.status = 'playing';
            }
            broadcastToRoom(ws.roomId);
        }

        if (data.type === 'fire') {
            if (currentRoom.status !== 'playing' || currentRoom.turn !== playerIdx) return;

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
            currentRoom.turn = opponentIndex;
            broadcastToRoom(ws.roomId);
        }
    });

    ws.on('close', () => {
        const currentRoom = activeRooms[ws.roomId];
        if (!currentRoom) return;

        const playerIdx = currentRoom.players.findIndex(p => p === ws);
        if (playerIdx !== -1) {
            console.log(`Jogador ${playerIdx} desconectado da sala ${ws.roomId}. Resetando sala.`);
            activeRooms[ws.roomId] = createNewRoomState(ws.roomId);
            broadcastToRoom(ws.roomId);
        }
    });
});

function broadcastToRoom(roomId) {
    const room = activeRooms[roomId];
    if (!room) return;

    const stateToSend = { ...room, players: [!!room.players[0], !!room.players[1]] };

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
            const playerIndex = room.players.indexOf(client);
            const personalState = {
                ...stateToSend,
                myBoard: playerIndex !== -1 ? room.boards[playerIndex] : createEmptyBoard()
            };
            client.send(JSON.stringify({ type: 'update', state: personalState }));
        }
    });
    saveAllRooms(activeRooms);
}

server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});