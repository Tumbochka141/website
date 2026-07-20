import {
    SPECIAL_CARDS,
    drawScenarioCard,
    drawSpecialCard,
    drawTraitCard,
    generateCharacters,
    generateScenarios
} from "./cards.js";

export const GAME_TYPE = "bunker";

export const PHASES = {
    LOBBY: "lobby",
    REVEAL: "reveal",
    DISCUSSION: "discussion",
    VOTING: "voting",
    RESULTS: "results",
    FINISHED: "finished"
};

export const TRAIT_KEYS = [
    "profession", "health", "biology", "fact", "hobby", "baggage", "special"
];

export const TRAIT_LABELS = {
    profession: "Профессия",
    health: "Здоровье",
    biology: "Биоданные",
    fact: "Факт",
    hobby: "Хобби",
    baggage: "Багаж",
    special: "Особая карта"
};

export function createInitialGame(players, capacity, random = Math.random) {
    const order = players.map(([playerId]) => playerId);
    const characters = generateCharacters(order, random);
    const scenarios = generateScenarios(random);
    const playerStates = {};
    const votes = {};

    for (const [playerId, player] of players) {
        playerStates[playerId] = {
            id: playerId,
            name: player.name,
            status: "active",
            revealedTraits: createHiddenTraits(),
            hasFinishedTurn: false,
            revealedThisTurn: false,
            voteSubmitted: false,
            specialUsed: false,
            voteMultiplier: 1,
            voteDisabled: false,
            immuneThisRound: false
        };
        votes[playerId] = "";
    }

    return {
        gameType: GAME_TYPE,
        revision: 0,
        phase: PHASES.REVEAL,
        round: 1,
        totalRounds: players.length - capacity,
        capacity,
        order,
        currentPlayerIndex: 0,
        players: playerStates,
        characters,
        votes,
        lastExiledPlayerId: "",
        voteResult: emptyVoteResult(),
        roundEffects: {},
        scenarioSecrets: scenarios,
        extraScenarios: {},
        catastrophe: hiddenScenario("Катастрофа"),
        bunker: hiddenScenario("Бункер"),
        threat: hiddenScenario("Угроза"),
        log: {
            start: {
                message: "Партия началась.",
                createdAt: Date.now()
            }
        }
    };
}

export function applyCommand(engine, command, hostId) {
    switch (command.type) {
        case "REVEAL_TRAIT":
            revealTrait(engine, command);
            break;
        case "FINISH_TURN":
            finishTurn(engine, command);
            break;
        case "VOTE":
            vote(engine, command);
            break;
        case "NEXT_PHASE":
            nextPhase(engine, command, hostId);
            break;
        case "REVEAL_SCENARIO":
            revealScenario(engine, command, hostId);
            break;
        case "HOST_EDIT":
            hostEdit(engine, command, hostId);
            break;
        case "PLAY_SPECIAL":
            playSpecial(engine, command);
            break;
        case "RESPOND_SECRET_SHARE":
            respondSecretShare(engine, command);
            break;
        default:
            return false;
    }

    engine.revision += 1;
    return true;
}

export function createPublicState(engine) {
    return {
        gameType: engine.gameType,
        revision: engine.revision,
        phase: engine.phase,
        round: engine.round,
        totalRounds: engine.totalRounds,
        capacity: engine.capacity,
        order: engine.order,
        currentPlayerIndex: engine.currentPlayerIndex,
        players: createPublicPlayers(engine.players),
        lastExiledPlayerId: engine.lastExiledPlayerId ?? "",
        voteResult: engine.voteResult,
        catastrophe: engine.catastrophe,
        bunker: engine.bunker,
        threat: engine.threat,
        extraScenarios: engine.extraScenarios ?? {},
        ...(engine.pendingSpecialChoice ? { pendingSpecialChoice: engine.pendingSpecialChoice } : {}),
        ...(engine.pendingSecretShare ? { pendingSecretShare: engine.pendingSecretShare } : {}),
        log: engine.log
    };
}

function createPublicPlayers(players) {
    return Object.fromEntries(Object.entries(players).map(([id, player]) => [id, {
        id: player.id,
        name: player.name,
        status: player.status,
        revealedTraits: player.revealedTraits,
        hasFinishedTurn: Boolean(player.hasFinishedTurn),
        revealedThisTurn: Boolean(player.revealedThisTurn),
        voteSubmitted: Boolean(player.voteSubmitted),
        specialUsed: Boolean(player.specialUsed),
        voteMultiplier: Number(player.voteMultiplier ?? 1),
        voteDisabled: Boolean(player.voteDisabled),
        immuneThisRound: Boolean(player.immuneThisRound),
        persistentVoter: Boolean(player.persistentVoter),
        forcedSelfVote: Boolean(player.forcedSelfVote),
        ...(player.cannotVoteAgainst ? { cannotVoteAgainst: player.cannotVoteAgainst } : {})
    }]));
}

export function createPrivateStates(engine) {
    return Object.fromEntries(engine.order.map((playerId) => [
        playerId,
        {
            ...engine.characters[playerId],
            ...(engine.sharedSecrets?.[playerId] ? { sharedSecrets: engine.sharedSecrets[playerId] } : {})
        }
    ]));
}

export function assertFirebaseSafe(value, path = "state") {
    if (value === undefined) throw new Error(`undefined в ${path}`);
    if (value === null) throw new Error(`null в ${path}`);
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
        assertFirebaseSafe(child, `${path}.${key}`);
    }
}

function revealTrait(engine, command) {
    const playerId = command.from;
    const trait = command.data?.trait;
    const currentPlayerId = engine.order[engine.currentPlayerIndex];
    const player = engine.players?.[playerId];

    if (engine.phase !== PHASES.REVEAL) throw new Error("Сейчас нельзя раскрывать характеристики.");
    if (playerId !== currentPlayerId) throw new Error("Сейчас ход другого игрока.");
    if (!player || player.status !== "active") throw new Error("Игрок не участвует в партии.");
    if (!TRAIT_KEYS.includes(trait)) throw new Error("Неизвестная характеристика.");
    const forcedTrait = engine.roundEffects?.forcedTrait;
    if (forcedTrait && !player.revealedTraits?.[forcedTrait] && trait !== forcedTrait) {
        throw new Error(`В этом раунде нужно раскрыть: ${TRAIT_LABELS[forcedTrait]}.`);
    }
    if (player.revealedThisTurn) throw new Error("В этом ходу характеристика уже раскрыта.");
    if (player.revealedTraits[trait]) throw new Error("Эта характеристика уже раскрыта.");

    const value = engine.characters?.[playerId]?.[trait];
    if (!value) throw new Error("Характеристика не найдена.");

    player.revealedTraits[trait] = value;
    player.revealedThisTurn = true;
    engine.firstReveal ??= {};
    if (!engine.firstReveal[trait]) engine.firstReveal[trait] = playerId;
    appendLog(engine, `${player.name} раскрывает: ${TRAIT_LABELS[trait]} — ${value}.`);
}

function finishTurn(engine, command) {
    const playerId = command.from;
    const currentPlayerId = engine.order[engine.currentPlayerIndex];
    const player = engine.players?.[playerId];

    if (engine.phase !== PHASES.REVEAL) throw new Error("Сейчас нельзя завершать ход.");
    if (playerId !== currentPlayerId) throw new Error("Сейчас ход другого игрока.");
    if (!player || player.status !== "active") throw new Error("Игрок не участвует в партии.");
    const hasHiddenTraits = TRAIT_KEYS.some((trait) => !player.revealedTraits?.[trait]);
    if (!player.revealedThisTurn && hasHiddenTraits) throw new Error("Сначала раскройте характеристику.");

    player.revealedThisTurn = false;
    player.hasFinishedTurn = true;
    const activeIds = activePlayerIds(engine);

    if (activeIds.every((id) => engine.players[id].hasFinishedTurn)) {
        engine.phase = PHASES.DISCUSSION;
        engine.currentPlayerIndex = -1;
        appendLog(engine, "Все участники завершили ходы. Начинается обсуждение.");
        return;
    }

    for (let offset = 1; offset <= engine.order.length; offset += 1) {
        const nextIndex = (engine.currentPlayerIndex + offset) % engine.order.length;
        const nextId = engine.order[nextIndex];
        const nextPlayer = engine.players[nextId];
        if (nextPlayer?.status === "active" && !nextPlayer.hasFinishedTurn) {
            engine.currentPlayerIndex = nextIndex;
            appendLog(engine, `Ход переходит к игроку ${nextPlayer.name}.`);
            return;
        }
    }
}

function vote(engine, command) {
    const voterId = command.from;
    const targetId = command.data?.targetId;
    const voter = engine.players?.[voterId];
    const target = engine.players?.[targetId];

    if (engine.phase !== PHASES.VOTING) throw new Error("Сейчас голосование не проводится.");
    if (!voter || !votingPlayerIds(engine).includes(voterId)) throw new Error("Вы не участвуете в голосовании.");
    if (!target || target.status !== "active") throw new Error("Нельзя голосовать за этого игрока.");
    if (voter.voteDisabled) throw new Error("Ваша особая карта запрещает вам голосовать в этом раунде.");
    if (target.immuneThisRound) throw new Error("У этого игрока иммунитет в текущем голосовании.");
    if (voter.cannotVoteAgainst?.[targetId]) throw new Error("Вы не можете голосовать против этого игрока.");
    if (voter.forcedSelfVote && targetId !== voterId) throw new Error("В этом голосовании вы обязаны проголосовать против себя.");
    if (engine.roundEffects?.previousVoteTargets?.[voterId] === targetId) {
        throw new Error("При переголосовании нужно выбрать другого кандидата.");
    }

    const revoteCandidates = engine.voteResult?.status === "tie"
        ? engine.voteResult.candidates ?? []
        : [];
    if (revoteCandidates.length && !revoteCandidates.includes(targetId)) {
        throw new Error("При переголосовании выберите одного из лидеров.");
    }

    engine.votes[voterId] = targetId;
    voter.voteSubmitted = true;
    if (targetId === voterId) voter.forcedSelfVote = false;
}

function nextPhase(engine, command, hostId) {
    if (command.from !== hostId) throw new Error("Менять фазу может только ведущий.");

    if (engine.phase === PHASES.DISCUSSION) {
        engine.phase = PHASES.VOTING;
        engine.currentPlayerIndex = -1;
        engine.voteResult = emptyVoteResult();
        resetVotes(engine);
        appendLog(engine, "Ведущий открыл голосование.");
        return;
    }

    if (engine.phase === PHASES.VOTING) {
        closeVoting(engine);
        return;
    }

    if (engine.phase === PHASES.RESULTS) {
        continueAfterResults(engine);
        return;
    }

    throw new Error("Сейчас нельзя менять фазу.");
}

function closeVoting(engine) {
    const activeIds = activePlayerIds(engine);
    const submittedIds = votingPlayerIds(engine).filter((id) => engine.players[id].voteSubmitted && engine.votes[id]);
    if (!submittedIds.length) throw new Error("Пока никто не проголосовал.");

    const counts = {};
    const votersByTarget = {};
    const discreditedVoters = new Set();
    for (const ownerId of Object.keys(engine.roundEffects?.discreditOwners ?? {})) {
        const candidateId = engine.votes[ownerId];
        if (candidateId) discreditedVoters.add(candidateId);
    }
    for (const voterId of submittedIds) {
        if (engine.players[voterId].voteDisabled || discreditedVoters.has(voterId)) continue;
        const targetId = engine.votes[voterId];
        if (engine.players[targetId]?.immuneThisRound) continue;
        let weight = Number(engine.players[voterId].voteMultiplier ?? 1);
        if (engine.roundEffects?.doubleAgainstTarget === targetId) weight *= 2;
        counts[targetId] = (counts[targetId] ?? 0) + weight;
        votersByTarget[targetId] ??= [];
        votersByTarget[targetId].push(voterId);
        if (engine.players[targetId]?.selfPenaltyAgainst) counts[voterId] = (counts[voterId] ?? 0) + 1;
    }

    for (const ownerId of activeIds) {
        const owner = engine.players[ownerId];
        const against = counts[ownerId] ?? 0;
        if (owner.ignoreVotesIfHalf && against >= Math.ceil(votingPlayerIds(engine).length / 2)) counts[ownerId] = 0;
        if (owner.ignoreVotesIfEven && against > 0 && against % 2 === 0) counts[ownerId] = 0;
        if (owner.loneVoteTriple) {
            const targetId = engine.votes[ownerId];
            if (targetId && votersByTarget[targetId]?.length === 1) counts[targetId] = (counts[targetId] ?? 0) + 2;
        }
        if (owner.votersGetHealth) {
            for (const voterId of votersByTarget[ownerId] ?? []) replaceTrait(engine, voterId, "health", drawTraitCard("health"), true);
        }
    }

    const missingTrait = engine.roundEffects?.missingTraitBonus;
    if (missingTrait) {
        for (const id of activeIds) {
            if (!engine.players[id].revealedTraits?.[missingTrait]) counts[id] = (counts[id] ?? 0) + 1;
        }
    }
    for (const [id, count] of Object.entries(counts)) {
        if (count <= 0) delete counts[id];
    }
    if (!Object.keys(counts).length) throw new Error("После применения особых карт не осталось учитываемых голосов.");

    const maximum = Math.max(...Object.values(counts));
    const leaders = Object.keys(counts).filter((id) => counts[id] === maximum);
    if (leaders.length === 1) {
        const exiledPlayerId = leaders[0];
        exilePlayer(engine, exiledPlayerId);
        engine.voteResult = { status: "exiled", exiledPlayerId, candidates: leaders, counts };
        appendLog(engine, `${engine.players[exiledPlayerId].name} изгнан из группы.`);
    } else {
        engine.voteResult = { status: "tie", exiledPlayerId: "", candidates: leaders, counts };
        appendLog(engine, "Голоса разделились поровну. Требуется переголосование.");
    }
    engine.phase = PHASES.RESULTS;
}

function continueAfterResults(engine) {
    if (engine.voteResult.status === "tie") {
        engine.phase = PHASES.VOTING;
        engine.currentPlayerIndex = -1;
        resetVotes(engine);
        appendLog(engine, "Началось переголосование между лидерами.");
        return;
    }

    if (engine.voteResult.status !== "exiled") throw new Error("Результат голосования ещё не готов.");
    applySecondChances(engine);
    const activeIds = activePlayerIds(engine);
    engine.totalRounds = Math.max(engine.round, engine.round + activeIds.length - engine.capacity);
    if (activeIds.length <= engine.capacity) {
        engine.phase = PHASES.FINISHED;
        engine.currentPlayerIndex = -1;
        appendLog(engine, `Двери бункера закрыты. Выжили: ${activeIds.map((id) => engine.players[id].name).join(", ")}.`);
        return;
    }

    engine.round += 1;
    engine.phase = PHASES.REVEAL;
    engine.voteResult = emptyVoteResult();
    engine.roundEffects = {};
    for (const id of activeIds) {
        const player = engine.players[id];
        player.hasFinishedTurn = false;
        player.revealedThisTurn = false;
        player.voteSubmitted = false;
        player.voteMultiplier = 1;
        player.voteDisabled = false;
        player.immuneThisRound = false;
        player.ignoreVotesIfHalf = false;
        player.ignoreVotesIfEven = false;
        player.selfPenaltyAgainst = false;
        player.loneVoteTriple = false;
        player.votersGetHealth = false;
        engine.votes[id] = "";
    }
    for (const id of votingPlayerIds(engine)) {
        const player = engine.players[id];
        player.voteSubmitted = false;
        player.voteMultiplier = 1;
        player.voteDisabled = false;
        player.immuneThisRound = false;
        player.ignoreVotesIfHalf = false;
        player.ignoreVotesIfEven = false;
        player.selfPenaltyAgainst = false;
        player.loneVoteTriple = false;
        player.votersGetHealth = false;
        engine.votes[id] = "";
    }
    engine.currentPlayerIndex = engine.order.findIndex((id) => engine.players[id]?.status === "active");
    appendLog(engine, `Начинается раунд ${engine.round}.`);
}

function revealScenario(engine, command, hostId) {
    if (command.from !== hostId) throw new Error("Раскрывать условия может только ведущий.");
    const scenarioType = command.data?.scenarioType;
    if (!["catastrophe", "bunker", "threat"].includes(scenarioType)) {
        throw new Error("Неизвестный тип сценария.");
    }
    if (engine[scenarioType]?.status === "revealed") throw new Error("Эта карта уже раскрыта.");
    const secret = engine.scenarioSecrets?.[scenarioType];
    if (!secret) throw new Error("Данные сценария не найдены.");
    engine[scenarioType] = { status: "revealed", title: secret.title, description: secret.description };
    appendLog(engine, `Раскрыта карта «${secret.title}».`);
}

function hostEdit(engine, command, hostId) {
    if (command.from !== hostId) throw new Error("Редактировать партию может только ведущий.");
    const action = command.data?.action;

    if (action === "set_capacity") {
        const capacity = Number(command.data?.capacity);
        if (!Number.isInteger(capacity) || capacity < 1 || capacity >= engine.order.length) {
            throw new Error("Некорректное количество мест в бункере.");
        }
        engine.capacity = capacity;
        engine.totalRounds = Math.max(engine.round, engine.round + activePlayerIds(engine).length - capacity);
        appendLog(engine, `Ведущий изменил количество мест в бункере: ${capacity}.`);
        return;
    }

    if (action === "set_special") {
        const playerId = command.data?.playerId;
        const specialId = Number(command.data?.specialId);
        const player = engine.players?.[playerId];
        const special = SPECIAL_CARDS.find((card) => card.id === specialId);
        if (!player || !special) throw new Error("Игрок или особая карта не найдены.");
        engine.characters[playerId].special = special.text;
        engine.characters[playerId].specialId = special.id;
        player.specialUsed = false;
        player.revealedTraits.special = command.data?.revealed === true ? special.text : "";
        appendLog(engine, `Ведущий выдал игроку ${player.name} особую карту №${special.id}${command.data?.revealed ? `: ${special.text}` : ""}.`);
        return;
    }

    if (action === "set_trait" || action === "random_trait") {
        const playerId = command.data?.playerId;
        const trait = command.data?.trait;
        const player = engine.players?.[playerId];
        if (!player || !TRAIT_KEYS.includes(trait)) throw new Error("Игрок или тип карты не найден.");
        const wasRevealed = Boolean(player.revealedTraits?.[trait]);
        let value = String(command.data?.value ?? "").trim();
        if (action === "random_trait") {
            if (trait === "special") {
                const special = drawSpecialCard();
                value = special.text;
                engine.characters[playerId].specialId = special.id;
            } else {
                value = drawTraitCard(trait);
            }
        }
        if (!value) throw new Error("Значение карты не может быть пустым.");
        engine.characters[playerId][trait] = value;
        if (trait === "special" && action === "set_trait") engine.characters[playerId].specialId = 0;
        if (trait === "special") player.specialUsed = false;
        if (wasRevealed || command.data?.revealed === true) player.revealedTraits[trait] = value;
        else player.revealedTraits[trait] = "";
        appendLog(engine, `Ведущий изменил карту «${TRAIT_LABELS[trait]}» игрока ${player.name}${wasRevealed || command.data?.revealed ? `: ${value}` : ""}.`);
        return;
    }

    if (action === "set_status") {
        const player = engine.players?.[command.data?.playerId];
        const status = command.data?.status;
        if (!player || !["active", "exiled"].includes(status)) throw new Error("Некорректный статус игрока.");
        player.status = status;
        player.voteSubmitted = false;
        engine.votes[player.id] = "";
        repairCurrentTurn(engine);
        appendLog(engine, `Ведущий изменил статус игрока ${player.name}: ${status === "active" ? "возвращён в игру" : "изгнан"}.`);
        return;
    }

    if (action === "add_scenario") {
        const type = command.data?.scenarioType;
        if (!["catastrophe", "bunker", "threat"].includes(type)) throw new Error("Неизвестный тип карты условий.");
        const randomCard = command.data?.random === true ? drawScenarioCard(type) : null;
        const title = String(randomCard?.title ?? command.data?.title ?? "").trim();
        const description = String(randomCard?.description ?? command.data?.description ?? "").trim();
        if (!title || !description) throw new Error("Укажите название и описание карты.");
        engine.extraScenarios ??= {};
        engine.extraScenarios[type] ??= [];
        const card = { id: `extra_${Date.now()}_${engine.revision}`, title, description };
        engine.extraScenarios[type].push(card);
        appendLog(engine, `Ведущий добавил карту «${title}».`);
        return;
    }

    if (action === "remove_scenario") {
        const type = command.data?.scenarioType;
        const cards = engine.extraScenarios?.[type];
        const cardIndex = cards?.findIndex((card) => card.id === command.data?.cardId) ?? -1;
        if (cardIndex < 0) throw new Error("Дополнительная карта не найдена.");
        const [removed] = cards.splice(cardIndex, 1);
        appendLog(engine, `Ведущий убрал карту «${removed.title}».`);
        return;
    }

    if (action === "remove_primary_scenario") {
        const type = command.data?.scenarioType;
        if (!["catastrophe", "bunker", "threat"].includes(type)) throw new Error("Неизвестный тип карты условий.");
        const removedTitle = engine[type]?.title ?? "Карта условий";
        engine[type] = hiddenScenario(type === "catastrophe" ? "Катастрофа" : type === "bunker" ? "Бункер" : "Угроза");
        appendLog(engine, `Ведущий убрал карту «${removedTitle}».`);
        return;
    }

    throw new Error("Неизвестное действие редактора ведущего.");
}

function playSpecial(engine, command) {
    const playerId = command.from;
    const player = engine.players?.[playerId];
    const character = engine.characters?.[playerId];
    const specialId = Number(character?.specialId ?? 0);
    if (!player || !character) throw new Error("Персонаж не найден.");
    if (!player.revealedTraits?.special) throw new Error("Сначала раскройте особую карту.");
    if (player.specialUsed) throw new Error("Особая карта уже использована.");
    validateSpecialTiming(engine, specialId, player);

    const targetId = command.data?.targetId;
    const target = engine.players?.[targetId];
    const trait = command.data?.trait;
    const choice = command.data?.choice;
    const scenarioTarget = command.data?.scenarioTarget;
    const requireTarget = () => {
        if (!target) throw new Error("Выберите игрока для действия карты.");
        return target;
    };
    if (specialId === 71) {
        cancelLastSpecial(engine, playerId);
        return;
    }
    if (specialId === 54) {
        resolveBunkerBaggageChoice(engine, playerId, command.data?.choice);
        return;
    }
    if (specialId === 50) {
        redirectLastSpecial(engine, playerId, command.data ?? {});
        return;
    }
    const snapshot = captureSpecialSnapshot(engine);
    let automatic = true;

    if (specialId === 1) {
        if (player.status !== "exiled") throw new Error("Эту карту можно сыграть только после изгнания.");
        const removed = removeBunkerTarget(engine, scenarioTarget);
        addExtraScenario(engine, "exile", `У изгнанных: ${removed.title}`, removed.description);
    } else if (specialId === 2) {
        requireTarget().cannotVoteAgainst ??= {};
        target.cannotVoteAgainst[playerId] = true;
    } else if (specialId === 3) {
        const card = drawScenarioCard("bunker");
        replaceBunkerTarget(engine, scenarioTarget, card);
    } else if (specialId === 4) {
        player.voteMultiplier = 2;
    } else if (specialId >= 5 && specialId <= 9) {
        shuffleRevealedTrait(engine, ({ 5: "baggage", 6: "biology", 7: "hobby", 8: "health", 9: "fact" })[specialId]);
    } else if (specialId === 10) {
        linkProtection(engine, playerId, neighborId(engine, playerId, -1));
    } else if (specialId === 11) {
        if (player.status !== "exiled") throw new Error("Эту карту можно сыграть только после изгнания.");
        removeBunkerTarget(engine, scenarioTarget);
    } else if (specialId === 12) {
        requireTarget().voteDisabled = true;
    } else if (specialId === 13) {
        const protectedId = engine.firstReveal?.health
            ?? engine.order.find((id) => engine.players[id].revealedTraits?.health);
        if (!protectedId) throw new Error("Пока никто не раскрыл здоровье.");
        linkProtection(engine, playerId, protectedId);
    } else if (specialId === 14) {
        linkProtection(engine, playerId, neighborId(engine, playerId, 1));
    } else if (specialId === 15 || specialId === 19) {
        const ages = activePlayerIds(engine).map((id) => ({ id, age: Number(engine.players[id].revealedTraits?.biology?.match(/\d+/)?.[0]) })).filter((item) => Number.isFinite(item.age));
        if (!ages.length) throw new Error("Нет раскрытых биоданных с возрастом.");
        ages.sort((a, b) => specialId === 15 ? a.age - b.age : b.age - a.age);
        linkProtection(engine, playerId, ages[0].id);
    } else if ([16, 17, 21, 22, 23].includes(specialId)) {
        const swapTrait = ({ 16: "baggage", 17: "biology", 21: "hobby", 22: "health", 23: "fact" })[specialId];
        swapNeighborTrait(engine, playerId, targetId, swapTrait);
    } else if (specialId === 18) {
        const victim = requireTarget();
        character.baggage = victim.revealedTraits?.baggage || engine.characters[targetId].baggage;
        if (player.revealedTraits.baggage) player.revealedTraits.baggage = character.baggage;
        engine.characters[targetId].baggage = "Багаж забрали особой картой";
        if (victim.revealedTraits.baggage) victim.revealedTraits.baggage = engine.characters[targetId].baggage;
        giveNewSpecial(engine, targetId);
    } else if (specialId === 20) {
        requireTarget();
        engine.roundEffects ??= {};
        engine.roundEffects.doubleAgainstTarget = targetId;
        player.voteDisabled = true;
    } else if (specialId === 24) {
        addExtraScenario(engine, "threat", "Тайная угроза", "Банда мародёров узнала о бункере и угрожает финалистам.");
    } else if (specialId === 25) {
        replaceTrait(engine, requireTarget().id, "health", drawTraitCard("health"));
    } else if (specialId === 26) {
        if (!TRAIT_KEYS.includes(trait) || trait === "special") throw new Error("Выберите тип обычной карты.");
        engine.roundEffects ??= {};
        engine.roundEffects.forcedTrait = trait;
    } else if (specialId === 27) {
        replaceTrait(engine, requireTarget().id, "health", "Идеально здоров");
    } else if (specialId === 28) {
        if (![PHASES.VOTING, PHASES.RESULTS].includes(engine.phase)) throw new Error("Эту карту можно сыграть во время голосования.");
        engine.roundEffects ??= {};
        engine.roundEffects.previousVoteTargets = { ...engine.votes };
        engine.phase = PHASES.VOTING;
        resetVotes(engine);
    } else if (specialId === 29) {
        replaceTrait(engine, requireTarget().id, "profession", drawTraitCard("profession"));
    } else if (specialId === 30) {
        if (player.status !== "exiled") throw new Error("Эту карту можно сыграть только после изгнания.");
        engine.capacity = Math.max(1, engine.capacity - 1);
        engine.totalRounds = Math.max(engine.round, engine.round + activePlayerIds(engine).length - engine.capacity);
    } else if (specialId >= 31 && specialId <= 36) {
        const ownTrait = specialId === 31 ? trait : ({ 32: "biology", 33: "hobby", 34: "baggage", 35: "fact", 36: "profession" })[specialId];
        if (!TRAIT_KEYS.includes(ownTrait) || ownTrait === "special") throw new Error("Выберите карту для замены.");
        replaceTrait(engine, playerId, ownTrait, drawTraitCard(ownTrait));
    } else if (specialId === 37) {
        const health = character.health;
        for (const id of activePlayerIds(engine)) replaceTrait(engine, id, "health", health);
    } else if (specialId === 38) {
        if (player.status !== "exiled") throw new Error("Эту карту можно сыграть только после изгнания.");
        exilePlayer(engine, requireTarget().id);
    } else if (specialId === 39) {
        player.persistentVoter = true;
    } else if (specialId === 40) {
        player.secondChance = true;
    } else if (specialId === 41) {
        replaceTrait(engine, playerId, "health", "Чума");
        replaceTrait(engine, requireTarget().id, "health", "Чума");
    } else if (specialId === 42) {
        const other = requireTarget();
        if (other.id === playerId) throw new Error("Выберите другого игрока.");
        replaceTrait(engine, other.id, "health", "Идеально здоров");
        replaceTrait(engine, playerId, "health", drawTraitCard("health"));
    } else if (specialId === 43) {
        for (const id of activePlayerIds(engine)) {
            for (const key of TRAIT_KEYS.filter((item) => item !== "special")) {
                if (engine.players[id].revealedTraits?.[key]) replaceTrait(engine, id, key, drawTraitCard(key));
            }
        }
    } else if (specialId === 44) {
        const other = requireTarget();
        const biology = engine.characters[other.id].biology;
        const match = biology.match(/\d+/);
        if (!match) throw new Error("В биоданных выбранного игрока нет возраста.");
        replaceTrait(engine, other.id, "biology", biology.replace(match[0], [...match[0]].reverse().join("")));
    } else if (specialId === 45) {
        const marked = requireTarget();
        addExtraScenario(engine, "threat", `Личная угроза: ${marked.name}`, "В финале этот игрок получает дополнительную угрозу.");
    } else if (specialId === 46) {
        player.ignoreVotesIfHalf = true;
    } else if (specialId === 47) {
        player.voteDisabled = true;
        replaceTrait(engine, playerId, "baggage", `${character.baggage}; дополнительно: ${drawTraitCard("baggage")}`);
    } else if (specialId === 48) {
        player.ignoreVotesIfEven = true;
    } else if (specialId === 49) {
        player.linkedExileTarget = requireTarget().id;
    } else if (specialId === 51) {
        player.selfPenaltyAgainst = true;
    } else if (specialId === 52) {
        player.loneVoteTriple = true;
    } else if (specialId === 53) {
        applyAgeVoteMultiplier(engine, choice);
    } else if (specialId === 55) {
        const other = requireTarget();
        if (other.id === playerId) throw new Error("Выберите другого игрока.");
        player.soulSwapTarget = other.id;
    } else if (specialId === 56) {
        const other = requireTarget();
        if (other.id === playerId) throw new Error("Выберите другого игрока.");
        startSecretShare(engine, playerId, other.id, trait, snapshot);
        return;
    } else if (specialId === 57) {
        applyNeighborVoteMultiplier(engine, playerId, choice);
    } else if (specialId === 58) {
        engine.roundEffects ??= {};
        engine.roundEffects.discreditOwners ??= {};
        engine.roundEffects.discreditOwners[playerId] = true;
    } else if ([59, 61, 62, 63].includes(specialId)) {
        engine.roundEffects ??= {};
        engine.roundEffects.missingTraitBonus = ({ 59: "health", 61: "baggage", 62: "biology", 63: "fact" })[specialId];
    } else if (specialId === 60) {
        for (const id of activePlayerIds(engine)) revealRandomHiddenTrait(engine, id);
    } else if (specialId === 64) {
        if (!scenarioTarget) throw new Error("Выберите открытую карту бункера.");
        player.sabotageScenarioTarget = scenarioTarget;
    } else if (specialId === 65) {
        player.votersGetHealth = true;
    } else if (specialId === 66) {
        const ids = activePlayerIds(engine).sort(() => Math.random() - .5);
        if (ids[0]) replaceTrait(engine, ids[0], "baggage", drawTraitCard("baggage"), true);
        if (ids[1]) replaceTrait(engine, ids[1], "health", drawTraitCard("health"), true);
    } else if (specialId === 67) {
        const other = requireTarget();
        const chosenTrait = TRAIT_KEYS.includes(trait) && trait !== "special" ? trait : "fact";
        revealSpecificTrait(engine, other.id, chosenTrait);
        replaceTrait(engine, other.id, "fact", `${engine.characters[other.id].fact}; дополнительный факт: ${drawTraitCard("fact")}`, true);
    } else if (specialId === 68) {
        engine.roundEffects ??= {};
        engine.roundEffects.exileBaggage = [drawTraitCard("baggage"), drawTraitCard("baggage")];
    } else if (specialId === 69) {
        applyGenderVoteMultiplier(engine, choice);
    } else if (specialId === 70) {
        player.immuneThisRound = true;
    } else {
        automatic = false;
    }

    player.specialUsed = true;
    engine.lastSpecialSnapshot = { playedBy: playerId, specialId, data: structuredClone(command.data ?? {}), state: snapshot };
    appendLog(engine, `${player.name} разыгрывает особую карту №${specialId}: ${character.special}.${automatic ? " Эффект применён автоматически." : " Эффект завершает ведущий через редактор партии."}`);
}

function replaceTrait(engine, playerId, trait, value, reveal = false) {
    engine.characters[playerId][trait] = value;
    if (reveal || engine.players[playerId].revealedTraits?.[trait]) engine.players[playerId].revealedTraits[trait] = value;
}

function validateSpecialTiming(engine, specialId, player) {
    if ([1, 11, 24, 30, 38].includes(specialId) && player.status !== "exiled") {
        throw new Error("Эту карту можно сыграть только после изгнания.");
    }
    if ([46, 47, 48, 49, 51, 52, 57, 58, 65, 68, 69, 70].includes(specialId)
        && engine.phase !== PHASES.DISCUSSION) {
        throw new Error("Эту карту нужно сыграть перед голосованием, во время обсуждения.");
    }
    if ([59, 60, 61, 62, 63].includes(specialId)) {
        const roundHasStarted = Object.values(engine.players).some((item) => item.hasFinishedTurn || item.revealedThisTurn);
        if (engine.phase !== PHASES.REVEAL || engine.round < 2 || engine.round > 4 || roundHasStarted) {
            throw new Error("Эту карту можно сыграть только в самом начале 2, 3 или 4 раунда.");
        }
    }
}

function revealSpecificTrait(engine, playerId, trait) {
    const value = engine.characters[playerId]?.[trait];
    if (value) engine.players[playerId].revealedTraits[trait] = value;
}

function revealRandomHiddenTrait(engine, playerId) {
    const hidden = TRAIT_KEYS.filter((trait) => trait !== "special" && !engine.players[playerId].revealedTraits?.[trait]);
    if (!hidden.length) return;
    revealSpecificTrait(engine, playerId, hidden[Math.floor(Math.random() * hidden.length)]);
}

function shuffleRevealedTrait(engine, trait) {
    const ids = activePlayerIds(engine).filter((id) => engine.players[id].revealedTraits?.[trait]);
    if (ids.length < 2) throw new Error("Для перераздачи нужны хотя бы две открытые карты этого типа.");
    const values = ids.map((id) => engine.characters[id][trait]).sort(() => Math.random() - .5);
    ids.forEach((id, index) => replaceTrait(engine, id, trait, values[index], true));
}

function swapNeighborTrait(engine, playerId, targetId, trait) {
    const active = activePlayerIds(engine);
    const index = active.indexOf(playerId);
    const neighbors = [active[(index - 1 + active.length) % active.length], active[(index + 1) % active.length]];
    if (!neighbors.includes(targetId)) throw new Error("Выберите игрока перед собой или после себя.");
    if (!engine.players[playerId].revealedTraits?.[trait] || !engine.players[targetId].revealedTraits?.[trait]) {
        throw new Error("Обе обмениваемые карты должны быть раскрыты.");
    }
    const own = engine.characters[playerId][trait];
    replaceTrait(engine, playerId, trait, engine.characters[targetId][trait], true);
    replaceTrait(engine, targetId, trait, own, true);
}

function giveNewSpecial(engine, playerId) {
    const special = drawSpecialCard();
    engine.characters[playerId].special = special.text;
    engine.characters[playerId].specialId = special.id;
    engine.players[playerId].revealedTraits.special = "";
    engine.players[playerId].specialUsed = false;
}

function applyAgeVoteMultiplier(engine, choice) {
    if (!["younger", "older"].includes(choice)) throw new Error("Выберите младше или старше 33 лет.");
    for (const id of activePlayerIds(engine)) {
        const text = engine.players[id].revealedTraits?.biology;
        const age = Number(text?.match(/\d+/)?.[0]);
        if (Number.isFinite(age) && (choice === "younger" ? age < 33 : age > 33)) engine.players[id].voteMultiplier = 2;
    }
}

function applyGenderVoteMultiplier(engine, choice) {
    if (!["female", "male"].includes(choice)) throw new Error("Выберите мужчин или женщин.");
    for (const id of activePlayerIds(engine)) {
        const text = String(engine.players[id].revealedTraits?.biology ?? "").toLowerCase();
        if ((choice === "female" && text.includes("женщ")) || (choice === "male" && text.includes("мужч"))) {
            engine.players[id].voteMultiplier = 2;
        }
    }
}

function applyNeighborVoteMultiplier(engine, playerId, choice) {
    if (!["before", "after"].includes(choice)) throw new Error("Выберите игроков до или после себя.");
    const active = activePlayerIds(engine);
    const index = active.indexOf(playerId);
    const direction = choice === "before" ? -1 : 1;
    for (let offset = 1; offset <= 2; offset += 1) {
        const id = active[(index + direction * offset + active.length) % active.length];
        engine.players[id].voteMultiplier = 2;
    }
}

const SPECIAL_SNAPSHOT_KEYS = [
    "capacity", "totalRounds", "phase", "round", "currentPlayerIndex", "players",
    "characters", "votes", "voteResult", "roundEffects", "bunker", "threat",
    "catastrophe", "extraScenarios", "firstReveal", "sharedSecrets",
    "pendingSpecialChoice", "pendingSpecialSnapshot", "pendingSecretShare",
    "pendingSecretSharePrivate"
];

function captureSpecialSnapshot(engine) {
    return Object.fromEntries(SPECIAL_SNAPSHOT_KEYS
        .filter((key) => engine[key] !== undefined)
        .map((key) => [key, structuredClone(engine[key])]));
}

function restoreSpecialSnapshot(engine, snapshot) {
    for (const key of SPECIAL_SNAPSHOT_KEYS) delete engine[key];
    for (const [key, value] of Object.entries(snapshot)) engine[key] = structuredClone(value);
}

function cancelLastSpecial(engine, cancellerId) {
    const previous = engine.lastSpecialSnapshot;
    if (!previous?.state || !previous.playedBy || previous.playedBy === cancellerId) throw new Error("Нет чужой особой карты, которую можно отменить.");
    const cancellerName = engine.players[cancellerId]?.name ?? "Игрок";
    const previousOwnerName = engine.players[previous.playedBy]?.name ?? "Игрок";
    restoreSpecialSnapshot(engine, previous.state);
    giveNewSpecial(engine, previous.playedBy);
    giveNewSpecial(engine, cancellerId);
    engine.lastSpecialSnapshot = { playedBy: "", specialId: 0, state: {} };
    appendLog(engine, `${cancellerName} отменяет особую карту игрока ${previousOwnerName}. Оба получают новые особые карты.`);
}

function redirectLastSpecial(engine, redirectorId, newChoice) {
    const previous = engine.lastSpecialSnapshot;
    if (!previous?.state || !previous.playedBy || previous.specialId === 50 || previous.specialId === 71) {
        throw new Error("Нет подходящей особой карты для подмены цели.");
    }
    const redirectorName = engine.players[redirectorId]?.name ?? "Игрок";
    const previousOwner = previous.playedBy;
    const redirectedData = {
        ...(previous.data ?? {}),
        targetId: newChoice.targetId || previous.data?.targetId,
        trait: newChoice.trait || previous.data?.trait,
        choice: newChoice.choice || previous.data?.choice
    };
    restoreSpecialSnapshot(engine, previous.state);
    playSpecial(engine, { type: "PLAY_SPECIAL", from: previousOwner, data: redirectedData });
    const redirector = engine.players[redirectorId];
    if (redirector && engine.characters[redirectorId]) {
        redirector.revealedTraits.special = engine.characters[redirectorId].special;
        redirector.specialUsed = true;
    }
    appendLog(engine, `${redirectorName} подменяет выбор только что сыгранной особой карты.`);
}

function resolveBunkerBaggageChoice(engine, playerId, choice) {
    const pending = engine.pendingSpecialChoice;
    if (!pending || pending.playerId !== playerId) {
        const options = [drawScenarioCard("bunker"), drawScenarioCard("bunker")];
        engine.pendingSpecialSnapshot = captureSpecialSnapshot(engine);
        engine.pendingSpecialChoice = {
            type: "bunker_to_baggage",
            playerId,
            options: options.map((card, index) => ({ index, title: card.title, description: card.description }))
        };
        appendLog(engine, `${engine.players[playerId].name} разыгрывает «Строителя бункера» и выбирает одну из двух карт.`);
        return;
    }
    const optionIndex = Number(choice);
    const selected = pending.options?.find((option) => option.index === optionIndex);
    if (!selected) throw new Error("Выберите одну из двух предложенных карт бункера.");
    const snapshot = engine.pendingSpecialSnapshot ?? captureSpecialSnapshot(engine);
    replaceTrait(engine, playerId, "baggage", `${engine.characters[playerId].baggage}; ${selected.title}: ${selected.description}`);
    engine.players[playerId].specialUsed = true;
    delete engine.pendingSpecialChoice;
    delete engine.pendingSpecialSnapshot;
    engine.lastSpecialSnapshot = { playedBy: playerId, specialId: 54, data: { choice: optionIndex }, state: snapshot };
    appendLog(engine, `${engine.players[playerId].name} выбирает карту «${selected.title}» как дополнительный багаж.`);
}

function votingPlayerIds(engine) {
    return engine.order.filter((id) => {
        const player = engine.players[id];
        const isLastExiled = player?.status === "exiled" && id === engine.lastExiledPlayerId;
        return player?.status === "active" || isLastExiled || player?.persistentVoter;
    });
}

function neighborId(engine, playerId, direction) {
    const active = activePlayerIds(engine);
    const index = active.indexOf(playerId);
    if (index < 0 || active.length < 2) throw new Error("Соседний игрок не найден.");
    return active[(index + direction + active.length) % active.length];
}

function linkProtection(engine, ownerId, protectedId) {
    if (engine.players[protectedId]?.status === "exiled") engine.players[ownerId].forcedSelfVote = true;
    else engine.players[ownerId].protectedPlayerId = protectedId;
}

function addExtraScenario(engine, type, title, description) {
    engine.extraScenarios ??= {};
    engine.extraScenarios[type] ??= [];
    engine.extraScenarios[type].push({ id: `special_${Date.now()}_${engine.revision}`, title, description });
}

function removeBunkerTarget(engine, targetValue) {
    const [scope, type, cardId] = String(targetValue ?? "").split(":");
    if (type !== "bunker") throw new Error("Выберите открытую карту бункера.");
    if (scope === "primary") {
        if (engine.bunker?.status !== "revealed") throw new Error("Основная карта бункера ещё не раскрыта.");
        const removed = { title: engine.bunker.title, description: engine.bunker.description };
        engine.bunker = hiddenScenario("Бункер");
        return removed;
    }
    if (scope === "extra") {
        const cards = engine.extraScenarios?.bunker ?? [];
        const index = cards.findIndex((card) => card.id === cardId);
        if (index < 0) throw new Error("Выбранная карта бункера не найдена.");
        return cards.splice(index, 1)[0];
    }
    throw new Error("Выберите открытую карту бункера.");
}

function replaceBunkerTarget(engine, targetValue, replacement) {
    const [scope, type, cardId] = String(targetValue ?? "").split(":");
    if (type !== "bunker") throw new Error("Выберите открытую карту бункера.");
    if (scope === "primary") {
        if (engine.bunker?.status !== "revealed") throw new Error("Основная карта бункера ещё не раскрыта.");
        engine.bunker = { status: "revealed", title: replacement.title, description: replacement.description };
        return;
    }
    if (scope === "extra") {
        const cards = engine.extraScenarios?.bunker ?? [];
        const index = cards.findIndex((card) => card.id === cardId);
        if (index < 0) throw new Error("Выбранная карта бункера не найдена.");
        cards[index] = { ...cards[index], title: replacement.title, description: replacement.description };
        return;
    }
    throw new Error("Выберите открытую карту бункера.");
}

function startSecretShare(engine, ownerId, targetId, ownerTrait, snapshot) {
    if (!TRAIT_KEYS.includes(ownerTrait) || ownerTrait === "special") throw new Error("Выберите свою закрытую обычную карту.");
    if (engine.players[ownerId].revealedTraits?.[ownerTrait]) throw new Error("Для обмена выберите закрытую карту.");
    engine.pendingSecretShare = {
        ownerId,
        targetId,
        ownerName: engine.players[ownerId].name
    };
    engine.pendingSecretSharePrivate = { ownerTrait, snapshot };
    appendLog(engine, `${engine.players[ownerId].name} предлагает игроку ${engine.players[targetId].name} обменяться тайной информацией.`);
}

function respondSecretShare(engine, command) {
    const pending = engine.pendingSecretShare;
    const privateData = engine.pendingSecretSharePrivate;
    if (!pending || !privateData || command.from !== pending.targetId) throw new Error("Для вас нет ожидающего обмена тайными картами.");
    const targetTrait = command.data?.trait;
    if (!TRAIT_KEYS.includes(targetTrait) || targetTrait === "special") throw new Error("Выберите закрытую обычную карту.");
    if (engine.players[pending.targetId].revealedTraits?.[targetTrait]) throw new Error("Для обмена выберите закрытую карту.");
    engine.sharedSecrets ??= {};
    engine.sharedSecrets[pending.ownerId] ??= {};
    engine.sharedSecrets[pending.targetId] ??= {};
    const key = `share_${Date.now()}_${engine.revision}`;
    engine.sharedSecrets[pending.ownerId][key] = {
        from: engine.players[pending.targetId].name,
        trait: targetTrait,
        value: engine.characters[pending.targetId][targetTrait]
    };
    engine.sharedSecrets[pending.targetId][key] = {
        from: engine.players[pending.ownerId].name,
        trait: privateData.ownerTrait,
        value: engine.characters[pending.ownerId][privateData.ownerTrait]
    };
    engine.players[pending.ownerId].specialUsed = true;
    engine.lastSpecialSnapshot = {
        playedBy: pending.ownerId,
        specialId: 56,
        data: { targetId: pending.targetId, trait: privateData.ownerTrait },
        state: privateData.snapshot
    };
    appendLog(engine, `${engine.players[pending.ownerId].name} и ${engine.players[pending.targetId].name} обменялись тайной информацией.`);
    delete engine.pendingSecretShare;
    delete engine.pendingSecretSharePrivate;
}

function exilePlayer(engine, playerId, visited = new Set()) {
    if (visited.has(playerId) || !engine.players[playerId]) return;
    visited.add(playerId);
    const player = engine.players[playerId];
    player.status = "exiled";
    engine.lastExiledPlayerId = playerId;
    if (engine.roundEffects?.exileBaggage?.length) {
        replaceTrait(engine, playerId, "baggage", `${engine.characters[playerId].baggage}; с собой: ${engine.roundEffects.exileBaggage.join("; ")}`);
    }
    for (const owner of Object.values(engine.players)) {
        if (owner.protectedPlayerId === playerId) owner.forcedSelfVote = true;
        if (!owner.soulSwapResolved && (owner.id === playerId || owner.soulSwapTarget === playerId)) {
            const otherId = owner.id === playerId ? owner.soulSwapTarget : owner.id;
            if (otherId && engine.players[otherId]) {
                const character = engine.characters[owner.id];
                engine.characters[owner.id] = engine.characters[otherId];
                engine.characters[otherId] = character;
                const revealed = owner.revealedTraits;
                owner.revealedTraits = engine.players[otherId].revealedTraits;
                engine.players[otherId].revealedTraits = revealed;
                owner.soulSwapResolved = true;
            }
        }
    }
    if (player.sabotageScenarioTarget) {
        try {
            const removed = removeBunkerTarget(engine, player.sabotageScenarioTarget);
            appendLog(engine, `После изгнания ${player.name} карта «${removed.title}» считается сломанной или заблокированной.`);
        } catch {
            appendLog(engine, `Саботаж ${player.name} не сработал: выбранной карты бункера уже нет.`);
        }
        delete player.sabotageScenarioTarget;
    }
    if (player.linkedExileTarget) exilePlayer(engine, player.linkedExileTarget, visited);
    for (const other of Object.values(engine.players)) {
        if (other.linkedExileTarget === playerId) exilePlayer(engine, other.id, visited);
    }
}

function applySecondChances(engine) {
    for (const id of engine.order) {
        const player = engine.players[id];
        if (player.status !== "exiled" || !player.secondChance) continue;
        const revealedKeys = TRAIT_KEYS.filter((trait) => player.revealedTraits?.[trait]);
        const replacement = generateCharacters([id])[id];
        engine.characters[id] = replacement;
        player.status = "active";
        player.secondChance = false;
        player.specialUsed = false;
        player.revealedTraits = createHiddenTraits();
        for (const trait of revealedKeys) player.revealedTraits[trait] = replacement[trait];
        appendLog(engine, `${player.name} возвращается в новом образе благодаря «Второму шансу».`);
    }
}

function repairCurrentTurn(engine) {
    if (engine.phase !== PHASES.REVEAL) return;
    const currentId = engine.order[engine.currentPlayerIndex];
    if (engine.players[currentId]?.status === "active" && !engine.players[currentId].hasFinishedTurn) return;
    const nextIndex = engine.order.findIndex((id) => {
        const player = engine.players[id];
        return player?.status === "active" && !player.hasFinishedTurn;
    });
    if (nextIndex >= 0) engine.currentPlayerIndex = nextIndex;
    else {
        engine.currentPlayerIndex = -1;
        engine.phase = PHASES.DISCUSSION;
    }
}

function activePlayerIds(engine) {
    return engine.order.filter((id) => engine.players[id]?.status === "active");
}

function resetVotes(engine) {
    for (const id of votingPlayerIds(engine)) {
        engine.players[id].voteSubmitted = false;
        engine.votes[id] = "";
    }
}

function createHiddenTraits() {
    return Object.fromEntries(TRAIT_KEYS.map((trait) => [trait, ""]));
}

function hiddenScenario(title) {
    return { status: "hidden", title, description: "Данные засекречены." };
}

function emptyVoteResult() {
    return { status: "pending", exiledPlayerId: "", candidates: [], counts: {} };
}

function appendLog(engine, message) {
    const key = `event_${Date.now()}_${engine.revision}`;
    engine.log[key] = { message, createdAt: Date.now() };
}
