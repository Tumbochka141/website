import { Multiplayer } from "../../modules/Multiplayer.js";
import { firebaseConfig, isFirebaseConfigured } from "../../firebase-config.js";
import { PLAYER_NAME_STORAGE_KEY, ROOM_STORAGE_KEY } from "./constants.js";
import { createCardElement, createDeck, isPlayable, shuffle } from "./cards.js";
import { drawCards, moveNext, playCards } from "./engine.js";
import { friendlyError, isDiscordAvatar, saveIdentity } from "./profile.js";
import { chooseColor, renderTableIndicators, ui } from "./ui.js";

let multiplayer = null;
let room = null;
let publicState = null;
let hand = [];
let commandQueue = Promise.resolve();
let gameConnected = false;

bindControls();
boot();

async function boot() {
    const savedName = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    const discordName = window.DiscordProfile?.getProfile()?.name;
    if (savedName || discordName) ui.name.value = savedName || discordName;

    ui.pass.hidden = true;
    ui.reveal.hidden = true;
    ui.direction.hidden = true;
    ui.currentColor.hidden = true;
    ui.status.textContent = "Создай комнату или войди по коду, чтобы начать.";

    if (!isFirebaseConfigured) {
        ui.error.textContent = "Для игры по сети сначала заполни firebase-config.js.";
        ui.create.disabled = true;
        ui.join.disabled = true;
        return;
    }

    try {
        multiplayer = new Multiplayer(firebaseConfig);
        await multiplayer.connect();
        ui.status.textContent = "Сеть готова. Создай комнату или войди по коду.";

        const savedRoom = localStorage.getItem(ROOM_STORAGE_KEY);
        if (savedRoom) {
            try {
                const identity = saveIdentity(ui.name);
                const code = await multiplayer.joinRoom(savedRoom, identity.name, identity.avatarUrl);
                await enterRoom(code);
            } catch (error) {
                localStorage.removeItem(ROOM_STORAGE_KEY);
                showError(error);
            }
        }
    } catch (error) {
        showError(error);
    }
}

function bindControls() {
    ui.codeInput.addEventListener("input", () => {
        ui.codeInput.value = Multiplayer.normalizeRoomId(ui.codeInput.value);
    });
    ui.name.addEventListener("input", () => {
        const value = ui.name.value.replace(/\s+/g, " ").slice(0, 24);
        localStorage.setItem(PLAYER_NAME_STORAGE_KEY, value);
    });
    ui.name.addEventListener("change", () => {
        if (!ui.name.value.trim()) ui.name.value = "Совёнок";
        localStorage.setItem(PLAYER_NAME_STORAGE_KEY, ui.name.value.trim().slice(0, 24));
    });

    ui.create.addEventListener("click", () => run(async () => {
        const identity = saveIdentity(ui.name);
        const code = await multiplayer.createRoom(identity.name, 4, identity.avatarUrl);
        return enterRoom(code);
    }));
    ui.join.addEventListener("click", () => run(async () => {
        const identity = saveIdentity(ui.name);
        const code = await multiplayer.joinRoom(ui.codeInput.value, identity.name, identity.avatarUrl);
        return enterRoom(code);
    }));
    ui.leave.addEventListener("click", async () => {
        localStorage.removeItem(ROOM_STORAGE_KEY);
        await multiplayer.leave();
        location.reload();
    });
    ui.code.addEventListener("click", async () => {
        await navigator.clipboard.writeText(multiplayer.roomId);
        ui.code.textContent = "СКОПИРОВАНО";
        setTimeout(() => { ui.code.textContent = multiplayer.roomId; }, 900);
    });
    ui.start.addEventListener("click", () => run(startGame));
    ui.draw.addEventListener("click", () => send("draw"));
    ui.uno.addEventListener("click", () => send("uno"));

    addEventListener("discord-profile-change", (event) => {
        if (event.detail?.name) {
            ui.name.value = event.detail.name;
            localStorage.setItem(PLAYER_NAME_STORAGE_KEY, event.detail.name);
        }
        if (multiplayer?.roomId) {
            const identity = saveIdentity(ui.name);
            run(() => multiplayer.updatePlayerProfile(identity.name, identity.avatarUrl));
        }
    });
}

async function enterRoom(code) {
    localStorage.setItem(ROOM_STORAGE_KEY, code);
    ui.entry.hidden = true;
    ui.room.hidden = false;
    ui.code.textContent = code;

    multiplayer.subscribeRoom((value) => {
        room = value;
        renderLobby();
        if (value.meta?.status !== "lobby" && !gameConnected) connectGame();
    });
}

function renderLobby() {
    if (!room?.meta) return;
    ui.players.replaceChildren();

    for (const [id, player] of Object.entries(room.players ?? {})) {
        const item = document.createElement("div");
        item.className = `online-player ${id === room.meta.hostId ? "is-host" : ""}`;
        appendAvatar(item, player.avatarUrl, "online-player__avatar");
        item.append(document.createTextNode(player.name));
        ui.players.append(item);
    }

    const isHost = room.meta.hostId === multiplayer.user.uid;
    ui.start.hidden = !isHost;
    ui.start.disabled = Object.keys(room.players ?? {}).length < 2 || room.meta.status !== "lobby";
    if (room.meta.status === "lobby") {
        ui.status.textContent = isHost
            ? "Когда все войдут, нажми «Начать игру»."
            : "Ждём, когда ведущий начнёт игру.";
    }
}

async function connectGame() {
    gameConnected = true;
    ui.entry.hidden = true;
    ui.room.hidden = false;

    multiplayer.subscribePublicState((value) => {
        publicState = value;
        renderGame();
    });
    multiplayer.subscribeHand((value) => {
        hand = value;
        renderGame();
    });

    if (room.meta.hostId === multiplayer.user.uid) {
        multiplayer.listenForCommands((command, key) => {
            commandQueue = commandQueue.then(() => processCommand(command, key)).catch(showError);
        });
    }
}

async function startGame() {
    const entries = Object.entries(room.players ?? {});
    if (entries.length < 2) throw new Error("Для партии нужны хотя бы два игрока.");

    const deck = shuffle(createDeck());
    const hands = Object.fromEntries(entries.map(([id]) => [id, []]));
    for (let round = 0; round < 7; round++) {
        for (const [id] of entries) hands[id].push(deck.pop());
    }

    const firstIndex = deck.findLastIndex((card) => card.type === "number");
    const firstCard = deck.splice(firstIndex, 1)[0];
    const engine = {
        deck,
        discard: [firstCard],
        hands,
        order: entries.map(([id]) => id),
        current: 0,
        direction: 1,
        currentColor: firstCard.color,
        revision: 1,
        winner: null,
        unoPendingPlayerId: null
    };
    await saveEngine(engine, `Ход: ${entries[0][1].name}.`);
}

async function processCommand(command, key) {
    try {
        const engine = await multiplayer.getEngine();
        if (!engine || command.revision !== engine.revision || engine.winner) return;

        const playerId = engine.order[engine.current];
        if (command.type === "uno") {
            if (engine.unoPendingPlayerId !== command.from) return;
            engine.unoPendingPlayerId = null;
            await saveEngine(engine, `${playerName(command.from)} кричит: UNO! Штрафа не будет.`);
            return;
        }
        if (command.from !== playerId) return;

        const messages = [];
        if (engine.unoPendingPlayerId) {
            const penalizedPlayerId = engine.unoPendingPlayerId;
            drawCards(engine, penalizedPlayerId, 2);
            engine.unoPendingPlayerId = null;
            messages.push(`${playerName(penalizedPlayerId)} забыл крикнуть UNO и берёт две карты.`);
        }

        if (command.type === "play") {
            messages.push(playCards(engine, command.from, command.data.indexes, command.data.color, playerName));
        } else if (command.type === "draw") {
            drawCards(engine, command.from, 1);
            moveNext(engine);
            messages.push(`${playerName(command.from)} берёт карту.`);
        } else {
            return;
        }

        engine.revision++;
        await saveEngine(engine, messages.join(" "));
    } finally {
        await multiplayer.removeCommand(key);
    }
}

async function saveEngine(engine, message) {
    engine.winner ??= null;
    engine.unoPendingPlayerId ??= null;

    const players = {};
    for (const id of engine.order) {
        const avatarUrl = room?.players?.[id]?.avatarUrl;
        players[id] = {
            name: playerName(id),
            cardCount: engine.hands[id].length,
            ...(isDiscordAvatar(avatarUrl) ? { avatarUrl } : {})
        };
    }

    const state = {
        phase: engine.winner ? "finished" : "playing",
        revision: engine.revision,
        currentPlayerId: engine.order[engine.current],
        currentColor: engine.currentColor,
        topCard: engine.discard.at(-1),
        deckCount: engine.deck.length,
        direction: engine.direction,
        winner: engine.winner,
        unoPendingPlayerId: engine.unoPendingPlayerId,
        players,
        message
    };
    await multiplayer.setGame(engine, state, engine.hands);
}

function renderGame() {
    if (!publicState) return;
    const myTurn = publicState.currentPlayerId === multiplayer.user.uid && !publicState.winner;
    renderTableIndicators(publicState.currentColor, publicState.direction);
    renderOpponents();

    const activeName = publicState.players?.[publicState.currentPlayerId]?.name ?? "Игрок";
    ui.status.textContent = publicState.winner
        ? `${publicState.players[publicState.winner].name} победил!`
        : publicState.unoPendingPlayerId === multiplayer.user.uid
            ? "Крикни UNO!"
            : myTurn ? "Твой ход" : `Ход: ${activeName}`;

    ui.top.replaceChildren(createCardElement(publicState.topCard));
    ui.deckCount.textContent = publicState.deckCount ?? "?";
    renderHand(myTurn);
    ui.draw.disabled = !myTurn;
    ui.uno.disabled = publicState.unoPendingPlayerId !== multiplayer.user.uid;
    ui.hand.style.pointerEvents = myTurn ? "auto" : "none";
    ui.game.classList.toggle("is-my-turn", myTurn);
}

function renderOpponents() {
    ui.opponents.replaceChildren();
    for (const [id, player] of Object.entries(publicState.players ?? {})) {
        if (id === multiplayer.user.uid) continue;

        const item = document.createElement("div");
        item.className = `opponent is-human ${id === publicState.currentPlayerId ? "is-active" : ""}`;
        appendAvatar(item, player.avatarUrl, "opponent__avatar");

        const name = document.createElement("strong");
        name.textContent = player.name;
        const count = document.createElement("span");
        count.textContent = `${player.cardCount} карт`;
        item.append(name, count);
        ui.opponents.append(item);
    }
}

function renderHand(myTurn) {
    const topCard = publicState.topCard;
    ui.hand.replaceChildren(...hand.map((card, index) => {
        const playable = isPlayable(card, publicState.currentColor, topCard);
        const element = createCardElement(card, { button: true, playable });
        element.disabled = !myTurn || !playable;
        element.onclick = async () => {
            let color = card.color;
            if (card.type === "wild") color = await chooseColor();

            const duplicateIndex = card.color
                ? hand.findIndex((candidate, otherIndex) => (
                    otherIndex !== index
                    && candidate.color === card.color
                    && candidate.value === card.value
                ))
                : -1;
            const playDuplicate = duplicateIndex >= 0
                && await window.gameDialog.confirm("У тебя есть такая же карта. Кинуть обе за один ход?");
            send("play", { indexes: playDuplicate ? [index, duplicateIndex] : [index], color });
        };
        return element;
    }));
}

function appendAvatar(container, avatarUrl, className) {
    if (!isDiscordAvatar(avatarUrl)) return;
    const avatar = document.createElement("img");
    avatar.className = className;
    avatar.src = avatarUrl;
    avatar.alt = "";
    container.append(avatar);
}

function playerName(id) {
    return room?.players?.[id]?.name ?? publicState?.players?.[id]?.name ?? "Игрок";
}

function send(type, data = {}) {
    if (publicState) run(() => multiplayer.sendCommand(type, data, publicState.revision));
}

async function run(task) {
    ui.error.textContent = "";
    try {
        return await task();
    } catch (error) {
        showError(error);
    }
}

function showError(error) {
    console.error(error);
    ui.error.textContent = friendlyError(error);
}
