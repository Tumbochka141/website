import { Multiplayer } from "./modules/Multiplayer.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const COLORS = ["Красный", "Желтый", "Зеленый", "Синий"];
const CLASSES = { Красный: "red", Желтый: "yellow", Зеленый: "green", Синий: "blue" };
const LABELS = { skip: "⊘", reverse: "↻", "+2": "+2", wild: "★", "+4": "+4" };
const $ = (selector) => document.querySelector(selector);
const ui = {
    config: $("#config-notice"), entry: $("#entry-panel"), room: $("#room-panel"), game: $("#game-panel"),
    name: $("#player-name"), size: $("#room-size"), codeInput: $("#room-code-input"), code: $("#room-code"),
    create: $("#create-room"), join: $("#join-room"), leave: $("#leave-room"), start: $("#start-game"),
    players: $("#players"), opponents: $("#opponents"), status: $("#game-status"), hand: $("#hand"),
    top: $("#top-card"), draw: $("#draw-card"), uno: $("#call-uno"), error: $("#error"),
    connection: $("#connection-label"), colorDialog: $("#color-dialog")
};

let mp = null;
let room = null;
let publicState = null;
let hand = [];
let commandQueue = Promise.resolve();

boot();

async function boot() {
    const savedName = localStorage.getItem("eulennest-player-name");
    if (savedName) ui.name.value = savedName;
    if (!isFirebaseConfigured) {
        ui.config.hidden = false;
        ui.connection.textContent = "Firebase не настроен";
        ui.create.disabled = ui.join.disabled = true;
        return;
    }
    try {
        mp = new Multiplayer(firebaseConfig);
        await mp.connect();
        ui.connection.textContent = "Сеть готова";
    } catch (error) { showError(error); }
}

ui.codeInput.addEventListener("input", () => ui.codeInput.value = Multiplayer.normalizeRoomId(ui.codeInput.value));
ui.create.addEventListener("click", async () => run(async () => enterRoom(await mp.createRoom(saveName(), Number(ui.size.value)))));
ui.join.addEventListener("click", async () => run(async () => enterRoom(await mp.joinRoom(ui.codeInput.value, saveName()))));
ui.leave.addEventListener("click", async () => { await mp.leave(); location.reload(); });
ui.code.addEventListener("click", async () => { await navigator.clipboard.writeText(mp.roomId); ui.code.textContent = "СКОПИРОВАНО"; setTimeout(() => ui.code.textContent = mp.roomId, 900); });
ui.start.addEventListener("click", () => run(startGame));
ui.draw.addEventListener("click", () => send("draw"));
ui.uno.addEventListener("click", () => send("uno"));

async function enterRoom(code) {
    ui.entry.hidden = true;
    ui.room.hidden = false;
    ui.code.textContent = code;
    mp.subscribeRoom((value) => {
        room = value;
        renderLobby();
        if (value.meta?.status !== "lobby" && ui.game.hidden) connectGame();
    });
}

function renderLobby() {
    if (!room?.meta) return;
    ui.players.replaceChildren();
    for (const [id, player] of Object.entries(room.players ?? {})) {
        const item = document.createElement("div");
        item.className = `player ${id === room.meta.hostId ? "host" : ""}`;
        item.textContent = player.name;
        ui.players.append(item);
    }
    const isHost = room.meta.hostId === mp.user.uid;
    ui.start.hidden = !isHost;
    ui.start.disabled = Object.keys(room.players ?? {}).length < 2 || room.meta.status !== "lobby";
}

async function connectGame() {
    ui.entry.hidden = true; ui.room.hidden = false; ui.game.hidden = false;
    mp.subscribePublicState((value) => { publicState = value; renderGame(); });
    mp.subscribeHand((value) => { hand = value; renderGame(); });
    if (room.meta.hostId === mp.user.uid) {
        mp.listenForCommands((command, key) => {
            commandQueue = commandQueue.then(() => processCommand(command, key)).catch(showError);
        });
    }
}

async function startGame() {
    const entries = Object.entries(room.players ?? {});
    if (entries.length < 2) throw new Error("Для партии нужны хотя бы два игрока.");
    const deck = shuffle(createDeck());
    const hands = Object.fromEntries(entries.map(([id]) => [id, []]));
    for (let round = 0; round < 7; round++) for (const [id] of entries) hands[id].push(deck.pop());
    const firstIndex = deck.findLastIndex((card) => card.type === "number");
    const first = deck.splice(firstIndex, 1)[0];
    const engine = { deck, discard: [first], hands, order: entries.map(([id]) => id), current: 0, direction: 1, currentColor: first.color, revision: 1, winner: null };
    await saveEngine(engine, `Ход: ${entries[0][1].name}.`);
}

async function processCommand(command, key) {
    try {
        const engine = await mp.getEngine();
        if (!engine || command.revision !== engine.revision || engine.winner) return;
        const playerId = engine.order[engine.current];
        if (command.from !== playerId && command.type !== "uno") return;
        let message = "";
        if (command.type === "play") message = play(engine, command.from, command.data.indexes, command.data.color);
        else if (command.type === "draw") { drawCards(engine, command.from, 1); next(engine); message = `${playerName(command.from)} берёт карту.`; }
        else if (command.type === "uno") message = `${playerName(command.from)} кричит: UNO!`;
        else return;
        engine.revision++;
        await saveEngine(engine, message);
    } finally { await mp.removeCommand(key); }
}

function play(engine, playerId, indexes, selectedColor) {
    const cards = engine.hands[playerId];
    const selectedIndexes = [...new Set(Array.isArray(indexes) ? indexes : [])];
    if (selectedIndexes.length < 1 || selectedIndexes.length > 2) throw new Error("Можно сыграть одну или две карты.");
    const selectedCards = selectedIndexes.map((index) => cards[index]);
    const card = selectedCards[0];
    const top = engine.discard.at(-1);
    if (!card || !(card.type === "wild" || card.color === engine.currentColor || card.value === top.value)) throw new Error("Эта карта не подходит.");
    if (selectedCards.length === 2 && (!card.color || !selectedCards[1] || selectedCards[1].color !== card.color || selectedCards[1].value !== card.value)) throw new Error("Вместе можно класть только точные цветные дубли.");
    selectedIndexes.sort((a, b) => b - a).forEach((index) => cards.splice(index, 1));
    engine.discard.push(...selectedCards); engine.currentColor = card.color ?? selectedColor;
    if (!engine.currentColor || !COLORS.includes(engine.currentColor)) throw new Error("Нужно выбрать цвет.");
    if (!cards.length) { engine.winner = playerId; return `${playerName(playerId)} победил!`; }
    const count = selectedCards.length;
    if (card.value === "reverse") { if (count % 2) engine.direction *= -1; next(engine, count === 2 ? 1 : (engine.order.length === 2 ? 2 : 1)); }
    else if (card.value === "skip") next(engine, 1 + count);
    else if (card.value === "+2" || card.value === "+4") { const amount = (card.value === "+2" ? 2 : 4) * count; const target = engine.order[nextIndex(engine)]; drawCards(engine, target, amount); next(engine, 2); }
    else next(engine);
    return `${playerName(playerId)} кладёт ${count === 2 ? "две карты " : ""}${label(card)}.`;
}

function drawCards(engine, playerId, amount) {
    for (let i = 0; i < amount; i++) {
        if (!engine.deck.length && engine.discard.length > 1) { const top = engine.discard.pop(); engine.deck = shuffle(engine.discard); engine.discard = [top]; }
        if (engine.deck.length) engine.hands[playerId].push(engine.deck.pop());
    }
}
function nextIndex(engine, steps = 1) { return (engine.current + engine.direction * steps + engine.order.length * steps) % engine.order.length; }
function next(engine, steps = 1) { engine.current = nextIndex(engine, steps); }

async function saveEngine(engine, message) {
    const players = {};
    for (const id of engine.order) players[id] = { name: playerName(id), cardCount: engine.hands[id].length };
    const state = { phase: engine.winner ? "finished" : "playing", revision: engine.revision, currentPlayerId: engine.order[engine.current], currentColor: engine.currentColor, topCard: engine.discard.at(-1), direction: engine.direction, winner: engine.winner, players, message };
    await mp.setGame(engine, state, engine.hands);
}

function renderGame() {
    if (!publicState) return;
    ui.opponents.replaceChildren();
    for (const [id, player] of Object.entries(publicState.players ?? {})) if (id !== mp.user.uid) {
        const item = document.createElement("div"); item.className = `player ${id === publicState.currentPlayerId ? "host" : ""}`; item.textContent = `${player.name} · ${player.cardCount}`; ui.opponents.append(item);
    }
    ui.status.textContent = publicState.winner ? `${publicState.players[publicState.winner].name} победил!` : `${publicState.message} Цвет: ${publicState.currentColor}.`;
    ui.top.replaceChildren(cardElement(publicState.topCard));
    const top = publicState.topCard;
    ui.hand.replaceChildren(...hand.map((card, index) => {
        const playable = card.type === "wild" || card.color === publicState.currentColor || card.value === top.value;
        const el = cardElement(card, true, playable);
        el.onclick = async () => {
            let color = card.color;
            if (card.type === "wild") color = await chooseColor();
            const duplicateIndex = card.color ? hand.findIndex((candidate, otherIndex) => otherIndex !== index && candidate.color === card.color && candidate.value === card.value) : -1;
            const indexes = duplicateIndex >= 0 && confirm("У тебя есть такая же карта. Кинуть обе за один ход?") ? [index, duplicateIndex] : [index];
            send("play", { indexes, color });
        };
        return el;
    }));
    const myTurn = publicState.currentPlayerId === mp.user.uid && !publicState.winner;
    ui.draw.disabled = !myTurn; ui.hand.style.pointerEvents = myTurn ? "auto" : "none";
    ui.game.classList.toggle("my-turn", myTurn);
}

function cardElement(card, button = false, playable = false) { const el = document.createElement(button ? "button" : "div"); if (button) el.type = "button"; el.className = `card ${card?.color ? CLASSES[card.color] : "wild"}${playable ? " playable" : ""}`; const span = document.createElement("span"); span.textContent = card ? label(card) : "?"; el.append(span); return el; }
function label(card) { return LABELS[card.value] ?? String(card.value); }
function playerName(id) { return room?.players?.[id]?.name ?? publicState?.players?.[id]?.name ?? "Игрок"; }
function send(type, data = {}) { if (publicState) run(() => mp.sendCommand(type, data, publicState.revision)); }
function chooseColor() { return new Promise((resolve) => { ui.colorDialog.showModal(); ui.colorDialog.querySelectorAll("button").forEach((button) => button.onclick = () => { ui.colorDialog.close(); resolve(button.dataset.color); }); }); }

function createDeck() { const deck = []; for (const color of COLORS) { deck.push({ color, value: 0, type: "number" }); for (let n = 1; n <= 9; n++) deck.push({ color, value: n, type: "number" }, { color, value: n, type: "number" }); for (const value of ["skip", "reverse", "+2"]) deck.push({ color, value, type: "action" }, { color, value, type: "action" }); } for (let i = 0; i < 4; i++) deck.push({ color: null, value: "wild", type: "wild" }, { color: null, value: "+4", type: "wild" }); return deck; }
function shuffle(deck) { for (let i = deck.length - 1; i; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; } return deck; }
function saveName() { const value = ui.name.value.trim().slice(0, 24) || "Совёнок"; localStorage.setItem("eulennest-player-name", value); return value; }
async function run(task) { ui.error.textContent = ""; try { return await task(); } catch (error) { showError(error); } }
function showError(error) { console.error(error); ui.error.textContent = friendlyError(error); }
function friendlyError(error) { if (error?.code === "auth/operation-not-allowed") return "В Firebase нужно включить анонимную авторизацию."; if (error?.code === "PERMISSION_DENIED") return "Firebase отклонил запрос: проверь правила базы."; return error?.message ?? "Что-то пошло не так."; }
