export const GAME_TYPE = "mafia";

export const PHASES = Object.freeze({
    NIGHT: "night",
    DAY: "day",
    VOTING: "voting",
    VERDICT: "verdict",
    FINISHED: "finished"
});

export const ROLES = Object.freeze({
    MAFIA: "mafia",
    CITIZEN: "citizen",
    DOCTOR: "doctor",
    DETECTIVE: "detective",
    ESCORT: "escort",
    MANIAC: "maniac",
    JESTER: "jester"
});

export const ROLE_LABELS = Object.freeze({
    [ROLES.MAFIA]: "Мафия",
    [ROLES.CITIZEN]: "Мирный житель",
    [ROLES.DOCTOR]: "Доктор",
    [ROLES.DETECTIVE]: "Полицейский",
    [ROLES.ESCORT]: "Путана",
    [ROLES.MANIAC]: "Маньяк",
    [ROLES.JESTER]: "Самоубийца"
});

const NIGHT_ROLES = new Set([
    ROLES.MAFIA,
    ROLES.DOCTOR,
    ROLES.DETECTIVE,
    ROLES.ESCORT,
    ROLES.MANIAC
]);

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 16;

export function createInitialGame(players, options = {}, random = Math.random) {
    validatePlayers(players);

    const order = players.map(([id]) => id);
    const roles = assignRoles(order, options, random);
    const engine = {
        gameType: GAME_TYPE,
        revision: 0,
        phase: PHASES.NIGHT,
        day: 1,
        order,
        players: Object.fromEntries(players.map(([id, player]) => [id, {
            id,
            name: normalizeName(player?.name),
            alive: true
        }])),
        roles,
        night: createNightState(),
        votes: {},
        detectiveChecks: {},
        lastNight: null,
        lastVote: null,
        winner: null,
        log: {}
    };

    appendLog(engine, "Игра началась. Город засыпает.");
    assertFirebaseSafe(engine);
    return engine;
}

export function applyCommand(engine, command, hostId) {
    assertEngine(engine);
    if (!command?.type || !command?.from) throw new Error("Некорректная игровая команда.");
    if (engine.phase === PHASES.FINISHED) throw new Error("Партия уже завершена.");

    switch (command.type) {
        case "MAFIA_VOTE":
            mafiaVote(engine, command);
            break;
        case "DOCTOR_HEAL":
            doctorHeal(engine, command);
            break;
        case "DETECTIVE_CHECK":
            detectiveCheck(engine, command);
            break;
        case "ESCORT_BLOCK":
            escortBlock(engine, command);
            break;
        case "MANIAC_KILL":
            maniacKill(engine, command);
            break;
        case "START_DAY":
            requireHost(command, hostId);
            startDay(engine);
            break;
        case "START_VOTING":
            requireHost(command, hostId);
            startVoting(engine);
            break;
        case "VOTE":
            dayVote(engine, command);
            break;
        case "FINISH_VOTING":
            requireHost(command, hostId);
            finishVoting(engine);
            break;
        case "START_NIGHT":
            requireHost(command, hostId);
            startNight(engine);
            break;
        default:
            return false;
    }

    engine.revision += 1;
    assertFirebaseSafe(engine);
    return true;
}

export function createPublicState(engine) {
    assertEngine(engine);
    const finished = engine.phase === PHASES.FINISHED;
    const nightProgress = getNightProgress(engine);

    return {
        gameType: engine.gameType,
        revision: engine.revision,
        phase: engine.phase,
        day: engine.day,
        order: engine.order,
        players: Object.fromEntries(Object.entries(engine.players).map(([id, player]) => [id, {
            ...player,
            ...(!player.alive || finished ? { role: engine.roles[id] } : {})
        }])),
        playersAlive: alivePlayerIds(engine).length,
        nightActionsSubmitted: nightProgress.submitted,
        nightActionsRequired: nightProgress.required,
        votesSubmitted: Object.keys(engine.votes).length,
        votesRequired: alivePlayerIds(engine).length,
        lastNight: engine.lastNight,
        lastVote: engine.lastVote,
        winner: engine.winner,
        log: engine.log
    };
}

export function createPrivateStates(engine) {
    assertEngine(engine);
    const aliveMafia = alivePlayerIds(engine).filter((id) => engine.roles[id] === ROLES.MAFIA);

    return Object.fromEntries(engine.order.map((id) => {
        const role = engine.roles[id];
        const selectedTarget = selectedNightTarget(engine, id);
        return [id, {
            role,
            alive: engine.players[id].alive,
            actionSubmitted: Boolean(selectedTarget),
            selectedTarget,
            voteTarget: engine.votes[id] ?? "",
            ...(role === ROLES.MAFIA ? {
                mafia: aliveMafia,
                mafiaVotes: { ...engine.night.mafiaVotes }
            } : {}),
            ...(role === ROLES.DETECTIVE ? {
                checks: engine.detectiveChecks[id] ?? {}
            } : {})
        }];
    }));
}

export function getRoleLineup(playerCount, options = {}) {
    const placeholderIds = Array.from({ length: playerCount }, (_, index) => `player_${index}`);
    const roles = assignRoles(placeholderIds, options, () => 0.999999);
    const counts = {};
    for (const role of Object.values(roles)) counts[role] = (counts[role] ?? 0) + 1;
    return counts;
}

export function assertFirebaseSafe(value) {
    const visit = (item, path = "root") => {
        if (item === undefined) throw new Error(`Значение ${path} равно undefined.`);
        if (typeof item === "number" && !Number.isFinite(item)) {
            throw new Error(`Значение ${path} не является конечным числом.`);
        }
        if (Array.isArray(item)) item.forEach((entry, index) => visit(entry, `${path}[${index}]`));
        else if (item && typeof item === "object") {
            for (const [key, entry] of Object.entries(item)) visit(entry, `${path}.${key}`);
        }
    };

    visit(value);
    return value;
}

function assignRoles(playerIds, options, random) {
    const playerCount = playerIds.length;
    const mafiaCount = Number.isInteger(options.mafiaCount)
        ? options.mafiaCount
        : playerCount >= 13 ? 3 : playerCount >= 8 ? 2 : 1;
    const includeDetective = options.includeDetective ?? playerCount >= 4;
    const includeDoctor = options.includeDoctor ?? playerCount >= 5;
    const includeEscort = options.includeEscort ?? playerCount >= 6;
    const includeManiac = options.includeManiac ?? playerCount >= 9;
    const includeJester = options.includeJester ?? playerCount >= 10;
    const specialRoles = [
        ...(includeDetective ? [ROLES.DETECTIVE] : []),
        ...(includeDoctor ? [ROLES.DOCTOR] : []),
        ...(includeEscort ? [ROLES.ESCORT] : []),
        ...(includeManiac ? [ROLES.MANIAC] : []),
        ...(includeJester ? [ROLES.JESTER] : [])
    ];
    const citizenCount = playerCount - mafiaCount - specialRoles.length;

    if (mafiaCount < 1 || mafiaCount >= playerCount || citizenCount < 1) {
        throw new Error("Для выбранного состава не хватает мирных жителей.");
    }

    const deck = [
        ...Array(mafiaCount).fill(ROLES.MAFIA),
        ...specialRoles,
        ...Array(citizenCount).fill(ROLES.CITIZEN)
    ];
    shuffle(deck, random);
    return Object.fromEntries(playerIds.map((id, index) => [id, deck[index]]));
}

function mafiaVote(engine, command) {
    requireNightAction(engine, command.from, ROLES.MAFIA);
    requireAliveTarget(engine, command.data?.targetId);
    if (engine.roles[command.data.targetId] === ROLES.MAFIA) {
        throw new Error("Мафия не может выбрать своего участника.");
    }
    engine.night.mafiaVotes[command.from] = command.data.targetId;
}

function doctorHeal(engine, command) {
    requireNightAction(engine, command.from, ROLES.DOCTOR);
    requireAliveTarget(engine, command.data?.targetId);
    engine.night.doctorTarget = command.data.targetId;
}

function detectiveCheck(engine, command) {
    requireNightAction(engine, command.from, ROLES.DETECTIVE);
    requireOtherAliveTarget(engine, command.from, command.data?.targetId);
    engine.night.detectiveTarget = command.data.targetId;
}

function escortBlock(engine, command) {
    requireNightAction(engine, command.from, ROLES.ESCORT);
    requireOtherAliveTarget(engine, command.from, command.data?.targetId);
    engine.night.escortTarget = command.data.targetId;
}

function maniacKill(engine, command) {
    requireNightAction(engine, command.from, ROLES.MANIAC);
    requireOtherAliveTarget(engine, command.from, command.data?.targetId);
    engine.night.maniacTarget = command.data.targetId;
}

function startDay(engine) {
    requirePhase(engine, PHASES.NIGHT);
    const progress = getNightProgress(engine);
    if (progress.submitted < progress.required) {
        throw new Error(`Не все ночные роли сделали выбор: ${progress.submitted} из ${progress.required}.`);
    }

    const blockedId = aliveRoleId(engine, ROLES.ESCORT)
        ? engine.night.escortTarget
        : "";
    const mafiaVotes = Object.fromEntries(Object.entries(engine.night.mafiaVotes)
        .filter(([voterId]) => voterId !== blockedId && engine.players[voterId]?.alive));
    const mafiaTarget = resolveUniqueVoteTarget(mafiaVotes);
    const doctorId = aliveRoleId(engine, ROLES.DOCTOR);
    const doctorTarget = doctorId && doctorId !== blockedId ? engine.night.doctorTarget : "";
    const maniacId = aliveRoleId(engine, ROLES.MANIAC);
    const maniacTarget = maniacId && maniacId !== blockedId ? engine.night.maniacTarget : "";
    const attacked = new Set([mafiaTarget, maniacTarget].filter(Boolean));
    const killedPlayerIds = [...attacked].filter((id) => id !== doctorTarget);

    for (const playerId of killedPlayerIds) engine.players[playerId].alive = false;

    const detectiveId = aliveRoleId(engine, ROLES.DETECTIVE);
    if (detectiveId && detectiveId !== blockedId && engine.night.detectiveTarget) {
        const targetId = engine.night.detectiveTarget;
        engine.detectiveChecks[detectiveId] ??= {};
        engine.detectiveChecks[detectiveId][targetId] = engine.roles[targetId] === ROLES.MAFIA;
    }

    engine.lastNight = {
        killedPlayerIds,
        someoneWasSaved: Boolean(doctorTarget && attacked.has(doctorTarget))
    };
    engine.phase = PHASES.DAY;
    engine.lastVote = null;
    appendLog(engine, killedPlayerIds.length
        ? `${killedPlayerIds.map((id) => engine.players[id].name).join(" и ")} не пережили ночь.`
        : "Этой ночью никто не погиб.");
    updateWinner(engine);
}

function startVoting(engine) {
    requirePhase(engine, PHASES.DAY);
    engine.phase = PHASES.VOTING;
    engine.votes = {};
    engine.lastVote = null;
    appendLog(engine, "Началось дневное голосование.");
}

function dayVote(engine, command) {
    requirePhase(engine, PHASES.VOTING);
    requireAlivePlayer(engine, command.from);
    requireOtherAliveTarget(engine, command.from, command.data?.targetId);
    engine.votes[command.from] = command.data.targetId;
}

function finishVoting(engine) {
    requirePhase(engine, PHASES.VOTING);
    const alive = alivePlayerIds(engine);
    if (Object.keys(engine.votes).length < alive.length) {
        throw new Error(`Ещё не все проголосовали: ${Object.keys(engine.votes).length} из ${alive.length}.`);
    }

    const counts = countVotes(engine.votes);
    const eliminatedId = resolveUniqueVoteTarget(engine.votes);
    if (eliminatedId) engine.players[eliminatedId].alive = false;
    engine.lastVote = {
        eliminatedPlayerId: eliminatedId,
        tie: !eliminatedId,
        counts
    };
    appendLog(engine, eliminatedId
        ? `${engine.players[eliminatedId].name} покидает игру по решению города. Роль: ${ROLE_LABELS[engine.roles[eliminatedId]]}.`
        : "Голоса разделились поровну. Никто не покидает игру.");

    if (eliminatedId && engine.roles[eliminatedId] === ROLES.JESTER) {
        finishGame(engine, "jester", "Самоубийца добился казни и победил.");
        return;
    }

    engine.phase = PHASES.VERDICT;
    updateWinner(engine);
}

function startNight(engine) {
    requirePhase(engine, PHASES.VERDICT);
    engine.day += 1;
    engine.phase = PHASES.NIGHT;
    engine.night = createNightState();
    engine.votes = {};
    engine.lastVote = null;
    appendLog(engine, `Наступает ночь ${engine.day}.`);
}

function updateWinner(engine) {
    const alive = alivePlayerIds(engine);
    const mafiaCount = alive.filter((id) => engine.roles[id] === ROLES.MAFIA).length;
    const maniacCount = alive.filter((id) => engine.roles[id] === ROLES.MANIAC).length;
    const nonMafiaCount = alive.length - mafiaCount;

    if (maniacCount === 1 && alive.length === 1) {
        finishGame(engine, "maniac", "Маньяк остался последним выжившим.");
    } else if (mafiaCount === 0 && maniacCount === 0) {
        finishGame(engine, "city", "Город избавился от всех убийц.");
    } else if (mafiaCount > 0 && mafiaCount >= nonMafiaCount) {
        finishGame(engine, "mafia", "Мафия получила контроль над городом.");
    }
}

function finishGame(engine, winner, message) {
    engine.winner = winner;
    engine.phase = PHASES.FINISHED;
    appendLog(engine, message);
}

function getNightProgress(engine) {
    const actors = alivePlayerIds(engine).filter((id) => NIGHT_ROLES.has(engine.roles[id]));
    const submitted = actors.filter((id) => Boolean(selectedNightTarget(engine, id))).length;
    return { submitted, required: actors.length };
}

function selectedNightTarget(engine, playerId) {
    const role = engine.roles[playerId];
    if (role === ROLES.MAFIA) return engine.night.mafiaVotes[playerId] ?? "";
    if (role === ROLES.DOCTOR) return engine.night.doctorTarget ?? "";
    if (role === ROLES.DETECTIVE) return engine.night.detectiveTarget ?? "";
    if (role === ROLES.ESCORT) return engine.night.escortTarget ?? "";
    if (role === ROLES.MANIAC) return engine.night.maniacTarget ?? "";
    return "";
}

function resolveUniqueVoteTarget(votes) {
    const counts = countVotes(votes);
    const highest = Math.max(0, ...Object.values(counts));
    if (!highest) return "";
    const leaders = Object.keys(counts).filter((id) => counts[id] === highest);
    return leaders.length === 1 ? leaders[0] : "";
}

function countVotes(votes) {
    const counts = {};
    for (const targetId of Object.values(votes)) counts[targetId] = (counts[targetId] ?? 0) + 1;
    return counts;
}

function createNightState() {
    return {
        mafiaVotes: {},
        doctorTarget: "",
        detectiveTarget: "",
        escortTarget: "",
        maniacTarget: ""
    };
}

function alivePlayerIds(engine) {
    return engine.order.filter((id) => engine.players[id]?.alive);
}

function aliveRoleId(engine, role) {
    return alivePlayerIds(engine).find((id) => engine.roles[id] === role) ?? "";
}

function requireAlivePlayer(engine, playerId) {
    if (!engine.players[playerId]?.alive) throw new Error("Этот игрок уже покинул партию.");
}

function requireAliveTarget(engine, targetId) {
    if (!targetId || !engine.players[targetId]?.alive) throw new Error("Выберите живого игрока.");
}

function requireOtherAliveTarget(engine, playerId, targetId) {
    requireAliveTarget(engine, targetId);
    if (targetId === playerId) throw new Error("Нельзя выбрать самого себя.");
}

function requireNightAction(engine, playerId, role) {
    requirePhase(engine, PHASES.NIGHT);
    requireAlivePlayer(engine, playerId);
    if (engine.roles[playerId] !== role) throw new Error("Эта команда недоступна вашей роли.");
}

function requirePhase(engine, phase) {
    if (engine.phase !== phase) throw new Error("Эта команда недоступна в текущей фазе.");
}

function requireHost(command, hostId) {
    if (!hostId || command.from !== hostId) throw new Error("Эту команду может выполнить только ведущий.");
}

function validatePlayers(players) {
    if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
        throw new Error(`Для игры нужно от ${MIN_PLAYERS} до ${MAX_PLAYERS} игроков.`);
    }
    const ids = players.map(([id]) => id);
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
        throw new Error("У каждого игрока должен быть уникальный идентификатор.");
    }
}

function assertEngine(engine) {
    if (!engine || engine.gameType !== GAME_TYPE) throw new Error("Некорректное состояние игры.");
}

function normalizeName(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 24) || "Игрок";
}

function shuffle(items, random) {
    for (let index = items.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
}

function appendLog(engine, message) {
    const createdAt = Date.now();
    let key = `event_${createdAt}_${engine.revision}`;
    while (engine.log[key]) key += "_";
    engine.log[key] = {
        message,
        createdAt,
        day: engine.day,
        phase: engine.phase
    };
}
