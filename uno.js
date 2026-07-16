"use strict";

const COLORS = ["Красный", "Желтый", "Зеленый", "Синий"];
const COLOR_CLASS_NAMES = {
    Красный: "red",
    Желтый: "yellow",
    Зеленый: "green",
    Синий: "blue"
};
const COLOR_BY_CLASS_NAME = Object.fromEntries(
    Object.entries(COLOR_CLASS_NAMES).map(([color, className]) => [className, color])
);
const ACTION_LABELS = {
    skip: "⊘",
    reverse: "↻",
    "+2": "+2",
    wild: "★",
    "+4": "+4"
};
const BOT_DELAY = 720;

const uno = {
    phase: "setup",
    players: [],
    deck: [],
    discard: [],
    currentPlayer: 0,
    currentColor: null,
    direction: 1,
    winner: null,
    hasDrawn: false,
    drawnCardIndex: null,
    pendingWildCard: null,
    unoVulnerable: null,
    humanCount: 1,
    viewerPlayer: 0,
    handoverPending: false,
    message: "",
    botTimer: null
};

const discardPileElement = document.querySelector("#discard-pile");
const newGameButton = document.querySelector("#new-game");
const playerHandElement = document.querySelector("#player-hand");
const drawPileButton = document.querySelector("#draw-pile");
const deckCountElement = document.querySelector("#deck-count");
const statusElement = document.querySelector("#status");
const playerCountElement = document.querySelector("#player-count");
const humanCountElement = document.querySelector("#human-count");
const setupSummaryElement = document.querySelector("#setup-summary");
const opponentsElement = document.querySelector("#opponents");
const unoCallButton = document.querySelector("#uno-call");
const passTurnButton = document.querySelector("#pass-turn");
const revealHandButton = document.querySelector("#reveal-hand");
const colorDialog = document.querySelector("#color-dialog");
const colorChoiceButtons = [...document.querySelectorAll(".color-choice")];
const gameBoardElement = document.querySelector(".game-board");

function createDeck() {
    const deck = [];

    for (const color of COLORS) {
        deck.push({ color, value: 0, type: "number" });

        for (let value = 1; value <= 9; value++) {
            deck.push({ color, value, type: "number" });
            deck.push({ color, value, type: "number" });
        }

        for (const value of ["skip", "reverse", "+2"]) {
            deck.push({ color, value, type: "action" });
            deck.push({ color, value, type: "action" });
        }
    }

    for (let copy = 0; copy < 4; copy++) {
        deck.push({ color: null, value: "wild", type: "wild" });
        deck.push({ color: null, value: "+4", type: "wild" });
    }

    return deck;
}

function shuffleDeck(deck) {
    for (let index = deck.length - 1; index > 0; index--) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [deck[index], deck[randomIndex]] = [deck[randomIndex], deck[index]];
    }

    return deck;
}

function createPlayers(count, humanCount = 1) {
    let humanNumber = 0;
    let botNumber = 0;

    return Array.from({ length: count }, (_, index) => {
        const isHuman = index < humanCount;
        const name = isHuman
            ? (humanCount === 1 ? "Ты" : `Игрок ${++humanNumber}`)
            : `Совёнок ${++botNumber}`;

        return { name, hand: [], isHuman };
    });
}

function dealCards(deck, players, amount = 7) {
    for (let round = 0; round < amount; round++) {
        for (const player of players) {
            player.hand.push(deck.pop());
        }
    }
}

function takeStartingCard() {
    const numberCardIndex = uno.deck.findLastIndex((card) => card.type === "number");
    return uno.deck.splice(numberCardIndex, 1)[0];
}

function startGame() {
    clearTimeout(uno.botTimer);

    const playerCount = Number(playerCountElement.value);
    const humanCount = Math.min(Number(humanCountElement.value), playerCount);
    uno.deck = shuffleDeck(createDeck());
    uno.players = createPlayers(playerCount, humanCount);
    uno.discard = [];
    dealCards(uno.deck, uno.players);

    const firstCard = takeStartingCard();
    uno.discard.push(firstCard);
    uno.currentPlayer = 0;
    uno.currentColor = firstCard.color;
    uno.direction = 1;
    uno.winner = null;
    uno.hasDrawn = false;
    uno.drawnCardIndex = null;
    uno.pendingWildCard = null;
    uno.unoVulnerable = null;
    uno.humanCount = humanCount;
    uno.viewerPlayer = 0;
    uno.handoverPending = false;
    uno.message = humanCount === 1
        ? "Твой ход. Выбери карту или возьми новую."
        : "Ход Игрока 1. Выбери карту или возьми новую.";
    uno.phase = "playing";

    if (colorDialog.open) {
        colorDialog.close();
    }

    renderGame();
}

function getTopCard() {
    return uno.discard.at(-1);
}

function getColorClassName(color) {
    return color ? COLOR_CLASS_NAMES[color] : "wild";
}

function getCardLabel(card) {
    return ACTION_LABELS[card.value] ?? String(card.value);
}

function getCardDescription(card) {
    if (card.value === "wild") return "Смена цвета";
    if (card.value === "+4") return "Смена цвета и плюс четыре";

    const valueNames = {
        skip: "пропуск хода",
        reverse: "смена направления",
        "+2": "плюс две"
    };
    return `${card.color}, ${valueNames[card.value] ?? card.value}`;
}

function canPlayCard(card) {
    const topCard = getTopCard();
    return card.type === "wild" || card.color === uno.currentColor || card.value === topCard.value;
}

function canHumanPlayCard(playerIndex, cardIndex) {
    if (uno.phase !== "playing" || uno.currentPlayer !== playerIndex || uno.handoverPending) return false;
    if (uno.hasDrawn && cardIndex !== uno.drawnCardIndex) return false;
    return canPlayCard(uno.players[playerIndex].hand[cardIndex]);
}

function recycleDiscardPile() {
    if (uno.deck.length > 0 || uno.discard.length <= 1) return;

    const topCard = uno.discard.pop();
    uno.deck = shuffleDeck(uno.discard);
    uno.discard = [topCard];
}

function giveCards(playerIndex, amount) {
    const player = uno.players[playerIndex];

    for (let count = 0; count < amount; count++) {
        recycleDiscardPile();
        const card = uno.deck.pop();
        if (!card) break;
        player.hand.push(card);
    }
}

function getNextPlayerIndex(steps = 1) {
    const playerCount = uno.players.length;
    return (uno.currentPlayer + uno.direction * steps + playerCount * steps) % playerCount;
}

function moveTurn(steps = 1) {
    const previousPlayer = uno.currentPlayer;
    uno.currentPlayer = getNextPlayerIndex(steps);
    uno.hasDrawn = false;
    uno.drawnCardIndex = null;

    const nextPlayer = uno.players[uno.currentPlayer];
    if (nextPlayer.isHuman && uno.humanCount > 1 && uno.currentPlayer !== previousPlayer) {
        uno.handoverPending = true;
    }
}

function chooseBotColor(playerIndex) {
    const counts = Object.fromEntries(COLORS.map((color) => [color, 0]));

    for (const card of uno.players[playerIndex].hand) {
        if (card.color) counts[card.color]++;
    }

    const highestCount = Math.max(...Object.values(counts));
    const bestColors = COLORS.filter((color) => counts[color] === highestCount);
    return bestColors[Math.floor(Math.random() * bestColors.length)];
}

function finishGame(playerIndex) {
    uno.winner = playerIndex;
    uno.phase = "finished";
    uno.unoVulnerable = null;
    uno.message = `${uno.players[playerIndex].name} победил!`;
}

function openUnoWindow(playerIndex) {
    if (uno.players[playerIndex].hand.length !== 1) return;

    if (uno.players[playerIndex].isHuman) {
        uno.unoVulnerable = playerIndex;
        uno.message = "У тебя одна карта — успей крикнуть UNO!";
    } else {
        uno.unoVulnerable = null;
        uno.message = `${uno.players[playerIndex].name} кричит: UNO!`;
    }
}

function penalizeMissedUno() {
    const playerIndex = uno.unoVulnerable;
    if (playerIndex === null) return;

    giveCards(playerIndex, 2);
    uno.message = `${uno.players[playerIndex].name} забыл крикнуть UNO и берёт две карты.`;
    uno.unoVulnerable = null;
}

function applyCardEffect(card, playedCount = 1) {
    if (card.value === "skip") {
        const skippedPlayer = uno.players[getNextPlayerIndex(1)];
        moveTurn(1 + playedCount);
        uno.message = playedCount === 2 ? "Двойной пропуск хода." : `${skippedPlayer.name} пропускает ход.`;
        return;
    }

    if (card.value === "reverse") {
        if (playedCount % 2 === 1) uno.direction *= -1;
        moveTurn(playedCount === 2 ? 1 : (uno.players.length === 2 ? 2 : 1));
        uno.message = playedCount === 2
            ? "Два разворота отменили друг друга."
            : (uno.players.length === 2 ? "Разворот работает как пропуск хода." : `Направление сменилось: теперь ходим ${uno.direction === 1 ? "по часовой" : "против часовой"}.`);
        return;
    }

    if (card.value === "+2" || card.value === "+4") {
        const amount = (card.value === "+2" ? 2 : 4) * playedCount;
        const targetIndex = getNextPlayerIndex(1);
        giveCards(targetIndex, amount);
        moveTurn(2);
        uno.message = `${uno.players[targetIndex].name} берёт ${amount} карты и пропускает ход.`;
        return;
    }

    moveTurn();
}

function completePlayedCard(playerIndex, card, playedCount = 1) {
    if (uno.players[playerIndex].hand.length === 0) {
        finishGame(playerIndex);
        return;
    }

    applyCardEffect(card, playedCount);
    openUnoWindow(playerIndex);
}

function findDuplicateIndex(cards, card, excludedIndex) {
    if (!card.color) return -1;
    return cards.findIndex((candidate, index) => index !== excludedIndex
        && candidate.color === card.color
        && candidate.value === card.value);
}

function playCard(playerIndex, cardIndex, playDuplicate = false) {
    const player = uno.players[playerIndex];

    if (uno.phase !== "playing" || playerIndex !== uno.currentPlayer || !player) return false;
    if (player.isHuman && uno.hasDrawn && cardIndex !== uno.drawnCardIndex) return false;

    const card = player.hand[cardIndex];
    if (!card || !canPlayCard(card)) return false;

    const duplicateIndex = playDuplicate && !uno.hasDrawn
        ? findDuplicateIndex(player.hand, card, cardIndex)
        : -1;
    const playedCards = duplicateIndex >= 0 ? [card, player.hand[duplicateIndex]] : [card];

    penalizeMissedUno();
    const indexes = duplicateIndex >= 0 ? [cardIndex, duplicateIndex] : [cardIndex];
    indexes.sort((left, right) => right - left).forEach((index) => player.hand.splice(index, 1));
    uno.discard.push(...playedCards);

    if (card.type === "wild") {
        if (player.hand.length === 0) {
            finishGame(playerIndex);
        } else if (player.isHuman) {
            uno.phase = "choosing-color";
            uno.pendingWildCard = { playerIndex, card };
            uno.message = "Выбери цвет для следующего хода.";
        } else {
            uno.currentColor = chooseBotColor(playerIndex);
            completePlayedCard(playerIndex, card);
        }
    } else {
        uno.currentColor = card.color;
        completePlayedCard(playerIndex, card, playedCards.length);
    }

    return true;
}

function chooseWildColor(color) {
    if (uno.phase !== "choosing-color" || !uno.pendingWildCard) return;

    const { playerIndex, card } = uno.pendingWildCard;
    uno.currentColor = color;
    uno.pendingWildCard = null;
    uno.phase = "playing";
    completePlayedCard(playerIndex, card);
    colorDialog.close();
    renderGame();
}

function drawForTurn(playerIndex) {
    const player = uno.players[playerIndex];

    if (uno.phase !== "playing" || playerIndex !== uno.currentPlayer || !player || uno.hasDrawn) {
        return false;
    }

    penalizeMissedUno();
    recycleDiscardPile();

    const card = uno.deck.pop();
    if (!card) {
        uno.message = "В колоде не осталось карт.";
        return false;
    }

    player.hand.push(card);
    uno.hasDrawn = true;
    uno.drawnCardIndex = player.hand.length - 1;

    if (canPlayCard(card)) {
        uno.message = player.isHuman
            ? "Взятая карта подходит: сыграй её или закончи ход."
            : `${player.name} нашёл подходящую карту.`;
    } else {
        uno.message = `${player.name} берёт карту и передаёт ход.`;
        moveTurn();
    }

    return true;
}

function passTurn() {
    const player = uno.players[uno.currentPlayer];
    if (uno.phase !== "playing" || !player?.isHuman || !uno.hasDrawn || uno.handoverPending) return;
    uno.message = `${player.name} оставляет взятую карту и заканчивает ход.`;
    moveTurn();
    renderGame();
}

function selectBotCard(playerIndex) {
    const playableIndexes = uno.players[playerIndex].hand
        .map((card, index) => ({ card, index }))
        .filter(({ card }) => canPlayCard(card));

    if (playableIndexes.length === 0) return null;

    const priority = { "+4": 5, "+2": 4, skip: 3, reverse: 2, wild: 1 };
    playableIndexes.sort((left, right) => (priority[right.card.value] ?? 0) - (priority[left.card.value] ?? 0));

    const bestPriority = priority[playableIndexes[0].card.value] ?? 0;
    const bestCards = playableIndexes.filter(({ card }) => (priority[card.value] ?? 0) === bestPriority);
    return bestCards[Math.floor(Math.random() * bestCards.length)].index;
}

function runBotTurn() {
    if (uno.phase !== "playing" || uno.players[uno.currentPlayer]?.isHuman) return;

    const botIndex = uno.currentPlayer;
    let cardIndex = selectBotCard(botIndex);

    if (cardIndex !== null) {
        playCard(botIndex, cardIndex, true);
        renderGame();
        return;
    }

    drawForTurn(botIndex);

    if (uno.phase === "playing" && uno.currentPlayer === botIndex && uno.hasDrawn) {
        cardIndex = uno.drawnCardIndex;
        playCard(botIndex, cardIndex, true);
    }

    renderGame();
}

function createCardElement(card, options = {}) {
    const element = document.createElement(options.button ? "button" : "div");
    if (options.button) element.type = "button";

    element.className = `uno-card uno-card--${getColorClassName(card.color)}`;
    if (options.playable) element.classList.add("is-playable");
    if (options.drawn) element.classList.add("is-drawn");
    element.setAttribute("aria-label", getCardDescription(card));

    const valueElement = document.createElement("span");
    valueElement.className = "uno-card__value";
    valueElement.textContent = getCardLabel(card);
    element.append(valueElement);

    return element;
}

function renderDiscard() {
    const card = getTopCard();
    discardPileElement.replaceChildren();
    if (card) discardPileElement.append(createCardElement(card));
}

function renderHand() {
    playerHandElement.replaceChildren();

    if (uno.handoverPending) {
        const cover = document.createElement("div");
        cover.className = "hand-cover";
        cover.textContent = `Передайте экран игроку «${uno.players[uno.currentPlayer].name}» и нажмите «Показать карты».`;
        playerHandElement.append(cover);
        return;
    }

    const playerIndex = uno.viewerPlayer;
    const player = uno.players[playerIndex];
    if (!player) return;

    player.hand.forEach((card, index) => {
        const playable = canHumanPlayCard(playerIndex, index);
        const cardButton = createCardElement(card, {
            button: true,
            playable,
            drawn: uno.hasDrawn && index === uno.drawnCardIndex
        });

        cardButton.addEventListener("click", () => {
            if (uno.phase === "finished") {
                alert(`GAMEOVER!!!. Победил ${uno.players[uno.winner].name}`);
                return;
            }
            if (uno.phase !== "playing") {
                alert("Притормози, спешка пока никчему");
                return;
            }
            if (uno.currentPlayer !== playerIndex) {
                alert(`Руки на стол, сейчас ходит ${uno.players[uno.currentPlayer].name}.`);
                return;
            }
            if (uno.hasDrawn && index !== uno.drawnCardIndex) {
                alert("После взятия можно сыграть только что вытянутую карту.");
                return;
            }
            if (!canPlayCard(card)) {
                alert("Бери другую карту)))");
                return;
            }

            const duplicateIndex = findDuplicateIndex(player.hand, card, index);
            const playDuplicate = !uno.hasDrawn
                && duplicateIndex >= 0
                && confirm("У тебя есть такая же карта. Кинуть обе за один ход?");
            const played = playCard(playerIndex, index, playDuplicate);

            if (!played) {
                alert("Бип-буп, давай по новой.");
                return;
            }

            renderGame();

            if (uno.phase === "choosing-color") {
                colorDialog.showModal();
            }
        });

        playerHandElement.append(cardButton);
    });
}

function renderOpponents() {
    opponentsElement.replaceChildren();

    for (let index = 0; index < uno.players.length; index++) {
        if (index === uno.viewerPlayer && !uno.handoverPending) continue;

        const player = uno.players[index];
        const opponent = document.createElement("div");
        opponent.className = "opponent";
        opponent.classList.add(player.isHuman ? "is-human" : "is-bot");
        opponent.classList.toggle("is-active", uno.phase === "playing" && uno.currentPlayer === index);

        const name = document.createElement("strong");
        name.textContent = player.name;
        const count = document.createElement("span");
        count.textContent = `${player.hand.length} ${getCardWord(player.hand.length)}`;

        opponent.append(name, count);
        opponentsElement.append(opponent);
    }
}

function getCardWord(amount) {
    const mod10 = amount % 10;
    const mod100 = amount % 100;
    if (mod10 === 1 && mod100 !== 11) return "карта";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "карты";
    return "карт";
}

function renderStatus() {
    if (uno.phase === "setup") {
        statusElement.textContent = "Нажми «Новая партия», чтобы начать.";
        return;
    }
    if (uno.phase === "finished") {
        statusElement.textContent = uno.message;
        return;
    }

    if (uno.handoverPending) {
        statusElement.textContent = `Ход: ${uno.players[uno.currentPlayer].name}. Карты скрыты до передачи экрана.`;
        return;
    }

    const player = uno.players[uno.currentPlayer];
    const turnText = uno.phase === "choosing-color" ? "Выбор цвета" : `Ход: ${player.name}`;
    statusElement.textContent = `${turnText}. Цвет: ${uno.currentColor}. ${uno.message}`;
}

function renderControls() {
    const currentPlayer = uno.players[uno.currentPlayer];
    const isHumanTurn = uno.phase === "playing" && currentPlayer?.isHuman && !uno.handoverPending;
    drawPileButton.disabled = !isHumanTurn || uno.hasDrawn;
    passTurnButton.disabled = !isHumanTurn || !uno.hasDrawn;
    unoCallButton.disabled = uno.phase !== "playing"
        || uno.unoVulnerable === null
        || !uno.players[uno.unoVulnerable]?.isHuman;
    revealHandButton.hidden = !uno.handoverPending;
    revealHandButton.disabled = !uno.handoverPending;
    gameBoardElement.classList.toggle("is-my-turn", isHumanTurn);
    deckCountElement.textContent = uno.deck.length;
}

function scheduleBotTurn() {
    clearTimeout(uno.botTimer);
    if (uno.phase === "playing" && !uno.players[uno.currentPlayer]?.isHuman) {
        uno.botTimer = setTimeout(runBotTurn, BOT_DELAY);
    }
}

function renderGame() {
    renderDiscard();
    renderHand();
    renderOpponents();
    renderStatus();
    renderControls();
    scheduleBotTurn();
}

drawPileButton.addEventListener("click", () => {
    const playerIndex = uno.currentPlayer;
    if (uno.players[playerIndex]?.isHuman && drawForTurn(playerIndex)) renderGame();
});

passTurnButton.addEventListener("click", () => {
    if (uno.players[uno.currentPlayer]?.isHuman) passTurn();
});

unoCallButton.addEventListener("click", () => {
    if (uno.unoVulnerable === null || !uno.players[uno.unoVulnerable]?.isHuman) return;
    uno.unoVulnerable = null;
    uno.message = "UNO! Принято — штрафа не будет.";
    renderGame();
});

for (const button of colorChoiceButtons) {
    button.addEventListener("click", () => {
        chooseWildColor(COLOR_BY_CLASS_NAME[button.dataset.color]);
    });
}

colorDialog.addEventListener("cancel", (event) => {
    if (uno.phase === "choosing-color") event.preventDefault();
});

newGameButton.addEventListener("click", startGame);
revealHandButton.addEventListener("click", () => {
    if (!uno.handoverPending || !uno.players[uno.currentPlayer]?.isHuman) return;
    uno.viewerPlayer = uno.currentPlayer;
    uno.handoverPending = false;
    uno.message = `${uno.players[uno.currentPlayer].name}, твой ход.`;
    renderGame();
});

function syncLobbyControls() {
    const totalPlayers = Number(playerCountElement.value);
    const previousHumans = Math.min(Number(humanCountElement.value), totalPlayers);

    humanCountElement.replaceChildren();
    for (let amount = 1; amount <= totalPlayers; amount++) {
        const option = document.createElement("option");
        option.value = amount;
        option.textContent = amount;
        option.selected = amount === previousHumans;
        humanCountElement.append(option);
    }

    const botCount = totalPlayers - previousHumans;
    setupSummaryElement.textContent = `${previousHumans} ${getPlayerWord(previousHumans)} · ${botCount} ${getBotWord(botCount)}`;
}

function getPlayerWord(amount) {
    if (amount === 1) return "игрок";
    if (amount >= 2 && amount <= 4) return "игрока";
    return "игроков";
}

function getBotWord(amount) {
    if (amount === 1) return "бот";
    if (amount >= 2 && amount <= 4) return "бота";
    return "ботов";
}

playerCountElement.addEventListener("change", syncLobbyControls);
humanCountElement.addEventListener("change", syncLobbyControls);
syncLobbyControls();
renderGame();
