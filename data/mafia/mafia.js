import { Multiplayer } from "../../modules/Multiplayer.js";
import { firebaseConfig, isFirebaseConfigured } from "../../firebase-config.js";
import {
    GAME_TYPE,
    PHASES,
    ROLES,
    ROLE_LABELS,
    applyCommand,
    assertFirebaseSafe,
    createInitialGame,
    createPrivateStates,
    createPublicState,
    getRoleLineup
} from "./engine.js";

const ROOM_STORAGE_KEY = "eulennest-mafia-room";
const PLAYER_NAME_STORAGE_KEY = "eulennest-player-name";
const select = (selector) => document.querySelector(selector);

const ui = {
    previewLobby: select("#preview-lobby"),
    previewNight: select("#preview-game"),
    previewDay: select("#preview-day"),
    previewVote: select("#preview-vote"),
    previewResult: select("#preview-result"),
    onlineName: select("#online-name"),
    nameField: select("#name-field"),
    createRoom: select("#create-room"),
    joinRoom: select("#join-room"),
    joinDivider: select("#join-divider"),
    joinRow: select("#join-row"),
    roomCodeInput: select("#room-code-input"),
    roomInfo: select("#room-info"),
    roomCodeOutput: select("#room-code-output"),
    onlineError: select("#online-error"),
    lobbyPlayers: select("#lobby-players"),
    lobbyPlayersCount: select("#lobby-player-count"),
    lobbyPlayersList: select("#lobby-player-list"),
    roleLineup: select("#role-lineup"),
    startGame: select("#start-game"),
    leaveLobby: select("#leave-lobby"),
    leaveGame: select("#leave-room"),
    gameRoomCode: select("#game-room-code"),
    nightNumber: select("#night-number"),
    dayNumber: select("#day-number"),
    voteDayNumber: select("#vote-day-number"),
    dayPhaseName: select("#day-phase-name"),
    playersAlive: select("#players-alive"),
    playersTotal: select("#players-total"),
    progressLabel: select("#progress-label"),
    progressCurrent: select("#progress-current"),
    progressTotal: select("#progress-total"),
    roleCard: select("#role-card"),
    roleIndex: select("#role-index"),
    roleSymbol: select("#role-symbol"),
    roleName: select("#role-name"),
    roleDescription: select("#role-description"),
    roleTeam: select("#role-team"),
    roleTeamList: select("#role-team-list"),
    roleGoal: select("#role-goal"),
    privateNotes: select("#private-notes"),
    privateNotesList: select("#private-notes-list"),
    nightTableTitle: select("#night-table-title"),
    dayTableKicker: select("#day-table-kicker"),
    dayTableTitle: select("#day-table-title"),
    resultTableTitle: select("#result-table-title"),
    nightStatus: select("#night-status"),
    dayStatus: select("#day-status"),
    voteStatus: select("#vote-status"),
    playerList: select("#player-list"),
    nightActionKicker: select("#night-action-kicker"),
    nightActionCopy: select("#night-action-copy"),
    confirmAction: select("#confirm-action"),
    finishNight: select("#finish-night"),
    dayActionKicker: select("#day-action-kicker"),
    dayActionCopy: select("#day-action-copy"),
    dayPhaseAction: select("#day-phase-action"),
    voteActionCopy: select("#vote-action-copy"),
    confirmVote: select("#confirm-vote"),
    finishVoting: select("#finish-voting"),
    winnerName: select("#winner-name"),
    winnerDescription: select("#winner-description"),
    resultSeal: select(".result-panel__seal"),
    restartGame: select("#restart-game"),
    eventLog: select("#event-log")
};

const ROLE_CONTENT = {
    [ROLES.MAFIA]: {
        name: "Мафия",
        symbol: "♠",
        description: "Ты местный чмошник, которому кажется, что он крутой, так как он в мафии. Днём лучше себя не выдавать.",
        goal: "Убирай мирных жителей и получи численное преимущество перед городом."
    },
    [ROLES.CITIZEN]: {
        name: "Мирный житель",
        symbol: "☀",
        description: "Ты обычный житель. От твоего выбора зависит, докажешь ли ты, что являешься частью тупого стада, которым легко манипулировать, или всё-таки умеешь думать.",
        goal: "Путём голосования найди мафию и маньяка и положи конец беспределу."
    },
    [ROLES.DOCTOR]: {
        name: "Доктор",
        symbol: "✚",
        description: "Ты потратил детство на образование и теперь способен каждую ночь защитить одного бедолагу от неминуемой гибели — даже если им окажется убийца.",
        goal: "Выполни свой долг и помоги мирным жителям пережить ночь."
    },
    [ROLES.DETECTIVE]: {
        name: "Полицейский",
        symbol: "⌕",
        description: "После всей честной работы пора посадить подонков, которые портят жизнь городу. Только тебе дано наверняка узнать, кто состоит в мафии.",
        goal: "Проверяй жителей ночью и убеждай город голосовать против мафии."
    },
    [ROLES.ESCORT]: {
        name: "Путана",
        symbol: "♥",
        description: "Жизнь тебя помотала. Однако ты можешь спасти горожан, заблокировав ночное действие выбранного участника.",
        goal: "Помоги городу, лишая подозрительных участников их ночных способностей."
    },
    [ROLES.MANIAC]: {
        name: "Маньяк",
        symbol: "♦",
        description: "Здоровой психики в тебе уже не осталось. В самое сложное для города время ты продолжаешь любимую работу — убиваешь.",
        goal: "Останься единственным выжившим."
    },
    [ROLES.JESTER]: {
        name: "Самоубийца",
        symbol: "☠",
        description: "Самостоятельно решиться ты не смог, поэтому теперь провоцируешь город и пытаешься заставить жителей вынести тебе смертный приговор.",
        goal: "Добейся своей казни именно на дневном голосовании."
    }
};

const NIGHT_ACTIONS = {
    [ROLES.MAFIA]: {
        command: "MAFIA_VOTE",
        title: "Кого выберет мафия?",
        kicker: "Выбор мафии",
        empty: "Выберите жертву"
    },
    [ROLES.DOCTOR]: {
        command: "DOCTOR_HEAL",
        title: "Кого спасти этой ночью?",
        kicker: "Лечение",
        empty: "Выберите пациента"
    },
    [ROLES.DETECTIVE]: {
        command: "DETECTIVE_CHECK",
        title: "Кого проверить?",
        kicker: "Проверка",
        empty: "Выберите подозреваемого"
    },
    [ROLES.ESCORT]: {
        command: "ESCORT_BLOCK",
        title: "Кому помешать этой ночью?",
        kicker: "Блокировка",
        empty: "Выберите участника"
    },
    [ROLES.MANIAC]: {
        command: "MANIAC_KILL",
        title: "Кто станет следующей жертвой?",
        kicker: "Охота",
        empty: "Выберите жертву"
    }
};

const WINNER_CONTENT = {
    city: {
        name: "Мирные жители",
        description: "Город избавился от мафии и маньяка.",
        symbol: "☀"
    },
    mafia: {
        name: "Мафия",
        description: "Преступники получили численное преимущество и захватили город.",
        symbol: "♠"
    },
    maniac: {
        name: "Маньяк",
        description: "Маньяк остался единственным выжившим.",
        symbol: "♦"
    },
    jester: {
        name: "Самоубийца",
        description: "Город исполнил его желание и вынес смертный приговор.",
        symbol: "☠"
    }
};

let multiplayer = null;
let room = null;
let publicState = null;
let privateState = {};
let selectedTarget = "";
let selectedPhase = "";
let commandListenerStarted = false;
let commandQueue = Promise.resolve();
let lastCommandErrorAt = 0;

bindEvents();
init();

async function init() {
    restorePlayerName();
    setConnectionDisabled(true);

    if (!isFirebaseConfigured) {
        showError(new Error("Firebase не настроен."));
        return;
    }

    try {
        multiplayer = new Multiplayer(firebaseConfig);
        await multiplayer.connect();
        setConnectionDisabled(false);
        await restoreRoom();
    } catch (error) {
        showError(error);
    }
}

function bindEvents() {
    ui.roomCodeInput.addEventListener("input", () => {
        ui.roomCodeInput.value = Multiplayer.normalizeRoomId(ui.roomCodeInput.value);
    });
    ui.roomCodeInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") ui.joinRoom.click();
    });
    ui.onlineName.addEventListener("change", savePlayerName);
    ui.createRoom.addEventListener("click", () => run(createRoom));
    ui.joinRoom.addEventListener("click", () => run(joinRoom));
    ui.roomCodeOutput.addEventListener("click", () => run(copyRoomCode));
    ui.gameRoomCode.addEventListener("click", () => run(copyRoomCode));
    ui.startGame.addEventListener("click", () => run(startGame));
    ui.leaveLobby.addEventListener("click", () => run(leaveRoom));
    ui.leaveGame.addEventListener("click", () => run(leaveRoom));
    ui.restartGame.addEventListener("click", () => run(resetGame));
    ui.playerList.addEventListener("click", (event) => {
        const card = event.target.closest("[data-player-id]");
        if (!card || card.disabled) return;
        selectedTarget = card.dataset.playerId;
        renderGame();
    });
    ui.confirmAction.addEventListener("click", () => run(submitNightAction));
    ui.finishNight.addEventListener("click", () => run(() => sendCommand("START_DAY")));
    ui.dayPhaseAction.addEventListener("click", () => run(() => sendCommand(
        publicState?.phase === PHASES.VERDICT ? "START_NIGHT" : "START_VOTING"
    )));
    ui.confirmVote.addEventListener("click", () => run(() => sendCommand("VOTE", {
        targetId: selectedTarget
    })));
    ui.finishVoting.addEventListener("click", () => run(() => sendCommand("FINISH_VOTING")));
}

async function createRoom() {
    requireConnection();
    const code = await multiplayer.createRoom(readPlayerName(), 16, null, GAME_TYPE);
    localStorage.setItem(ROOM_STORAGE_KEY, code);
    connectToRoom(code);
}

async function joinRoom() {
    requireConnection();
    const code = await multiplayer.joinRoom(ui.roomCodeInput.value, readPlayerName(), null, GAME_TYPE);
    localStorage.setItem(ROOM_STORAGE_KEY, code);
    connectToRoom(code);
}

async function restoreRoom() {
    const savedRoom = localStorage.getItem(ROOM_STORAGE_KEY);
    if (!savedRoom) return;
    try {
        const code = await multiplayer.joinRoom(savedRoom, readPlayerName(), null, GAME_TYPE);
        connectToRoom(code);
    } catch (error) {
        localStorage.removeItem(ROOM_STORAGE_KEY);
        showError(error);
    }
}

function connectToRoom(code) {
    multiplayer.clearListeners();
    commandListenerStarted = false;
    ui.roomCodeOutput.textContent = code;
    ui.gameRoomCode.textContent = code;

    multiplayer.subscribeRoom((roomState) => {
        room = {
            meta: roomState?.meta ?? null,
            players: roomState?.players ?? {}
        };
        if (isHost()) startCommandListener();
        renderApp();
    });
    multiplayer.subscribePublicState((state) => {
        publicState = state ?? null;
        const error = publicState?.commandErrors?.[multiplayer.user.uid];
        if (error?.createdAt > lastCommandErrorAt) {
            lastCommandErrorAt = error.createdAt;
            showError(new Error(error.message));
        }
        syncSelectedTarget();
        renderApp();
    });
    multiplayer.subscribeHand((state) => {
        privateState = normalizePrivateState(state);
        syncSelectedTarget();
        renderApp();
    });
}

function renderApp() {
    renderRoom();
    if (room?.meta?.status === "lobby" || !publicState?.phase) {
        ui.previewLobby.checked = true;
        return;
    }
    renderGame();
}

function renderRoom() {
    const connected = Boolean(room?.meta && multiplayer?.roomId);
    const players = Object.entries(room?.players ?? {}).filter(([, player]) => player.online !== false);
    const host = isHost();
    const lobby = room?.meta?.status === "lobby";

    ui.nameField.hidden = connected;
    ui.createRoom.hidden = connected;
    ui.joinDivider.hidden = connected;
    ui.joinRow.hidden = connected;
    ui.roomInfo.hidden = !connected;
    ui.lobbyPlayers.hidden = !connected;
    ui.lobbyPlayersCount.textContent = `${players.length} / ${room?.meta?.maxPlayers ?? 16}`;
    ui.startGame.hidden = !host || !lobby;
    ui.startGame.disabled = players.length < 4;
    ui.lobbyPlayersList.replaceChildren(...players.map(([playerId, player]) => {
        const item = document.createElement("li");
        item.textContent = playerId === room.meta.hostId
            ? `${player.name} · ведущий`
            : player.name;
        return item;
    }));
    renderRoleLineup(players.length);
}

function renderRoleLineup(playerCount) {
    if (playerCount < 4) {
        ui.roleLineup.textContent = `Нужно ещё ${4 - playerCount} игрока для минимального состава.`;
        return;
    }
    try {
        const counts = getRoleLineup(playerCount);
        ui.roleLineup.textContent = Object.entries(counts)
            .map(([role, count]) => `${ROLE_LABELS[role]}${count > 1 ? ` ×${count}` : ""}`)
            .join(" · ");
    } catch (error) {
        ui.roleLineup.textContent = error.message;
    }
}

function renderGame() {
    if (!publicState?.phase) return;
    showGamePhase(publicState.phase);
    renderRoundBar();
    renderRole();
    renderPlayers();
    renderPhaseActions();
    renderLog();
    renderResult();
}

function showGamePhase(phase) {
    const input = {
        [PHASES.NIGHT]: ui.previewNight,
        [PHASES.DAY]: ui.previewDay,
        [PHASES.VERDICT]: ui.previewDay,
        [PHASES.VOTING]: ui.previewVote,
        [PHASES.FINISHED]: ui.previewResult
    }[phase];
    if (input) input.checked = true;
}

function renderRoundBar() {
    const alive = Object.values(publicState.players ?? {}).filter((player) => player.alive).length;
    const total = Object.keys(publicState.players ?? {}).length;
    const day = String(publicState.day ?? 1).padStart(2, "0");
    ui.nightNumber.textContent = `Ночь ${day}`;
    ui.dayNumber.textContent = `День ${day}`;
    ui.voteDayNumber.textContent = `День ${day}`;
    ui.playersAlive.textContent = alive;
    ui.playersTotal.textContent = total;

    if (publicState.phase === PHASES.NIGHT) {
        ui.progressLabel.textContent = "Действия";
        ui.progressCurrent.textContent = publicState.nightActionsSubmitted ?? 0;
        ui.progressTotal.textContent = publicState.nightActionsRequired ?? 0;
    } else if (publicState.phase === PHASES.VOTING) {
        ui.progressLabel.textContent = "Голоса";
        ui.progressCurrent.textContent = publicState.votesSubmitted ?? 0;
        ui.progressTotal.textContent = publicState.votesRequired ?? alive;
    } else {
        ui.progressLabel.textContent = "В живых";
        ui.progressCurrent.textContent = alive;
        ui.progressTotal.textContent = total;
    }
}

function renderRole() {
    const role = privateState.role;
    const content = ROLE_CONTENT[role];
    if (!content) {
        ui.roleCard.dataset.role = "";
        ui.roleIndex.textContent = "—";
        ui.roleSymbol.textContent = "?";
        ui.roleName.textContent = "Роль скрыта";
        ui.roleDescription.textContent = "Записка откроется после начала партии.";
        ui.roleGoal.textContent = "Дождитесь начала партии и не показывайте записку другим игрокам.";
        ui.roleTeam.hidden = true;
        ui.privateNotes.hidden = true;
        return;
    }

    const myId = multiplayer.user.uid;
    ui.roleCard.dataset.role = role;
    ui.roleIndex.textContent = String((publicState.order ?? []).indexOf(myId) + 1).padStart(2, "0");
    ui.roleSymbol.textContent = content.symbol;
    ui.roleName.textContent = content.name;
    ui.roleDescription.textContent = content.description;
    ui.roleGoal.textContent = content.goal;

    const teammateIds = role === ROLES.MAFIA
        ? (privateState.mafia ?? []).filter((playerId) => playerId !== myId)
        : [];
    ui.roleTeam.hidden = teammateIds.length === 0;
    ui.roleTeamList.replaceChildren(...teammateIds.map((playerId) => {
        const name = publicState.players?.[playerId]?.name ?? "Союзник";
        const item = document.createElement("strong");
        const avatar = document.createElement("span");
        avatar.className = "avatar avatar--small";
        avatar.textContent = initial(name);
        item.append(avatar, name);
        return item;
    }));

    const checks = Object.entries(privateState.checks ?? {});
    ui.privateNotes.hidden = role !== ROLES.DETECTIVE || checks.length === 0;
    ui.privateNotesList.replaceChildren(...checks.map(([playerId, isMafia]) => {
        const item = document.createElement("p");
        const name = publicState.players?.[playerId]?.name ?? "Игрок";
        item.className = isMafia ? "is-danger" : "is-safe";
        item.textContent = `${name} — ${isMafia ? "мафия" : "не мафия"}`;
        return item;
    }));
}

function renderPlayers() {
    const myId = multiplayer.user.uid;
    const mafiaIds = new Set(privateState.mafia ?? []);
    const checks = privateState.checks ?? {};
    const finished = publicState.phase === PHASES.FINISHED;

    ui.playerList.replaceChildren(...Object.entries(publicState.players ?? {}).map(([playerId, player]) => {
        const card = document.createElement("button");
        const avatar = document.createElement("span");
        const copy = document.createElement("span");
        const name = document.createElement("strong");
        const status = document.createElement("small");
        const marker = document.createElement("i");
        const selectable = canSelectTarget(playerId);
        const isYou = playerId === myId;

        card.type = "button";
        card.className = "player-card";
        card.dataset.playerId = playerId;
        card.classList.toggle("is-selected", playerId === selectedTarget && selectable);
        card.classList.toggle("is-you", isYou);
        card.classList.toggle("is-dead", !player.alive);
        card.disabled = !selectable;
        avatar.className = "avatar";
        avatar.textContent = isYou ? "ВЫ" : initial(player.name);
        copy.className = "player-card__copy";
        name.textContent = player.name;
        status.textContent = playerStatus(playerId, player, mafiaIds, checks, finished);
        marker.className = "player-card__vote";
        marker.textContent = !player.alive ? "×" : playerId === selectedTarget && selectable ? "✓" : "·";
        copy.append(name, status);
        card.append(avatar, copy, marker);
        return card;
    }));
}

function playerStatus(playerId, player, mafiaIds, checks, finished) {
    const myId = multiplayer.user.uid;
    if (!player.alive) return `Покинул игру · ${ROLE_LABELS[player.role] ?? "роль скрыта"}`;
    if (finished) return ROLE_LABELS[player.role] ?? "Роль неизвестна";
    if (playerId === myId) return `Это вы · ${ROLE_LABELS[privateState.role] ?? "игрок"}`;
    if (mafiaIds.has(playerId)) return "Ваш союзник";
    if (Object.prototype.hasOwnProperty.call(checks, playerId)) {
        return checks[playerId] ? "Проверка: мафия" : "Проверка: не мафия";
    }
    return "В игре";
}

function renderPhaseActions() {
    renderNightAction();
    renderDayAction();
    renderVotingAction();
}

function renderNightAction() {
    const action = NIGHT_ACTIONS[privateState.role];
    const alive = privateState.alive !== false;
    const selectedName = publicState.players?.[selectedTarget]?.name;
    const canAct = publicState.phase === PHASES.NIGHT && alive && Boolean(action);

    ui.nightTableTitle.textContent = action?.title ?? "Город спит";
    ui.nightActionKicker.textContent = action?.kicker ?? "Ожидание";
    ui.nightActionCopy.textContent = !alive
        ? "Вы наблюдаете за партией"
        : action
            ? selectedName
                ? `Цель: ${selectedName}`
                : action.empty
            : "У вашей роли нет ночного действия";
    ui.confirmAction.hidden = !canAct;
    ui.confirmAction.disabled = !canAct || !selectedTarget;
    ui.confirmAction.textContent = privateState.actionSubmitted ? "Изменить выбор" : "Подтвердить выбор";

    const current = Number(publicState.nightActionsSubmitted ?? 0);
    const required = Number(publicState.nightActionsRequired ?? 0);
    ui.nightStatus.textContent = `${current} из ${required} ночных действий`;
    ui.finishNight.hidden = !isHost();
    ui.finishNight.disabled = current < required;
    ui.finishNight.textContent = current < required
        ? `Ожидание действий (${current}/${required})`
        : "Начать день";
}

function renderDayAction() {
    const verdict = publicState.phase === PHASES.VERDICT;
    const killedIds = publicState.lastNight?.killedPlayerIds ?? [];
    const eliminatedId = publicState.lastVote?.eliminatedPlayerId;

    ui.dayPhaseName.textContent = verdict ? "Приговор вынесен" : "Город обсуждает";
    ui.dayTableKicker.textContent = verdict ? "Решение принято" : "Открытое обсуждение";
    ui.dayTableTitle.textContent = verdict
        ? eliminatedId
            ? `${publicState.players?.[eliminatedId]?.name ?? "Игрок"} покидает город`
            : "Голоса разделились"
        : "Кому город ещё доверяет?";
    ui.dayActionKicker.textContent = verdict ? "Итог голосования" : "Обсуждение";
    ui.dayActionCopy.textContent = verdict
        ? eliminatedId
            ? `Раскрытая роль: ${ROLE_LABELS[publicState.players?.[eliminatedId]?.role] ?? "неизвестна"}`
            : "Никто не покидает игру"
        : killedIds.length
            ? `Ночью погибли: ${killedIds.map((id) => publicState.players?.[id]?.name).join(", ")}`
            : publicState.lastNight?.someoneWasSaved
                ? "Ночью на кого-то напали, но цель спасли"
                : "Этой ночью никто не погиб";
    ui.dayStatus.textContent = verdict ? "Ожидание следующей ночи" : "Время для обсуждения";
    ui.dayPhaseAction.hidden = !isHost();
    ui.dayPhaseAction.textContent = verdict ? "Начать следующую ночь" : "Начать голосование";
}

function renderVotingAction() {
    const alive = privateState.alive !== false;
    const selectedName = publicState.players?.[selectedTarget]?.name;
    const submitted = Number(publicState.votesSubmitted ?? 0);
    const required = Number(publicState.votesRequired ?? 0);

    ui.voteStatus.textContent = `${submitted} из ${required} голосов`;
    ui.voteActionCopy.textContent = !alive
        ? "Вы больше не участвуете в голосовании"
        : selectedName
            ? `Кандидат: ${selectedName}`
            : "Выберите кандидата";
    ui.confirmVote.hidden = !alive;
    ui.confirmVote.disabled = !alive || !selectedTarget;
    ui.confirmVote.textContent = privateState.voteTarget ? "Изменить голос" : "Отдать голос";
    ui.finishVoting.hidden = !isHost();
    ui.finishVoting.disabled = submitted < required;
    ui.finishVoting.textContent = submitted < required
        ? `Ожидание голосов (${submitted}/${required})`
        : "Подвести итог";
}

function renderResult() {
    if (publicState.phase !== PHASES.FINISHED) return;
    const result = WINNER_CONTENT[publicState.winner] ?? {
        name: "Партия окончена",
        description: "Победитель не определён.",
        symbol: "✦"
    };
    ui.resultTableTitle.textContent = `${result.name} побеждает`;
    ui.winnerName.textContent = result.name;
    ui.winnerDescription.textContent = result.description;
    ui.resultSeal.textContent = result.symbol;
    ui.restartGame.hidden = !isHost();
}

function renderLog() {
    const entries = Object.values(publicState.log ?? {}).sort((left, right) => right.createdAt - left.createdAt);
    ui.eventLog.replaceChildren(...entries.map((entry) => {
        const item = document.createElement("li");
        const time = document.createElement("time");
        const copy = document.createElement("p");
        const message = document.createElement("strong");
        const phase = document.createElement("span");
        time.textContent = new Date(entry.createdAt).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit"
        });
        message.textContent = entry.message;
        phase.textContent = entry.phase === PHASES.NIGHT
            ? `Ночь ${entry.day ?? publicState.day}`
            : `День ${entry.day ?? publicState.day}`;
        copy.append(message, phase);
        item.append(time, copy);
        return item;
    }));
}

function canSelectTarget(playerId) {
    const player = publicState.players?.[playerId];
    const myId = multiplayer?.user?.uid;
    if (!player?.alive || privateState.alive === false) return false;

    if (publicState.phase === PHASES.VOTING) return playerId !== myId;
    if (publicState.phase !== PHASES.NIGHT || !NIGHT_ACTIONS[privateState.role]) return false;
    if (privateState.role === ROLES.DOCTOR) return true;
    if (privateState.role === ROLES.MAFIA) return !(privateState.mafia ?? []).includes(playerId);
    return playerId !== myId;
}

async function submitNightAction() {
    const action = NIGHT_ACTIONS[privateState.role];
    if (!action) throw new Error("У вашей роли нет ночного действия.");
    if (!selectedTarget) throw new Error("Сначала выберите цель.");
    await sendCommand(action.command, { targetId: selectedTarget });
}

async function startGame() {
    if (!isHost()) throw new Error("Запустить игру может только ведущий.");
    const players = Object.entries(room.players ?? {}).filter(([, player]) => player.online !== false);
    if (players.length < 4) throw new Error("Для игры нужны хотя бы четыре человека.");

    ui.startGame.disabled = true;
    try {
        const engine = createInitialGame(players);
        await saveEngine(engine);
        startCommandListener();
    } finally {
        ui.startGame.disabled = false;
    }
}

function startCommandListener() {
    if (!isHost() || commandListenerStarted) return;
    commandListenerStarted = true;
    multiplayer.listenForCommands((command, commandId) => {
        commandQueue = commandQueue
            .then(() => processCommand(command, commandId))
            .catch(showError);
    });
}

async function processCommand(command, commandId) {
    try {
        const engine = await multiplayer.getEngine();
        if (!engine) return;
        if (command.data?._phase !== engine.phase || Number(command.data?._day) !== Number(engine.day)) return;
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
    const nextPublicState = createPublicState(engine);
    const privateStates = createPrivateStates(engine);
    assertFirebaseSafe(engine);
    assertFirebaseSafe(nextPublicState);
    assertFirebaseSafe(privateStates);
    await multiplayer.setGame(engine, nextPublicState, privateStates);
}

async function sendCommand(type, data = {}) {
    if (!multiplayer?.roomId || !publicState) throw new Error("Игра ещё не началась.");
    await multiplayer.sendCommand(type, {
        ...data,
        _phase: publicState.phase,
        _day: publicState.day
    }, Number(publicState.revision ?? 0));
}

async function resetGame() {
    if (!isHost()) throw new Error("Начать новую партию может только ведущий.");
    if (!window.confirm("Вернуть всех в лобби и начать новую партию с тем же кодом?")) return;
    await multiplayer.resetGame();
    publicState = null;
    privateState = {};
    selectedTarget = "";
    selectedPhase = "";
    ui.previewLobby.checked = true;
    renderApp();
}

async function leaveRoom() {
    localStorage.removeItem(ROOM_STORAGE_KEY);
    if (multiplayer?.roomId) await multiplayer.leave();
    location.reload();
}

async function copyRoomCode() {
    if (!multiplayer?.roomId) return;
    await navigator.clipboard.writeText(multiplayer.roomId);
    ui.roomCodeOutput.textContent = "СКОПИРОВАНО";
    ui.gameRoomCode.textContent = "СКОПИРОВАНО";
    setTimeout(() => {
        if (!multiplayer?.roomId) return;
        ui.roomCodeOutput.textContent = multiplayer.roomId;
        ui.gameRoomCode.textContent = multiplayer.roomId;
    }, 900);
}

function syncSelectedTarget() {
    const phase = publicState?.phase ?? "";
    const context = `${phase}:${publicState?.day ?? 0}`;
    if (context !== selectedPhase) {
        selectedPhase = context;
        selectedTarget = "";
        return;
    }
    if (!selectedTarget) {
        selectedTarget = phase === PHASES.VOTING
            ? privateState.voteTarget ?? ""
            : phase === PHASES.NIGHT
                ? privateState.selectedTarget ?? ""
                : "";
    }
}

function normalizePrivateState(state) {
    return state && typeof state === "object" && !Array.isArray(state) ? state : {};
}

function isHost() {
    return Boolean(room?.meta?.hostId && multiplayer?.user?.uid === room.meta.hostId);
}

function initial(name) {
    return String(name ?? "?").trim().slice(0, 1).toUpperCase() || "?";
}

function readPlayerName() {
    const name = ui.onlineName.value.trim().replace(/\s+/g, " ").slice(0, 24) || "Игрок";
    ui.onlineName.value = name;
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
    return name;
}

function savePlayerName() {
    readPlayerName();
}

function restorePlayerName() {
    const saved = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    const discordName = window.DiscordProfile?.getProfile?.()?.name;
    if (saved || discordName) ui.onlineName.value = saved || discordName;
}

function setConnectionDisabled(disabled) {
    ui.createRoom.disabled = disabled;
    ui.joinRoom.disabled = disabled;
}

function requireConnection() {
    if (!multiplayer) throw new Error("Подключение к сети ещё не готово.");
}

async function run(task) {
    ui.onlineError.textContent = "";
    try {
        return await task();
    } catch (error) {
        showError(error);
    }
}

function friendlyError(error) {
    const message = String(error?.message ?? error ?? "Неизвестная ошибка");
    return message
        .replace("PERMISSION_DENIED", "Firebase отклонил запрос")
        .replace("permission_denied", "Firebase отклонил запрос");
}

function showError(error) {
    console.error(error);
    ui.onlineError.textContent = friendlyError(error);
}
