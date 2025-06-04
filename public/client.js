/** @format */

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
const shipDockDiv = document.getElementById('ship-dock');
const shipListDiv = document.querySelector('.ship-list');

const FLEET = [
  { name: 'Porta-aviões', size: 5 },
  { name: 'Encouraçado', size: 4 },
  { name: 'Cruzador', size: 3 },
  { name: 'Submarino', size: 3 },
  { name: 'Destróier', size: 2 },
];

let ws;
let playerIndex = -1;
let myTurn = false;

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
    alert(
      'Não foi possível conectar à sala. Verifique o código e tente novamente.'
    );
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

  ws = new WebSocket(`wss://${window.location.host}?roomId=${roomId}`);
  ws.onopen = () => {
    infoDiv.textContent = 'Conectado à sala! Aguardando outro jogador...';
  };
  ws.onclose = () => {
    infoDiv.textContent = 'Desconectado da sala.';
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
}

function initializeBoards() {
  const createStructure = (boardId) => {
    const boardElement = document.getElementById(boardId);
    const container = boardElement.closest('.board-container');
    const labelsCols = container.querySelector('.board-labels-cols');
    const labelsRows = container.querySelector('.board-labels-rows');
    const letters = 'ABCDEFGHIJ';
    labelsCols.innerHTML = '';
    labelsRows.innerHTML = '';
    boardElement.innerHTML = '';

    for (let i = 0; i < 10; i++) {
      const colLabel = document.createElement('div');
      colLabel.className = 'label-cell';
      colLabel.textContent = letters[i];
      labelsCols.appendChild(colLabel);

      const rowLabel = document.createElement('div');
      rowLabel.className = 'label-cell';
      rowLabel.textContent = i + 1;
      labelsRows.appendChild(rowLabel);
    }

    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.dataset.x = x;
        cell.dataset.y = y;
        boardElement.appendChild(cell);
      }
    }
  };
  createStructure('my-board');
  createStructure('opponent-board');
}

const renderBoard = (
  div,
  boardData,
  isOpponentBoard = false,
  isGameOver = false
) => {
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const cell = div.querySelector(`.cell[data-x='${x}'][data-y='${y}']`);
      if (!cell) continue;

      const cellValue = boardData[y]?.[x] ?? 0;

      cell.classList.remove(
        'ship',
        'hit',
        'miss',
        'ship-hit',
        'preview-valid',
        'preview-invalid'
      );
      cell.style.backgroundImage = '';

      if (cellValue === 'X') {
        if (isOpponentBoard) {
          cell.classList.add('hit');
        } else {
          cell.classList.add('ship-hit');
        }
      } else if (cellValue === 'M') {
        cell.classList.add('miss');
      } else if (cellValue === 1) {
        if (!isOpponentBoard || isGameOver) {
          cell.classList.add('ship');
        }
      }
    }
  }
};

function handleGameUpdate(state) {
  myTurn = state.turn === playerIndex;
  const isGameOver = state.status === 'gameover';
  const myBoardData =
    state.boards[playerIndex] ||
    Array(10)
      .fill(null)
      .map(() => Array(10).fill(0));
  const opponentBoardData =
    state.boards[1 - playerIndex] ||
    Array(10)
      .fill(null)
      .map(() => Array(10).fill(0));

  renderBoard(myBoardDiv, myBoardData, false, isGameOver);
  renderBoard(opponentBoardDiv, opponentBoardData, true, isGameOver);

  updateStatus(state);
}

const setupMyBoard = () => {
  let localBoard = Array(10)
    .fill(null)
    .map(() => Array(10).fill(0));
  let shipsToPlace = JSON.parse(JSON.stringify(FLEET));
  let selectedShipData = null;
  let currentOrientation = 'horizontal';

  shipDockDiv.classList.remove('hidden');
  renderShipList();
  infoDiv.textContent =
    'Selecione um navio e posicione-o. Pressione "R" para girar.';

  document.addEventListener('keydown', handleRotation);
  myBoardDiv.addEventListener('mouseover', handlePreview);
  myBoardDiv.addEventListener('mouseout', clearPreview);
  myBoardDiv.addEventListener('click', placeShipOnClick);

  function renderShipList() {
    shipListDiv.innerHTML = '';
    shipsToPlace.forEach((ship, index) => {
      const shipItem = document.createElement('div');
      shipItem.className = 'ship-item';
      shipItem.dataset.originalIndex = FLEET.findIndex(
        (fShip) => fShip.name === ship.name && fShip.size === ship.size
      );
      shipItem.dataset.currentListIndex = index;

      shipItem.innerHTML = `<div class="ship-name">${ship.name} (${ship.size})</div>`;
      const previewDiv = document.createElement('div');
      previewDiv.className = 'ship-preview';
      for (let i = 0; i < ship.size; i++) {
        previewDiv.innerHTML += `<div class="ship-cell-preview"></div>`;
      }
      shipItem.appendChild(previewDiv);
      shipItem.addEventListener('click', () => selectShip(ship, index));
      shipListDiv.appendChild(shipItem);
    });

    if (selectedShipData) {
      const stillAvailable = shipsToPlace.find(
        (s) =>
          s.name === selectedShipData.ship.name &&
          s.size === selectedShipData.ship.size
      );
      if (stillAvailable) {
        const itemToSelect = Array.from(shipListDiv.children).find((child) => {
          const shipInList =
            shipsToPlace[parseInt(child.dataset.currentListIndex)];
          return (
            shipInList &&
            shipInList.name === selectedShipData.ship.name &&
            shipInList.size === selectedShipData.ship.size
          );
        });
        if (itemToSelect) itemToSelect.classList.add('selected');
      } else {
        selectedShipData = null;
      }
    }
  }

  function selectShip(ship, currentListIndex) {
    selectedShipData = {
      ship: { ...ship },
      currentListIndex: currentListIndex,
      orientation: currentOrientation,
    };
    document
      .querySelectorAll('.ship-item')
      .forEach((item) => item.classList.remove('selected'));

    const shipElement = shipListDiv.querySelector(
      `.ship-item[data-current-list-index='${currentListIndex}']`
    );
    if (shipElement) {
      shipElement.classList.add('selected');
    }
  }

  function handleRotation(e) {
    if (e.key.toLowerCase() === 'r' && selectedShipData) {
      currentOrientation =
        currentOrientation === 'horizontal' ? 'vertical' : 'horizontal';
      selectedShipData.orientation = currentOrientation;

      const hoveredCell = myBoardDiv.querySelector('.cell:hover');
      if (hoveredCell && hoveredCell.dataset.x) {
        const event = new MouseEvent('mouseover', { bubbles: true });
        hoveredCell.dispatchEvent(event);
      }
    }
  }

  function getShipCellsForPreview(x, y) {
    if (!selectedShipData) return [];
    let cells = [];
    for (let i = 0; i < selectedShipData.ship.size; i++) {
      if (selectedShipData.orientation === 'horizontal') {
        cells.push({ x: x + i, y: y });
      } else {
        cells.push({ x: x, y: y + i });
      }
    }
    return cells;
  }

  function handlePreview(e) {
    if (
      !selectedShipData ||
      !e.target.classList.contains('cell') ||
      !e.target.dataset.x
    )
      return;
    clearPreview();

    const x = parseInt(e.target.dataset.x);
    const y = parseInt(e.target.dataset.y);
    const shipCells = getShipCellsForPreview(x, y);
    const isValidPlacement = canPlaceShip(shipCells);

    shipCells.forEach((cellPos) => {
      const cellDiv = myBoardDiv.querySelector(
        `.cell[data-x='${cellPos.x}'][data-y='${cellPos.y}']`
      );
      if (cellDiv) {
        cellDiv.classList.add(
          isValidPlacement ? 'preview-valid' : 'preview-invalid'
        );
      }
    });
  }

  function clearPreview() {
    myBoardDiv.querySelectorAll('.cell').forEach((c) => {
      c.classList.remove('preview-valid', 'preview-invalid');
    });
  }

  function canPlaceShip(shipCells) {
    return shipCells.every((cellPos) => {
      return (
        cellPos.x >= 0 &&
        cellPos.x < 10 &&
        cellPos.y >= 0 &&
        cellPos.y < 10 &&
        localBoard[cellPos.y][cellPos.x] === 0
      );
    });
  }

  function placeShipOnClick(e) {
    if (
      !selectedShipData ||
      !e.target.classList.contains('cell') ||
      !e.target.dataset.x
    )
      return;

    const x = parseInt(e.target.dataset.x);
    const y = parseInt(e.target.dataset.y);
    const shipCellsToPlace = getShipCellsForPreview(x, y);

    if (canPlaceShip(shipCellsToPlace)) {
      shipCellsToPlace.forEach((cellPos) => {
        localBoard[cellPos.y][cellPos.x] = 1;
        myBoardDiv
          .querySelector(`.cell[data-x='${cellPos.x}'][data-y='${cellPos.y}']`)
          .classList.add('ship');
      });

      shipsToPlace.splice(selectedShipData.currentListIndex, 1);
      selectedShipData = null;
      currentOrientation = 'horizontal';
      renderShipList();
      clearPreview();

      if (shipsToPlace.length === 0) {
        finishSetupPhase();
      }
    }
  }

  function finishSetupPhase() {
    infoDiv.textContent = 'Frota posicionada! Clique em "Confirmar Posições".';
    setupButton.style.display = 'block';
    shipDockDiv.classList.add('hidden');

    document.removeEventListener('keydown', handleRotation);
    myBoardDiv.removeEventListener('mouseover', handlePreview);
    myBoardDiv.removeEventListener('mouseout', clearPreview);
    myBoardDiv.removeEventListener('click', placeShipOnClick);
    myBoardDiv.style.cursor = 'default';

    setupButton.onclick = () => {
      setupButton.style.display = 'none';
      ws.send(JSON.stringify({ type: 'place_ships', board: localBoard }));
      infoDiv.textContent = 'Aguardando o oponente posicionar os navios...';
    };
  }
};

const updateStatus = (state) => {
  switch (state.status) {
    case 'waiting':
      infoDiv.textContent = 'Aguardando oponente...';
      break;
    case 'setup':
      opponentBoardDiv.style.pointerEvents = 'none';
      if (!state.shipsPlaced[playerIndex]) {
        setupMyBoard();
      } else {
        infoDiv.textContent = 'Aguardando o oponente posicionar os navios...';
        shipDockDiv.classList.add('hidden');
      }
      break;
    case 'playing':
      shipDockDiv.classList.add('hidden');
      myBoardDiv.style.cursor = 'default';
      opponentBoardDiv.style.pointerEvents = 'auto';
      infoDiv.textContent = myTurn
        ? 'Sua vez de atirar!'
        : 'Aguarde a vez do oponente.';
      break;
    case 'gameover':
      opponentBoardDiv.style.pointerEvents = 'none';
      infoDiv.textContent =
        state.winner === playerIndex
          ? 'Fim de Jogo: Você Venceu!'
          : 'Fim de Jogo: Você Perdeu.';
      break;
  }
};

const fire = (x, y) => {
  const targetCell = opponentBoardDiv.querySelector(
    `.cell[data-x='${x}'][data-y='${y}']`
  );
  if (
    !myTurn ||
    targetCell.classList.contains('hit') ||
    targetCell.classList.contains('miss')
  ) {
    return;
  }
  ws.send(JSON.stringify({ type: 'fire', coords: { x, y } }));
};

opponentBoardDiv.addEventListener('click', (e) => {
  if (
    e.target.classList.contains('cell') &&
    e.target.dataset.x &&
    e.target.dataset.y &&
    e.target.closest('.board')
  ) {
    fire(parseInt(e.target.dataset.x), parseInt(e.target.dataset.y));
  }
});

initializeBoards();
