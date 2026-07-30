import { firebaseConfig, isFirebaseConfigured } from "../../firebase-config.js";
import { LocalMultiplayer } from "./local-multiplayer.js";
import {
    GAME_TYPE,
    PHASES,
    TRAIT_KEYS,
    TRAIT_LABELS,
    applyCommand,
    assertFirebaseSafe,
    createInitialGame,
    createPrivateStates,
    createPublicState,
    getSpecialAvailability
} from "./engine.js";
import { SPECIAL_CARDS } from "./cards.js";
import {
    fillWithDeveloperBots,
    getDeveloperBotCommands,
    isDeveloperBot
} from "./bots.js";

const ROOM_STORAGE_KEY = "eulennest-bunker-room";
const PLAYER_NAME_STORAGE_KEY = "eulennest-player-name";
const IS_FILE_MODE = window.location.protocol === "file:";

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
    playerCount: select("#player-count"),
    bunkerCapacity: select("#bunker-capacity"),
    hostPlays: select("#host-plays"),
    developerMode: select("#developer-mode"),
    roundDrawer: select("#round-drawer"),
    roundDrawerToggle: select("#round-drawer-toggle"),
    roundDrawerClose: select("#round-drawer-close"),
    roundDrawerBackdrop: select("#round-drawer-backdrop"),
    roundToggleCurrent: select("#round-toggle-current"),
    roundToggleTotal: select("#round-toggle-total"),
    roundTogglePhase: select("#round-toggle-phase"),
    roundProgress: select("#round-progress"),
    roundCurrent: select("#round-current"),
    roundTotal: select("#round-total"),
    roundPhase: select("#round-phase"),
    playersAlive: select("#players-alive"),
    playersTotal: select("#players-total"),
    bunkerSlots: select("#bunker-slots"),
    skipTurn: select("#skip-turn"),
    nextPhase: select("#next-phase"),
    turnPanel: select("#turn-panel"),
    turnKicker: select("#turn-kicker"),
    turnTitle: select("#turn-title"),
    turnDescription: select("#turn-description"),
    finishTurn: select("#finish-turn"),
    characterTraits: select("#character-traits"),
    specialControls: select("#special-controls"),
    specialGuide: select("#special-guide"),
    specialTargetPlayer: select("#special-target-player"),
    specialTargetTrait: select("#special-target-trait"),
    specialTargetScenario: select("#special-target-scenario"),
    specialChoice: select("#special-choice"),
    playSpecial: select("#play-special"),
    secretShareResponse: select("#secret-share-response"),
    secretShareTrait: select("#secret-share-trait"),
    respondSecretShare: select("#respond-secret-share"),
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
    },
    threatResolutionStatus: select("#threat-resolution-status"),
    threatResolutionActions: select("#threat-resolution-actions"),
    threatSurvived: select("#threat-survived"),
    threatNonlethalFailed: select("#threat-nonlethal-failed"),
    threatFailed: select("#threat-failed")
};

let multiplayer = null;
let room = null;
let publicState = null;
let privateState = {};
let selectedVoteTarget = "";
let selectedBunkerVoteTarget = "";
let commandListenerStarted = false;
let commandQueue = Promise.resolve();
let hasSeenRoom = false;
let leavingRoom = false;
let lastCommandErrorAt = 0;
let botActionTimer = 0;
let botActionRevision = -1;

init();

async function init() {
    initSpecialCatalog();
    lockHostInterface();
    mountRoundDrawer();
    bindEvents();
    configureFileMode();
    ui.roundDrawer.inert = true;

    if (!IS_FILE_MODE && !isFirebaseConfigured) {
        setConnectionControlsDisabled(true);
        handleError(new Error("Firebase не настроен."));
        return;
    }

    try {
        const MultiplayerClass = await loadMultiplayerClass();
        multiplayer = new MultiplayerClass(firebaseConfig);
        await multiplayer.connect();
        restorePlayerName();
        setConnectionControlsDisabled(false);
        setStatus(IS_FILE_MODE ? "Локальный режим · без Firebase" : "Готов к подключению");
        await restoreRoom();
    } catch (error) {
        handleError(error);
    }
}

function mountRoundDrawer() {
    document.body.append(ui.roundDrawerBackdrop, ui.roundDrawer);
}

function configureFileMode() {
    if (!IS_FILE_MODE) return;
    document.body.classList.add("is-local-file");
    ui.createRoomButton.textContent = "Создать локальную игру";
    ui.joinRoomButton.hidden = true;
    ui.roomCodeInput.closest("label").hidden = true;
    ui.hostPlays.checked = true;
    ui.developerMode.checked = true;
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
        ui.roomCodeInput.value = normalizeRoomId(ui.roomCodeInput.value);
    });

    ui.roomCodeInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") ui.joinRoomButton.click();
    });

    ui.roomCodeOutput.addEventListener("click", () => run(copyRoomCode));
    ui.leaveRoom.addEventListener("click", () => run(leaveCurrentRoom));
    ui.restartRoom.addEventListener("click", () => run(resetCurrentGame));
    ui.startGame.addEventListener("click", () => run(startGame));
    ui.roundDrawerToggle.addEventListener("click", () => setRoundDrawer(true));
    ui.roundDrawerClose.addEventListener("click", () => setRoundDrawer(false));
    ui.roundDrawerBackdrop.addEventListener("click", () => setRoundDrawer(false));
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && document.body.classList.contains("round-drawer-open")) {
            setRoundDrawer(false);
        }
    });
    ui.skipTurn.addEventListener("click", () => run(() => sendCommand(
        publicState?.pendingSecretShare || publicState?.pendingSpecialChoice
            ? "CANCEL_PENDING"
            : "SKIP_TURN"
    )));
    ui.nextPhase.addEventListener("click", () => run(() => sendCommand(
        publicState?.pendingSecretShare || publicState?.pendingSpecialChoice
            ? "CANCEL_PENDING"
            : "NEXT_PHASE"
    )));
    ui.finishTurn.addEventListener("click", () => run(() => sendCommand("FINISH_TURN")));
    ui.hostFinishTurn.addEventListener("click", () => run(() => sendCommand("FINISH_TURN")));

    ui.characterTraits.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action='reveal-trait']");
        const trait = button?.closest("[data-trait]")?.dataset.trait;
        if (trait) run(() => sendCommand("REVEAL_TRAIT", { trait }));
    });

    ui.hostTraits.addEventListener("click", (event) => {
        const button = event.target.closest("[data-host-reveal-trait]");
        if (!button || button.disabled) return;
        run(() => sendCommand("REVEAL_TRAIT", { trait: button.dataset.hostRevealTrait }));
    });

    ui.voteList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-vote-target]");
        if (button && !button.disabled) selectVoteTarget(button.dataset.voteTarget);
    });

    ui.confirmVote.addEventListener("click", () => {
        if (selectedVoteTarget) run(() => sendCommand("VOTE", { targetId: selectedVoteTarget }));
    });
    ui.playSpecial.addEventListener("click", () => run(playOrRespondSpecial));
    ui.respondSecretShare.addEventListener("click", () => run(() =>
        sendCommand("RESPOND_SECRET_SHARE", { trait: ui.secretShareTrait.value })
    ));
    ui.specialTargetPlayer.addEventListener("change", renderPrivateState);

    for (const [scenarioType, button] of Object.entries(ui.scenarioButtons)) {
        button.addEventListener("click", () => run(() => sendCommand("REVEAL_SCENARIO", { scenarioType })));
    }
    ui.threatSurvived.addEventListener("click", () => {
        if (window.confirm("Подтвердить, что финалисты справились со всеми угрозами?")) {
            run(() => sendCommand("RESOLVE_THREAT", { outcome: "survived" }));
        }
    });
    ui.threatNonlethalFailed.addEventListener("click", () => {
        if (window.confirm("Подтвердить, что смертельные угрозы устранены, но домового не поймали? Финалисты потеряют багаж.")) {
            run(() => sendCommand("RESOLVE_THREAT", { outcome: "nonlethal_failed" }));
        }
    });
    ui.threatFailed.addEventListener("click", () => {
        const onlyNonlethal = Number(publicState?.threatResolution?.lethalThreatCount ?? 0) === 0
            && Number(publicState?.threatResolution?.nonlethalThreatCount ?? 0) > 0;
        const message = onlyNonlethal
            ? "Подтвердить, что домового не поймали? Финалисты потеряют багаж, но останутся живы."
            : "Завершить партию поражением бункера?";
        if (window.confirm(message)) {
            run(() => sendCommand("RESOLVE_THREAT", { outcome: "failed" }));
        }
    });

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
        const bunkerVote = event.target.closest("[data-bunker-vote-submit]");
        if (bunkerVote && !bunkerVote.disabled) {
            const controls = bunkerVote.closest("[data-bunker-vote-controls]");
            const targetId = controls?.querySelector("[data-bunker-vote-target]")?.value;
            if (targetId) run(() => sendCommand("BUNKER_VOTE", { targetId }));
            return;
        }
        const resolveBunkerVote = event.target.closest("[data-bunker-vote-resolve]");
        if (resolveBunkerVote && !resolveBunkerVote.disabled) {
            run(() => sendCommand("RESOLVE_BUNKER_VOTE"));
            return;
        }
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
    ui.scenarioGrid.addEventListener("change", (event) => {
        const select = event.target.closest("[data-bunker-vote-target]");
        if (select) selectedBunkerVoteTarget = select.value;
    });

    ui.hostPlays.addEventListener("change", () => run(syncRoomSettings));
    ui.developerMode.addEventListener("change", () => run(syncRoomSettings));
    ui.playerCount.addEventListener("change", () => run(syncRoomSettings));
    ui.bunkerCapacity.addEventListener("change", () => run(syncRoomSettings));

    ui.playersList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-kick-player]");
        if (button) run(() => kickPlayer(button.dataset.kickPlayer));
    });
}

async function loadMultiplayerClass() {
    if (IS_FILE_MODE) return LocalMultiplayer;
    const onlineModulePath = "../../modules/" + "Multiplayer.js";
    return (await import(onlineModulePath)).Multiplayer;
}

function normalizeRoomId(value) {
    return IS_FILE_MODE
        ? LocalMultiplayer.normalizeRoomId(value)
        : String(value ?? "").toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
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
    const currentVoting = [4, 12, 20, 53];
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
            : currentVoting.includes(specialId)
                ? "до завершения текущего голосования"
            : roundStart.includes(specialId)
                ? "в начале 2–4 раунда"
                : reaction.includes(specialId)
                    ? "сразу после чужой особой карты"
                    : specialId === 28
                        ? "во время или сразу после голосования"
                        : specialId === 26
                            ? "во время раскрытия характеристик"
                            : "в любой момент, пока владелец в игре";
    const inputs = [];
    if (targetPlayer.includes(specialId)) inputs.push("игрок");
    if (targetTrait.includes(specialId)) inputs.push("тип карты");
    if (targetScenario.includes(specialId)) inputs.push("карта бункера");
    if (choice.includes(specialId)) inputs.push("вариант эффекта");
    return { timing, inputs, targetPlayer, targetTrait, targetScenario, choice };
}

function currentSpecialUsage(specialId) {
    const usage = specialUsage(specialId);
    if (specialId !== 50) return usage;
    const inputTypes = publicState?.lastSpecial?.inputTypes ?? [];
    const targetPlayer = inputTypes.includes("targetId") ? [50] : [];
    const targetTrait = inputTypes.includes("trait") ? [50] : [];
    const targetScenario = inputTypes.includes("scenarioTarget") ? [50] : [];
    const choice = inputTypes.includes("choice") ? [50] : [];
    const inputs = [];
    if (targetPlayer.length) inputs.push("нового игрока");
    if (targetTrait.length) inputs.push("новый тип карты");
    if (targetScenario.length) inputs.push("новую карту бункера");
    if (choice.length) inputs.push("новый вариант эффекта");
    return { ...usage, inputs, targetPlayer, targetTrait, targetScenario, choice };
}

function renderSpecialPreview() {
    const card = SPECIAL_CARDS.find((item) => item.id === Number(ui.hostSpecialCard.value)) ?? SPECIAL_CARDS[0];
    const usage = specialUsage(card.id);
    ui.hostSpecialPreview.querySelector("strong").textContent = `№${card.id} · ${specialCardTitle(card.text)}`;
    ui.hostSpecialPreview.querySelector("span").textContent = card.text;
    ui.hostSpecialPreview.querySelector("small").textContent = `Условие применения: ${usage.timing}. ${usage.inputs.length ? `Нужно выбрать: ${usage.inputs.join(", ")}.` : "Дополнительный выбор не нужен."}`;
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
}

function readPlayerName() {
    const playerName = ui.onlineName.value.trim().replace(/\s+/g, " ").slice(0, 24) || "Игрок";
    ui.onlineName.value = playerName;
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, playerName);
    return playerName;
}

async function createRoom(playerName, maxPlayers) {
    const roomCode = await multiplayer.createRoom(playerName, maxPlayers, null, GAME_TYPE);
    await multiplayer.setRoomSettings(readRoomSettingsFromControls());
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
    resetDeveloperBotScheduler();
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
        if (botActionTimer && shouldDelayForHumanReaction()) {
            window.clearTimeout(botActionTimer);
            botActionTimer = 0;
            botActionRevision = -1;
            scheduleDeveloperBots();
        }
    });
}

function renderRoom() {
    if (!room?.meta?.hostId) return;

    showConnectedRoom(multiplayer.roomId);
    const entries = Object.entries(room.players ?? {});
    const host = isHost();
    const playing = room.meta.status !== "lobby";
    const settings = getRoomSettings();

    ui.playerCount.value = String(settings.playerCount);
    ui.bunkerCapacity.value = String(settings.bunkerCapacity);
    ui.hostPlays.checked = settings.hostPlays;
    ui.developerMode.checked = settings.developerMode;

    ui.modeHost.disabled = !host;
    ui.hostModeTab.hidden = !host;
    ui.startGame.hidden = !host || playing;
    ui.restartRoom.hidden = !host || !playing;
    ui.setupPanel.hidden = playing;
    ui.hostPlays.disabled = !host || playing;
    ui.developerMode.disabled = !host || playing;
    ui.playerCount.disabled = !host || playing;
    ui.bunkerCapacity.disabled = !host || playing;
    if (host && playing && publicState?.players) {
        ui.hostPlays.checked = Boolean(publicState.players[room.meta.hostId]);
    }
    document.body.classList.toggle("host-is-player", host && Boolean(publicState?.players?.[room.meta.hostId]));

    if (host) {
        ui.modeHost.checked = true;
        startCommandListener();
    } else {
        ui.modePlayer.checked = true;
    }

    if (publicState?.phase) renderGame();
    else renderWaitingPlayers(entries);

    const humanParticipants = entries.filter(([id, player]) =>
        player.online !== false && (settings.hostPlays || id !== room.meta.hostId));
    const participants = settings.developerMode
        ? fillWithDeveloperBots(humanParticipants, settings.playerCount)
        : humanParticipants;
    const expected = settings.playerCount;
    ui.startGame.disabled = !host || playing
        || humanParticipants.length > expected
        || (!settings.developerMode && participants.length !== expected);
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
            : `Лобби: ${participants.length}/${expected} игроков. Ждём ведущего.`);
    }
}

function getRoomSettings() {
    const settings = room?.meta?.settings ?? {};
    return {
        playerCount: normalizeRoomNumber(settings.playerCount, 8, 6, 15),
        bunkerCapacity: normalizeRoomNumber(settings.bunkerCapacity, 4, 3, 7),
        hostPlays: settings.hostPlays === true,
        developerMode: settings.developerMode === true
    };
}

function readRoomSettingsFromControls() {
    return {
        playerCount: normalizeRoomNumber(ui.playerCount.value, 8, 6, 15),
        bunkerCapacity: normalizeRoomNumber(ui.bunkerCapacity.value, 4, 3, 7),
        hostPlays: ui.hostPlays.checked,
        developerMode: ui.developerMode.checked
    };
}

function normalizeRoomNumber(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isInteger(number) && number >= minimum && number <= maximum
        ? number
        : fallback;
}

async function syncRoomSettings() {
    if (!isHost() || room?.meta?.status !== "lobby") return;
    await multiplayer.setRoomSettings(readRoomSettingsFromControls());
}

function renderWaitingPlayers(entries) {
    const settings = getRoomSettings();
    const participants = entries.filter(([id, player]) =>
        player.online !== false && (settings.hostPlays || id !== room.meta.hostId));
    const waitingEntries = settings.developerMode
        ? fillWithDeveloperBots(participants, settings.playerCount)
        : entries;
    const waitingPlayers = Object.fromEntries(waitingEntries.map(([id, player]) => [id, {
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
        document.body.classList.remove("has-pending-bunker-vote");
        setRoundDrawer(false, false);
        ui.eventLog.replaceChildren();
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
    const bunkerVotePending = Boolean(publicState.pendingBunkerVote);
    if (!bunkerVotePending) selectedBunkerVoteTarget = "";
    const hostIsPlayer = isHost() && Boolean(players[room?.meta?.hostId]);
    document.body.classList.toggle("host-is-player", hostIsPlayer);
    document.body.classList.toggle("has-pending-bunker-vote", bunkerVotePending);
    if (isHost() && room?.meta?.status !== "lobby") ui.hostPlays.checked = hostIsPlayer;
    ui.roundCurrent.textContent = Number(publicState.round ?? 0);
    ui.roundTotal.textContent = Number(publicState.totalRounds ?? 0);
    ui.roundToggleCurrent.textContent = Number(publicState.round ?? 0);
    ui.roundToggleTotal.textContent = Number(publicState.totalRounds ?? 0);
    ui.playersAlive.textContent = activePlayers.length;
    ui.playersTotal.textContent = Object.keys(players).length;
    ui.bunkerSlots.textContent = Number(publicState.capacity ?? 0);
    const visiblePhase = bunkerVotePending ? bunkerVoteTitle(publicState.pendingBunkerVote) : getPhaseLabel(publicState.phase);
    ui.roundPhase.textContent = visiblePhase;
    ui.roundTogglePhase.textContent = visiblePhase;
    ui.setupPanel.hidden = true;

    renderRosters(players, publicState.order ?? [], publicState.currentPlayerIndex ?? -1);
    renderScenarios();
    renderVoting();
    renderLog();
    renderControls();
    renderRoundProgress();
    renderHostEditor();
    renderPrivateState();
    scheduleDeveloperBots();

    if (publicState.phase === PHASES.FINISHED) {
        setStatus(publicState.threatResolution?.status === "failed"
            ? "Финальная угроза не устранена — бункер не выжил"
            : `Бункер выжил: ${activePlayers.map((player) => player.name).join(", ")}`);
    } else {
        setStatus(getStatusMessage());
    }
}

function renderRoundProgress() {
    const currentRound = Number(publicState?.round ?? 0);
    const totalRounds = Math.max(currentRound, Number(publicState?.totalRounds ?? 0));
    const finalStage = [PHASES.THREAT, PHASES.FINISHED].includes(publicState?.phase);
    const items = Array.from({ length: totalRounds }, (_, index) => {
        const round = index + 1;
        const item = document.createElement("li");
        const number = document.createElement("b");
        const label = document.createElement("span");
        const status = document.createElement("small");
        const complete = round < currentRound || (finalStage && round === currentRound);
        const current = round === currentRound && !finalStage;
        number.textContent = String(round).padStart(2, "0");
        label.textContent = `Раунд ${round}`;
        status.textContent = complete ? "Пройден" : current ? getPhaseLabel(publicState.phase) : "Ожидает";
        item.classList.toggle("is-complete", complete);
        item.classList.toggle("is-current", current);
        if (current) item.setAttribute("aria-current", "step");
        item.append(number, label, status);
        return item;
    });

    const resolution = publicState?.threatResolution;
    if (resolution) {
        const item = document.createElement("li");
        const number = document.createElement("b");
        const label = document.createElement("span");
        const status = document.createElement("small");
        const pending = publicState.phase === PHASES.THREAT && resolution.status === "pending";
        const failed = resolution.status === "failed";
        number.textContent = "!";
        label.textContent = "Финальная угроза";
        status.textContent = pending
            ? "Активна"
            : failed
                ? "Не пройдена"
                : Number(resolution.threatCount ?? 0) > 0
                    ? "Устранена"
                    : "Угроз нет";
        item.classList.toggle("is-current", pending);
        item.classList.toggle("is-complete", resolution.status === "survived");
        item.classList.toggle("is-failed", failed);
        if (pending) item.setAttribute("aria-current", "step");
        item.append(number, label, status);
        items.push(item);
    }

    ui.roundProgress.replaceChildren(...items);
}

function renderRosters(players, order, currentIndex) {
    const entries = Object.entries(players);
    const currentId = currentIndex >= 0 ? order[currentIndex] : "";

    ui.playerRoster.replaceChildren(...entries.map(([id, player]) => {
        const row = document.createElement("p");
        const isCurrent = id === currentId;
        const summary = document.createElement("span");
        const name = document.createElement("b");
        const traits = document.createElement("small");
        const status = document.createElement("em");
        const revealed = Object.entries(player.revealedTraits ?? {}).filter(([, value]) => value);
        const shuffleLabel = currentTraitShuffleLabel(id);
        name.textContent = player.name;
        traits.textContent = revealed.length
            ? revealed.map(([trait, value]) => `${TRAIT_LABELS[trait]}: ${value}`).join(" · ")
            : "Карты не раскрыты";
        status.textContent = playerStatus(player, id === currentId, id);
        summary.append(name, traits);
        if (shuffleLabel) summary.append(createTraitShuffleBadge(shuffleLabel));
        row.append(summary, status);
        row.classList.toggle("is-current-turn", isCurrent);
        row.classList.toggle("is-dead", player.status === "dead");
        row.classList.toggle("is-bunker-king", Boolean(player.bunkerKing));
        row.classList.toggle("has-trait-shuffle", Boolean(shuffleLabel));
        if (isCurrent) row.setAttribute("aria-current", "true");
        return row;
    }));

    ui.playersList.replaceChildren(...entries.map(([id, player], index) => {
        const row = ui.playerTemplate.content.firstElementChild.cloneNode(true);
        const revealed = Object.entries(player.revealedTraits ?? {}).filter(([, value]) => value);
        const shuffleLabel = currentTraitShuffleLabel(id);
        row.dataset.playerId = id;
        row.dataset.playerStatus = player.status;
        row.classList.toggle("is-active", id === currentId);
        row.classList.toggle("is-exiled", player.status === "exiled");
        row.classList.toggle("is-dead", player.status === "dead");
        row.classList.toggle("is-bunker-king", Boolean(player.bunkerKing));
        row.classList.toggle("is-bot", isDeveloperBot(id));
        row.querySelector(":scope > b").textContent = String(index + 1).padStart(2, "0");
        row.querySelector("strong").textContent = player.name;
        row.querySelector("small").textContent = revealed.length
            ? revealed.map(([trait, value]) => `${TRAIT_LABELS[trait]}: ${value}`).join(" · ")
            : "Карты не раскрыты";
        row.querySelector("em").textContent = playerStatus(player, id === currentId, id);
        row.classList.toggle("has-trait-shuffle", Boolean(shuffleLabel));
        if (shuffleLabel) row.querySelector(":scope > span").append(createTraitShuffleBadge(shuffleLabel));
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
    ui.activePlayerLabel.classList.toggle("has-active-turn", Boolean(currentPlayer));
}

function currentTraitShuffleLabel(playerId) {
    const shuffle = publicState?.lastTraitShuffle;
    if (
        !shuffle
        || Number(shuffle.round) !== Number(publicState?.round)
        || !(shuffle.affectedIds ?? []).includes(playerId)
    ) {
        return "";
    }
    return `Перераздано: ${TRAIT_LABELS[shuffle.trait] ?? "открытая карта"}`;
}

function createTraitShuffleBadge(label) {
    const badge = document.createElement("span");
    badge.className = "trait-shuffle-badge";
    badge.textContent = `↻ ${label}`;
    return badge;
}

function playerStatus(player, isCurrent, playerId) {
    const king = player.bunkerKing ? "Царь · " : "";
    if (player.status === "dead") return `${king}Погиб`;
    if (player.status === "exiled") {
        const canStillVote = playerId === publicState?.lastExiledPlayerId || player.persistentVoter;
        return canStillVote ? `${king}Изгнан · право голоса` : `${king}Изгнан`;
    }
    if (player.status === "offline" || room?.players?.[playerId]?.online === false) return `${king}Не в сети`;
    if (isCurrent) return `${king}Ходит сейчас`;
    return `${king}В игре`;
}

function renderPrivateState() {
    const myId = multiplayer?.user?.uid;
    const myPublicState = publicState?.players?.[myId];
    const bunkerVotePending = Boolean(publicState?.pendingBunkerVote);
    const myTurn = !bunkerVotePending
        && publicState?.phase === PHASES.REVEAL
        && publicState.order?.[publicState.currentPlayerIndex] === myId;

    const currentPlayerId = publicState?.order?.[publicState.currentPlayerIndex];
    const currentPlayer = currentPlayerId ? publicState?.players?.[currentPlayerId] : null;
    const revealPhase = publicState?.phase === PHASES.REVEAL;
    const requiredTrait = publicState?.requiredTrait;
    const ordinaryTraitKeys = TRAIT_KEYS.filter((trait) => trait !== "special");
    const revealedOrdinaryCount = ordinaryTraitKeys.filter((trait) =>
        myPublicState?.revealedTraits?.[trait]).length;
    const ordinaryRevealLimitReached =
        revealedOrdinaryCount >= ordinaryTraitKeys.length - 1;
    const mustRevealRequiredTrait = Boolean(
        requiredTrait
        && myPublicState
        && !myPublicState.revealedTraits?.[requiredTrait]
        && !ordinaryRevealLimitReached
    );

    ui.turnPanel.classList.toggle("is-my-turn", myTurn);
    ui.turnPanel.classList.toggle("is-waiting-turn", revealPhase && !myTurn);

    if (bunkerVotePending) {
        ui.turnKicker.textContent = "Карта бункера";
        ui.turnTitle.textContent = bunkerVoteTitle(publicState.pendingBunkerVote);
        ui.turnDescription.textContent = "Откройте детали партии и завершите действие этой карты.";
    } else if (myTurn) {
        ui.turnKicker.textContent = "Сейчас ваш ход";
        ui.turnTitle.textContent = ordinaryRevealLimitReached
            ? "Пять характеристик раскрыты"
            : mustRevealRequiredTrait
            ? `Раскройте: ${TRAIT_LABELS[requiredTrait]}`
            : "Раскройте одну характеристику";
        ui.turnDescription.textContent = ordinaryRevealLimitReached
            ? "Оставьте последнюю обычную карту скрытой и завершите ход."
            : mustRevealRequiredTrait
            ? "Особая карта задала характеристику для всех игроков в этом раунде."
            : "Выберите характеристику ниже, затем завершите ход.";
    } else if (revealPhase && currentPlayer) {
        ui.turnKicker.textContent = "Сейчас ходит";
        ui.turnTitle.textContent = currentPlayer.name;
        ui.turnDescription.textContent = "Дождитесь своего хода. Активный игрок должен раскрыть характеристику.";
    } else {
        ui.turnKicker.textContent = "Текущая фаза";
        ui.turnTitle.textContent = getPhaseLabel(publicState?.phase);
        ui.turnDescription.textContent = "Следите за состоянием игры и указаниями ведущего.";
    }

    for (const card of ui.characterTraits.querySelectorAll("[data-trait]")) {
        const trait = card.dataset.trait;
        const isSpecial = trait === "special";
        const valueElement = card.querySelector("[data-trait-value]");
        const button = card.querySelector("button");
        const revealed = Boolean(myPublicState?.revealedTraits?.[trait]);
        valueElement.textContent = privateState?.[trait] || "Не назначено";
        card.classList.toggle("is-revealed", revealed);
        card.classList.toggle("is-required", mustRevealRequiredTrait && trait === requiredTrait);
        button.textContent = revealed ? "Раскрыто" : "Раскрыть";
        button.disabled = bunkerVotePending
            || !myTurn
            || revealed
            || (!isSpecial && ordinaryRevealLimitReached)
            || (!isSpecial && Boolean(myPublicState?.revealedThisTurn))
            || (!isSpecial && mustRevealRequiredTrait && trait !== requiredTrait);
    }

    const hasHiddenOrdinaryTraits = TRAIT_KEYS.some((trait) =>
        trait !== "special" && !myPublicState?.revealedTraits?.[trait]);
    const canFinish = !bunkerVotePending
        && myTurn
        && (
            Boolean(myPublicState?.revealedThisTurn)
            || !hasHiddenOrdinaryTraits
            || ordinaryRevealLimitReached
        );
    ui.finishTurn.disabled = !canFinish;
    ui.hostFinishTurn.disabled = !canFinish;
    ui.hostDossier.hidden = !isHost() || !myPublicState;

    const pendingShare = publicState?.pendingSecretShare?.targetId === myId
        ? publicState.pendingSecretShare
        : null;
    const pendingSpecial = privateState?.pendingSpecialChoice?.playerId === myId
        ? privateState.pendingSpecialChoice
        : null;
    const specialId = Number(privateState?.specialId ?? 0);
    const hasSpecial = specialId > 0 && Boolean(privateState?.special);
    const specialUi = currentSpecialUsage(specialId);
    const availability = hasSpecial
        ? getSpecialAvailability(publicState, myId, specialId)
        : { allowed: false, reason: "Особая карта не назначена." };
    const canReactDuringBunkerVote = bunkerVotePending
        && [50, 71].includes(specialId)
        && availability.allowed;
    const completesPendingAction = Boolean(pendingSpecial);
    const bunkerVoteLocksSpecial = bunkerVotePending
        && !canReactDuringBunkerVote
        && !completesPendingAction;
    ui.specialControls.classList.toggle("can-react-during-bunker-vote", canReactDuringBunkerVote);
    renderSpecialTargetOptions(specialId, myId);
    renderSpecialTraitOptions(specialId, myId, false);
    renderSpecialScenarioOptions();
    renderSpecialChoiceOptions(pendingSpecial, specialId);
    renderSecretShareResponse(pendingShare, myId);
    const formIssue = specialFormIssue(specialUi, specialId, false, Boolean(pendingSpecial));
    const specialUsed = Boolean(myPublicState?.specialUsed);
    const hideSpecialInputs = specialUsed && !pendingSpecial;
    ui.specialGuide.textContent = bunkerVoteLocksSpecial
        ? "Сначала завершите действие открытой карты бункера."
        : pendingShare
        ? "Выберите закрытую карту для обмена. Если хотите применить реакцию №50 или №71, разыграйте её до отправки."
        : pendingSpecial
            ? "Выберите одну из двух предложенных карт бункера."
            : myPublicState?.specialUsed
                ? `Карта №${specialId} уже использована.`
                : !availability.allowed
                    ? `Карта №${specialId} пока недоступна: ${availability.reason}`
                    : `Карта №${specialId} · ${specialCardTitle(privateState.special)}. Условие: ${specialUi.timing}.${specialUi.inputs.length ? ` Выберите: ${specialUi.inputs.join(", ")}.` : ""}${formIssue ? ` ${formIssue}` : ""}`;
    ui.specialTargetPlayer.hidden = hideSpecialInputs
        || !specialUi.targetPlayer.includes(specialId);
    ui.specialTargetTrait.hidden = hideSpecialInputs
        || !specialUi.targetTrait.includes(specialId);
    ui.specialTargetScenario.hidden = hideSpecialInputs
        || !specialUi.targetScenario.includes(specialId);
    ui.specialChoice.hidden = hideSpecialInputs
        || !(specialUi.choice.includes(specialId) || pendingSpecial);
    for (const control of [
        ui.specialTargetPlayer,
        ui.specialTargetTrait,
        ui.specialTargetScenario,
        ui.specialChoice
    ]) {
        control.disabled = bunkerVoteLocksSpecial || hideSpecialInputs;
    }
    ui.specialControls.hidden = !myPublicState || (!hasSpecial && !pendingShare && !pendingSpecial);
    ui.playSpecial.hidden = !hasSpecial && !pendingSpecial;
    ui.playSpecial.disabled = bunkerVoteLocksSpecial || (pendingSpecial
        ? Boolean(formIssue)
        : !hasSpecial || !availability.allowed || Boolean(formIssue));
    ui.playSpecial.textContent = pendingSpecial
            ? "Подтвердить выбранную карту"
            : myPublicState?.specialUsed
                ? "Особая карта использована"
                : "Разыграть особую карту";
    renderSharedSecrets();

    for (const element of ui.hostTraits.querySelectorAll("[data-host-trait]")) {
        element.textContent = privateState?.[element.dataset.hostTrait] || "Не назначено";
    }

    for (const card of ui.hostTraits.querySelectorAll("[data-host-trait-card]")) {
        const trait = card.dataset.hostTraitCard;
        const isSpecial = trait === "special";
        const revealed = Boolean(myPublicState?.revealedTraits?.[trait]);
        const button = card.querySelector("[data-host-reveal-trait]");
        card.classList.toggle("is-revealed", revealed);
        card.classList.toggle("is-required", mustRevealRequiredTrait && trait === requiredTrait);
        button.textContent = revealed ? "Раскрыто" : "Раскрыть";
        button.disabled = bunkerVotePending
            || !myTurn
            || revealed
            || (!isSpecial && ordinaryRevealLimitReached)
            || (!isSpecial && Boolean(myPublicState?.revealedThisTurn))
            || (!isSpecial && mustRevealRequiredTrait && trait !== requiredTrait);
        button.setAttribute("aria-pressed", String(revealed));
    }
}

function renderSpecialTargetOptions(specialId, myId) {
    const selected = ui.specialTargetPlayer.value;
    const redirectedSpecialId = Number(publicState?.lastSpecial?.specialId ?? 0);
    const actionId = specialId === 50 ? redirectedSpecialId : specialId;
    const ownerId = specialId === 50 ? publicState?.lastSpecial?.playedBy : myId;
    const activeIds = (publicState?.order ?? []).filter((id) => publicState?.players?.[id]?.status === "active");
    let allowedIds = [...activeIds];

    if ([16, 17, 21, 22, 23].includes(actionId)) {
        const swapTrait = ({
            16: "baggage",
            17: "biology",
            21: "hobby",
            22: "health",
            23: "fact"
        })[actionId];
        const index = activeIds.indexOf(ownerId);
        allowedIds = index < 0 || activeIds.length < 2
            ? []
            : [...new Set([
                activeIds[(index - 1 + activeIds.length) % activeIds.length],
                activeIds[(index + 1) % activeIds.length]
            ])].filter((id) =>
                publicState?.players?.[ownerId]?.revealedTraits?.[swapTrait]
                && publicState?.players?.[id]?.revealedTraits?.[swapTrait]);
    } else if ([18, 41, 42, 49, 55, 56].includes(actionId)) {
        allowedIds = activeIds.filter((id) => id !== ownerId);
    } else if (actionId === 25 || actionId === 29) {
        const requiredTrait = actionId === 25 ? "health" : "profession";
        allowedIds = activeIds.filter((id) =>
            publicState?.players?.[id]?.revealedTraits?.[requiredTrait]);
    } else if (actionId === 38) {
        allowedIds = activeIds.filter((id) => !publicState?.players?.[id]?.bunkerKing);
    } else if (actionId === 44) {
        allowedIds = activeIds.filter((id) =>
            /\d+/.test(publicState?.players?.[id]?.revealedTraits?.biology ?? ""));
    } else if (actionId === 67) {
        allowedIds = activeIds.filter((id) =>
            gossipTraitOptions(publicState?.players?.[id]).length);
    }

    ui.specialTargetPlayer.replaceChildren(...allowedIds.map((id) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${publicState.players[id].name}${id === myId ? " (вы)" : ""}`;
        return option;
    }));
    if (allowedIds.includes(selected)) ui.specialTargetPlayer.value = selected;
}

function renderSpecialTraitOptions(specialId, myId, pendingShare) {
    const selected = ui.specialTargetTrait.value;
    const redirectedSpecialId = Number(publicState?.lastSpecial?.specialId ?? 0);
    const actionId = specialId === 50 ? redirectedSpecialId : specialId;
    const ownerId = specialId === 50 ? publicState?.lastSpecial?.playedBy : myId;
    const targetId = ui.specialTargetPlayer.value;
    let traits = TRAIT_KEYS.filter((trait) => trait !== "special");

    if (pendingShare) {
        traits = traits.filter((trait) => !publicState?.players?.[myId]?.revealedTraits?.[trait]);
    } else if (actionId === 56) {
        traits = traits.filter((trait) => !publicState?.players?.[ownerId]?.revealedTraits?.[trait]);
    } else if (actionId === 67) {
        traits = gossipTraitOptions(publicState?.players?.[targetId]);
    }

    ui.specialTargetTrait.replaceChildren(...traits.map((trait) => {
        const option = document.createElement("option");
        option.value = trait;
        option.textContent = TRAIT_LABELS[trait];
        return option;
    }));
    if (traits.includes(selected)) ui.specialTargetTrait.value = selected;
}

function gossipTraitOptions(player) {
    if (!player || player.status !== "active") return [];
    const ordinaryTraits = TRAIT_KEYS.filter((trait) => trait !== "special");
    const revealedCount = ordinaryTraits.filter((trait) =>
        player.revealedTraits?.[trait]).length;
    return ordinaryTraits.filter((trait) => {
        if (player.revealedTraits?.[trait]) return false;
        const additionalReveals = trait === "fact" || player.revealedTraits?.fact ? 1 : 2;
        return revealedCount + additionalReveals <= ordinaryTraits.length - 1;
    });
}

function specialFormIssue(usage, specialId, pendingShare, pendingSpecial) {
    if (pendingShare && !ui.specialTargetTrait.value) return "У вас не осталось закрытых обычных карт для обмена.";
    if (pendingSpecial && !ui.specialChoice.value) return "Выберите одну из предложенных карт.";
    if (usage.targetPlayer.includes(specialId) && !ui.specialTargetPlayer.value) return "Нет подходящего игрока для этой карты.";
    if (usage.targetTrait.includes(specialId) && !ui.specialTargetTrait.value) return "Нет подходящей закрытой характеристики.";
    if (usage.targetScenario.includes(specialId) && !ui.specialTargetScenario.value) return "Сначала нужна открытая карта бункера.";
    if (usage.choice.includes(specialId) && !ui.specialChoice.value) return "Выберите вариант эффекта.";
    return "";
}

function renderSpecialScenarioOptions() {
    const selected = ui.specialTargetScenario.value;
    const options = [];
    if (publicState?.bunker?.status === "revealed") {
        options.push({
            value: "primary:bunker",
            label: `Основная${publicState.bunker.revealedRound ? ` · раунд ${publicState.bunker.revealedRound}` : ""} · ${publicState.bunker.title}`
        });
    }
    for (const card of publicState?.extraScenarios?.bunker ?? []) {
        const targetToken = card.id ?? card.instanceId;
        options.push({
            value: `extra:bunker:${targetToken}`,
            label: `${card.revealedRound ? `Раунд ${card.revealedRound}` : "Дополнительная"} · ${card.title}`
        });
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

function renderSecretShareResponse(pendingShare, myId) {
    ui.secretShareResponse.hidden = !pendingShare;
    if (!pendingShare) return;

    const selected = ui.secretShareTrait.value;
    const options = TRAIT_KEYS
        .filter((trait) => trait !== "special")
        .filter((trait) => !publicState?.players?.[myId]?.revealedTraits?.[trait]);
    ui.secretShareTrait.replaceChildren(...options.map((trait) => {
        const option = document.createElement("option");
        option.value = trait;
        option.textContent = TRAIT_LABELS[trait] ?? trait;
        return option;
    }));
    if (options.includes(selected)) ui.secretShareTrait.value = selected;
    ui.respondSecretShare.disabled = !options.length;
}

function renderSpecialChoiceOptions(pending, specialId) {
    const selected = ui.specialChoice.value;
    const redirectedSpecialId = Number(publicState?.lastSpecial?.specialId ?? 0);
    const actionId = specialId === 50 ? redirectedSpecialId : specialId;
    const defaultOptions = {
        53: [
            { value: "younger", label: "Младше 33 лет" },
            { value: "older", label: "Старше 33 лет" }
        ],
        57: [
            { value: "after", label: "Два игрока после меня" },
            { value: "before", label: "Два игрока передо мной" }
        ],
        69: [
            { value: "female", label: "Женщины" },
            { value: "male", label: "Мужчины" }
        ]
    };
    const redirectedOptions = specialId === 50
        ? privateState?.specialReactionChoiceOptions
        : null;
    const options = pending?.options?.map((card) => ({
        value: String(card.index),
        label: `${card.title} — ${card.description}`
    })) ?? redirectedOptions?.map((card) => ({
        value: String(card.index),
        label: `${card.title} — ${card.description}`
    })) ?? defaultOptions[actionId] ?? [];
    ui.specialChoice.replaceChildren(...options.map(({ value, label }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
    }));
    if (options.some((option) => option.value === selected)) ui.specialChoice.value = selected;
}

function renderScenarios() {
    const finalLocked = [PHASES.THREAT, PHASES.FINISHED].includes(publicState.phase);
    const bunkerVotePending = Boolean(publicState.pendingBunkerVote);
    const interactionLocked = finalLocked || bunkerVotePending;
    for (const scenarioType of ["catastrophe", "bunker", "threat"]) {
        const scenario = publicState[scenarioType];
        const card = ui.scenarioCards[scenarioType];
        const button = ui.scenarioButtons[scenarioType];
        clearBunkerCardUi(card);
        const label = card.querySelector(".scenario-card__label");
        label.textContent = scenarioType === "bunker" && scenario?.revealedRound
            ? `Бункер · раунд ${scenario.revealedRound}`
            : scenarioType === "catastrophe"
                ? "Катастрофа"
                : scenarioType === "threat"
                    ? "Угроза"
                    : "Бункер";
        card.querySelector("[data-card-title]").textContent = scenario?.title || "Данные засекречены";
        card.querySelector("[data-card-description]").textContent = scenario?.description || "Данные засекречены.";
        button.hidden = !isHost() || scenario?.status !== "hidden" || interactionLocked;
        card.querySelector("[data-remove-primary-scenario]")?.remove();
        card.dataset.scenarioType = scenarioType;
        if (scenario?.instanceId) card.dataset.scenarioInstanceId = scenario.instanceId;
        else delete card.dataset.scenarioInstanceId;
        if (scenario?.cardId) card.dataset.scenarioCardId = String(scenario.cardId);
        else delete card.dataset.scenarioCardId;
        if (scenarioType === "bunker") {
            card.dataset.scenarioTarget = "primary:bunker";
            decorateBunkerScenarioCard(card, scenario, "primary:bunker");
        }
        if (isHost() && scenario?.status === "revealed" && !interactionLocked) {
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
            const scenarioToken = scenario.id ?? scenario.instanceId;
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
                        : scenario.revealedRound
                            ? `Бункер · раунд ${scenario.revealedRound}`
                            : "Бункер";
            title.textContent = scenario.title;
            description.textContent = scenario.description;
            card.append(label, title, description);
            card.dataset.scenarioType = scenarioType;
            if (scenarioToken) card.dataset.scenarioId = scenarioToken;
            if (scenario.instanceId) card.dataset.scenarioInstanceId = scenario.instanceId;
            if (scenario.cardId) card.dataset.scenarioCardId = String(scenario.cardId);
            if (scenario.targetId) card.dataset.threatTargetId = scenario.targetId;
            if (scenario.suppressed) card.dataset.threatSuppressed = "true";
            if (scenarioType === "bunker") {
                const targetValue = `extra:bunker:${scenarioToken}`;
                card.dataset.scenarioTarget = targetValue;
                decorateBunkerScenarioCard(card, scenario, targetValue);
            }
            if (isHost() && !interactionLocked) {
                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "scenario-card__remove";
                remove.dataset.removeScenario = scenarioToken;
                remove.dataset.scenarioType = scenarioType;
                remove.textContent = "Убрать карту";
                card.append(remove);
            }
            const stackType = scenarioType === "exile" ? "bunker" : scenarioType;
            const stack = ui.scenarioGrid.querySelector(`[data-scenario-stack="${stackType}"]`);
            (stack ?? ui.scenarioGrid).append(card);
        }
    }
    renderBunkerVoteFallback();
    renderThreatResolution();
}

function clearBunkerCardUi(card) {
    card.querySelectorAll("[data-bunker-card-ui]").forEach((element) => element.remove());
    card.classList.remove("has-bunker-effect", "has-bunker-sabotage", "has-pending-bunker-vote");
}

function decorateBunkerScenarioCard(card, scenario, targetValue) {
    if (!scenario) return;
    const result = scenario.instanceId
        ? publicState?.bunkerEffectResults?.[scenario.instanceId]
        : null;
    if (result) {
        const resultBox = document.createElement("div");
        const heading = document.createElement("strong");
        const message = document.createElement("span");
        const status = String(result.status ?? "resolved").toLowerCase().replace(/[^a-z0-9_-]/g, "");
        resultBox.className = "bunker-effect-result";
        resultBox.dataset.bunkerCardUi = "effect";
        resultBox.dataset.effectStatus = status || "resolved";
        if (result.outcome) resultBox.dataset.effectOutcome = String(result.outcome);
        heading.textContent = result.status === "voting"
            ? "Действие карты"
            : result.status === "awaiting_final"
                ? "Эффект сработает в финале"
                : result.status === "pending"
                    ? "Эффект карты ожидает решения"
                    : "Результат эффекта";
        message.textContent = result.message || "Эффект карты применён.";
        resultBox.append(heading, message);
        card.append(resultBox);
        card.classList.add("has-bunker-effect");
    }

    const sabotageTargets = (publicState?.bunkerSabotageTargets ?? []).filter((mark) => (
        mark?.instanceId
            ? Boolean(
                scenario.instanceId
                && String(mark.instanceId) === String(scenario.instanceId)
            )
            : Boolean(mark?.target && mark.target === targetValue)
    ));
    if (sabotageTargets.length) {
        const sabotageBox = document.createElement("div");
        sabotageBox.className = "bunker-sabotage-list";
        sabotageBox.dataset.bunkerCardUi = "sabotage";
        for (const mark of sabotageTargets) {
            const row = document.createElement("span");
            const player = publicState?.players?.[mark.playerId];
            const playerName = mark.playerName || player?.name || "Игрок";
            row.textContent = `Саботаж: ${playerName}. Сработает при изгнании этого игрока.`;
            sabotageBox.append(row);
        }
        card.append(sabotageBox);
        card.classList.add("has-bunker-sabotage");
    }

    const pending = publicState?.pendingBunkerVote;
    const isVoteSource = Boolean(pending && (
        (
            pending.sourceInstanceId
            && scenario.instanceId
            && String(scenario.instanceId) === String(pending.sourceInstanceId)
        )
        || (pending.sourceTarget && pending.sourceTarget === targetValue)
    ));
    if (isVoteSource) renderBunkerVoteControls(card, pending);
}

function renderBunkerVoteControls(card, pending) {
    const players = publicState?.players ?? {};
    const candidateIds = (Array.isArray(pending.candidateIds) ? pending.candidateIds : [])
        .filter((id) => players[id]);
    const voterIds = Array.isArray(pending.voterIds) ? pending.voterIds : [];
    const submittedVoterIds = Array.isArray(pending.submittedVoterIds)
        ? pending.submittedVoterIds
        : [];
    const myId = multiplayer?.user?.uid;
    const canVote = voterIds.includes(myId);
    const submitted = submittedVoterIds.includes(myId);
    const hasSubmittedVotes = submittedVoterIds.some((id) => voterIds.includes(id));

    if (!candidateIds.includes(selectedBunkerVoteTarget)) {
        selectedBunkerVoteTarget = candidateIds[0] ?? "";
    }

    const controls = document.createElement("section");
    const heading = document.createElement("strong");
    const description = document.createElement("p");
    const progress = document.createElement("small");
    const select = document.createElement("select");
    const actions = document.createElement("div");
    const voteButton = document.createElement("button");
    controls.className = "bunker-vote-controls";
    controls.dataset.bunkerCardUi = "vote";
    controls.dataset.bunkerVoteControls = "";
    heading.textContent = bunkerVoteTitle(pending);
    description.textContent = pending.type === "king"
        ? "Выберите царя. После подведения итогов он получит место в бункере и иммунитет от изгнания."
        : "Выберите участника для жертвы. После подведения итогов бункер получит новую карту.";
    progress.textContent = `Проголосовали: ${submittedVoterIds.length}/${voterIds.length}.${pending.revote ? " Идёт переголосование." : ""}`;
    select.dataset.bunkerVoteTarget = "";
    select.setAttribute("aria-label", pending.type === "king" ? "Кандидат в цари" : "Кандидат для жертвы");
    select.disabled = !canVote || !candidateIds.length;
    select.replaceChildren(...candidateIds.map((id) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = bunkerVoteCandidateLabel(id, myId);
        return option;
    }));
    if (candidateIds.includes(selectedBunkerVoteTarget)) select.value = selectedBunkerVoteTarget;

    voteButton.type = "button";
    voteButton.className = "button button--wine";
    voteButton.dataset.bunkerVoteSubmit = "";
    voteButton.hidden = !canVote;
    voteButton.disabled = !candidateIds.length;
    voteButton.textContent = submitted ? "Изменить голос" : "Подтвердить голос";
    actions.append(voteButton);

    if (isHost()) {
        const resolveButton = document.createElement("button");
        resolveButton.type = "button";
        resolveButton.className = "button button--primary";
        resolveButton.dataset.bunkerVoteResolve = "";
        resolveButton.disabled = !hasSubmittedVotes;
        resolveButton.textContent = pending.revote ? "Подвести итог переголосования" : "Подвести итог";
        actions.append(resolveButton);
    }

    if (!canVote) {
        const waiting = document.createElement("span");
        waiting.className = "bunker-vote-controls__waiting";
        waiting.textContent = isHost()
            ? "Вы не участвуете в этом голосовании."
            : "Вы не входите в список голосующих.";
        controls.append(heading, description, progress, waiting, actions);
    } else {
        controls.append(heading, description, progress, select, actions);
    }
    card.append(controls);
    card.classList.add("has-pending-bunker-vote");
}

function renderBunkerVoteFallback() {
    const pending = publicState?.pendingBunkerVote;
    if (!pending || ui.scenarioGrid.querySelector("[data-bunker-vote-controls]")) return;
    const card = document.createElement("article");
    const label = document.createElement("span");
    const title = document.createElement("h2");
    const description = document.createElement("p");
    card.className = "scenario-card scenario-card--extra bunker-vote-fallback";
    card.dataset.scenarioType = "bunker";
    label.className = "scenario-card__label";
    label.textContent = "Карта бункера · действие";
    title.textContent = bunkerVoteTitle(pending);
    description.textContent = "Исходная карта изменилась, но начатое действие нужно завершить.";
    card.append(label, title, description);
    renderBunkerVoteControls(card, pending);
    ui.scenarioGrid.querySelector('[data-scenario-stack="bunker"]')?.append(card);
}

function bunkerVoteTitle(pending) {
    if (pending?.type === "king") return pending.revote ? "Переголосование за царя" : "Выбор царя";
    return pending?.revote ? "Переголосование за жертву" : "Жертвенное голосование";
}

function bunkerVoteCandidateLabel(playerId, myId) {
    const player = publicState?.players?.[playerId];
    if (!player) return "Неизвестный игрок";
    const notes = [];
    if (playerId === myId) notes.push("вы");
    if (player.bunkerKing) notes.push("царь");
    if (player.status === "exiled") notes.push("изгнан");
    if (player.status === "dead") notes.push("погиб");
    return `${player.name}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}

function renderThreatResolution() {
    const resolution = publicState?.threatResolution;
    const pending = publicState?.phase === PHASES.THREAT && resolution?.status === "pending";
    const survived = resolution?.status === "survived";
    const failed = resolution?.status === "failed";
    const onlyNonlethal = Number(resolution?.lethalThreatCount ?? 0) === 0
        && Number(resolution?.nonlethalThreatCount ?? 0) > 0;
    const nonlethalFailure = Boolean(resolution?.nonlethalFailure);
    const primaryThreat = ui.scenarioCards.threat;
    const extraThreats = [
        ...ui.scenarioGrid.querySelectorAll('.scenario-card--extra[data-scenario-type="threat"]')
    ];
    const finalistIds = new Set(resolution?.finalistIds ?? []);
    const recordedThreatIds = Array.isArray(resolution?.extraThreatIds)
        ? new Set(resolution.extraThreatIds)
        : null;
    const updateCardState = (card, counted) => {
        card.classList.toggle("is-threat-active", Boolean(counted && pending));
        card.classList.toggle("is-threat-survived", Boolean(counted && survived));
        card.classList.toggle("is-threat-failed", Boolean(counted && failed));
        card.classList.toggle("is-threat-inactive", Boolean(resolution && !counted));
    };

    updateCardState(primaryThreat, !resolution || publicState?.threat?.status === "revealed");
    for (const card of extraThreats) {
        const scenarioId = card.dataset.scenarioId;
        const targetId = card.dataset.threatTargetId;
        const suppressed = card.dataset.threatSuppressed === "true";
        const counted = !resolution
            || (recordedThreatIds
                ? recordedThreatIds.has(scenarioId)
                : !targetId || finalistIds.has(targetId));
        updateCardState(card, counted);
        if (resolution) {
            card.querySelector(".scenario-card__label").textContent = counted
                ? "Финальная угроза"
                : suppressed
                    ? "Угроза · нейтрализована"
                    : "Угроза · цель выбыла";
        }
    }

    ui.threatResolutionStatus.hidden = !resolution;
    ui.threatResolutionActions.hidden = !isHost() || !pending;
    if (!resolution) return;

    const count = Number(resolution.threatCount ?? 0);
    const hasMixedThreats = Number(resolution.lethalThreatCount ?? 0) > 0
        && Number(resolution.nonlethalThreatCount ?? 0) > 0;
    ui.threatNonlethalFailed.hidden = !pending || !hasMixedThreats;
    ui.threatFailed.textContent = onlyNonlethal
        ? "Не поймали — потерять багаж"
        : "Бункер не выжил";
    ui.scenarioCards.threat.querySelector(".scenario-card__label").textContent = pending
        ? `Финальная угроза · ${count}`
        : "Финальная угроза";
    ui.threatResolutionStatus.textContent = pending
        ? onlyNonlethal
            ? `Активно несмертельных угроз: ${count}. Если финалисты не справятся, они потеряют багаж, но останутся живы.`
            : `Активно угроз: ${count}. Финалисты должны объяснить, какие их открытые карты и ресурсы бункера помогут выжить.`
        : nonlethalFailure
            ? "Домового поймать не удалось: финалисты потеряли багаж, но остались живы."
            : survived
            ? "Все финальные угрозы устранены. Бункер выжил."
            : "Угрозы не устранены. Бункер не выжил.";
}

function renderHostEditor() {
    const host = isHost();
    const locked = [PHASES.THREAT, PHASES.FINISHED].includes(publicState?.phase)
        || Boolean(publicState?.pendingBunkerVote);
    ui.hostEditor.hidden = !host || !publicState?.phase || locked;
    if (!host || !publicState?.phase || locked) return;
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
    const bunkerVotePending = Boolean(publicState.pendingBunkerVote);
    const myPlayer = players[multiplayer?.user?.uid];
    const revoteCandidates = publicState.voteResult?.status === "tie"
        ? publicState.voteResult.candidates ?? []
        : [];
    const isLastExiled = myPlayer?.status === "exiled"
        && multiplayer?.user?.uid === publicState.lastExiledPlayerId;
    const canVote = Boolean(myPlayer && (
        myPlayer.status === "active"
        || isLastExiled
        || myPlayer.persistentVoter
    ) && !myPlayer.voteDisabled);

    ui.votePanel.hidden = ![PHASES.VOTING, PHASES.RESULTS].includes(publicState.phase);
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
        button.disabled = bunkerVotePending
            || !isVoting
            || !canVote
            || player.immuneThisRound
            || player.bunkerKing
            || Boolean(myPlayer?.cannotVoteAgainst?.[id])
            || Boolean(myPlayer?.forcedSelfVote && id !== multiplayer?.user?.uid)
            || (revoteCandidates.length > 0 && !revoteCandidates.includes(id));
        name.textContent = player.name;
        count.textContent = publicState.phase === PHASES.RESULTS
            ? String(publicState.voteResult?.counts?.[id] ?? 0)
            : "";
        button.append(name, count);
        return button;
    }));

    ui.confirmVote.disabled = bunkerVotePending || !isVoting || !canVote || !selectedVoteTarget;
    ui.confirmVote.textContent = myPlayer?.voteSubmitted ? "Изменить голос" : "Подтвердить голос";
    ui.voteStatus.textContent = voteStatusText(players);
}

function voteStatusText(players) {
    const result = publicState.voteResult;
    if (publicState.phase === PHASES.VOTING) {
        const eligibleVoters = Object.entries(players).filter(([id, player]) => (
            (
                player.status === "active"
                || player.persistentVoter
                || (player.status === "exiled" && id === publicState.lastExiledPlayerId)
            )
            && !player.voteDisabled
        ));
        const submitted = eligibleVoters.filter(([, player]) => player.voteSubmitted).length;
        const progress = `Проголосовали: ${submitted}/${eligibleVoters.length}.`;
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
    if (publicState.phase === PHASES.FINISHED && publicState.threatResolution?.status === "failed") {
        return "Финальная угроза не устранена — бункер не выжил.";
    }
    if (publicState.phase === PHASES.FINISHED && publicState.threatResolution?.status === "survived") {
        return "Финальная угроза устранена — бункер выжил.";
    }
    if (publicState.phase === PHASES.FINISHED) return "Состав бункера определён.";
    return "Голосование пока закрыто.";
}

function renderControls() {
    const host = isHost();
    const phase = publicState.phase;
    const bunkerVotePending = Boolean(publicState.pendingBunkerVote);
    const pendingSpecialAction = Boolean(
        publicState.pendingSecretShare || publicState.pendingSpecialChoice
    );
    const currentPlayerId = publicState.order?.[publicState.currentPlayerIndex];
    const currentPlayer = currentPlayerId ? publicState.players?.[currentPlayerId] : null;
    ui.skipTurn.hidden = !host || phase !== PHASES.REVEAL || !currentPlayer;
    ui.skipTurn.disabled = (bunkerVotePending && !pendingSpecialAction)
        || !host
        || phase !== PHASES.REVEAL
        || !currentPlayer;
    ui.skipTurn.textContent = pendingSpecialAction
        ? "Отменить зависшее действие спецкарты"
        : currentPlayer
            ? `Пропустить ход: ${currentPlayer.name}`
            : "Пропустить ход";
    ui.nextPhase.hidden = !host || ![PHASES.DISCUSSION, PHASES.VOTING, PHASES.RESULTS].includes(phase);
    ui.nextPhase.disabled = (bunkerVotePending && !pendingSpecialAction) || !host;
    ui.nextPhase.textContent = pendingSpecialAction
        ? "Отменить зависшее действие спецкарты"
        : phase === PHASES.DISCUSSION
        ? publicState.round === 1
            ? "Начать раунд 2 без голосования →"
            : "Начать голосование →"
        : phase === PHASES.VOTING
            ? "Закрыть голосование →"
            : publicState.voteResult?.status === "tie"
                ? "Переголосовать →"
                : "Следующий раунд →";
    ui.roundDrawerToggle.classList.toggle(
        "needs-attention",
        bunkerVotePending
        || (host && (
            (phase === PHASES.REVEAL && Boolean(currentPlayer))
            || phase === PHASES.THREAT
            || [PHASES.DISCUSSION, PHASES.VOTING, PHASES.RESULTS].includes(phase)
        ))
    );
}

function setRoundDrawer(open, restoreFocus = true) {
    const shouldOpen = Boolean(open && publicState?.phase);
    document.body.classList.toggle("round-drawer-open", shouldOpen);
    ui.roundDrawerToggle.setAttribute("aria-expanded", String(shouldOpen));
    ui.roundDrawer.setAttribute("aria-hidden", String(!shouldOpen));
    ui.roundDrawer.inert = !shouldOpen;
    ui.roundDrawerBackdrop.hidden = !shouldOpen;
    if (shouldOpen) {
        window.requestAnimationFrame(() => ui.roundDrawerClose.focus());
    } else if (restoreFocus && !ui.roundDrawerToggle.hidden) {
        ui.roundDrawerToggle.focus();
    }
}

function renderLog() {
    const distanceFromBottom = ui.eventLog.scrollHeight - ui.eventLog.scrollTop - ui.eventLog.clientHeight;
    const keepAtBottom = !ui.eventLog.children.length || distanceFromBottom < 36;
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
    if (keepAtBottom) ui.eventLog.scrollTop = ui.eventLog.scrollHeight;
}

async function startGame() {
    if (!room?.meta?.hostId) throw new Error("Сначала создайте комнату.");
    if (!isHost()) throw new Error("Начать игру может только ведущий.");

    const settings = getRoomSettings();
    const roomPlayers = Object.entries(room.players ?? {}).filter(([, player]) => player.online !== false);
    let players = settings.hostPlays
        ? roomPlayers
        : roomPlayers.filter(([playerId]) => playerId !== room.meta.hostId);
    const expectedPlayers = settings.playerCount;

    if (settings.developerMode && players.length <= expectedPlayers) {
        players = fillWithDeveloperBots(players, expectedPlayers);
    }

    if (players.length !== expectedPlayers) {
        throw new Error(`Нужно ${expectedPlayers} игроков, сейчас подключено ${players.length}.`);
    }

    const capacity = settings.bunkerCapacity;
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

function scheduleDeveloperBots() {
    if (!isHost() || !getRoomSettings().developerMode || !publicState?.phase) return;
    if (botActionTimer || botActionRevision === publicState.revision) return;
    botActionRevision = publicState.revision;
    botActionTimer = window.setTimeout(() => {
        botActionTimer = 0;
        commandQueue = commandQueue
            .then(runDeveloperBotStep)
            .catch((error) => {
                botActionRevision = -1;
                handleError(error);
            });
    }, shouldDelayForHumanReaction() ? 8000 : 450);
}

function shouldDelayForHumanReaction() {
    const mySpecialId = Number(privateState?.specialId ?? 0);
    const hostCanReact = [50, 71].includes(mySpecialId)
        && getSpecialAvailability(publicState, multiplayer?.user?.uid, mySpecialId).allowed;
    if (hostCanReact) return true;

    const reactionWindowOpen = Number(publicState?.lastSpecial?.playedAtRevision ?? -1)
        === Number(publicState?.revision ?? 0);
    if (!reactionWindowOpen) return false;
    return Object.keys(room?.players ?? {}).some((playerId) =>
        playerId !== room?.meta?.hostId
        && publicState?.players?.[playerId]?.status === "active");
}

function resetDeveloperBotScheduler() {
    if (botActionTimer) window.clearTimeout(botActionTimer);
    botActionTimer = 0;
    botActionRevision = -1;
}

async function runDeveloperBotStep() {
    if (!isHost() || !getRoomSettings().developerMode) return;
    const engine = await multiplayer.getEngine();
    const commands = getDeveloperBotCommands(engine);
    if (!commands.length) return;
    for (const command of commands) {
        applyCommand(engine, command, room.meta.hostId);
    }
    await saveEngine(engine);
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
    const myId = multiplayer?.user?.uid;
    const pendingChoice = privateState?.pendingSpecialChoice?.playerId === myId;
    if (pendingChoice) {
        await sendCommand("PLAY_SPECIAL", { choice: ui.specialChoice.value });
        return;
    }

    const specialId = Number(privateState?.specialId ?? 0);
    const usage = currentSpecialUsage(specialId);
    const data = {};
    if (usage.targetPlayer.includes(specialId)) data.targetId = ui.specialTargetPlayer.value;
    if (usage.targetTrait.includes(specialId)) data.trait = ui.specialTargetTrait.value;
    if (usage.targetScenario.includes(specialId)) data.scenarioTarget = ui.specialTargetScenario.value;
    if (usage.choice.includes(specialId)) data.choice = ui.specialChoice.value;
    await sendCommand("PLAY_SPECIAL", data);
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

function getStatusMessage() {
    const phase = publicState?.phase;
    const currentPlayerId = publicState?.order?.[publicState?.currentPlayerIndex];
    const currentPlayer = currentPlayerId ? publicState?.players?.[currentPlayerId] : null;
    if (publicState?.pendingBunkerVote) {
        return `Карта бункера: ${bunkerVoteTitle(publicState.pendingBunkerVote).toLowerCase()}`;
    }
    if (phase === PHASES.REVEAL && currentPlayer) return `Ходит: ${currentPlayer.name}`;
    if (phase === PHASES.DISCUSSION && publicState?.round === 1) return "Первый раунд: без голосования";
    if (phase === PHASES.DISCUSSION) return "Обсуждение перед голосованием";
    if (phase === PHASES.VOTING) return "Идёт голосование";
    if (phase === PHASES.RESULTS) return "Результаты голосования";
    if (phase === PHASES.THREAT) return "Финальная угроза: ведущий определяет исход";
    return getPhaseLabel(phase);
}

function getPhaseLabel(phase) {
    return {
        [PHASES.LOBBY]: "Ожидание игроков",
        [PHASES.REVEAL]: "Раскрытие карт",
        [PHASES.DISCUSSION]: "Обсуждение",
        [PHASES.VOTING]: "Голосование",
        [PHASES.RESULTS]: "Результаты",
        [PHASES.THREAT]: "Финальная угроза",
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
    ui.startGame.hidden = true;
    ui.startGame.disabled = true;
    ui.onlineError.textContent = "";
}

function showLobbyForm() {
    document.body.classList.remove("is-connected", "has-game", "host-is-player", "has-pending-bunker-vote");
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
    setRoundDrawer(false, false);
    resetDeveloperBotScheduler();
    localStorage.removeItem(ROOM_STORAGE_KEY);
    room = null;
    publicState = null;
    privateState = {};
    selectedVoteTarget = "";
    selectedBunkerVoteTarget = "";
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
    setRoundDrawer(false, false);
    resetDeveloperBotScheduler();
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
    setRoundDrawer(false, false);
    resetDeveloperBotScheduler();
    await commandQueue;
    commandQueue = Promise.resolve();
    await multiplayer.resetGame();
    publicState = null;
    privateState = {};
    selectedVoteTarget = "";
    selectedBunkerVoteTarget = "";
    lastCommandErrorAt = 0;
    document.body.classList.remove("has-game");
    renderGame();
    renderRoom();
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
