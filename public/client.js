const lobbyDiv = document.getElementById('lobby');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomForm = document.getElementById('join-room-form');
const roomIdInput = document.getElementById('room-id-input');

const gameContainerDiv = document.getElementById('game-container');
const myBoardDiv = document.getElementById('my-board');
const opponentBoardDiv = document.getElementById('opponent-board');
const infoDiv = document.getElementById('info');
const roomInfoDiv = document.getElementById('room-info');
const setupButton = document.getElementById('setup-button');

let ws;
let playerIndex = -1;
let myTurn = false;
let localBoard = Array(10).fill(null).map(() => Array(10).fill(0));
let inSetupPhase = false;

createRoomBtn.addEventListener('click', async () => {
    try {
        const response = await fetch('/api/create-room', { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            connectToRoom(data.roomId);
        }
    } catch (error) {
        console.error('Erro ao criar sala:', error);
        alert('Não foi possível criar a sala. Tente novamente.');
    }
});

joinRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const roomId = roomIdInput.value.trim();
    if (!roomId) return;

    try {
        const response = await fetch(`/api/validate-room/${roomId}`);
        const data = await response.json();
        if (data.success) {
            connectToRoom(roomId);
        } else {
            alert(`Erro: ${data.message}`);
        }
    } catch (error) {
        console.error('Erro ao entrar na sala:', error);
        alert('Não foi possível conectar à sala. Verifique o código e tente novamente.');
    }
});

function connectToRoom(roomId) {
    lobbyDiv.classList.add('hidden');
    gameContainerDiv.classList.remove('hidden');
    roomInfoDiv.innerHTML = `Código da Sala: <span title="Clique para copiar">${roomId}</span>`;
    roomInfoDiv.querySelector('span').addEventListener('click', () => {
        navigator.clipboard.writeText(roomId);
        alert('Código da sala copiado!');
    });

    ws = new WebSocket(`ws://${window.location.host}?roomId=${roomId}`);

    ws.onopen = () => {
        infoDiv.textContent = 'Conectado à sala! Aguardando outro jogador...';
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        switch (data.type) {
            case 'assign_player':
                playerIndex = data.playerIndex;
                break;
            case 'error':
                alert(`Erro do servidor: ${data.message}`);
                gameContainerDiv.classList.add('hidden');
                lobbyDiv.classList.remove('hidden');
                break;
            case 'update':
                handleGameUpdate(data.state);
                break;
        }
    };

    ws.onclose = () => {
        infoDiv.textContent = 'Desconectado da sala.';
    };
}


function handleGameUpdate(state) {
    myTurn = (state.turn === playerIndex);
    const isGameOver = state.status === 'gameover';

    renderBoard(myBoardDiv, state.myBoard, false, isGameOver);

    const opponentBoard = state.boards[1 - playerIndex] || [];
    renderBoard(opponentBoardDiv, opponentBoard, true, isGameOver);

    updateStatus(state);
}

const renderBoard = (div, boardData, isOpponentBoard = false, isGameOver = false) => {
    div.innerHTML = '';
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.x = x;
            cell.dataset.y = y;
            const cellValue = boardData[y][x];
            cell.classList.remove('ship', 'hit', 'miss', 'ship-hit');
            if (cellValue === 'X') {
                if (isOpponentBoard) cell.classList.add('hit');
                else cell.classList.add('ship-hit');
            } else if (cellValue === 'M') {
                cell.classList.add('miss');
            } else if (cellValue === 1) {
                if (!isOpponentBoard || isGameOver) cell.classList.add('ship');
            }
            if (isOpponentBoard && !isGameOver) {
                cell.addEventListener('click', () => fire(x, y));
            }
            div.appendChild(cell);
        }
    }
};

const setupMyBoard = () => {
    if (inSetupPhase) return;
    inSetupPhase = true;
    localBoard = Array(10).fill(null).map(() => Array(10).fill(0));
    renderBoard(myBoardDiv, localBoard);
    let shipCount = 0;
    infoDiv.textContent = 'Posicione seus 5 navios (1x1).';
    myBoardDiv.style.cursor = 'pointer';

    const placeShipHandler = (e) => {
        if (!e.target.classList.contains('cell')) return;
        const x = parseInt(e.target.dataset.x);
        const y = parseInt(e.target.dataset.y);
        if (localBoard[y][x] === 0) {
            if (shipCount < 5) {
                localBoard[y][x] = 1;
                e.target.classList.add('ship');
                shipCount++;
            }
        } else {
            localBoard[y][x] = 0;
            e.target.classList.remove('ship');
            shipCount--;
        }
        setupButton.style.display = (shipCount === 5) ? 'block' : 'none';
    };

    myBoardDiv.addEventListener('click', placeShipHandler);
    setupButton.onclick = () => {
        inSetupPhase = false;
        myBoardDiv.removeEventListener('click', placeShipHandler);
        myBoardDiv.style.cursor = 'default';
        setupButton.style.display = 'none';
        ws.send(JSON.stringify({ type: 'place_ships', board: localBoard }));
        infoDiv.textContent = 'Aguardando o oponente posicionar os navios...';
    };
};

const updateStatus = (state) => {
    switch(state.status) {
        case 'waiting':
            infoDiv.textContent = 'Aguardando oponente...';
            break;
        case 'setup':
            if (!state.shipsPlaced[playerIndex]) setupMyBoard();
            break;
        case 'playing':
            opponentBoardDiv.style.pointerEvents = 'auto';
            infoDiv.textContent = myTurn ? 'Sua vez de atirar!' : 'Aguarde a vez do oponente.';
            break;
        case 'gameover':
            opponentBoardDiv.style.pointerEvents = 'none';
            if (state.winner === playerIndex) infoDiv.textContent = 'Fim de Jogo: Você Venceu! 🎉';
            else infoDiv.textContent = 'Fim de Jogo: Você Perdeu. 😢';
            break;
    }
};

const fire = (x, y) => {
    const targetCell = opponentBoardDiv.querySelector(`[data-x='${x}'][data-y='${y}']`);
    if (targetCell.classList.contains('hit') || targetCell.classList.contains('miss')) return;
    if (myTurn) ws.send(JSON.stringify({ type: 'fire', coords: { x, y } }));
};