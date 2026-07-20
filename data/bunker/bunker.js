import { Multiplayer } from "../../modules/Multiplayer.js";
import { firebaseConfig, isFirebaseConfigured } from "../../firebase-config.js";
import {
    GAME_TYPE,
    PHASES,
    TRAIT_KEYS,
    TRAIT_LABELS,
    applyCommand,
    assertFirebaseSafe,
    createInitialGame,
    createPrivateStates,
    createPublicState
} from "./engine.js";
import { SPECIAL_CARDS } from "./cards.js";

const ROOM_STORAGE_KEY = "eulennest-bunker-room";
const PLAYER_NAME_STORAGE_KEY = "eulennest-player-name";

const select = (selector) => document.querySelector(selector);

const ui = {
    modePlayer: select("#mode-player"),
    modeHost: select("#mode-host"),
    hostModeTab: select('label[for="mode-host"]'),
    lobby: select("#online-lobby"),
    lobbyForm: select("#online-lobby .setup-grid"),
    onlineName: select("#online-name"),
    createRoomButton: select("#create-room"),
    joinRoomButton: select("#join-room"),
    roomCodeInput: select("#room-code-input"),
    roomInfo: select("#room-info"),
    roomCodeOutput: select("#room-code-output"),
    restartRoom: select("#restart-room"),
    leaveRoom: select("#leave-room"),
    onlineError: select("#online-error"),
    status: select("#game-status span"),
    startGame: select("#start-game"),
    setupPanel: select("#setup-panel"),
    hostName: select("#host-name"),
    playerCount: select("#player-count"),
    bunkerCapacity: select("#bunker-capacity"),
    hostPlays: select("#host-plays"),
    roundCurrent: select("#round-current"),
    roundTotal: select("#round-total"),
    roundPhase: select("#round-phase"),
    playersAlive: select("#players-alive"),
    playersTotal: select("#players-total"),
    nextPhase: select("#next-phase"),
    finishTurn: select("#finish-turn"),
    characterTraits: select("#character-traits"),
    specialControls: select("#special-controls"),
    specialGuide: select("#special-guide"),
    specialTargetPlayer: select("#special-target-player"),
    specialTargetTrait: select("#special-target-trait"),
    specialTargetScenario: select("#special-target-scenario"),
    specialChoice: select("#special-choice"),
    playSpecial: select("#play-special"),
    sharedSecrets: select("#shared-secrets"),
    playerRoster: select("#player-roster"),
    playersList: select("#players-list"),
    playerTemplate: select("#player-card-template"),
    activePlayerLabel: select("#active-player-label"),
    votePanel: select("#vote-panel"),
    voteRoundLabel: select("#vote-round-label"),
    voteList: select("#vote-list"),
    confirmVote: select("#confirm-vote"),
    voteStatus: select("#vote-status"),
    eventLog: select("#event-log"),
    logTemplate: select("#log-entry-template"),
    hostDossier: select("#host-dossier"),
    hostTraits: select("#host-character-traits"),
    hostRevealTrait: select("#host-reveal-trait"),
    hostFinishTurn: select("#host-finish-turn"),
    scenarioCards: {
        catastrophe: select("#catastrophe-card"),
        bunker: select("#bunker-card"),
        threat: select("#threat-card")
    },
    scenarioGrid: select("#scenario-grid"),
    hostEditor: select("#host-editor"),
    hostEditCapacity: select("#host-edit-capacity"),
    hostApplyCapacity: select("#host-apply-capacity"),
    hostEditPlayer: select("#host-edit-player"),
    hostEditTrait: select("#host-edit-trait"),
    hostEditValue: select("#host-edit-value"),
    hostEditRevealed: select("#host-edit-revealed"),
    hostRandomTrait: select("#host-random-trait"),
    hostApplyTrait: select("#host-apply-trait"),
    hostEditStatus: select("#host-edit-status"),
    hostApplyStatus: select("#host-apply-status"),
    hostEditScenarioType: select("#host-edit-scenario-type"),
    hostEditScenarioTitle: select("#host-edit-scenario-title"),
    hostEditScenarioDescription: select("#host-edit-scenario-description"),
    hostRandomScenario: select("#host-random-scenario"),
    hostAddScenario: select("#host-add-scenario"),
    hostSpecialPlayer: select("#host-special-player"),
    hostSpecialCard: select("#host-special-card"),
    hostSpecialRevealed: select("#host-special-revealed"),
    hostAssignSpecial: select("#host-assign-special"),
    hostSpecialPreview: select("#host-special-preview"),
    scenarioButtons: {
        catastrophe: select("#reveal-catastrophe"),
        bunker: select("#reveal-bunker"),
        threat: select("#reveal-threat")
    }
};

let multiplayer = null;
let room = null;
let publicState = null;
let privateState = {};
let selectedVoteTarget = "";
let commandListenerStarted = false;
let commandQueue = Promise.resolve();
let hasSeenRoom = false;
let leavingRoom = false;
let lastCommandErrorAt = 0;

init();

async function init() {
    initSpecialCatalog();
    lockHostInterface();
    bindEvents();

    if (!isFirebaseConfigured) {
        setConnectionControlsDisabled(true);
        handleError(new Error("Firebase не настроен."));
        return;
    }

    try {
        multiplayer = new Multiplayer(firebaseConfig);
        await multiplayer.connect();
        restorePlayerName();
        setConnectionControlsDisabled(false);
        setStatus("Готов к подключению");
        await restoreRoom();
    } catch (error) {
        handleError(error);
    }
}

function bindEvents() {
    ui.createRoomButton.addEventListener("click", () => run(async () => {
        const roomCode = await createRoom(readPlayerName(), 16);
        showConnectedRoom(roomCode);
    }));

    ui.joinRoomButton.addEventListener("click", () => run(async () => {
        const roomCode = await joinRoom(ui.roomCodeInput.value, readPlayerName());
        showConnectedRoom(roomCode);
    }));

    ui.roomCodeInput.addEventListener("input", () => {
        ui.roomCodeInput.value = Multiplayer.normalizeRoomId(ui.roomCodeInput.value);
    });

    ui.roomCodeInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") ui.joinRoomButton.click();
    });

    ui.roomCodeOutput.addEventListener("click", () => run(copyRoomCode));
    ui.leaveRoom.addEventListener("click", () => run(leaveCurrentRoom));
    ui.restartRoom.addEventListener("click", () => run(resetCurrentGame));
    ui.startGame.addEventListener("click", () => run(startGame));
    ui.nextPhase.addEventListener("click", () => run(() => sendCommand("NEXT_PHASE")));
    ui.finishTurn.addEventListener("click", () => run(() => sendCommand("FINISH_TURN")));
    ui.hostFinishTurn.addEventListener("click", () => run(() => sendCommand("FINISH_TURN")));

    ui.characterTraits.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action='reveal-trait'], [data-action='play-special']");
        const trait = button?.closest("[data-trait]")?.dataset.trait;
        if (trait) run(() => sendCommand("REVEAL_TRAIT", { trait }));
    });

    ui.hostRevealTrait.addEventListener("click", () => run(revealNextHostTrait));

    ui.voteList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-vote-target]");
        if (button && !button.disabled) selectVoteTarget(button.dataset.voteTarget);
    });

    ui.confirmVote.addEventListener("click", () => {
        if (selectedVoteTarget) run(() => sendCommand("VOTE", { targetId: selectedVoteTarget }));
    });
    ui.playSpecial.addEventListener("click", () => run(playOrRespondSpecial));

    for (const [scenarioType, button] of Object.entries(ui.scenarioButtons)) {
        button.addEventListener("click", () => run(() => sendCommand("REVEAL_SCENARIO", { scenarioType })));
    }

    ui.hostApplyCapacity.addEventListener("click", () => run(() => sendHostEdit({
        action: "set_capacity",
        capacity: Number(ui.hostEditCapacity.value)
    })));
    ui.hostApplyTrait.addEventListener("click", () => run(() => sendHostEdit({
        action: "set_trait",
        playerId: ui.hostEditPlayer.value,
        trait: ui.hostEditTrait.value,
        value: ui.hostEditValue.value,
        revealed: ui.hostEditRevealed.checked
    })));
    ui.hostRandomTrait.addEventListener("click", () => run(() => sendHostEdit({
        action: "random_trait",
        playerId: ui.hostEditPlayer.value,
        trait: ui.hostEditTrait.value,
        revealed: ui.hostEditRevealed.checked
    })));
    ui.hostApplyStatus.addEventListener("click", () => run(() => sendHostEdit({
        action: "set_status",
        playerId: ui.hostEditPlayer.value,
        status: ui.hostEditStatus.value
    })));
    ui.hostAddScenario.addEventListener("click", () => run(() => sendHostEdit({
        action: "add_scenario",
        scenarioType: ui.hostEditScenarioType.value,
        title: ui.hostEditScenarioTitle.value,
        description: ui.hostEditScenarioDescription.value
    })));
    ui.hostRandomScenario.addEventListener("click", () => run(() => sendHostEdit({
        action: "add_scenario",
        scenarioType: ui.hostEditScenarioType.value,
        random: true
    })));
    ui.hostSpecialCard.addEventListener("change", renderSpecialPreview);
    ui.hostAssignSpecial.addEventListener("click", () => run(() => sendHostEdit({
        action: "set_special",
        playerId: ui.hostSpecialPlayer.value,
        specialId: Number(ui.hostSpecialCard.value),
        revealed: ui.hostSpecialRevealed.checked
    })));
    ui.scenarioGrid.addEventListener("click", (event) => {
        const button = event.target.closest("[data-remove-scenario]");
        if (button) run(() => sendHostEdit({
            action: "remove_scenario",
            scenarioType: button.dataset.scenarioType,
            cardId: button.dataset.removeScenario
        }));
        const primary = event.target.closest("[data-remove-primary-scenario]");
        if (primary) run(() => sendHostEdit({
            action: "remove_primary_scenario",
            scenarioType: primary.dataset.removePrimaryScenario
        }));
    });

    ui.hostPlays.addEventListener("change", renderRoom);
    ui.playerCount.addEventListener("change", renderRoom);

    ui.playersList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-kick-player]");
        if (button) run(() => kickPlayer(button.dataset.kickPlayer));
    });
}

function initSpecialCatalog() {
    ui.hostSpecialCard.replaceChildren(...SPECIAL_CARDS.map((card) => {
        const option = document.createElement("option");
        option.value = String(card.id);
        option.textContent = `№${card.id} · ${specialCardTitle(card.text)}`;
        return option;
    }));
    renderSpecialPreview();
}

function specialCardTitle(text) {
    const title = String(text).split(":")[0].trim();
    return title.length <= 54 ? title : `${title.slice(0, 51)}…`;
}

function specialUsage(specialId) {
    const afterExile = [1, 11, 24, 30, 38];
    const beforeVoting = [46, 47, 48, 49, 51, 52, 57, 58, 65, 68, 69, 70];
    const roundStart = [59, 60, 61, 62, 63];
    const reaction = [50, 71];
    const targetPlayer = [2, 12, 16, 17, 18, 20, 21, 22, 23, 25, 27, 29, 38, 41, 42, 44, 45, 49, 55, 56, 67];
    const targetTrait = [26, 31, 56, 67];
    const targetScenario = [1, 3, 11, 64];
    const choice = [53, 57, 69];
    const timing = afterExile.includes(specialId)
        ? "после изгнания владельца"
        : beforeVoting.includes(specialId)
            ? "перед голосованием"
            : roundStart.includes(specialId)
                ? "в начале 2–4 раунда"
                : reaction.includes(specialId)
                    ? "сразу после чужой особой карты"
                    : specialId === 28
                        ? "во время или сразу после голосования"
                        : "после раскрытия карты";
    const inputs = [];
    if (targetPlayer.includes(specialId)) inputs.push("игрок");
    if (targetTrait.includes(specialId)) inputs.push("тип карты");
    if (targetScenario.includes(specialId)) inputs.push("карта бункера");
    if (choice.includes(specialId)) inputs.push("вариант эффекта");
    return { timing, inputs, targetPlayer, targetTrait, targetScenario, choice };
}

function renderSpecialPreview() {
    const card = SPECIAL_CARDS.find((item) => item.id === Number(ui.hostSpecialCard.value)) ?? SPECIAL_CARDS[0];
    const usage = specialUsage(card.id);
    ui.hostSpecialPreview.querySelector("strong").textContent = `№${card.id} · ${specialCardTitle(card.text)}`;
    ui.hostSpecialPreview.querySelector("span").textContent = card.text;
    ui.hostSpecialPreview.querySelector("small").textContent = `Когда: ${usage.timing}. ${usage.inputs.length ? `Нужно выбрать: ${usage.inputs.join(", ")}.` : "Дополнительный выбор не нужен."}`;
}

async function restoreRoom() {
    const savedRoom = localStorage.getItem(ROOM_STORAGE_KEY);
    if (!savedRoom) return;

    try {
        const roomCode = await joinRoom(savedRoom, readPlayerName());
        showConnectedRoom(roomCode);
        setStatus("Подключение восстановлено");
    } catch (error) {
        localStorage.removeItem(ROOM_STORAGE_KEY);
        showLobbyForm();
        ui.onlineError.textContent = `Не удалось вернуться в комнату: ${friendlyError(error)}`;
    }
}

function restorePlayerName() {
    const savedName = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    if (savedName) ui.onlineName.value = savedName;
    ui.hostName.value = ui.onlineName.value;
}

function readPlayerName() {
    const playerName = ui.onlineName.value.trim().replace(/\s+/g, " ").slice(0, 24) || "Игрок";
    ui.onlineName.value = playerName;
    ui.hostName.value = playerName;
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, playerName);
    return playerName;
}

async function createRoom(playerName, maxPlayers) {
    const roomCode = await multiplayer.createRoom(playerName, maxPlayers, null, GAME_TYPE);
    localStorage.setItem(ROOM_STORAGE_KEY, roomCode);
    connectToRoom();
    return roomCode;
}

async function joinRoom(roomCode, playerName) {
    const normalizedCode = await multiplayer.joinRoom(roomCode, playerName, null, GAME_TYPE);
    localStorage.setItem(ROOM_STORAGE_KEY, normalizedCode);
    connectToRoom();
    return normalizedCode;
}

function connectToRoom() {
    multiplayer.clearListeners();
    commandListenerStarted = false;
    commandQueue = Promise.resolve();
    hasSeenRoom = false;
    leavingRoom = false;

    multiplayer.subscribeRoom((roomState) => {
        if (hasSeenRoom && !roomState?.meta) {
            run(() => handleRoomUnavailable("Комната была закрыта ведущим."));
            return;
        }
        if (roomState?.meta) hasSeenRoom = true;
        if (hasSeenRoom && roomState?.players !== null && !roomState?.players?.[multiplayer.user.uid]) {
            run(() => handleRoomUnavailable("Ведущий удалил вас из комнаты."));
            return;
        }
        room = {
            meta: roomState?.meta ?? {},
            players: roomState?.players ?? {}
        };
        renderRoom();
    });

    multiplayer.subscribePublicState((state) => {
        publicState = state ?? null;
        renderGame();
    });

    multiplayer.subscribeHand((state) => {
        privateState = normalizePrivateState(state);
        renderPrivateState();
    });
}

function renderRoom() {
    if (!room?.meta?.hostId) return;

    showConnectedRoom(multiplayer.roomId);
    const entries = Object.entries(room.players ?? {});
    const host = isHost();
    const playing = room.meta.status !== "lobby";

    ui.modeHost.disabled = !host;
    ui.hostModeTab.hidden = !host;
    ui.startGame.hidden = !host || playing;
    ui.restartRoom.hidden = !host || !playing;
    ui.setupPanel.hidden = playing;
    ui.hostPlays.disabled = playing;
    ui.playerCount.disabled = playing;
    ui.bunkerCapacity.disabled = playing;

    if (host) {
        ui.modeHost.checked = true;
        startCommandListener();
    } else {
        ui.modePlayer.checked = true;
    }

    if (publicState?.phase) renderGame();
    else renderWaitingPlayers(entries);

    const participants = entries.filter(([id, player]) =>
        player.online !== false && (ui.hostPlays.checked || id !== room.meta.hostId));
    const expected = Number(ui.playerCount.value);
    ui.startGame.disabled = !host || playing || participants.length !== expected;
    if (publicState?.players) {
        ui.playersAlive.textContent = Object.values(publicState.players)
            .filter((player) => player.status === "active").length;
        ui.playersTotal.textContent = Object.keys(publicState.players).length;
    } else {
        ui.playersAlive.textContent = participants.length;
        ui.playersTotal.textContent = expected;
    }

    if (!playing) {
        setStatus(host
            ? `Лобби: ${participants.length}/${expected} игроков`
            : `В комнате ${entries.length} участников. Ждём ведущего.`);
    }
}

function renderWaitingPlayers(entries) {
    const waitingPlayers = Object.fromEntries(entries.map(([id, player]) => [id, {
        id,
        name: player.name,
        status: player.online === false ? "offline" : "active",
        revealedTraits: {}
    }]));
    renderRosters(waitingPlayers, [], -1);
    ui.activePlayerLabel.textContent = "Ожидание игроков";
}

function renderGame() {
    document.body.classList.toggle("has-game", Boolean(publicState?.phase));
    if (!publicState?.phase) {
        ui.votePanel.hidden = true;
        ui.hostEditor.hidden = true;
        ui.specialControls.hidden = true;
        ui.scenarioGrid.querySelectorAll(".scenario-card--extra").forEach((card) => card.remove());
        return;
    }

    const commandError = publicState.commandErrors?.[multiplayer?.user?.uid];
    if (commandError && Number(commandError.createdAt) > lastCommandErrorAt) {
        lastCommandErrorAt = Number(commandError.createdAt);
        ui.onlineError.textContent = commandError.message;
        setStatus(commandError.message);
    }

    const players = publicState.players ?? {};
    const activePlayers = Object.values(players).filter((player) => player.status === "active");
    ui.roundCurrent.textContent = Number(publicState.round ?? 0);
    ui.roundTotal.textContent = Number(publicState.totalRounds ?? 0);
    ui.playersAlive.textContent = activePlayers.length;
    ui.playersTotal.textContent = Object.keys(players).length;
    ui.roundPhase.textContent = getPhaseLabel(publicState.phase);
    ui.setupPanel.hidden = true;

    renderRosters(players, publicState.order ?? [], publicState.currentPlayerIndex ?? -1);
    renderScenarios();
    renderVoting();
    renderLog();
    renderControls();
    renderHostEditor();
    renderPrivateState();

    if (publicState.phase === PHASES.FINISHED) {
        setStatus(`Выжившие: ${activePlayers.map((player) => player.name).join(", ")}`);
    } else {
        setStatus(getPhaseLabel(publicState.phase));
    }
}

function renderRosters(players, order, currentIndex) {
    const entries = Object.entries(players);
    const currentId = currentIndex >= 0 ? order[currentIndex] : "";

    ui.playerRoster.replaceChildren(...entries.map(([id, player]) => {
        const row = document.createElement("p");
        const summary = document.createElement("span");
        const name = document.createElement("b");
        const traits = document.createElement("small");
        const status = document.createElement("em");
        const revealed = Object.entries(player.revealedTraits ?? {}).filter(([, value]) => value);
        name.textContent = player.name;
        traits.textContent = revealed.length
            ? revealed.map(([trait, value]) => `${TRAIT_LABELS[trait]}: ${value}`).join(" · ")
            : "Карты не раскрыты";
        status.textContent = playerStatus(player, id === currentId, id);
        summary.append(name, traits);
        row.append(summary, status);
        return row;
    }));

    ui.playersList.replaceChildren(...entries.map(([id, player], index) => {
        const row = ui.playerTemplate.content.firstElementChild.cloneNode(true);
        const revealed = Object.entries(player.revealedTraits ?? {}).filter(([, value]) => value);
        row.dataset.playerId = id;
        row.dataset.playerStatus = player.status;
        row.classList.toggle("is-active", id === currentId);
        row.classList.toggle("is-exiled", player.status === "exiled");
        row.querySelector(":scope > b").textContent = String(index + 1).padStart(2, "0");
        row.querySelector("strong").textContent = player.name;
        row.querySelector("small").textContent = revealed.length
            ? revealed.map(([trait, value]) => `${TRAIT_LABELS[trait]}: ${value}`).join(" · ")
            : "Карты не раскрыты";
        row.querySelector("em").textContent = playerStatus(player, id === currentId, id);
        if (isHost() && room?.meta?.status === "lobby" && id !== room.meta.hostId) {
            const kick = document.createElement("button");
            kick.type = "button";
            kick.className = "kick-player";
            kick.dataset.kickPlayer = id;
            kick.textContent = "Удалить";
            row.append(kick);
        }
        return row;
    }));

    const currentPlayer = players[currentId];
    ui.activePlayerLabel.textContent = currentPlayer ? `Ход: ${currentPlayer.name}` : getPhaseLabel(publicState?.phase);
}

function playerStatus(player, isCurrent, playerId) {
    if (player.status === "exiled") return "Изгнан";
    if (player.status === "offline" || room?.players?.[playerId]?.online === false) return "Не в сети";
    if (isCurrent) return "Ходит сейчас";
    return "В игре";
}

function renderPrivateState() {
    const myId = multiplayer?.user?.uid;
    const myPublicState = publicState?.players?.[myId];
    const myTurn = publicState?.phase === PHASES.REVEAL
        && publicState.order?.[publicState.currentPlayerIndex] === myId;

    for (const card of ui.characterTraits.querySelectorAll("[data-trait]")) {
        const trait = card.dataset.trait;
        const valueElement = card.querySelector("[data-trait-value]");
        const button = card.querySelector("button");
        const revealed = Boolean(myPublicState?.revealedTraits?.[trait]);
        valueElement.textContent = privateState?.[trait] || "Не назначено";
        card.classList.toggle("is-revealed", revealed);
        button.textContent = revealed ? "Раскрыто" : "Раскрыть";
        button.disabled = !myTurn || revealed || Boolean(myPublicState?.revealedThisTurn);
    }

    const hasHiddenTraits = TRAIT_KEYS.some((trait) => !myPublicState?.revealedTraits?.[trait]);
    const canFinish = myTurn && (Boolean(myPublicState?.revealedThisTurn) || !hasHiddenTraits);
    ui.finishTurn.disabled = !canFinish;
    ui.hostFinishTurn.disabled = !canFinish;
    ui.hostRevealTrait.disabled = !myTurn || !hasHiddenTraits || Boolean(myPublicState?.revealedThisTurn);
    ui.hostDossier.hidden = !isHost() || !myPublicState;

    const specialRevealed = Boolean(myPublicState?.revealedTraits?.special);
    const pendingShare = publicState?.pendingSecretShare?.targetId === myId
        ? publicState.pendingSecretShare
        : null;
    const pendingSpecial = publicState?.pendingSpecialChoice?.playerId === myId
        ? publicState.pendingSpecialChoice
        : null;
    renderSpecialChoiceOptions(pendingSpecial);
    const specialId = Number(privateState?.specialId ?? 0);
    const specialUi = specialUsage(specialId);
    ui.specialGuide.textContent = pendingShare
        ? "Выберите свою закрытую карту для обмена тайной информацией."
        : pendingSpecial
            ? "Выберите одну из двух предложенных карт бункера."
            : specialId
                ? `Карта №${specialId}. Использование: ${specialUi.timing}.${specialUi.inputs.length ? ` Выберите: ${specialUi.inputs.join(", ")}.` : " Дополнительный выбор не нужен."}`
                : "У этой карты нет автоматического эффекта: ведущий завершит её вручную.";
    ui.specialTargetPlayer.hidden = !specialUi.targetPlayer.includes(specialId) || Boolean(pendingShare);
    ui.specialTargetTrait.hidden = !(specialUi.targetTrait.includes(specialId) || pendingShare);
    ui.specialTargetScenario.hidden = !specialUi.targetScenario.includes(specialId);
    ui.specialChoice.hidden = !(specialUi.choice.includes(specialId) || pendingSpecial);
    ui.specialControls.hidden = !specialRevealed && !pendingShare;
    ui.playSpecial.disabled = (!specialRevealed || Boolean(myPublicState?.specialUsed)) && !pendingShare;
    ui.playSpecial.textContent = pendingShare
        ? "Поделиться выбранной закрытой картой"
        : myPublicState?.specialUsed
            ? "Особая карта использована"
            : pendingSpecial
                ? "Подтвердить выбранную карту"
                : "Разыграть особую карту";
    const selectedTarget = ui.specialTargetPlayer.value;
    ui.specialTargetPlayer.replaceChildren(...Object.entries(publicState?.players ?? {}).map(([id, player]) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${player.name}${id === myId ? " (вы)" : ""}`;
        return option;
    }));
    if (publicState?.players?.[selectedTarget]) ui.specialTargetPlayer.value = selectedTarget;
    renderSpecialScenarioOptions();
    renderSharedSecrets();

    for (const element of ui.hostTraits.querySelectorAll("[data-host-trait]")) {
        element.textContent = privateState?.[element.dataset.hostTrait] || "Не назначено";
    }
}

function renderSpecialScenarioOptions() {
    const selected = ui.specialTargetScenario.value;
    const options = [];
    if (publicState?.bunker?.status === "revealed") {
        options.push({ value: "primary:bunker", label: publicState.bunker.title });
    }
    for (const card of publicState?.extraScenarios?.bunker ?? []) {
        options.push({ value: `extra:bunker:${card.id}`, label: card.title });
    }
    ui.specialTargetScenario.replaceChildren(...options.map(({ value, label }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
    }));
    if (options.some((option) => option.value === selected)) ui.specialTargetScenario.value = selected;
}

function renderSharedSecrets() {
    const secrets = Object.values(privateState?.sharedSecrets ?? {});
    ui.sharedSecrets.hidden = !secrets.length;
    ui.sharedSecrets.replaceChildren(...secrets.map((secret) => {
        const row = document.createElement("p");
        const title = document.createElement("strong");
        title.textContent = `${secret.from}: ${TRAIT_LABELS[secret.trait] ?? secret.trait}`;
        row.append(title, document.createTextNode(` — ${secret.value}`));
        return row;
    }));
}

function renderSpecialChoiceOptions(pending) {
    const mode = pending ? "bunker-options" : "default";
    if (ui.specialChoice.dataset.mode === mode) return;
    ui.specialChoice.dataset.mode = mode;
    const options = pending?.options?.map((card) => ({ value: String(card.index), label: `${card.title} — ${card.description}` })) ?? [
        { value: "after", label: "Игроки после меня" },
        { value: "before", label: "Игроки передо мной" },
        { value: "younger", label: "Младше 33 лет" },
        { value: "older", label: "Старше 33 лет" },
        { value: "female", label: "Женщины" },
        { value: "male", label: "Мужчины" }
    ];
    ui.specialChoice.replaceChildren(...options.map(({ value, label }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
    }));
}

function renderScenarios() {
    for (const scenarioType of ["catastrophe", "bunker", "threat"]) {
        const scenario = publicState[scenarioType];
        const card = ui.scenarioCards[scenarioType];
        const button = ui.scenarioButtons[scenarioType];
        card.querySelector("[data-card-title]").textContent = scenario?.title || "Данные засекречены";
        card.querySelector("[data-card-description]").textContent = scenario?.description || "Данные засекречены.";
        button.hidden = !isHost() || scenario?.status === "revealed";
        card.querySelector("[data-remove-primary-scenario]")?.remove();
        if (isHost() && scenario?.status === "revealed") {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "scenario-card__remove";
            remove.dataset.removePrimaryScenario = scenarioType;
            remove.textContent = "Убрать карту";
            card.append(remove);
        }
    }

    ui.scenarioGrid.querySelectorAll(".scenario-card--extra").forEach((card) => card.remove());
    for (const [scenarioType, cards] of Object.entries(publicState.extraScenarios ?? {})) {
        for (const scenario of cards ?? []) {
            const card = document.createElement("article");
            card.className = `scenario-card scenario-card--extra${scenarioType === "catastrophe" ? " scenario-card--danger" : ""}`;
            const label = document.createElement("span");
            const title = document.createElement("h2");
            const description = document.createElement("p");
            label.className = "scenario-card__label";
            label.textContent = scenarioType === "catastrophe"
                ? "Катастрофа"
                : scenarioType === "threat"
                    ? "Угроза"
                    : scenarioType === "exile"
                        ? "У изгнанных"
                        : "Бункер";
            title.textContent = scenario.title;
            description.textContent = scenario.description;
            card.append(label, title, description);
            if (isHost()) {
                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "scenario-card__remove";
                remove.dataset.removeScenario = scenario.id;
                remove.dataset.scenarioType = scenarioType;
                remove.textContent = "Убрать карту";
                card.append(remove);
            }
            ui.scenarioGrid.append(card);
        }
    }
}

function renderHostEditor() {
    const host = isHost();
    ui.hostEditor.hidden = !host || !publicState?.phase;
    if (!host || !publicState?.phase) return;
    if (document.activeElement !== ui.hostEditCapacity) ui.hostEditCapacity.value = String(publicState.capacity);
    const selectedPlayer = ui.hostEditPlayer.value;
    ui.hostEditPlayer.replaceChildren(...Object.entries(publicState.players ?? {}).map(([id, player]) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = player.name;
        return option;
    }));
    if (publicState.players?.[selectedPlayer]) ui.hostEditPlayer.value = selectedPlayer;
    const selectedSpecialPlayer = ui.hostSpecialPlayer.value;
    ui.hostSpecialPlayer.replaceChildren(...Object.entries(publicState.players ?? {}).map(([id, player]) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = player.name;
        return option;
    }));
    if (publicState.players?.[selectedSpecialPlayer]) ui.hostSpecialPlayer.value = selectedSpecialPlayer;
    const current = publicState.players?.[ui.hostEditPlayer.value];
    if (current && document.activeElement !== ui.hostEditStatus) ui.hostEditStatus.value = current.status;
}

function renderVoting() {
    const players = publicState.players ?? {};
    const activeEntries = Object.entries(players).filter(([, player]) => player.status === "active");
    const isVoting = publicState.phase === PHASES.VOTING;
    const myPlayer = players[multiplayer?.user?.uid];
    const revoteCandidates = publicState.voteResult?.status === "tie"
        ? publicState.voteResult.candidates ?? []
        : [];

    ui.votePanel.hidden = ![PHASES.VOTING, PHASES.RESULTS, PHASES.FINISHED].includes(publicState.phase);
    ui.voteRoundLabel.textContent = `Раунд ${publicState.round}`;

    if (selectedVoteTarget && (!players[selectedVoteTarget] || (revoteCandidates.length && !revoteCandidates.includes(selectedVoteTarget)))) {
        selectedVoteTarget = "";
    }

    ui.voteList.replaceChildren(...activeEntries.map(([id, player]) => {
        const button = document.createElement("button");
        const name = document.createElement("span");
        const count = document.createElement("b");
        button.type = "button";
        button.dataset.voteTarget = id;
        button.classList.toggle("is-selected", id === selectedVoteTarget);
        button.disabled = !isVoting
            || player.immuneThisRound
            || Boolean(myPlayer?.cannotVoteAgainst?.[id])
            || Boolean(myPlayer?.forcedSelfVote && id !== multiplayer?.user?.uid)
            || (revoteCandidates.length > 0 && !revoteCandidates.includes(id));
        name.textContent = player.name;
        count.textContent = publicState.phase === PHASES.RESULTS
            ? String(publicState.voteResult?.counts?.[id] ?? 0)
            : player.voteSubmitted ? "✓" : "";
        button.append(name, count);
        return button;
    }));

    const canVote = myPlayer?.status === "active" || myPlayer?.persistentVoter;
    ui.confirmVote.disabled = !isVoting || !canVote || myPlayer.voteDisabled || !selectedVoteTarget;
    ui.voteStatus.textContent = voteStatusText(players);
}

function voteStatusText(players) {
    const result = publicState.voteResult;
    if (publicState.phase === PHASES.VOTING) {
        const activePlayers = Object.values(players).filter((player) => player.status === "active");
        const submitted = activePlayers.filter((player) => player.voteSubmitted).length;
        const progress = `Проголосовали: ${submitted}/${activePlayers.length}.`;
        if (result?.status === "tie") {
            const names = (result.candidates ?? []).map((id) => players[id]?.name).filter(Boolean);
            return `Переголосование: ${names.join(" или ")}. ${progress} Голос можно менять до закрытия.`;
        }
        return `Выберите кандидата. ${progress} Голос можно менять до закрытия голосования.`;
    }
    if (publicState.phase === PHASES.RESULTS && result?.status === "exiled") {
        return `${players[result.exiledPlayerId]?.name ?? "Игрок"} изгнан из группы.`;
    }
    if (publicState.phase === PHASES.RESULTS && result?.status === "tie") {
        return "Ничья. Ведущий должен начать переголосование.";
    }
    if (publicState.phase === PHASES.FINISHED) return "Состав бункера определён.";
    return "Голосование пока закрыто.";
}

function renderControls() {
    const host = isHost();
    const phase = publicState.phase;
    ui.nextPhase.hidden = !host || ![PHASES.DISCUSSION, PHASES.VOTING, PHASES.RESULTS].includes(phase);
    ui.nextPhase.disabled = !host;
    ui.nextPhase.textContent = phase === PHASES.DISCUSSION
        ? "Начать голосование →"
        : phase === PHASES.VOTING
            ? "Закрыть голосование →"
            : publicState.voteResult?.status === "tie"
                ? "Переголосовать →"
                : "Следующий раунд →";
}

function renderLog() {
    const events = Object.values(publicState.log ?? {}).sort((left, right) => left.createdAt - right.createdAt);
    ui.eventLog.replaceChildren(...events.map((event) => {
        const row = ui.logTemplate.content.firstElementChild.cloneNode(true);
        row.querySelector("time").textContent = new Date(event.createdAt).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit"
        });
        row.querySelector("span").textContent = event.message;
        return row;
    }));
}

async function revealNextHostTrait() {
    const myId = multiplayer.user.uid;
    const player = publicState?.players?.[myId];
    const trait = TRAIT_KEYS.find((key) => !player?.revealedTraits?.[key]);
    if (!trait) throw new Error("Все характеристики уже раскрыты.");
    await sendCommand("REVEAL_TRAIT", { trait });
}

async function startGame() {
    if (!room?.meta?.hostId) throw new Error("Сначала создайте комнату.");
    if (!isHost()) throw new Error("Начать игру может только ведущий.");

    const roomPlayers = Object.entries(room.players ?? {}).filter(([, player]) => player.online !== false);
    const players = ui.hostPlays.checked
        ? roomPlayers
        : roomPlayers.filter(([playerId]) => playerId !== room.meta.hostId);
    const expectedPlayers = Number(ui.playerCount.value);

    if (players.length !== expectedPlayers) {
        throw new Error(`Нужно ${expectedPlayers} игроков, сейчас подключено ${players.length}.`);
    }

    const capacity = Number(ui.bunkerCapacity.value);
    if (capacity >= players.length) throw new Error("Мест в бункере должно быть меньше, чем игроков.");

    const engine = createInitialGame(players, capacity);
    await saveEngine(engine);
    startCommandListener();
}

function startCommandListener() {
    if (!isHost() || commandListenerStarted) return;
    commandListenerStarted = true;
    multiplayer.listenForCommands((command, commandId) => {
        commandQueue = commandQueue
            .then(() => processCommand(command, commandId))
            .catch(handleError);
    });
}

async function processCommand(command, commandId) {
    try {
        const engine = await multiplayer.getEngine();
        if (!engine) return;
        if (!applyCommand(engine, command, room?.meta?.hostId)) return;
        await saveEngine(engine);
    } catch (error) {
        await multiplayer.reportCommandError(command.from, friendlyError(error));
        throw error;
    } finally {
        await multiplayer.removeCommand(commandId);
    }
}

async function saveEngine(engine) {
    const publicGame = createPublicState(engine);
    const privateStates = createPrivateStates(engine);
    assertFirebaseSafe(engine);
    assertFirebaseSafe(publicGame);
    assertFirebaseSafe(privateStates);
    await multiplayer.setGame(engine, publicGame, privateStates);
}

async function sendCommand(type, data = {}) {
    if (!multiplayer?.roomId) throw new Error("Сначала войдите в комнату.");
    await multiplayer.sendCommand(type, data, Number(publicState?.revision ?? 0));
}

async function sendHostEdit(data) {
    if (!isHost()) throw new Error("Редактор доступен только ведущему.");
    await sendCommand("HOST_EDIT", data);
}

async function playOrRespondSpecial() {
    const data = {
        targetId: ui.specialTargetPlayer.value,
        trait: ui.specialTargetTrait.value,
        scenarioTarget: ui.specialTargetScenario.value,
        choice: ui.specialChoice.value
    };
    const type = publicState?.pendingSecretShare?.targetId === multiplayer?.user?.uid
        ? "RESPOND_SECRET_SHARE"
        : "PLAY_SPECIAL";
    await sendCommand(type, data);
}

function selectVoteTarget(playerId) {
    selectedVoteTarget = playerId;
    renderVoting();
}

function normalizePrivateState(state) {
    return state && typeof state === "object" && !Array.isArray(state) ? state : {};
}

function isHost() {
    return Boolean(room?.meta?.hostId && multiplayer?.user?.uid === room.meta.hostId);
}

function getPhaseLabel(phase) {
    return {
        [PHASES.LOBBY]: "Ожидание игроков",
        [PHASES.REVEAL]: "Раскрытие карт",
        [PHASES.DISCUSSION]: "Обсуждение",
        [PHASES.VOTING]: "Голосование",
        [PHASES.RESULTS]: "Результаты",
        [PHASES.FINISHED]: "Игра завершена"
    }[phase] ?? "Неизвестная фаза";
}

function lockHostInterface() {
    ui.modeHost.disabled = true;
    ui.hostModeTab.hidden = true;
    ui.startGame.hidden = true;
    setConnectionControlsDisabled(true);
}

function showConnectedRoom(roomCode) {
    document.body.classList.add("is-connected");
    ui.roomCodeOutput.textContent = roomCode;
    ui.roomInfo.hidden = false;
    ui.lobbyForm.hidden = true;
    ui.onlineError.textContent = "";
}

function showLobbyForm() {
    document.body.classList.remove("is-connected", "has-game");
    ui.roomInfo.hidden = true;
    ui.lobbyForm.hidden = false;
}

function setConnectionControlsDisabled(disabled) {
    ui.createRoomButton.disabled = disabled;
    ui.joinRoomButton.disabled = disabled;
    ui.onlineName.disabled = disabled;
    ui.roomCodeInput.disabled = disabled;
}

async function copyRoomCode() {
    if (!multiplayer?.roomId) return;
    await navigator.clipboard.writeText(multiplayer.roomId);
    const original = ui.roomCodeOutput.textContent;
    ui.roomCodeOutput.textContent = "Скопировано";
    setTimeout(() => { ui.roomCodeOutput.textContent = original; }, 900);
}

async function kickPlayer(playerId) {
    const playerName = room?.players?.[playerId]?.name ?? "игрока";
    if (!window.confirm(`Удалить ${playerName} из комнаты?`)) return;
    await multiplayer.removePlayer(playerId);
}

async function leaveCurrentRoom() {
    if (!multiplayer?.roomId) return;
    const host = isHost();
    const message = host
        ? "Закрыть комнату для всех участников?"
        : "Выйти из комнаты?";
    if (!window.confirm(message)) return;
    if (host) await multiplayer.deleteRoom();
    else await multiplayer.leave();
    localStorage.removeItem(ROOM_STORAGE_KEY);
    room = null;
    publicState = null;
    privateState = {};
    selectedVoteTarget = "";
    commandListenerStarted = false;
    lockHostInterface();
    showLobbyForm();
    setConnectionControlsDisabled(false);
    setStatus("Ожидание подключения");
}

async function handleRoomUnavailable(message) {
    if (leavingRoom) return;
    leavingRoom = true;
    try {
        await multiplayer.leave();
    } catch (error) {
        console.warn("Не удалось полностью закрыть подключение к комнате:", error);
    }
    localStorage.removeItem(ROOM_STORAGE_KEY);
    room = null;
    publicState = null;
    privateState = {};
    commandListenerStarted = false;
    lockHostInterface();
    showLobbyForm();
    setConnectionControlsDisabled(false);
    ui.onlineError.textContent = message;
    setStatus(message);
}

async function resetCurrentGame() {
    if (!isHost()) throw new Error("Сбросить партию может только ведущий.");
    if (!window.confirm("Завершить текущую партию и вернуться в лобби?")) return;
    await multiplayer.resetGame();
    publicState = null;
    privateState = {};
    selectedVoteTarget = "";
    document.body.classList.remove("has-game");
    setStatus("Лобби открыто для новой партии");
}

function setStatus(message) {
    ui.status.textContent = message;
}

function handleError(error) {
    console.error(error);
    const message = friendlyError(error);
    ui.onlineError.textContent = message;
    setStatus(message);
}

function friendlyError(error) {
    if (error?.code === "auth/operation-not-allowed") return "В Firebase нужно включить анонимную авторизацию.";
    if (error?.code === "PERMISSION_DENIED") return "Firebase отклонил запрос. Проверьте опубликованные правила базы.";
    return error?.message ?? "Произошла неизвестная ошибка.";
}

async function run(action) {
    ui.onlineError.textContent = "";
    try {
        await action();
    } catch (error) {
        handleError(error);
    }
}
