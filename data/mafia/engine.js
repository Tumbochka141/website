export const GAME_TYPE = "mafia";

export const PHASES = Object.freeze({
    NIGHT: "night",
    DAY: "day",
    VOTING: "voting",
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

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 16;

export function createInitialGame(players, options = {}, random = Math.random) {
    validatePlayers(players);

    const order = players.map(([id]) => id);
    const roles = assignRoles(order, options, random);

    return {
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
        winner: null,
        log: {
            start: {
                message: "Игра началась. Город засыпает.",
                createdAt: Date.now()
            }
        }
    };
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

    return {
        gameType: engine.gameType,
        revision: engine.revision,
        phase: engine.phase,
        day: engine.day,
        order: engine.order,
        players: Object.fromEntries(Object.entries(engine.players).map(([id, player]) => [id, {
            ...player,
            ...(finished ? { role: engine.roles[id] } : {})
        }])),
        votesSubmitted: Object.keys(engine.votes).length,
        lastNight: engine.lastNight,
        winner: engine.winner,
        log: engine.log
    };
}

export function createPrivateStates(engine) {
    assertEngine(engine);
    const mafia = alivePlayerIds(engine).filter((id) => engine.roles[id] === ROLES.MAFIA);

    return Object.fromEntries(engine.order.map((id) => [id, {
        role: engine.roles[id],
        alive: engine.players[id].alive,
        ...(engine.roles[id] === ROLES.MAFIA ? { mafia } : {}),
        ...(engine.roles[id] === ROLES.DETECTIVE
            ? { checks: engine.detectiveChecks[id] ?? {} }
            : {})
    }]));
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

    const mafiaCount = Number.isInteger(options.mafiaCount)? options.mafiaCount: playerCount >= 13 ? 3: playerCount >= 8 ? 2: 1;
    const includeDetective = options.includeDetective ?? playerCount >=4;
    const includeDoctor = options.includeDoctor ?? playerCount >=5;
    const includeEscort = options.includeEscort ?? playerCount >=6;
    const includeManiac = options.includeManiac ?? playerCount >=9;
    const includeJester = options.includeJester ?? playerCount >=10; // тут я стопаю в 0.04 26.07.2026
    const specialRoles = [
        ...(includeDetective ? [ROLES.DETECTIVE] : []),
        ...(includeDoctor ?[ROLES.DOCTOR] : []),
        ...(includeEscort ? [ROLES.ESCORT]: []),
        ...(includeManiac ? [ROLES.MANIAC]: []),
        ...(includeJester ? [ROLES.JESTER]: [])
    ];
    const citizenCount = playerCount - mafiaCount - specialRoles.length;

    if (mafiaCount < 1 || citizenCount < 1){
        throw new Error("Игроков маловато");
    }

    const deck = [
        ...Array(mafiaCount).fill(ROLES.MAFIA),
        ...specialRoles,
        ...Array(citizenCount).fill(ROLES.CITIZEN)
    ];

    shuffle(deck, random);

    return Object.fromEntries(
        playerIds.map((id,index) => [id,deck[index]])
    );

}

function mafiaVote(engine, command) {
    requirePhase(engine, PHASES.NIGHT);
    requireAliveRole(engine, command.from, ROLES.MAFIA);
    requireAliveTarget(engine, command.data?.targetId);
    if (engine.roles[command.data.targetId] === ROLES.MAFIA) {
        throw new Error("Мафия не может выбрать участника мафии.");
    }
    engine.night.mafiaVotes[command.from] = command.data.targetId;
}

function doctorHeal(engine, command) {
    requirePhase(engine, PHASES.NIGHT);
    requireAliveRole(engine, command.from, ROLES.DOCTOR);
    requireAliveTarget(engine, command.data?.targetId);
    engine.night.doctorTarget = command.data.targetId;
}

function detectiveCheck(engine, command) {
    requirePhase(engine, PHASES.NIGHT);
    requireAliveRole(engine, command.from, ROLES.DETECTIVE);
    requireAliveTarget(engine, command.data?.targetId);
    if (command.data.targetId === command.from) throw new Error("Нельзя проверить самого себя.");

    engine.night.detectiveTarget = command.data.targetId;
    engine.detectiveChecks[command.from] ??= {};
    engine.detectiveChecks[command.from][command.data.targetId] =
        engine.roles[command.data.targetId] === ROLES.MAFIA;
}

function startDay(engine) {
    requirePhase(engine, PHASES.NIGHT);
    const targetId = resolveMafiaTarget(engine.night.mafiaVotes);
    const killedId = targetId && targetId !== engine.night.doctorTarget ? targetId : "";
    if (killedId) engine.players[killedId].alive = false;

    engine.lastNight = {
        killedPlayerId: killedId,
        someoneWasSaved: Boolean(targetId && !killedId)
    };
    engine.phase = PHASES.DAY;
    appendLog(engine, killedId
        ? `${engine.players[killedId].name} не пережил эту ночь.`
        : "Этой ночью никто не погиб.");
    updateWinner(engine);
}

function startVoting(engine) {
    requirePhase(engine, PHASES.DAY);
    engine.phase = PHASES.VOTING;
    engine.votes = {};
    appendLog(engine, "Началось дневное голосование.");
}

function dayVote(engine, command) {
    requirePhase(engine, PHASES.VOTING);
    requireAlivePlayer(engine, command.from);
    requireAliveTarget(engine, command.data?.targetId);
    if (command.data.targetId === command.from) throw new Error("Нельзя голосовать за себя.");
    engine.votes[command.from] = command.data.targetId;
}

function finishVoting(engine) {
    requirePhase(engine, PHASES.VOTING);
    const alive = alivePlayerIds(engine);
    if (Object.keys(engine.votes).length < alive.length) {
        throw new Error("Ещё не все живые игроки проголосовали.");
    }

    const eliminatedId = resolveUniqueVoteTarget(engine.votes);
    if (eliminatedId) engine.players[eliminatedId].alive = false;
    appendLog(engine, eliminatedId
        ? `${engine.players[eliminatedId].name} покидает игру по решению города.`
        : "Голоса разделились поровну. Никто не покидает игру.");
    engine.phase = PHASES.DAY;
    updateWinner(engine);
}

function startNight(engine) {
    requirePhase(engine, PHASES.DAY);
    engine.day += 1;
    engine.phase = PHASES.NIGHT;
    engine.night = createNightState();
    engine.votes = {};
    appendLog(engine, `Наступает ночь ${engine.day}.`);
}

function updateWinner(engine) {
    const alive = alivePlayerIds(engine);
    const mafiaCount = alive.filter((id) => engine.roles[id] === ROLES.MAFIA).length;
    const cityCount = alive.length - mafiaCount;

    if (mafiaCount === 0) engine.winner = "city";
    else if (mafiaCount >= cityCount) engine.winner = "mafia";
    else return;

    engine.phase = PHASES.FINISHED;
    appendLog(engine, engine.winner === "city" ? "Город победил." : "Мафия победила.");
}

function resolveMafiaTarget(votes) {
    const counts = countVotes(votes);
    const highest = Math.max(0, ...Object.values(counts));
    const leaders = Object.keys(counts).filter((id) => counts[id] === highest);
    return leaders.length === 1 ? leaders[0] : "";
}

function resolveUniqueVoteTarget(votes) {
    return resolveMafiaTarget(votes);
}

function countVotes(votes) {
    const counts = {};
    for (const targetId of Object.values(votes)) counts[targetId] = (counts[targetId] ?? 0) + 1;
    return counts;
}

function createNightState() {
    return { mafiaVotes: {}, doctorTarget: "", detectiveTarget: "" };
}

function alivePlayerIds(engine) {
    return engine.order.filter((id) => engine.players[id]?.alive);
}

function requireAlivePlayer(engine, playerId) {
    if (!engine.players[playerId]?.alive) throw new Error("Этот игрок не участвует в текущем ходе.");
}

function requireAliveTarget(engine, targetId) {
    if (!targetId || !engine.players[targetId]?.alive) throw new Error("Выберите живого игрока.");
}

function requireAliveRole(engine, playerId, role) {
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
    const key = `event_${Date.now()}_${engine.revision}`;
    engine.log[key] = { message, createdAt: Date.now() };
}
