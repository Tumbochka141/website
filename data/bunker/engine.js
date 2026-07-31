import {
    SPECIAL_CARDS,
    drawDistinctScenarioCard,
    drawDistinctTraitCard,
    drawScenarioCard,
    drawSpecialCard,
    drawTraitCard,
    findScenarioCard,
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
    THREAT: "threat",
    FINISHED: "finished"
};

export const TRAIT_KEYS = [
    "profession", "health", "biology", "fact", "hobby", "baggage", "special"
];
const ORDINARY_TRAIT_KEYS = TRAIT_KEYS.filter((trait) => trait !== "special");

export const TRAIT_LABELS = {
    profession: "Профессия",
    health: "Здоровье",
    biology: "Биоданные",
    fact: "Факт",
    hobby: "Хобби",
    baggage: "Багаж",
    special: "Особая карта"
};

const MINIMUM_GAME_ROUNDS = 5;
const MAX_REVEALED_ORDINARY_TRAITS = ORDINARY_TRAIT_KEYS.length - 1;
const MAX_TRAIT_REVEAL_ROUNDS = MAX_REVEALED_ORDINARY_TRAITS;
const AFTER_EXILE_SPECIAL_IDS = new Set([1, 11, 24, 30, 38]);
const BEFORE_VOTING_SPECIAL_IDS = new Set([46, 47, 48, 49, 51, 52, 57, 58, 65, 68, 69, 70]);
const CURRENT_VOTING_SPECIAL_IDS = new Set([4, 12, 20, 53]);
const ROUND_START_SPECIAL_IDS = new Set([59, 60, 61, 62, 63]);
const REACTION_SPECIAL_IDS = new Set([50, 71]);
const SECRET_SPECIAL_IDS = new Set([10, 13, 14, 15, 19]);
const INTERACTIVE_BUNKER_CARD_IDS = new Set([1, 4, 44, 51, 52, 53, 59, 62, 75]);

export function getOfficialBunkerCapacity(playerCount) {
    const count = Math.max(0, Math.trunc(Number(playerCount) || 0));
    return Math.floor(count / 2);
}

export function getRoundVoteSchedule(playerCount, capacity = getOfficialBunkerCapacity(playerCount)) {
    const count = Math.max(0, Math.trunc(Number(playerCount) || 0));
    const safeCapacity = Math.max(0, Math.min(count, Math.trunc(Number(capacity) || 0)));
    const exileCount = Math.max(0, count - safeCapacity);
    const baseVotes = Math.floor(exileCount / 4);
    const extraVotes = exileCount % 4;
    const schedule = { 1: 0 };

    for (let index = 0; index < 4; index += 1) {
        const round = index + 2;
        schedule[round] = baseVotes + (index >= 4 - extraVotes ? 1 : 0);
    }

    return schedule;
}

export function getSpecialAvailability(state, playerId, specialId) {
    const id = Number(specialId ?? 0);
    const player = state?.players?.[playerId];
    if (!player || !id) return { allowed: false, reason: "Особая карта не назначена." };
    if (player.specialUsed) return { allowed: false, reason: "Особая карта уже использована." };
    if (state.phase === PHASES.FINISHED) return { allowed: false, reason: "Партия уже завершена." };
    if (state.phase === PHASES.THREAT) {
        return { allowed: false, reason: "Сейчас группа проходит финальную угрозу." };
    }
    if (state.pendingSpecialChoice) {
        return { allowed: false, reason: "Сначала завершите ожидающий выбор особой карты." };
    }
    if (state.pendingSecretShare && !REACTION_SPECIAL_IDS.has(id)) {
        return { allowed: false, reason: "Сначала завершите ожидающий обмен тайными картами." };
    }
    if (state.pendingBunkerVote && !REACTION_SPECIAL_IDS.has(id)) {
        return { allowed: false, reason: "Сначала завершите голосование по карте бункера." };
    }

    const afterExile = AFTER_EXILE_SPECIAL_IDS.has(id);
    if (afterExile && player.status !== "exiled") {
        return { allowed: false, reason: "Эту карту можно разыграть только после своего изгнания." };
    }
    if (!afterExile && player.status !== "active") {
        return { allowed: false, reason: "После изгнания можно разыгрывать только карты с таким условием." };
    }

    const activeCount = Object.values(state.players ?? {}).filter((item) => item.status === "active").length;
    const round = Number(state.round ?? 0);
    const roundVoteTarget = Number(
        state.roundVoteTarget
        ?? state.voteSchedule?.[round]
        ?? (round >= 2 ? 1 : 0)
    );
    const roundVotesCompleted = Number(
        state.roundVotesCompleted
        ?? state.completedVotesByRound?.[round]
        ?? 0
    );
    const hasUpcomingVote = activeCount > Number(state.capacity ?? 0)
        && (
            state.phase === PHASES.VOTING
            || (state.phase === PHASES.RESULTS && state.voteResult?.status === "tie")
            || roundVoteTarget > roundVotesCompleted
        );
    if (BEFORE_VOTING_SPECIAL_IDS.has(id)) {
        if (!hasUpcomingVote) {
            return { allowed: false, reason: "Эта карта применяется перед голосованием, а голосование сейчас не ожидается." };
        }
        if (![PHASES.REVEAL, PHASES.DISCUSSION].includes(state.phase)) {
            return { allowed: false, reason: "Эту карту нужно разыграть до открытия голосования." };
        }
    }

    if (CURRENT_VOTING_SPECIAL_IDS.has(id)) {
        if (!hasUpcomingVote) {
            return { allowed: false, reason: "Эффект действует на текущее голосование, а голосование сейчас не ожидается." };
        }
        if (![PHASES.REVEAL, PHASES.DISCUSSION, PHASES.VOTING].includes(state.phase)) {
            return { allowed: false, reason: "Эту карту можно разыграть только до завершения текущего голосования." };
        }
    }

    if (ROUND_START_SPECIAL_IDS.has(id)) {
        const roundHasStarted = Object.values(state.players ?? {}).some((item) =>
            item.status === "active" && (item.hasFinishedTurn || item.revealedThisTurn));
        if (
            Number(state.round ?? 0) < 2
            || Number(state.round ?? 0) > 4
            || state.phase !== PHASES.REVEAL
            || roundHasStarted
        ) {
            return { allowed: false, reason: "Эту карту можно разыграть во время раскрытия карт во 2–4 раунде." };
        }
    }

    if (id === 28 && ![PHASES.VOTING, PHASES.RESULTS].includes(state.phase)) {
        return { allowed: false, reason: "Эту карту можно разыграть во время или сразу после голосования." };
    }

    if (id === 30 && Number(state.capacity ?? 0) <= 1) {
        return { allowed: false, reason: "Вместимость бункера уже нельзя уменьшить." };
    }

    if (id === 26 && state.phase !== PHASES.REVEAL) {
        return { allowed: false, reason: "Эту карту нужно разыграть до завершения раскрытия характеристик в текущем раунде." };
    }

    if (REACTION_SPECIAL_IDS.has(id)) {
        const previous = state.lastSpecialSnapshot ?? state.lastSpecial;
        const previousRevision = Number(previous?.playedAtRevision ?? -1);
        if (!previous?.playedBy || previous.playedBy === playerId || previousRevision !== Number(state.revision ?? 0)) {
            return { allowed: false, reason: "Эта карта срабатывает только сразу после чужой особой карты." };
        }
        if (id === 50) {
            const inputTypes = previous.inputTypes
                ?? Object.entries(previous.data ?? {})
                    .filter(([, value]) => value !== "" && value !== undefined)
                    .map(([key]) => key);
            const previousSpecialId = Number(previous.specialId);
            const missingBunkerChoice = previousSpecialId === 54
                && !(previous.choiceOptions?.length || previous.hasChoiceOptions);
            if ([50, 71].includes(previousSpecialId) || missingBunkerChoice || !inputTypes.length) {
                return { allowed: false, reason: "У только что сыгранной карты нет выбора, который можно подменить." };
            }
        }
    }

    return { allowed: true, reason: "" };
}

export function createInitialGame(players, capacity, random = Math.random) {
    const order = players.map(([playerId]) => playerId);
    const characters = generateCharacters(order, random);
    const scenarios = generateScenarios(random);
    const randomState = Math.floor(random() * 0x100000000) >>> 0;
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

    const engine = {
        gameType: GAME_TYPE,
        revision: 0,
        randomState: randomState || 1,
        phase: PHASES.REVEAL,
        round: 1,
        totalRounds: MINIMUM_GAME_ROUNDS,
        capacity,
        initialPlayerCount: players.length,
        voteSchedule: getRoundVoteSchedule(players.length, capacity),
        completedVotesByRound: {},
        voteCycle: 0,
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
        bunkerCardSequence: 0,
        bunkerCardHistory: {
            [Number(scenarios.bunker.id)]: true
        },
        bunkerEffectResults: {},
        bunkerVoteQueue: [],
        catastrophe: hiddenScenario("Катастрофа"),
        bunker: hiddenScenario("Бункер"),
        threat: hiddenScenario("Угроза"),
        logSequence: 0,
        log: {
            start: {
                message: "Партия началась.",
                createdAt: Date.now()
            }
        }
    };

    ensureBunkerCardsForCurrentRound(engine);
    return engine;
}

export function applyCommand(engine, command, hostId) {
    const requiresExactRevision = [
        "NEXT_PHASE",
        "PLAY_SPECIAL",
        "RESPOND_SECRET_SHARE",
        "CANCEL_PENDING"
    ].includes(command?.type);
    if (
        requiresExactRevision
        && command?.revision !== undefined
        && Number(command.revision) !== Number(engine.revision)
    ) {
        throw new Error("Команда устарела: состояние партии уже изменилось.");
    }
    ensureVotingPlan(engine);
    reconcileVotingPlan(engine);
    const introducedBunkerVote = migrateScenarioMetadata(engine);
    const isHostPendingSpecialCancel = command.type === "CANCEL_PENDING"
        && command.from === hostId;
    const isPendingSecretReaction = command.type === "PLAY_SPECIAL"
        && REACTION_SPECIAL_IDS.has(Number(engine.characters?.[command.from]?.specialId ?? 0));
    if (
        introducedBunkerVote
        && !["BUNKER_VOTE", "RESOLVE_BUNKER_VOTE"].includes(command.type)
    ) {
        engine.revision += 1;
        return true;
    }
    if (
        engine.pendingSpecialChoice
        && !(command.type === "PLAY_SPECIAL" && command.from === engine.pendingSpecialChoice.playerId)
        && !isHostPendingSpecialCancel
    ) {
        throw new Error("Сначала завершите ожидающее действие особой карты: выбор ещё не подтверждён.");
    }
    if (
        engine.pendingSecretShare
        && !(command.type === "RESPOND_SECRET_SHARE" && command.from === engine.pendingSecretShare.targetId)
        && !isPendingSecretReaction
        && !isHostPendingSpecialCancel
    ) {
        throw new Error("Сначала завершите ожидающее действие особой карты: обмен тайными картами.");
    }
    if (
        engine.pendingBunkerVote
        && !["BUNKER_VOTE", "RESOLVE_BUNKER_VOTE"].includes(command.type)
        && !(
            engine.pendingSpecialChoice
            && command.type === "PLAY_SPECIAL"
            && command.from === engine.pendingSpecialChoice.playerId
        )
        && !(
            engine.pendingSecretShare
            && command.type === "RESPOND_SECRET_SHARE"
            && command.from === engine.pendingSecretShare.targetId
        )
        && !(
            command.type === "PLAY_SPECIAL"
            && REACTION_SPECIAL_IDS.has(Number(engine.characters?.[command.from]?.specialId ?? 0))
        )
        && !isHostPendingSpecialCancel
    ) {
        throw new Error("Сначала завершите голосование по карте бункера.");
    }

    switch (command.type) {
        case "REVEAL_TRAIT":
            revealTrait(engine, command);
            break;
        case "FINISH_TURN":
            finishTurn(engine, command);
            break;
        case "SKIP_TURN":
            skipTurn(engine, command, hostId);
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
        case "CANCEL_PENDING":
            cancelPendingSpecial(engine, command, hostId);
            break;
        case "RESOLVE_THREAT":
            resolveThreat(engine, command, hostId);
            break;
        case "BUNKER_VOTE":
            voteForBunkerEffect(engine, command);
            break;
        case "RESOLVE_BUNKER_VOTE":
            resolveBunkerVote(engine, command, hostId);
            break;
        default:
            return false;
    }

    reconcileVotingPlan(engine);
    ensureBunkerCardsForCurrentRound(engine);
    engine.revision += 1;
    return true;
}

export function createPublicState(engine) {
    const lastSpecial = engine.lastSpecialSnapshot?.playedBy
        ? {
            playedBy: engine.lastSpecialSnapshot.playedBy,
            specialId: SECRET_SPECIAL_IDS.has(Number(engine.lastSpecialSnapshot.specialId))
                ? 0
                : Number(engine.lastSpecialSnapshot.specialId ?? 0),
            playedAtRevision: Number(engine.lastSpecialSnapshot.playedAtRevision ?? -1),
            inputTypes: Object.entries(engine.lastSpecialSnapshot.data ?? {})
                .filter(([, value]) => value !== "" && value !== undefined)
                .map(([key]) => key),
            ...(engine.lastSpecialSnapshot.choiceOptions?.length
                ? { hasChoiceOptions: true }
                : {})
        }
        : null;
    return {
        gameType: engine.gameType,
        revision: engine.revision,
        phase: engine.phase,
        round: engine.round,
        totalRounds: engine.totalRounds,
        capacity: engine.capacity,
        initialPlayerCount: Number(engine.initialPlayerCount ?? engine.order?.length ?? 0),
        voteSchedule: { ...(engine.voteSchedule ?? {}) },
        roundVoteTarget: roundVoteTarget(engine),
        roundVotesCompleted: completedRoundVotes(engine),
        voteCycle: Number(engine.voteCycle ?? 0),
        order: engine.order,
        currentPlayerIndex: engine.currentPlayerIndex,
        requiredTrait: engine.roundEffects?.forcedTrait ?? "",
        players: createPublicPlayers(engine.players),
        lastExiledPlayerId: engine.lastExiledPlayerId ?? "",
        voteResult: engine.voteResult,
        catastrophe: engine.catastrophe,
        bunker: engine.bunker,
        threat: engine.threat,
        ...(engine.threatResolution ? { threatResolution: engine.threatResolution } : {}),
        extraScenarios: createPublicExtraScenarios(engine),
        bunkerEffectResults: engine.bunkerEffectResults ?? {},
        bunkerSabotageTargets: createPublicBunkerSabotageTargets(engine),
        ...(engine.lastTraitShuffle ? {
            lastTraitShuffle: {
                round: Number(engine.lastTraitShuffle.round ?? engine.round),
                trait: engine.lastTraitShuffle.trait,
                affectedIds: [...(engine.lastTraitShuffle.affectedIds ?? [])],
                sourceByRecipient: { ...(engine.lastTraitShuffle.sourceByRecipient ?? {}) }
            }
        } : {}),
        ...(engine.pendingBunkerVote ? {
            pendingBunkerVote: {
                type: engine.pendingBunkerVote.type,
                sourceTarget: engine.pendingBunkerVote.sourceTarget,
                sourceInstanceId: engine.pendingBunkerVote.sourceInstanceId,
                candidateIds: [...(engine.pendingBunkerVote.candidateIds ?? [])],
                voterIds: [...(engine.pendingBunkerVote.voterIds ?? [])],
                submittedVoterIds: Object.keys(engine.pendingBunkerVote.votes ?? {}),
                revote: Boolean(engine.pendingBunkerVote.revote)
            }
        } : {}),
        ...(engine.pendingSpecialChoice ? {
            pendingSpecialChoice: {
                type: engine.pendingSpecialChoice.type,
                playerId: engine.pendingSpecialChoice.playerId
            }
        } : {}),
        ...(engine.pendingSecretShare ? { pendingSecretShare: engine.pendingSecretShare } : {}),
        ...(lastSpecial ? { lastSpecial } : {}),
        log: engine.log
    };
}

function createPublicBunkerSabotageTargets(engine) {
    return Object.values(engine.players ?? {})
        .filter((player) => player.sabotageScenarioTarget)
        .map((player) => ({
            target: player.sabotageScenarioTarget,
            instanceId: player.sabotageScenarioInstanceId ?? "",
            playerId: player.id,
            playerName: player.name
        }));
}

function createPublicExtraScenarios(engine) {
    const revealFinalThreats = [PHASES.THREAT, PHASES.FINISHED].includes(engine.phase);
    return Object.fromEntries(Object.entries(engine.extraScenarios ?? {}).map(([type, cards]) => [
        type,
        (Array.isArray(cards) ? cards : []).map((card) => (
            card?.hiddenUntilFinal && !revealFinalThreats
                ? {
                    ...card,
                    title: "Тайная угроза",
                    description: "Содержание этой угрозы раскроется только в финале."
                }
                : { ...card }
        ))
    ]));
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
        bunkerKing: Boolean(player.bunkerKing),
        persistentVoter: Boolean(player.persistentVoter),
        forcedSelfVote: Boolean(player.forcedSelfVote),
        ...(player.cannotVoteAgainst ? { cannotVoteAgainst: player.cannotVoteAgainst } : {})
    }]));
}

export function createPrivateStates(engine) {
    return Object.fromEntries(engine.order.map((playerId) => {
        const canRedirectBunkerChoice = Number(engine.characters?.[playerId]?.specialId ?? 0) === 50
            && Number(engine.lastSpecialSnapshot?.specialId ?? 0) === 54
            && getSpecialAvailability(engine, playerId, 50).allowed
            && engine.lastSpecialSnapshot?.choiceOptions?.length;
        return [
            playerId,
            {
                ...engine.characters[playerId],
                ...(engine.pendingSpecialChoice?.playerId === playerId
                    ? { pendingSpecialChoice: engine.pendingSpecialChoice }
                    : {}),
                ...(canRedirectBunkerChoice ? {
                    specialReactionChoiceOptions: engine.lastSpecialSnapshot.choiceOptions.map((option) => ({
                        index: Number(option.index),
                        title: option.title,
                        description: option.description
                    }))
                } : {}),
                ...(engine.sharedSecrets?.[playerId] ? { sharedSecrets: engine.sharedSecrets[playerId] } : {})
            }
        ];
    }));
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
    const isSpecial = trait === "special";
    if (forcedTrait && !player.revealedTraits?.[forcedTrait] && trait !== forcedTrait && !isSpecial) {
        throw new Error(`В этом раунде нужно раскрыть: ${TRAIT_LABELS[forcedTrait]}.`);
    }
    if (player.revealedThisTurn && !isSpecial) throw new Error("В этом ходу обычная характеристика уже раскрыта.");
    if (player.revealedTraits[trait]) throw new Error("Эта характеристика уже раскрыта.");
    if (!isSpecial && revealedOrdinaryTraitCount(player) >= MAX_REVEALED_ORDINARY_TRAITS) {
        throw new Error("Последняя обычная карта должна остаться скрытой.");
    }

    const value = engine.characters?.[playerId]?.[trait];
    if (!value) throw new Error("Характеристика не найдена.");

    player.revealedTraits[trait] = value;
    if (!isSpecial) {
        player.revealedThisTurn = true;
        recordFirstReveal(engine, playerId, trait);
    }
    appendLog(engine, `${player.name} раскрывает: ${TRAIT_LABELS[trait]} — ${value}.`);
}

function finishTurn(engine, command) {
    const playerId = command.from;
    const currentPlayerId = engine.order[engine.currentPlayerIndex];
    const player = engine.players?.[playerId];

    if (engine.phase !== PHASES.REVEAL) throw new Error("Сейчас нельзя завершать ход.");
    if (playerId !== currentPlayerId) throw new Error("Сейчас ход другого игрока.");
    if (!player || player.status !== "active") throw new Error("Игрок не участвует в партии.");
    const hasHiddenOrdinaryTraits = TRAIT_KEYS.some((trait) =>
        trait !== "special" && !player.revealedTraits?.[trait]);
    const mayKeepLastTraitHidden =
        revealedOrdinaryTraitCount(player) >= MAX_REVEALED_ORDINARY_TRAITS;
    if (!player.revealedThisTurn && hasHiddenOrdinaryTraits && !mayKeepLastTraitHidden) {
        throw new Error("Сначала раскройте обычную характеристику.");
    }

    completeTurn(engine, playerId);
}

function skipTurn(engine, command, hostId) {
    if (command.from !== hostId) throw new Error("Пропустить ход может только ведущий.");
    if (engine.phase !== PHASES.REVEAL) throw new Error("Сейчас нет активного хода.");
    const currentPlayerId = engine.order[engine.currentPlayerIndex];
    const player = engine.players?.[currentPlayerId];
    if (!player || player.status !== "active") throw new Error("Активный игрок не найден.");

    appendLog(engine, `Ведущий пропускает ход игрока ${player.name}.`);
    completeTurn(engine, currentPlayerId);
}

function completeTurn(engine, playerId) {
    const player = engine.players[playerId];
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

    if (
        command.data?.voteCycle !== undefined
        && Number(command.data.voteCycle) !== Number(engine.voteCycle ?? 0)
    ) {
        throw new Error("Голосование уже сменилось. Выберите кандидата заново.");
    }
    if (engine.phase !== PHASES.VOTING) throw new Error("Сейчас голосование не проводится.");
    if (!voter || !votingPlayerIds(engine).includes(voterId)) throw new Error("Вы не участвуете в голосовании.");
    if (!target || target.status !== "active") throw new Error("Нельзя голосовать за этого игрока.");
    if (voter.voteDisabled) throw new Error("Ваша особая карта запрещает вам голосовать в этом раунде.");
    if (target.immuneThisRound || target.bunkerKing) throw new Error("Этого игрока нельзя изгнать.");
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
    if (engine.pendingSpecialChoice || engine.pendingSecretShare || engine.pendingBunkerVote) {
        throw new Error("Сначала завершите ожидающее действие особой карты.");
    }

    if (engine.phase === PHASES.DISCUSSION) {
        const activeIds = activePlayerIds(engine);
        if (activeIds.length > engine.capacity && remainingRoundVotes(engine) > 0) {
            openVoting(engine);
            return;
        }

        completeCurrentRound(engine);
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
    const revoteCandidates = new Set(
        engine.voteResult?.status === "tie"
            ? engine.voteResult.candidates ?? []
            : []
    );
    const submittedIds = votingPlayerIds(engine).filter((id) => engine.players[id].voteSubmitted && engine.votes[id]);
    if (!submittedIds.length) throw new Error("Пока никто не проголосовал.");
    delete engine.preVotingResultSnapshot;
    engine.preVotingResultSnapshot = captureSpecialSnapshot(engine);

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
        if (engine.players[targetId]?.immuneThisRound || engine.players[targetId]?.bunkerKing) continue;
        let weight = Number(engine.players[voterId].voteMultiplier ?? 1);
        if (engine.roundEffects?.doubleAgainstTarget === targetId) weight *= 2;
        counts[targetId] = (counts[targetId] ?? 0) + weight;
        votersByTarget[targetId] ??= [];
        votersByTarget[targetId].push(voterId);
        if (engine.players[targetId]?.selfPenaltyAgainst) counts[voterId] = (counts[voterId] ?? 0) + 1;
    }

    for (const ownerId of activeIds) {
        const owner = engine.players[ownerId];
        const votersAgainst = votersByTarget[ownerId]?.length ?? 0;
        if (owner.ignoreVotesIfHalf && votersAgainst >= Math.ceil(votingPlayerIds(engine).length / 2)) counts[ownerId] = 0;
        if (owner.ignoreVotesIfEven && votersAgainst > 0 && votersAgainst % 2 === 0) counts[ownerId] = 0;
        if (owner.loneVoteTriple) {
            const targetId = engine.votes[ownerId];
            if (targetId && votersByTarget[targetId]?.length === 1) counts[targetId] = (counts[targetId] ?? 0) + 2;
        }
        if (owner.votersGetHealth) {
            for (const voterId of votersByTarget[ownerId] ?? []) {
                const extraHealth = drawTraitCard("health", () => engineRandom(engine));
                replaceTrait(
                    engine,
                    voterId,
                    "health",
                    `${engine.characters[voterId].health}; дополнительно: ${extraHealth}`,
                    true
                );
            }
        }
    }

    const missingTraits = engine.roundEffects?.missingTraitBonuses
        ?? (engine.roundEffects?.missingTraitBonus ? [engine.roundEffects.missingTraitBonus] : []);
    for (const missingTrait of missingTraits) {
        for (const id of activeIds) {
            if (!engine.players[id].revealedTraits?.[missingTrait]) counts[id] = (counts[id] ?? 0) + 1;
        }
    }
    for (const [id, count] of Object.entries(counts)) {
        const player = engine.players[id];
        if (
            count <= 0
            || player?.status !== "active"
            || player.immuneThisRound
            || player.bunkerKing
            || (revoteCandidates.size && !revoteCandidates.has(id))
        ) {
            delete counts[id];
        }
    }
    if (!Object.keys(counts).length) throw new Error("После применения особых карт не осталось учитываемых голосов.");

    const maximum = Math.max(...Object.values(counts));
    const leaders = Object.keys(counts).filter((id) => counts[id] === maximum);
    if (leaders.length === 1) {
        const exiledPlayerId = leaders[0];
        if (!exilePlayer(engine, exiledPlayerId)) {
            throw new Error("Выбранного игрока нельзя изгнать.");
        }
        markRoundVoteCompleted(engine);
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
        advanceVoteCycle(engine);
        resetVotes(engine);
        appendLog(engine, "Началось переголосование между лидерами.");
        return;
    }

    if (engine.voteResult.status !== "exiled") throw new Error("Результат голосования ещё не готов.");
    const activeIds = activePlayerIds(engine);
    if (activeIds.length > engine.capacity && remainingRoundVotes(engine) > 0) {
        prepareNextVoteInRound(engine);
        return;
    }

    completeCurrentRound(engine);
}

function openVoting(engine) {
    const voteNumber = completedRoundVotes(engine) + 1;
    const voteTarget = roundVoteTarget(engine);
    engine.phase = PHASES.VOTING;
    engine.currentPlayerIndex = -1;
    engine.voteResult = emptyVoteResult();
    advanceVoteCycle(engine);
    resetVotes(engine);
    appendLog(
        engine,
        voteTarget > 1
            ? `Ведущий открыл голосование ${voteNumber} из ${voteTarget} в раунде ${engine.round}.`
            : "Ведущий открыл голосование."
    );
}

function prepareNextVoteInRound(engine) {
    const nextVoteNumber = completedRoundVotes(engine) + 1;
    const voteTarget = roundVoteTarget(engine);
    engine.phase = PHASES.DISCUSSION;
    engine.currentPlayerIndex = -1;
    engine.voteResult = emptyVoteResult();
    delete engine.preVotingResultSnapshot;
    resetSingleVoteEffects(engine);
    resetVotes(engine);
    appendLog(
        engine,
        `Раунд ${engine.round} продолжается: подготовка к голосованию ${nextVoteNumber} из ${voteTarget}.`
    );
}

function completeCurrentRound(engine) {
    const completedRound = Number(engine.round ?? 1);
    const returnedIds = applySecondChances(engine);
    const activeIds = activePlayerIds(engine);
    if (returnedIds.length) {
        appendLog(engine, "Игроки со «Вторым шансом» возвращаются в следующем раунде.");
    }

    reconcileVotingPlan(engine, completedRound + 1);
    if (completedRound >= engine.totalRounds) {
        if (activeIds.length <= engine.capacity) {
            finishGame(engine, activeIds);
            return;
        }
        engine.totalRounds = completedRound + 1;
        engine.voteSchedule[engine.totalRounds] = Math.max(
            Number(engine.voteSchedule?.[engine.totalRounds] ?? 0),
            activeIds.length - engine.capacity
        );
    }

    if (activeIds.length <= engine.capacity) {
        appendLog(engine, "Состав бункера уже определён. Следующий раунд пройдёт без голосования.");
    }
    beginNextRound(engine, activeIds);
}

function beginNextRound(engine, activeIds = activePlayerIds(engine)) {
    if (!activeIds.length) {
        finishGame(engine, []);
        return;
    }
    const completedRound = engine.round;
    engine.round += 1;
    engine.totalRounds = Math.max(MINIMUM_GAME_ROUNDS, engine.totalRounds, engine.round);
    const hasRevealTurns = engine.round <= MAX_TRAIT_REVEAL_ROUNDS;
    engine.phase = hasRevealTurns ? PHASES.REVEAL : PHASES.DISCUSSION;
    engine.voteResult = emptyVoteResult();
    engine.roundEffects = {};
    delete engine.preVotingResultSnapshot;
    delete engine.lastTraitShuffle;
    for (const id of activeIds) {
        const player = engine.players[id];
        player.hasFinishedTurn = !hasRevealTurns;
        player.revealedThisTurn = false;
        player.voteSubmitted = false;
        player.voteMultiplier = 1;
        player.voteDisabled = false;
        player.immuneThisRound = Boolean(player.bunkerKing);
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
        player.immuneThisRound = Boolean(player.bunkerKing);
        player.ignoreVotesIfHalf = false;
        player.ignoreVotesIfEven = false;
        player.selfPenaltyAgainst = false;
        player.loneVoteTriple = false;
        player.votersGetHealth = false;
        engine.votes[id] = "";
    }
    engine.currentPlayerIndex = hasRevealTurns
        ? engine.order.findIndex((id) => engine.players[id]?.status === "active")
        : -1;
    appendLog(
        engine,
        completedRound === 1
            ? `Первый раунд завершён без голосования. Начинается раунд ${engine.round}.`
            : hasRevealTurns
                ? `Начинается раунд ${engine.round}.`
                : `Начинается раунд ${engine.round} без раскрытия новых характеристик: одна обычная карта остаётся скрытой.`
    );
}

function finishGame(engine, activeIds = activePlayerIds(engine)) {
    engine.currentPlayerIndex = -1;
    const bunkerOutcome = resolveFinalBunkerEffects(engine, activeIds);
    const finalistIds = activePlayerIds(engine);
    revealAllPlayersTraits(engine);
    if (engine.threat?.status === "hidden") {
        const secret = engine.scenarioSecrets?.threat;
        if (secret) {
            engine.threat = {
                status: "revealed",
                cardId: Number(secret.id ?? 0),
                title: secret.title,
                description: secret.description
            };
            appendLog(engine, `Финал: раскрыта угроза «${secret.title}».`);
        }
    }

    const finalistSet = new Set(finalistIds);
    const activeExtraThreats = (engine.extraScenarios?.threat ?? []).filter(
        (card) => (
            !card.suppressed
            && isDangerousThreatCard(card)
            && (!card.targetId || finalistSet.has(card.targetId))
        )
    );
    const activeThreatCards = [
        ...(engine.threat?.status === "revealed" && isDangerousThreatCard(engine.threat)
            ? [engine.threat]
            : []),
        ...activeExtraThreats
    ];
    const threatCount = activeThreatCards.length;
    const nonlethalThreatCount = activeThreatCards.filter(isNonlethalThreatCard).length;
    const lethalThreatCount = threatCount - nonlethalThreatCount;
    engine.threatResolution = {
        status: bunkerOutcome.forcedFailure ? "failed" : threatCount ? "pending" : "survived",
        finalistIds,
        threatCount,
        lethalThreatCount,
        nonlethalThreatCount,
        extraThreatIds: activeExtraThreats.map((card) => card.id),
        ...(bunkerOutcome.forcedFailure ? {
            forcedByBunker: true,
            failureReason: bunkerOutcome.message
        } : {})
    };

    if (bunkerOutcome.forcedFailure) {
        engine.phase = PHASES.FINISHED;
        appendLog(engine, bunkerOutcome.message);
        return;
    }

    if (!threatCount) {
        engine.phase = PHASES.FINISHED;
        appendLog(engine, `Угроз для финалистов нет. Бункер выжил: ${finalistIds.map((id) => engine.players[id].name).join(", ")}.`);
        return;
    }

    engine.phase = PHASES.THREAT;
    appendLog(engine, `Финалисты вошли в бункер. Им предстоит справиться с угрозами: ${threatCount}.`);
}

function resolveFinalBunkerEffects(engine, finalistIds) {
    if (engine.finalBunkerEffectsResolved) {
        return {
            forcedFailure: Boolean(engine.finalBunkerEffectsResolved.forcedFailure),
            message: engine.finalBunkerEffectsResolved.message ?? ""
        };
    }

    const bunkerCards = visibleBunkerCards(engine);
    const byCardId = (cardId) => bunkerCards.filter(({ scenario }) => Number(scenario.cardId) === cardId);

    for (const { scenario } of byCardId(4)) {
        const threat = drawUniqueThreatCard(engine);
        addExtraScenario(engine, "threat", threat.title, threat.description, {
            cardId: Number(threat.id ?? 0),
            sourceBunkerInstanceId: scenario.instanceId
        });
        const message = `Из-за долгого срока в бункере добавлена угроза «${threat.title}».`;
        setBunkerEffectResult(engine, scenario, "resolved", message, "threat_added");
        appendLog(engine, message);
    }

    for (const { scenario } of byCardId(59)) {
        const replacement = replaceOneThreat(engine, finalistIds);
        const message = replacement
            ? `Лампа джинна нейтрализовала прежнюю угрозу, но открыла новую: «${replacement.title}».`
            : "Лампа джинна не нашла угрозу для замены.";
        setBunkerEffectResult(engine, scenario, "resolved", message, replacement ? "threat_replaced" : "no_threat");
        appendLog(engine, message);
    }

    for (const { scenario } of byCardId(1)) {
        const suppressed = suppressOneThreat(engine, finalistIds, scenario.instanceId);
        const message = suppressed
            ? suppressed.wasHidden
                ? "Старый журнал позволил не открывать одну угрозу."
                : `Старый журнал позволил не открывать угрозу «${suppressed.title}».`
            : "Старый журнал не нашёл активной угрозы.";
        setBunkerEffectResult(engine, scenario, "resolved", message, suppressed ? "threat_suppressed" : "no_threat");
        appendLog(engine, message);
    }

    let forcedFailure = false;
    let failureMessage = "";
    for (const { scenario } of byCardId(44)) {
        if (engineRandom(engine) < .5) {
            const suppressed = suppressOneThreat(engine, activePlayerIds(engine), scenario.instanceId);
            neutralizeCatastrophe(engine);
            const message = suppressed
                ? suppressed.wasHidden
                    ? "Энергетическая сфера нейтрализовала катастрофу и одну нераскрытую угрозу."
                    : `Энергетическая сфера нейтрализовала катастрофу и угрозу «${suppressed.title}».`
                : "Энергетическая сфера нейтрализовала катастрофу; активных угроз не осталось.";
            setBunkerEffectResult(engine, scenario, "resolved", message, "saved");
            appendLog(engine, message);
        } else {
            for (const playerId of engine.order) killPlayerByBunker(engine, playerId);
            forcedFailure = true;
            failureMessage = "Энергетическая сфера взорвалась. Никто в окрестностях бункера не выжил.";
            setBunkerEffectResult(engine, scenario, "resolved", failureMessage, "destroyed_all");
            appendLog(engine, failureMessage);
            break;
        }
    }

    if (!forcedFailure) {
        for (const { scenario } of byCardId(75)) {
            const roll = engineRandom(engine);
            if (roll < .4) {
                const suppressed = suppressOneThreat(engine, activePlayerIds(engine), scenario.instanceId);
                const message = suppressed
                    ? suppressed.wasHidden
                        ? "Артефакты нейтрализовали одну нераскрытую угрозу."
                        : `Артефакты нейтрализовали угрозу «${suppressed.title}».`
                    : "Артефакты сработали, но активных угроз уже не было.";
                setBunkerEffectResult(engine, scenario, "resolved", message, suppressed ? "threat_suppressed" : "no_threat");
                appendLog(engine, message);
            } else if (roll < .6) {
                const targetId = randomPlayerId(activePlayerIds(engine), () => engineRandom(engine));
                if (targetId) {
                    const name = engine.players[targetId].name;
                    killPlayerByBunker(engine, targetId);
                    const message = `Артефакты убили случайного игрока: ${name}.`;
                    setBunkerEffectResult(engine, scenario, "resolved", message, "player_killed");
                    appendLog(engine, message);
                } else {
                    setBunkerEffectResult(engine, scenario, "resolved", "Артефактам некого было выбрать.", "no_target");
                }
            } else {
                const message = "Артефакты не дали никакого эффекта.";
                setBunkerEffectResult(engine, scenario, "resolved", message, "nothing");
                appendLog(engine, message);
            }
        }
    }

    if (!activePlayerIds(engine).length) {
        forcedFailure = true;
        failureMessage ||= "В финале не осталось ни одного живого участника.";
    }
    engine.finalBunkerEffectsResolved = { forcedFailure, message: failureMessage };
    return { forcedFailure, message: failureMessage };
}

function visibleBunkerCards(engine) {
    const cards = [];
    if (engine.bunker?.status === "revealed") {
        cards.push({ target: "primary:bunker", scenario: engine.bunker });
    }
    for (const scenario of engine.extraScenarios?.bunker ?? []) {
        cards.push({ target: `extra:bunker:${scenario.id}`, scenario });
    }
    return cards;
}

function drawUniqueThreatCard(engine) {
    const excludedTitles = [
        scenarioDeckTitle("threat", engine.scenarioSecrets?.threat),
        engine.threat?.status === "revealed" || engine.threat?.status === "suppressed"
            ? scenarioDeckTitle("threat", engine.threat)
            : "",
        ...(engine.extraScenarios?.threat ?? []).map((card) => scenarioDeckTitle("threat", card))
    ].filter(Boolean);
    for (let attempt = 0; attempt < 80; attempt += 1) {
        const card = drawDistinctScenarioCard(
            "threat",
            excludedTitles,
            () => engineRandom(engine)
        );
        if (isDangerousThreatCard(card)) return card;
        excludedTitles.push(card.title);
    }
    throw new Error("В колоде не осталось активных угроз.");
}

function scenarioDeckTitle(type, scenario) {
    return findScenarioCard(type, scenario)?.title ?? scenario?.title ?? "";
}

function replaceOneThreat(engine, finalistIds) {
    const finalistSet = new Set(finalistIds);
    const primary = engine.threat?.status === "hidden"
        ? engine.scenarioSecrets?.threat
        : engine.threat;
    const replacePrimary = ["hidden", "revealed"].includes(engine.threat?.status)
        && isDangerousThreatCard(primary);
    const extra = (engine.extraScenarios?.threat ?? []).find((card) => (
        !card.suppressed
        && isDangerousThreatCard(card)
        && (!card.targetId || finalistSet.has(card.targetId))
    ));
    if (!replacePrimary && !extra) return null;

    const replacement = drawUniqueThreatCard(engine);
    if (replacePrimary) {
        engine.scenarioSecrets ??= {};
        engine.scenarioSecrets.threat = replacement;
        if (engine.threat.status === "revealed") {
            engine.threat = {
                status: "revealed",
                cardId: Number(replacement.id ?? 0),
                title: replacement.title,
                description: replacement.description
            };
        }
        return replacement;
    }
    extra.cardId = Number(replacement.id ?? 0);
    extra.title = replacement.title;
    extra.description = replacement.description;
    return replacement;
}

function suppressOneThreat(engine, finalistIds, sourceBunkerInstanceId) {
    const finalistSet = new Set(finalistIds);
    const primaryWasHidden = engine.threat?.status === "hidden";
    if (
        ["hidden", "revealed"].includes(engine.threat?.status)
        && isDangerousThreatCard(primaryWasHidden
            ? engine.scenarioSecrets?.threat
            : engine.threat)
    ) {
        const secret = engine.scenarioSecrets?.threat ?? engine.threat;
        engine.threat = {
            status: "suppressed",
            cardId: primaryWasHidden ? 0 : Number(secret?.id ?? secret?.cardId ?? 0),
            title: primaryWasHidden ? "Угроза не раскрыта" : secret?.title ?? "Угроза",
            description: "Эта угроза нейтрализована картой бункера до финальной проверки.",
            sourceBunkerInstanceId
        };
        return { ...secret, wasHidden: primaryWasHidden };
    }
    const extra = (engine.extraScenarios?.threat ?? []).find((card) => (
        !card.suppressed
        && isDangerousThreatCard(card)
        && (!card.targetId || finalistSet.has(card.targetId))
    ));
    if (!extra) return null;
    const wasHidden = Boolean(extra.hiddenUntilFinal);
    const suppressed = { ...extra, wasHidden };
    extra.suppressed = true;
    extra.suppressedByBunkerInstanceId = sourceBunkerInstanceId;
    if (wasHidden) {
        extra.cardId = 0;
        extra.title = "Угроза не раскрыта";
        extra.description = "Эта тайная угроза нейтрализована картой бункера и не раскрывается.";
        extra.hiddenUntilFinal = false;
    }
    return suppressed;
}

function neutralizeCatastrophe(engine) {
    const catastrophe = engine.catastrophe?.status === "revealed"
        ? engine.catastrophe
        : engine.scenarioSecrets?.catastrophe;
    engine.catastrophe = {
        status: "neutralized",
        cardId: Number(catastrophe?.id ?? catastrophe?.cardId ?? 0),
        title: catastrophe?.title ? `Нейтрализована: ${catastrophe.title}` : "Катастрофа нейтрализована",
        description: "Энергетическая сфера устранила последствия катастрофы."
    };
}

function killPlayerByBunker(engine, playerId) {
    const player = engine.players?.[playerId];
    if (!player || player.status === "dead") return;
    player.status = "dead";
    player.bunkerDeath = true;
    player.voteSubmitted = false;
    engine.votes[playerId] = "";
    revealAllTraits(engine, playerId);
}

function isDangerousThreatCard(card) {
    const cardId = Number(card?.cardId ?? card?.id ?? 0);
    return ![11, 31].includes(cardId);
}

function isNonlethalThreatCard(card) {
    return Number(card?.cardId ?? card?.id ?? 0) === 36;
}

function resolveThreat(engine, command, hostId) {
    if (command.from !== hostId) throw new Error("Исход финальной угрозы определяет ведущий.");
    if (engine.phase !== PHASES.THREAT || engine.threatResolution?.status !== "pending") {
        throw new Error("Сейчас нет активной финальной угрозы.");
    }
    const outcome = command.data?.outcome;
    if (!["survived", "failed", "nonlethal_failed"].includes(outcome)) {
        throw new Error("Неизвестный исход угрозы.");
    }

    const hasNonlethalThreat = Number(engine.threatResolution.nonlethalThreatCount ?? 0) > 0;
    if (outcome === "nonlethal_failed" && !hasNonlethalThreat) {
        throw new Error("Среди активных угроз нет несмертельной угрозы с домовым.");
    }
    const onlyNonlethalFailure = outcome === "failed"
        && Number(engine.threatResolution.lethalThreatCount ?? engine.threatResolution.threatCount ?? 0) === 0
        && hasNonlethalThreat;
    if (onlyNonlethalFailure || outcome === "nonlethal_failed") {
        resolveNonlethalThreatFailure(engine);
        return;
    }

    engine.threatResolution.status = outcome;
    engine.threatResolution.resolvedAt = Date.now();
    revealAllPlayersTraits(engine);
    engine.phase = PHASES.FINISHED;
    const names = engine.threatResolution.finalistIds
        .map((id) => engine.players[id]?.name)
        .filter(Boolean)
        .join(", ");
    appendLog(
        engine,
        outcome === "survived"
            ? `Финальная угроза устранена. Бункер выжил: ${names}.`
            : `Финальная угроза не устранена. Бункер не выжил. Финалисты: ${names}.`
    );
}

function resolveNonlethalThreatFailure(engine) {
    for (const playerId of engine.threatResolution.finalistIds ?? []) {
        if (engine.players[playerId]?.status !== "active") continue;
        replaceTrait(engine, playerId, "baggage", "Багаж потерян из-за домового", true);
    }
    const lethalThreatsResolved = Number(engine.threatResolution.lethalThreatCount ?? 0) > 0;
    engine.threatResolution.status = "survived";
    engine.threatResolution.nonlethalFailure = true;
    engine.threatResolution.lethalThreatsResolved = lethalThreatsResolved;
    engine.threatResolution.resolvedAt = Date.now();
    revealAllPlayersTraits(engine);
    engine.phase = PHASES.FINISHED;
    const names = engine.threatResolution.finalistIds
        .map((id) => engine.players[id]?.name)
        .filter(Boolean)
        .join(", ");
    appendLog(
        engine,
        lethalThreatsResolved
            ? `Смертельные угрозы устранены, но домового поймать не удалось: финалисты потеряли багаж. Бункер выжил: ${names}.`
            : `Домового поймать не удалось: финалисты потеряли багаж, но остались живы. Бункер выжил: ${names}.`
    );
}

function ensureBunkerCardsForCurrentRound(engine) {
    engine.bunkerRoundsRevealed ??= {};
    engine.extraScenarios ??= {};
    engine.extraScenarios.bunker ??= [];
    engine.bunkerEffectResults ??= {};
    engine.bunkerVoteQueue ??= [];
    migrateScenarioMetadata(engine);

    if (!engine.bunkerRoundsRevealed[1]) {
        const wasHidden = engine.bunker?.status !== "revealed";
        if (wasHidden) {
            const firstCard = engine.scenarioSecrets?.bunker ?? drawUniqueBunkerCard(engine);
            engine.bunker = {
                status: "revealed",
                cardId: Number(firstCard.id ?? firstCard.cardId ?? 0),
                instanceId: nextBunkerCardInstanceId(engine),
                title: firstCard.title,
                description: firstCard.description,
                revealedRound: 1
            };
            appendLog(engine, `Раунд 1: раскрыта карта бункера «${firstCard.title}».`);
        } else {
            engine.bunker.revealedRound ??= 1;
            engine.bunker.cardId ??= Number(engine.scenarioSecrets?.bunker?.id ?? 0);
            engine.bunker.instanceId ??= nextBunkerCardInstanceId(engine);
        }
        engine.bunkerRoundsRevealed[1] = true;
        activateBunkerCard(engine, engine.bunker, "primary:bunker");
    }

    for (let round = 2; round <= Number(engine.round ?? 1); round += 1) {
        if (engine.bunkerRoundsRevealed[round]) continue;
        const card = drawUniqueBunkerCard(engine);
        const scenario = {
            id: `round_bunker_${round}`,
            cardId: Number(card.id ?? 0),
            instanceId: nextBunkerCardInstanceId(engine),
            title: card.title,
            description: card.description,
            revealedRound: round
        };
        engine.extraScenarios.bunker.push(scenario);
        engine.bunkerRoundsRevealed[round] = true;
        appendLog(engine, `Раунд ${round}: раскрыта карта бункера «${card.title}».`);
        activateBunkerCard(engine, scenario, `extra:bunker:${scenario.id}`);
    }
}

function migrateScenarioMetadata(engine) {
    engine.extraScenarios ??= {};
    engine.extraScenarios.bunker ??= [];
    engine.bunkerCardHistory ??= {};
    rememberBunkerCard(engine, engine.scenarioSecrets?.bunker);
    rememberBunkerCard(engine, engine.bunker);
    engine.bunkerEffectResults ??= {};
    engine.bunkerVoteQueue ??= [];
    engine.bunkerCardSequence = Math.max(
        Number(engine.bunkerCardSequence ?? 0),
        ...[
            engine.bunker,
            ...(engine.extraScenarios.bunker ?? [])
        ].map((scenario) => {
            const match = String(scenario?.instanceId ?? "").match(/^bunker_card_(\d+)$/);
            return Number(match?.[1] ?? 0);
        })
    );

    migrateScenarioCardId("catastrophe", engine.catastrophe);
    migrateScenarioCardId("threat", engine.threat);
    for (const scenario of engine.extraScenarios.threat ?? []) {
        migrateScenarioCardId("threat", scenario);
    }

    const hadPendingVote = Boolean(engine.pendingBunkerVote);
    const canActivateBunkerCards = !engine.pendingSpecialChoice
        && !engine.pendingSecretShare
        && !engine.pendingBunkerVote;
    if (engine.bunker?.status === "revealed") {
        migrateBunkerScenario(
            engine,
            engine.bunker,
            "primary:bunker",
            1,
            canActivateBunkerCards
        );
    }
    for (const scenario of engine.extraScenarios.bunker) {
        const roundMatch = String(scenario?.id ?? "").match(/^round_bunker_(\d+)$/);
        const revealedRound = Number(scenario?.revealedRound ?? roundMatch?.[1] ?? engine.round ?? 1);
        migrateBunkerScenario(
            engine,
            scenario,
            `extra:bunker:${scenario.id}`,
            revealedRound,
            canActivateBunkerCards
        );
    }
    return !hadPendingVote && Boolean(engine.pendingBunkerVote);
}

function migrateScenarioCardId(type, scenario) {
    if (!scenario || Number(scenario.cardId ?? 0)) return;
    const card = findScenarioCard(type, scenario);
    if (card) scenario.cardId = Number(card.id ?? 0);
}

function migrateBunkerScenario(engine, scenario, sourceTarget, revealedRound, activate) {
    migrateScenarioCardId("bunker", scenario);
    rememberBunkerCard(engine, scenario);
    scenario.instanceId ??= nextBunkerCardInstanceId(engine);
    scenario.revealedRound ??= revealedRound;
    if (activate) activateBunkerCard(engine, scenario, sourceTarget);
}

function nextBunkerCardInstanceId(engine) {
    engine.bunkerCardSequence = Number(engine.bunkerCardSequence ?? 0) + 1;
    return `bunker_card_${engine.bunkerCardSequence}`;
}

function drawUniqueBunkerCard(engine, additionalExcludedTitles = []) {
    const visibleTitles = new Set([
        engine.bunker?.status === "revealed" ? engine.bunker.title : "",
        ...(engine.extraScenarios?.bunker ?? []).map((card) => card.title),
        ...bunkerCardHistoryTitles(engine),
        ...additionalExcludedTitles
    ].filter(Boolean));
    const card = drawDistinctScenarioCard("bunker", [...visibleTitles], () => engineRandom(engine));
    rememberBunkerCard(engine, card);
    return card;
}

function rememberBunkerCard(engine, scenario) {
    if (!scenario) return 0;
    const reference = scenario.removedCardTitle
        ? { title: scenario.removedCardTitle }
        : scenario;
    const card = findScenarioCard("bunker", reference);
    const cardId = Number(card?.id ?? scenario.cardId ?? 0);
    if (!cardId) return 0;
    engine.bunkerCardHistory ??= {};
    engine.bunkerCardHistory[cardId] = true;
    return cardId;
}

function bunkerCardHistoryTitles(engine) {
    return Object.entries(engine.bunkerCardHistory ?? {})
        .filter(([, drawn]) => Boolean(drawn))
        .map(([cardId]) => findScenarioCard("bunker", { cardId: Number(cardId) })?.title)
        .filter(Boolean);
}

function engineRandom(engine) {
    const current = Number(engine.randomState ?? 1) >>> 0;
    engine.randomState = (Math.imul(current || 1, 1664525) + 1013904223) >>> 0;
    return engine.randomState / 0x100000000;
}

function activateBunkerCard(engine, scenario, sourceTarget) {
    const cardId = Number(scenario?.cardId ?? 0);
    if (!INTERACTIVE_BUNKER_CARD_IDS.has(cardId)) return;
    scenario.instanceId ??= nextBunkerCardInstanceId(engine);
    engine.bunkerEffectResults ??= {};
    if (engine.bunkerEffectResults[scenario.instanceId]) return;

    if (cardId === 51 || cardId === 52) {
        const activeIds = activePlayerIds(engine);
        const targetId = randomPlayerId(
            activeIds,
            () => engineRandom(engine)
        );
        if (!targetId) {
            setBunkerEffectResult(engine, scenario, "resolved", "Эффект не сработал: нет активных игроков.");
            return;
        }
        const health = cardId === 51 ? "Огнестрельное ранение" : "Зоофилия";
        const healthRevealed = replaceTrait(engine, targetId, "health", health, true);
        const message = healthRevealed
            ? `${engine.players[targetId].name}: состояние здоровья изменено на «${health}».`
            : `${engine.players[targetId].name}: состояние здоровья изменено, но последняя обычная карта остаётся скрытой.`;
        setBunkerEffectResult(engine, scenario, "resolved", message);
        appendLog(engine, `Карта бункера №${cardId} сработала. ${message}`);
        return;
    }

    if (cardId === 53 || cardId === 62) {
        queueBunkerVote(
            engine,
            scenario,
            sourceTarget,
            cardId === 53 ? "sacrifice" : "king"
        );
        return;
    }

    const message = cardId === 1
        ? "В финале эта карта нейтрализует одну угрозу."
        : cardId === 4
            ? "В финале эта карта добавит ещё одну угрозу."
            : cardId === 59
                ? "В финале одна угроза будет заменена новой."
                : "Случайный исход этой карты определится в финале.";
    setBunkerEffectResult(engine, scenario, "awaiting_final", message);
    appendLog(engine, `Активирована интерактивная карта бункера №${cardId}. ${message}`);
}

function setBunkerEffectResult(engine, scenario, status, message, outcome = "") {
    engine.bunkerEffectResults ??= {};
    const instanceId = scenario?.instanceId;
    if (!instanceId) return;
    engine.bunkerEffectResults[instanceId] = {
        cardId: Number(scenario.cardId ?? 0),
        status,
        message,
        ...(outcome ? { outcome } : {})
    };
}

function setBunkerEffectResultByInstance(engine, instanceId, status, message, outcome = "") {
    const current = engine.bunkerEffectResults?.[instanceId] ?? {};
    engine.bunkerEffectResults ??= {};
    engine.bunkerEffectResults[instanceId] = {
        cardId: Number(current.cardId ?? findBunkerScenarioByInstance(engine, instanceId)?.cardId ?? 0),
        status,
        message,
        ...(outcome ? { outcome } : {})
    };
}

function queueBunkerVote(engine, scenario, sourceTarget, type) {
    const voterIds = activePlayerIds(engine);
    const candidateIds = type === "king"
        ? engine.order.filter((id) => engine.players[id]?.status !== "dead")
        : voterIds.filter((id) =>
            !engine.players[id]?.bunkerKing
            && !engine.players[id]?.immuneThisRound);
    if (!voterIds.length || !candidateIds.length) {
        const message = "Голосование невозможно: нет подходящих участников.";
        setBunkerEffectResult(engine, scenario, "resolved", message, "no_candidates");
        appendLog(engine, message);
        return;
    }

    const vote = {
        type,
        sourceTarget,
        sourceInstanceId: scenario.instanceId,
        candidateIds,
        voterIds,
        votes: {},
        revote: false
    };
    engine.bunkerVoteQueue ??= [];
    if (engine.pendingBunkerVote) engine.bunkerVoteQueue.push(vote);
    else engine.pendingBunkerVote = vote;
    setBunkerEffectResult(
        engine,
        scenario,
        "voting",
        type === "king"
            ? "Идёт дополнительное голосование за царя."
            : "Идёт дополнительное голосование за жертву."
    );
    appendLog(
        engine,
        type === "king"
            ? "Карта бункера №62 требует выбрать царя дополнительным голосованием."
            : "Карта бункера №53 требует выбрать жертву дополнительным голосованием."
    );
}

function voteForBunkerEffect(engine, command) {
    const vote = engine.pendingBunkerVote;
    if (!vote) throw new Error("Сейчас нет голосования по карте бункера.");
    refreshBunkerVoteParticipants(engine, vote);
    const voterId = command.from;
    const targetId = command.data?.targetId;
    if (!vote.voterIds.includes(voterId) || engine.players[voterId]?.status !== "active") {
        throw new Error("Вы не участвуете в этом дополнительном голосовании.");
    }
    if (!vote.candidateIds.includes(targetId)) throw new Error("Выберите допустимого кандидата.");
    if (
        vote.type === "sacrifice"
        && (
            engine.players[targetId]?.status !== "active"
            || engine.players[targetId]?.bunkerKing
            || engine.players[targetId]?.immuneThisRound
        )
    ) {
        throw new Error("В жертву можно выбрать только активного игрока, который не является царём.");
    }
    vote.votes[voterId] = targetId;
    appendLog(engine, `${engine.players[voterId].name} проголосовал в дополнительном голосовании.`);
}

function resolveBunkerVote(engine, command, hostId) {
    if (command.from !== hostId) throw new Error("Подвести итог дополнительного голосования может только ведущий.");
    const vote = engine.pendingBunkerVote;
    if (!vote) throw new Error("Сейчас нет голосования по карте бункера.");
    refreshBunkerVoteParticipants(engine, vote);
    const submittedTargets = Object.entries(vote.votes ?? {})
        .filter(([voterId, targetId]) => vote.voterIds.includes(voterId) && vote.candidateIds.includes(targetId))
        .map(([, targetId]) => targetId);
    if (!submittedTargets.length) throw new Error("Пока никто не проголосовал.");

    const counts = {};
    for (const targetId of submittedTargets) counts[targetId] = (counts[targetId] ?? 0) + 1;
    const maximum = Math.max(...Object.values(counts));
    const leaders = Object.keys(counts).filter((id) => counts[id] === maximum);
    if (leaders.length > 1) {
        vote.candidateIds = leaders;
        vote.votes = {};
        vote.revote = true;
        setBunkerEffectResultByInstance(
            engine,
            vote.sourceInstanceId,
            "voting",
            "Ничья. Идёт переголосование между лидерами.",
            "tie"
        );
        appendLog(engine, "Дополнительное голосование завершилось ничьей. Требуется переголосование.");
        return;
    }

    const winnerId = leaders[0];
    const winner = engine.players[winnerId];
    delete engine.pendingBunkerVote;

    if (vote.type === "sacrifice") {
        if (!exilePlayer(engine, winnerId)) {
            engine.pendingBunkerVote = vote;
            throw new Error("Выбранного игрока нельзя принести в жертву.");
        }
        const extraCard = addRevealedBunkerCard(engine, drawUniqueBunkerCard(engine), "altar");
        const message = `${winner.name} принесён в жертву. Открыта дополнительная карта «${extraCard.title}».`;
        setBunkerEffectResultByInstance(engine, vote.sourceInstanceId, "resolved", message, "sacrificed");
        appendLog(engine, message);
        activateBunkerCard(engine, extraCard, `extra:bunker:${extraCard.id}`);
    } else {
        if (winner.status === "exiled") {
            winner.status = "active";
            restorePreExileTraits(engine, winnerId);
            catchUpReturnedPlayer(engine, winnerId);
            if (engine.phase === PHASES.REVEAL) {
                winner.hasFinishedTurn = false;
                winner.revealedThisTurn = false;
            }
        }
        winner.bunkerKing = true;
        winner.immuneThisRound = true;
        const message = `${winner.name} выбран царём, возвращён в группу и больше не может быть изгнан.`;
        setBunkerEffectResultByInstance(engine, vote.sourceInstanceId, "resolved", message, "king_chosen");
        appendLog(engine, message);
        repairCurrentTurn(engine);
    }

    if (!engine.pendingBunkerVote) promoteNextBunkerVote(engine);

}

function refreshBunkerVoteParticipants(engine, vote, rebuild = false) {
    const activeIds = activePlayerIds(engine);
    const eligibleVoters = new Set(activeIds);
    const eligibleCandidates = new Set(vote.type === "king"
        ? engine.order.filter((id) => engine.players[id]?.status !== "dead")
        : activeIds.filter((id) =>
            !engine.players[id]?.bunkerKing
            && !engine.players[id]?.immuneThisRound));
    vote.voterIds = rebuild
        ? [...eligibleVoters]
        : (vote.voterIds ?? []).filter((id) => eligibleVoters.has(id));
    vote.candidateIds = rebuild && !vote.revote
        ? [...eligibleCandidates]
        : (vote.candidateIds ?? []).filter((id) => eligibleCandidates.has(id));
    vote.votes = Object.fromEntries(Object.entries(vote.votes ?? {}).filter(
        ([voterId, targetId]) =>
            vote.voterIds.includes(voterId) && vote.candidateIds.includes(targetId)
    ));
}

function promoteNextBunkerVote(engine) {
    while (!engine.pendingBunkerVote && engine.bunkerVoteQueue?.length) {
        const next = engine.bunkerVoteQueue.shift();
        refreshBunkerVoteParticipants(engine, next, true);
        if (!next.voterIds.length || !next.candidateIds.length) {
            const message = "Отложенное голосование отменено: подходящих участников больше нет.";
            setBunkerEffectResultByInstance(
                engine,
                next.sourceInstanceId,
                "resolved",
                message,
                "no_candidates"
            );
            appendLog(engine, message);
            continue;
        }
        next.votes = {};
        next.revote = false;
        engine.pendingBunkerVote = next;
        setBunkerEffectResultByInstance(
            engine,
            next.sourceInstanceId,
            "voting",
            next.type === "king"
                ? "Идёт дополнительное голосование за царя."
                : "Идёт дополнительное голосование за жертву."
        );
    }
}

function addRevealedBunkerCard(engine, card, origin = "extra") {
    engine.extraScenarios ??= {};
    engine.extraScenarios.bunker ??= [];
    const instanceId = nextBunkerCardInstanceId(engine);
    const scenario = {
        id: `${origin}_bunker_${instanceId}`,
        cardId: Number(card.id ?? 0),
        instanceId,
        title: card.title,
        description: card.description,
        revealedRound: Number(engine.round ?? 1)
    };
    engine.extraScenarios.bunker.push(scenario);
    return scenario;
}

function findBunkerScenarioByInstance(engine, instanceId) {
    if (engine.bunker?.instanceId === instanceId) return engine.bunker;
    return (engine.extraScenarios?.bunker ?? []).find((card) => card.instanceId === instanceId) ?? null;
}

function randomPlayerId(ids, random = Math.random) {
    if (!ids.length) return "";
    return ids[Math.min(ids.length - 1, Math.floor(random() * ids.length))];
}

function revealScenario(engine, command, hostId) {
    if (command.from !== hostId) throw new Error("Раскрывать условия может только ведущий.");
    if ([PHASES.THREAT, PHASES.FINISHED].includes(engine.phase)) {
        throw new Error("После начала финальной угрозы карты условий менять нельзя.");
    }
    const scenarioType = command.data?.scenarioType;
    if (!["catastrophe", "bunker", "threat"].includes(scenarioType)) {
        throw new Error("Неизвестный тип сценария.");
    }
    if (engine[scenarioType]?.status !== "hidden") throw new Error("Эту карту сейчас нельзя раскрыть.");
    const secret = engine.scenarioSecrets?.[scenarioType];
    if (!secret) throw new Error("Данные сценария не найдены.");
    engine[scenarioType] = {
        status: "revealed",
        cardId: Number(secret.id ?? 0),
        ...(scenarioType === "bunker" ? {
            instanceId: nextBunkerCardInstanceId(engine),
            revealedRound: Number(engine.round ?? 1)
        } : {}),
        title: secret.title,
        description: secret.description
    };
    appendLog(engine, `Раскрыта карта «${secret.title}».`);
    if (scenarioType === "bunker") activateBunkerCard(engine, engine.bunker, "primary:bunker");
}

function hostEdit(engine, command, hostId) {
    if (command.from !== hostId) throw new Error("Редактировать партию может только ведущий.");
    if ([PHASES.THREAT, PHASES.FINISHED].includes(engine.phase)) {
        throw new Error("После начала финальной угрозы редактор партии заблокирован.");
    }
    const action = command.data?.action;

    if (action === "set_capacity") {
        const capacity = Number(command.data?.capacity);
        if (!Number.isInteger(capacity) || capacity < 1 || capacity >= engine.order.length) {
            throw new Error("Некорректное количество мест в бункере.");
        }
        engine.capacity = capacity;
        const voteIsStillOpen = engine.phase === PHASES.VOTING
            || (engine.phase === PHASES.RESULTS && engine.voteResult?.status === "tie");
        if (voteIsStillOpen && activePlayerIds(engine).length <= capacity) {
            engine.phase = PHASES.DISCUSSION;
            engine.currentPlayerIndex = -1;
            engine.voteResult = emptyVoteResult();
            resetSingleVoteEffects(engine);
            resetVotes(engine);
            delete engine.preVotingResultSnapshot;
            appendLog(engine, "Голосование отменено: после изменения вместимости мест хватает всем активным игрокам.");
        }
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
                const special = drawSpecialCard(() => engineRandom(engine));
                value = special.text;
                engine.characters[playerId].specialId = special.id;
            } else {
                value = drawTraitCard(trait, () => engineRandom(engine));
            }
        }
        if (!value) throw new Error("Значение карты не может быть пустым.");
        const revealRequested = wasRevealed || command.data?.revealed === true;
        if (
            revealRequested
            && !wasRevealed
            && trait !== "special"
            && !canRevealTrait(player, trait)
        ) {
            throw new Error("У активного игрока должна остаться одна скрытая обычная карта.");
        }
        engine.characters[playerId][trait] = value;
        if (trait === "special" && action === "set_trait") engine.characters[playerId].specialId = 0;
        if (trait === "special") player.specialUsed = false;
        if (revealRequested) {
            player.revealedTraits[trait] = value;
            if (!wasRevealed) recordFirstReveal(engine, playerId, trait);
        }
        else player.revealedTraits[trait] = "";
        appendLog(engine, `Ведущий изменил карту «${TRAIT_LABELS[trait]}» игрока ${player.name}${revealRequested ? `: ${value}` : ""}.`);
        return;
    }

    if (action === "set_status") {
        const player = engine.players?.[command.data?.playerId];
        const status = command.data?.status;
        if (!player || !["active", "exiled"].includes(status)) throw new Error("Некорректный статус игрока.");
        if (status === "exiled" && player.bunkerKing) throw new Error("Царя нельзя изгнать из бункера.");
        const isReturning = status === "active" && player.status === "exiled";
        if (status === "exiled" && player.status !== "exiled") exilePlayer(engine, player.id);
        else {
            player.status = status;
            if (isReturning) {
                restorePreExileTraits(engine, player.id);
                catchUpReturnedPlayer(engine, player.id);
                if (engine.phase === PHASES.REVEAL) {
                    player.hasFinishedTurn = false;
                    player.revealedThisTurn = false;
                }
            }
        }
        player.voteSubmitted = false;
        engine.votes[player.id] = "";
        repairCurrentTurn(engine);
        appendLog(engine, `Ведущий изменил статус игрока ${player.name}: ${status === "active" ? "возвращён в игру" : "изгнан"}.`);
        return;
    }

    if (action === "add_scenario") {
        const type = command.data?.scenarioType;
        if (!["catastrophe", "bunker", "threat"].includes(type)) throw new Error("Неизвестный тип карты условий.");
        const randomCard = command.data?.random === true
            ? type === "bunker"
                ? drawUniqueBunkerCard(engine)
                : drawScenarioCard(type, () => engineRandom(engine))
            : null;
        const title = String(randomCard?.title ?? command.data?.title ?? "").trim();
        const description = String(randomCard?.description ?? command.data?.description ?? "").trim();
        if (!title || !description) throw new Error("Укажите название и описание карты.");
        engine.extraScenarios ??= {};
        engine.extraScenarios[type] ??= [];
        const card = {
            id: `extra_${Date.now()}_${engine.revision}`,
            ...(randomCard ? { cardId: Number(randomCard.id ?? 0) } : {}),
            ...(type === "bunker" ? {
                instanceId: nextBunkerCardInstanceId(engine),
                revealedRound: Number(engine.round ?? 1)
            } : {}),
            title,
            description
        };
        if (type === "bunker") rememberBunkerCard(engine, card);
        engine.extraScenarios[type].push(card);
        appendLog(engine, `Ведущий добавил карту «${title}».`);
        if (type === "bunker") activateBunkerCard(engine, card, `extra:bunker:${card.id}`);
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
        engine[type] = removedScenario(
            type === "catastrophe" ? "Катастрофа" : type === "bunker" ? "Бункер" : "Угроза",
            removedTitle,
            "Ведущий убрал эту карту из партии."
        );
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
    if (player.specialUsed) throw new Error("Особая карта уже использована.");
    if (!specialId) throw new Error("Особая карта не назначена.");
    const resolvingPendingChoice = specialId === 54
        && engine.pendingSpecialChoice?.playerId === playerId;
    if (!resolvingPendingChoice) {
        const availability = getSpecialAvailability(engine, playerId, specialId);
        if (!availability.allowed) throw new Error(availability.reason);
    } else if ([PHASES.THREAT, PHASES.FINISHED].includes(engine.phase)) {
        throw new Error("Финальная угроза уже началась.");
    }
    const secretSpecial = SECRET_SPECIAL_IDS.has(specialId);
    if (!secretSpecial && !player.revealedTraits?.special) {
        player.revealedTraits.special = character.special;
    }

    const targetId = command.data?.targetId;
    const target = engine.players?.[targetId];
    const trait = command.data?.trait;
    const choice = command.data?.choice;
    const scenarioTarget = command.data?.scenarioTarget;
    const requireTarget = () => {
        if (!target || target.status !== "active") throw new Error("Выберите активного игрока для действия карты.");
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
        const removed = removeBunkerTarget(
            engine,
            scenarioTarget,
            "Карта перенесена к изгнанным и больше не помогает финалистам."
        );
        addExtraScenario(engine, "exile", `У изгнанных: ${removed.title}`, removed.description);
    } else if (specialId === 2) {
        requireTarget().cannotVoteAgainst ??= {};
        target.cannotVoteAgainst[playerId] = true;
    } else if (specialId === 3) {
        const card = drawUniqueBunkerCard(engine);
        replaceBunkerTarget(engine, scenarioTarget, card);
    } else if (specialId === 4) {
        player.voteMultiplier = 2;
    } else if (specialId >= 5 && specialId <= 9) {
        shuffleRevealedTrait(engine, ({ 5: "baggage", 6: "biology", 7: "hobby", 8: "health", 9: "fact" })[specialId]);
    } else if (specialId === 10) {
        linkProtection(engine, playerId, neighborId(engine, playerId, -1));
    } else if (specialId === 11) {
        if (player.status !== "exiled") throw new Error("Эту карту можно сыграть только после изгнания.");
        removeBunkerTarget(engine, scenarioTarget, "Карта сброшена диверсией и больше недоступна.");
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
        if (victim.id === playerId) throw new Error("Выберите другого игрока.");
        character.baggage = victim.revealedTraits?.baggage || engine.characters[targetId].baggage;
        if (player.revealedTraits.baggage) player.revealedTraits.baggage = character.baggage;
        engine.characters[targetId].baggage = "Багаж забрали особой картой";
        if (victim.revealedTraits.baggage) victim.revealedTraits.baggage = engine.characters[targetId].baggage;
        giveNewSpecial(engine, targetId);
    } else if (specialId === 20) {
        requireTarget();
        engine.roundEffects ??= {};
        engine.roundEffects.doubleAgainstTarget = targetId;
        engine.roundEffects.voteDisabledPlayers ??= {};
        engine.roundEffects.voteDisabledPlayers[playerId] = true;
        player.voteDisabled = true;
    } else if (specialId === 24) {
        if (player.status !== "exiled") throw new Error("Эту карту можно сыграть только после изгнания.");
        addExtraScenario(
            engine,
            "threat",
            "Налёт мародёров",
            "Банда мародёров узнала о бункере и угрожает финалистам.",
            { hiddenUntilFinal: true }
        );
    } else if (specialId === 25) {
        const healthTarget = requireTarget();
        if (!healthTarget.revealedTraits?.health) {
            throw new Error("Выберите игрока с открытой картой здоровья.");
        }
        replaceTrait(engine, healthTarget.id, "health", drawTraitCard("health", () => engineRandom(engine)));
    } else if (specialId === 26) {
        if (!TRAIT_KEYS.includes(trait) || trait === "special") throw new Error("Выберите тип обычной карты.");
        engine.roundEffects ??= {};
        engine.roundEffects.forcedTrait = trait;
    } else if (specialId === 27) {
        replaceTrait(engine, requireTarget().id, "health", "Идеально здоров");
    } else if (specialId === 28) {
        if (engine.phase === PHASES.RESULTS) {
            const resultSnapshot = snapshot;
            const votingSnapshot = engine.preVotingResultSnapshot;
            if (!votingSnapshot) throw new Error("Не удалось восстановить состояние до подсчёта голосов.");
            restoreSpecialSnapshot(engine, votingSnapshot);
            engine.roundEffects ??= {};
            engine.roundEffects.previousVoteTargets = { ...engine.votes };
            engine.phase = PHASES.VOTING;
            engine.voteResult = emptyVoteResult();
            advanceVoteCycle(engine);
            resetVotes(engine);
            const restoredPlayer = engine.players[playerId];
            restoredPlayer.revealedTraits.special = engine.characters[playerId].special;
            restoredPlayer.specialUsed = true;
            delete engine.preVotingResultSnapshot;
            engine.lastSpecialSnapshot = {
                playedBy: playerId,
                specialId,
                data: {},
                state: resultSnapshot,
                playedAtRevision: engine.revision + 1
            };
            appendLog(engine, `${restoredPlayer.name} разыгрывает «План Б»: результат отменён, начинается новое голосование.`);
            return;
        }
        engine.roundEffects ??= {};
        engine.roundEffects.previousVoteTargets = { ...engine.votes };
        engine.voteResult = emptyVoteResult();
        advanceVoteCycle(engine);
        resetVotes(engine);
    } else if (specialId === 29) {
        const professionTarget = requireTarget();
        if (!professionTarget.revealedTraits?.profession) {
            throw new Error("Выберите игрока с открытой картой профессии.");
        }
        replaceTrait(engine, professionTarget.id, "profession", drawTraitCard("profession", () => engineRandom(engine)));
    } else if (specialId === 30) {
        if (player.status !== "exiled") throw new Error("Эту карту можно сыграть только после изгнания.");
        if (engine.capacity <= 1) throw new Error("Вместимость бункера уже нельзя уменьшить.");
        engine.capacity = Math.max(1, engine.capacity - 1);
        appendLog(engine, `После последней диверсии вместимость бункера уменьшена до ${engine.capacity}.`);
    } else if (specialId >= 31 && specialId <= 36) {
        const ownTrait = specialId === 31 ? trait : ({ 32: "biology", 33: "hobby", 34: "baggage", 35: "fact", 36: "profession" })[specialId];
        if (!TRAIT_KEYS.includes(ownTrait) || ownTrait === "special") throw new Error("Выберите карту для замены.");
        replaceTrait(engine, playerId, ownTrait, drawTraitCard(ownTrait, () => engineRandom(engine)));
    } else if (specialId === 37) {
        const health = character.health;
        for (const id of activePlayerIds(engine)) replaceTrait(engine, id, "health", health);
    } else if (specialId === 38) {
        if (player.status !== "exiled") throw new Error("Эту карту можно сыграть только после изгнания.");
        const exileTarget = requireTarget();
        if (exileTarget.bunkerKing) throw new Error("Царя нельзя изгнать из бункера.");
        exilePlayer(engine, exileTarget.id);
    } else if (specialId === 39) {
        player.persistentVoter = true;
    } else if (specialId === 40) {
        player.secondChance = true;
    } else if (specialId === 41) {
        const other = requireTarget();
        if (other.id === playerId) throw new Error("Выберите другого игрока для заражения.");
        replaceTrait(engine, playerId, "health", "Чума");
        replaceTrait(engine, other.id, "health", "Чума");
    } else if (specialId === 42) {
        const other = requireTarget();
        if (other.id === playerId) throw new Error("Выберите другого игрока.");
        replaceTrait(engine, other.id, "health", "Идеально здоров");
        replaceTrait(engine, playerId, "health", drawTraitCard("health", () => engineRandom(engine)));
    } else if (specialId === 43) {
        for (const id of activePlayerIds(engine)) {
            for (const key of TRAIT_KEYS.filter((item) => item !== "special")) {
                if (engine.players[id].revealedTraits?.[key]) {
                    replaceTrait(
                        engine,
                        id,
                        key,
                        drawDistinctTraitCard(
                            key,
                            [engine.characters[id][key]],
                            () => engineRandom(engine)
                        )
                    );
                }
            }
        }
        appendLog(engine, "Абсолютный хаос заменил все раскрытые обычные карты новыми случайными картами.");
    } else if (specialId === 44) {
        const other = requireTarget();
        const biology = other.revealedTraits?.biology;
        if (!biology) {
            throw new Error("Выберите игрока с открытыми биоданными, содержащими возраст.");
        }
        const match = biology.match(/\d+/);
        if (!match) throw new Error("Выберите игрока с открытыми биоданными, содержащими возраст.");
        replaceTrait(engine, other.id, "biology", biology.replace(match[0], [...match[0]].reverse().join("")));
    } else if (specialId === 45) {
        const marked = requireTarget();
        const personalThreat = drawUniqueThreatCard(engine);
        addExtraScenario(
            engine,
            "threat",
            `Личная угроза для ${marked.name}: ${personalThreat.title}`,
            personalThreat.description,
            { targetId: marked.id, cardId: Number(personalThreat.id ?? 0) }
        );
    } else if (specialId === 46) {
        player.ignoreVotesIfHalf = true;
    } else if (specialId === 47) {
        player.voteDisabled = true;
        replaceTrait(
            engine,
            playerId,
            "baggage",
            `${character.baggage}; дополнительно: ${drawTraitCard("baggage", () => engineRandom(engine))}`,
            true
        );
    } else if (specialId === 48) {
        player.ignoreVotesIfEven = true;
    } else if (specialId === 49) {
        const linked = requireTarget();
        if (linked.id === playerId) throw new Error("Выберите другого игрока.");
        player.linkedExileTarget = linked.id;
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
        engine.roundEffects.missingTraitBonuses ??= [];
        engine.roundEffects.missingTraitBonuses.push(({ 59: "health", 61: "baggage", 62: "biology", 63: "fact" })[specialId]);
    } else if (specialId === 60) {
        for (const id of activePlayerIds(engine)) revealRandomHiddenTrait(engine, id);
    } else if (specialId === 64) {
        const targetScenario = getOpenBunkerTarget(engine, scenarioTarget);
        if (!targetScenario) throw new Error("Выберите существующую открытую карту бункера.");
        player.sabotageScenarioTarget = scenarioTarget;
        player.sabotageScenarioInstanceId = targetScenario.instanceId ?? "";
    } else if (specialId === 65) {
        player.votersGetHealth = true;
    } else if (specialId === 66) {
        const ids = shuffleWithEngineRandom(engine, activePlayerIds(engine));
        if (ids[0]) {
            replaceTrait(
                engine,
                ids[0],
                "baggage",
                drawTraitCard("baggage", () => engineRandom(engine)),
                true
            );
        }
        if (ids[1]) {
            replaceTrait(
                engine,
                ids[1],
                "health",
                drawTraitCard("health", () => engineRandom(engine)),
                true
            );
        }
    } else if (specialId === 67) {
        const other = requireTarget();
        const chosenTrait = TRAIT_KEYS.includes(trait) && trait !== "special" ? trait : "";
        if (!canApplyGossip(other, chosenTrait)) {
            throw new Error("Для «Сплетен» выберите закрытую характеристику, которую можно раскрыть вместе с дополнительным фактом.");
        }
        revealSpecificTrait(engine, other.id, chosenTrait);
        replaceTrait(
            engine,
            other.id,
            "fact",
            `${engine.characters[other.id].fact}; дополнительный факт: ${drawTraitCard("fact", () => engineRandom(engine))}`,
            true
        );
    } else if (specialId === 68) {
        engine.roundEffects ??= {};
        engine.roundEffects.exileBaggage = [
            drawTraitCard("baggage", () => engineRandom(engine)),
            drawTraitCard("baggage", () => engineRandom(engine))
        ];
    } else if (specialId === 69) {
        applyGenderVoteMultiplier(engine, choice);
    } else if (specialId === 70) {
        player.immuneThisRound = true;
    } else {
        automatic = false;
    }

    player.specialUsed = true;
    engine.lastSpecialSnapshot = {
        playedBy: playerId,
        specialId,
        data: structuredClone(command.data ?? {}),
        state: snapshot,
        playedAtRevision: engine.revision + 1
    };
    appendLog(
        engine,
        secretSpecial
            ? `${player.name} тайно активирует защитную особую карту.`
            : `${player.name} разыгрывает особую карту №${specialId}: ${character.special}.${automatic ? " Эффект применён автоматически." : " Эффект завершает ведущий через редактор партии."}`
    );
}

function replaceTrait(engine, playerId, trait, value, reveal = false) {
    const player = engine.players[playerId];
    const wasRevealed = Boolean(player?.revealedTraits?.[trait]);
    engine.characters[playerId][trait] = value;
    if (wasRevealed || (reveal && canRevealTrait(player, trait))) {
        player.revealedTraits[trait] = value;
        if (!wasRevealed) recordFirstReveal(engine, playerId, trait);
        return true;
    }
    return false;
}

function revealSpecificTrait(engine, playerId, trait) {
    const player = engine.players[playerId];
    const value = engine.characters[playerId]?.[trait];
    if (!value || !player || !canRevealTrait(player, trait)) return false;
    const wasRevealed = Boolean(player.revealedTraits?.[trait]);
    player.revealedTraits[trait] = value;
    if (!wasRevealed) recordFirstReveal(engine, playerId, trait);
    return true;
}

function revealRandomHiddenTrait(engine, playerId) {
    const player = engine.players[playerId];
    if (revealedOrdinaryTraitCount(player) >= MAX_REVEALED_ORDINARY_TRAITS) return;
    const hidden = ORDINARY_TRAIT_KEYS.filter((trait) => !player.revealedTraits?.[trait]);
    if (!hidden.length) return;
    revealSpecificTrait(
        engine,
        playerId,
        hidden[Math.floor(engineRandom(engine) * hidden.length)]
    );
}

function shuffleWithEngineRandom(engine, values) {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const targetIndex = Math.floor(engineRandom(engine) * (index + 1));
        [shuffled[index], shuffled[targetIndex]] = [shuffled[targetIndex], shuffled[index]];
    }
    return shuffled;
}

function shuffleRevealedTrait(engine, trait) {
    const ids = activePlayerIds(engine).filter((id) => engine.players[id].revealedTraits?.[trait]);
    if (ids.length < 2) throw new Error("Для перераздачи нужны хотя бы две открытые карты этого типа.");
    const originalValues = Object.fromEntries(ids.map((id) => [id, engine.characters[id][trait]]));
    const sourceIds = [...ids];

    // Алгоритм Саттоло создаёт один цикл: каждая физическая карта
    // гарантированно переходит другому игроку и эффект не бывает визуальным no-op.
    for (let index = sourceIds.length - 1; index > 0; index -= 1) {
        const targetIndex = Math.floor(engineRandom(engine) * index);
        [sourceIds[index], sourceIds[targetIndex]] = [sourceIds[targetIndex], sourceIds[index]];
    }

    const sourceByRecipient = {};
    ids.forEach((recipientId, index) => {
        const sourceId = sourceIds[index];
        sourceByRecipient[recipientId] = sourceId;
        replaceTrait(engine, recipientId, trait, originalValues[sourceId], true);
    });
    engine.lastTraitShuffle = {
        round: Number(engine.round ?? 1),
        trait,
        affectedIds: [...ids],
        sourceByRecipient
    };
    const transfers = ids.map((recipientId) =>
        `${engine.players[recipientId].name} ← ${engine.players[sourceByRecipient[recipientId]].name}`
    );
    appendLog(
        engine,
        `Перераздача «${TRAIT_LABELS[trait]}»: карты сменили владельцев у ${ids.length} игроков (${transfers.join(", ")}).`
    );
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
    const special = drawSpecialCard(() => engineRandom(engine));
    engine.characters[playerId].special = special.text;
    engine.characters[playerId].specialId = special.id;
    engine.players[playerId].revealedTraits.special = engine.players[playerId].status === "exiled"
        ? special.text
        : "";
    engine.players[playerId].specialUsed = false;
}

function applyAgeVoteMultiplier(engine, choice) {
    if (!["younger", "older"].includes(choice)) throw new Error("Выберите младше или старше 33 лет.");
    for (const id of activePlayerIds(engine)) {
        const text = engine.players[id].revealedTraits?.biology;
        const age = Number(text?.match(/\d+/)?.[0]);
        if (Number.isFinite(age) && (choice === "younger" ? age < 33 : age > 33)) {
            setRoundVoteMultiplier(engine, id);
        }
    }
}

function applyGenderVoteMultiplier(engine, choice) {
    if (!["female", "male"].includes(choice)) throw new Error("Выберите мужчин или женщин.");
    for (const id of activePlayerIds(engine)) {
        const text = String(engine.players[id].revealedTraits?.biology ?? "").toLowerCase();
        if ((choice === "female" && text.includes("женщ")) || (choice === "male" && text.includes("мужч"))) {
            setRoundVoteMultiplier(engine, id);
        }
    }
}

function setRoundVoteMultiplier(engine, playerId) {
    engine.roundEffects ??= {};
    engine.roundEffects.voteMultiplierPlayers ??= {};
    engine.roundEffects.voteMultiplierPlayers[playerId] = true;
    engine.players[playerId].voteMultiplier = 2;
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
    "capacity", "totalRounds", "phase", "round", "currentPlayerIndex", "randomState", "players",
    "initialPlayerCount", "voteSchedule", "completedVotesByRound", "voteCycle",
    "characters", "votes", "voteResult", "roundEffects", "bunker", "threat", "threatResolution",
    "catastrophe", "extraScenarios", "bunkerRoundsRevealed", "firstReveal", "sharedSecrets",
    "lastExiledPlayerId", "bunkerCardSequence", "extraScenarioSequence", "bunkerEffectResults",
    "lastTraitShuffle", "preVotingResultSnapshot",
    "pendingBunkerVote", "bunkerVoteQueue", "finalBunkerEffectsResolved",
    "pendingSpecialChoice", "pendingSpecialSnapshot", "pendingSecretShare",
    "pendingSecretSharePrivate", "pendingSpecialRedirect"
];

function captureSpecialSnapshot(engine) {
    return Object.fromEntries(SPECIAL_SNAPSHOT_KEYS
        .filter((key) => engine[key] !== undefined)
        .map((key) => [key, structuredClone(engine[key])]));
}

function restoreSpecialSnapshot(engine, snapshot) {
    const currentVoteCycle = Math.max(0, Math.trunc(Number(engine.voteCycle) || 0));
    for (const key of SPECIAL_SNAPSHOT_KEYS) delete engine[key];
    for (const [key, value] of Object.entries(snapshot)) engine[key] = structuredClone(value);
    engine.voteCycle = Math.max(
        currentVoteCycle,
        Math.max(0, Math.trunc(Number(engine.voteCycle) || 0))
    );
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
    const stateBeforeRedirect = structuredClone(engine);
    try {
        const previous = engine.lastSpecialSnapshot;
        const previousSpecialId = Number(previous?.specialId ?? 0);
        if (!previous?.state || !previous.playedBy || [50, 71].includes(previousSpecialId)) {
            throw new Error("Нет подходящей особой карты для подмены цели.");
        }
        const inputTypes = Object.entries(previous.data ?? {})
            .filter(([, value]) => value !== "" && value !== undefined)
            .map(([key]) => key);
        if (!inputTypes.length) throw new Error("У сыгранной карты нет выбора, который можно подменить.");
        const redirectorName = engine.players[redirectorId]?.name ?? "Игрок";
        const previousOwner = previous.playedBy;
        const redirectedData = { ...(previous.data ?? {}) };
        for (const key of ["targetId", "trait", "scenarioTarget", "choice"]) {
            if (newChoice[key] !== undefined && newChoice[key] !== "") {
                redirectedData[key] = newChoice[key];
            }
        }
        const redirectSnapshot = captureSpecialSnapshot(engine);

        if (previousSpecialId === 54) {
            const selected = previous.choiceOptions?.find((option) =>
                Number(option.index) === Number(redirectedData.choice));
            if (!selected) throw new Error("Не удалось восстановить варианты «Строителя бункера».");
            restoreSpecialSnapshot(engine, previous.state);
            applyBunkerBaggageSelection(engine, previousOwner, selected);
            finalizeSpecialRedirect(
                engine,
                redirectorId,
                redirectorName,
                redirectSnapshot,
                redirectedData
            );
            return;
        }

        restoreSpecialSnapshot(engine, previous.state);
        playSpecial(engine, { type: "PLAY_SPECIAL", from: previousOwner, data: redirectedData });
        if (previousSpecialId === 56 && engine.pendingSecretShare) {
            engine.pendingSpecialRedirect = {
                redirectorId,
                redirectorName,
                redirectSnapshot,
                redirectedData: structuredClone(redirectedData)
            };
            finalizeSpecialRedirect(
                engine,
                redirectorId,
                redirectorName,
                redirectSnapshot,
                redirectedData
            );
            appendLog(engine, `${redirectorName} подменяет выбор «Связанных тайной». Новый участник должен выбрать закрытую карту.`);
            return;
        }
        finalizeSpecialRedirect(
            engine,
            redirectorId,
            redirectorName,
            redirectSnapshot,
            redirectedData
        );
    } catch (error) {
        for (const key of Object.keys(engine)) delete engine[key];
        Object.assign(engine, stateBeforeRedirect);
        throw error;
    }
}

function finalizeSpecialRedirect(
    engine,
    redirectorId,
    redirectorName,
    redirectSnapshot,
    redirectedData
) {
    markSpecialCardUsed(engine, redirectorId);
    engine.lastSpecialSnapshot = {
        playedBy: redirectorId,
        specialId: 50,
        data: structuredClone(redirectedData ?? {}),
        state: redirectSnapshot,
        playedAtRevision: engine.revision + 1
    };
    appendLog(engine, `${redirectorName} подменяет выбор только что сыгранной особой карты.`);
}

function markSpecialCardUsed(engine, playerId) {
    const player = engine.players[playerId];
    if (!player || !engine.characters[playerId]) return;
    player.revealedTraits.special = engine.characters[playerId].special;
    player.specialUsed = true;
}

function resolveBunkerBaggageChoice(engine, playerId, choice) {
    const pending = engine.pendingSpecialChoice;
    if (!pending || pending.playerId !== playerId) {
        const first = drawUniqueBunkerCard(engine);
        const second = drawUniqueBunkerCard(engine, [first.title]);
        const options = [first, second];
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
    const choiceOptions = pending.options.map((option) => ({ ...option }));
    const snapshot = captureSpecialSnapshot(engine);
    delete snapshot.pendingSpecialChoice;
    delete snapshot.pendingSpecialSnapshot;
    delete engine.pendingSpecialChoice;
    delete engine.pendingSpecialSnapshot;
    applyBunkerBaggageSelection(engine, playerId, selected);
    engine.lastSpecialSnapshot = {
        playedBy: playerId,
        specialId: 54,
        data: { choice: optionIndex },
        choiceOptions,
        state: snapshot,
        playedAtRevision: engine.revision + 1
    };
}

function applyBunkerBaggageSelection(engine, playerId, selected) {
    replaceTrait(
        engine,
        playerId,
        "baggage",
        `${engine.characters[playerId].baggage}; ${selected.title}: ${selected.description}`
    );
    engine.players[playerId].specialUsed = true;
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

function addExtraScenario(engine, type, title, description, metadata = {}) {
    engine.extraScenarios ??= {};
    engine.extraScenarios[type] ??= [];
    engine.extraScenarioSequence = Number(engine.extraScenarioSequence ?? 0) + 1;
    const card = {
        id: `special_${engine.revision}_${engine.extraScenarioSequence}`,
        title,
        description
    };
    if (metadata.hiddenUntilFinal) card.hiddenUntilFinal = true;
    if (metadata.targetId) card.targetId = metadata.targetId;
    if (metadata.cardId) card.cardId = Number(metadata.cardId);
    if (metadata.sourceBunkerInstanceId) card.sourceBunkerInstanceId = metadata.sourceBunkerInstanceId;
    engine.extraScenarios[type].push(card);
}

function getOpenBunkerTarget(engine, targetValue) {
    const [scope, type, cardId] = String(targetValue ?? "").split(":");
    if (type !== "bunker") return null;
    if (scope === "primary") {
        return engine.bunker?.status === "revealed" ? engine.bunker : null;
    }
    if (scope === "extra") {
        const cards = engine.extraScenarios?.bunker ?? [];
        return cards.find((card) => card.id === cardId) ?? null;
    }
    return null;
}

function removeBunkerTarget(engine, targetValue, reason = "Карта больше недоступна.") {
    const [scope, type, cardId] = String(targetValue ?? "").split(":");
    if (type !== "bunker") throw new Error("Выберите открытую карту бункера.");
    if (scope === "primary") {
        const removed = getOpenBunkerTarget(engine, targetValue);
        if (!removed) throw new Error("Основная карта бункера ещё не раскрыта.");
        engine.bunker = {
            status: "removed",
            title: "Карта бункера недоступна",
            description: `«${removed.title}». ${reason}`,
            removedCardTitle: removed.title,
            revealedRound: Number(removed.revealedRound ?? 1)
        };
        return { ...removed };
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
        const current = getOpenBunkerTarget(engine, targetValue);
        if (!current) throw new Error("Основная карта бункера ещё не раскрыта.");
        engine.bunker = {
            status: "revealed",
            cardId: Number(replacement.id ?? replacement.cardId ?? 0),
            instanceId: nextBunkerCardInstanceId(engine),
            title: replacement.title,
            description: replacement.description,
            revealedRound: Number(current.revealedRound ?? 1)
        };
        activateBunkerCard(engine, engine.bunker, "primary:bunker");
        return engine.bunker;
    }
    if (scope === "extra") {
        const cards = engine.extraScenarios?.bunker ?? [];
        const index = cards.findIndex((card) => card.id === cardId);
        if (index < 0) throw new Error("Выбранная карта бункера не найдена.");
        cards[index] = {
            ...cards[index],
            cardId: Number(replacement.id ?? replacement.cardId ?? 0),
            instanceId: nextBunkerCardInstanceId(engine),
            title: replacement.title,
            description: replacement.description
        };
        activateBunkerCard(engine, cards[index], targetValue);
        return cards[index];
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
    markSpecialCardUsed(engine, ownerId);
    engine.lastSpecialSnapshot = {
        playedBy: ownerId,
        specialId: 56,
        data: { targetId, trait: ownerTrait },
        state: snapshot,
        playedAtRevision: engine.revision + 1
    };
    appendLog(engine, `${engine.players[ownerId].name} предлагает игроку ${engine.players[targetId].name} обменяться тайной информацией.`);
}

function respondSecretShare(engine, command) {
    if ([PHASES.THREAT, PHASES.FINISHED].includes(engine.phase)) {
        throw new Error("Финальная угроза уже началась.");
    }
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
    markSpecialCardUsed(engine, pending.ownerId);
    appendLog(engine, `${engine.players[pending.ownerId].name} и ${engine.players[pending.targetId].name} обменялись тайной информацией.`);
    delete engine.pendingSecretShare;
    delete engine.pendingSecretSharePrivate;
    delete engine.pendingSpecialRedirect;
}

function cancelPendingSpecial(engine, command, hostId) {
    if (command.from !== hostId) throw new Error("Отменить зависшее действие может только ведущий.");
    const choiceOwnerId = engine.pendingSpecialChoice?.playerId;
    const shareOwnerId = engine.pendingSecretShare?.ownerId;
    if (!choiceOwnerId && !shareOwnerId) throw new Error("Нет ожидающего действия особой карты.");

    const ownerId = shareOwnerId || choiceOwnerId;
    const ownerName = engine.players?.[ownerId]?.name ?? "Игрок";
    markSpecialCardUsed(engine, ownerId);
    if (engine.pendingSpecialRedirect?.redirectorId) {
        markSpecialCardUsed(engine, engine.pendingSpecialRedirect.redirectorId);
    }
    delete engine.pendingSpecialChoice;
    delete engine.pendingSpecialSnapshot;
    delete engine.pendingSecretShare;
    delete engine.pendingSecretSharePrivate;
    delete engine.pendingSpecialRedirect;
    engine.lastSpecialSnapshot = { playedBy: "", specialId: 0, state: {} };
    appendLog(engine, `Ведущий отменяет незавершённое действие особой карты игрока ${ownerName}. Карта считается использованной.`);
}

function exilePlayer(engine, playerId, visited = new Set()) {
    if (visited.has(playerId) || !engine.players[playerId]) return;
    visited.add(playerId);
    const player = engine.players[playerId];
    if (player.bunkerKing) {
        appendLog(engine, `${player.name} остаётся в бункере: царя нельзя изгнать.`);
        return false;
    }
    if (player.status !== "exiled") {
        player.revealedBeforeExile = TRAIT_KEYS.filter((trait) => player.revealedTraits?.[trait]);
    }
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
                const specialUsed = owner.specialUsed;
                owner.specialUsed = engine.players[otherId].specialUsed;
                engine.players[otherId].specialUsed = specialUsed;
                owner.soulSwapResolved = true;
            }
        }
    }
    if (player.sabotageScenarioTarget) {
        const target = getOpenBunkerTarget(engine, player.sabotageScenarioTarget);
        const sameCard = target && (
            !player.sabotageScenarioInstanceId
            || target.instanceId === player.sabotageScenarioInstanceId
        );
        if (sameCard) {
            const removed = removeBunkerTarget(
                engine,
                player.sabotageScenarioTarget,
                "Карта сломана или заблокирована шантажом."
            );
            appendLog(engine, `После изгнания ${player.name} карта «${removed.title}» считается сломанной или заблокированной.`);
        } else {
            appendLog(engine, `Саботаж ${player.name} не сработал: выбранной карты бункера уже нет.`);
        }
        delete player.sabotageScenarioTarget;
        delete player.sabotageScenarioInstanceId;
    }
    if (player.linkedExileTarget) exilePlayer(engine, player.linkedExileTarget, visited);
    for (const other of Object.values(engine.players)) {
        if (other.linkedExileTarget === playerId) exilePlayer(engine, other.id, visited);
    }
    revealAllTraits(engine, playerId);
    repairCurrentTurn(engine);
    return true;
}

function revealAllTraits(engine, playerId) {
    const player = engine.players[playerId];
    const character = engine.characters[playerId];
    if (!player || !character) return;
    for (const trait of TRAIT_KEYS) {
        player.revealedTraits[trait] = character[trait];
    }
}

function revealAllPlayersTraits(engine) {
    let revealedSomething = false;
    for (const playerId of engine.order ?? []) {
        const player = engine.players?.[playerId];
        const character = engine.characters?.[playerId];
        if (!player || !character) continue;
        if (TRAIT_KEYS.some((trait) => player.revealedTraits?.[trait] !== character[trait])) {
            revealedSomething = true;
        }
        revealAllTraits(engine, playerId);
    }
    if (revealedSomething) {
        appendLog(engine, "Финал: раскрыты все карты всех участников.");
    }
}

function restorePreExileTraits(engine, playerId) {
    const player = engine.players[playerId];
    if (!player || !Array.isArray(player.revealedBeforeExile)) return;
    const revealedTraits = createHiddenTraits();
    let revealedOrdinaryCount = 0;
    for (const trait of player.revealedBeforeExile) {
        if (!TRAIT_KEYS.includes(trait)) continue;
        if (trait !== "special") {
            if (revealedOrdinaryCount >= MAX_REVEALED_ORDINARY_TRAITS) continue;
            revealedOrdinaryCount += 1;
        }
        revealedTraits[trait] = engine.characters[playerId][trait];
    }
    player.revealedTraits = revealedTraits;
    delete player.revealedBeforeExile;
}

function catchUpReturnedPlayer(engine, playerId) {
    const player = engine.players[playerId];
    if (!player || player.status !== "active") return;
    const revealedOrdinaryTraits = ORDINARY_TRAIT_KEYS.filter((trait) =>
        player.revealedTraits?.[trait]);
    for (const trait of revealedOrdinaryTraits.slice(MAX_REVEALED_ORDINARY_TRAITS)) {
        player.revealedTraits[trait] = "";
    }
    const currentRevealIsPending =
        engine.phase === PHASES.REVEAL
        && Number(engine.round ?? 0) <= MAX_TRAIT_REVEAL_ROUNDS;
    const completedRevealRounds = Math.max(
        0,
        Number(engine.round ?? 0) - (currentRevealIsPending ? 1 : 0)
    );
    const targetCount = Math.min(MAX_REVEALED_ORDINARY_TRAITS, completedRevealRounds);
    const revealedTraits = [];

    while (revealedOrdinaryTraitCount(player) < targetCount) {
        const hidden = ORDINARY_TRAIT_KEYS.filter((trait) => !player.revealedTraits?.[trait]);
        if (!hidden.length) break;
        const trait = hidden[Math.floor(engineRandom(engine) * hidden.length)];
        if (!revealSpecificTrait(engine, playerId, trait)) break;
        revealedTraits.push(trait);
    }

    if (revealedTraits.length) {
        const details = revealedTraits
            .map((trait) => `${TRAIT_LABELS[trait]} — ${engine.characters[playerId][trait]}`)
            .join("; ");
        appendLog(engine, `${player.name} догоняет пропущенные раунды и раскрывает: ${details}.`);
    }
}

function applySecondChances(engine) {
    const returnedIds = [];
    for (const id of engine.order) {
        const player = engine.players[id];
        if (player.status !== "exiled" || !player.secondChance) continue;
        const revealedKeys = Array.isArray(player.revealedBeforeExile)
            ? player.revealedBeforeExile
            : TRAIT_KEYS.filter((trait) => player.revealedTraits?.[trait]);
        const replacement = generateCharacters([id], () => engineRandom(engine))[id];
        engine.characters[id] = replacement;
        player.status = "active";
        player.secondChance = false;
        player.specialUsed = false;
        player.revealedTraits = createHiddenTraits();
        let revealedOrdinaryCount = 0;
        for (const trait of revealedKeys) {
            if (!TRAIT_KEYS.includes(trait)) continue;
            if (trait !== "special") {
                if (revealedOrdinaryCount >= MAX_REVEALED_ORDINARY_TRAITS) continue;
                revealedOrdinaryCount += 1;
            }
            player.revealedTraits[trait] = replacement[trait];
        }
        delete player.revealedBeforeExile;
        catchUpReturnedPlayer(engine, id);
        returnedIds.push(id);
        appendLog(engine, `${player.name} возвращается в новом образе благодаря «Второму шансу».`);
    }
    return returnedIds;
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

function ensureVotingPlan(engine) {
    const playerCount = Math.max(0, Math.trunc(Number(engine.initialPlayerCount ?? engine.order?.length) || 0));
    const currentRound = Math.max(1, Math.trunc(Number(engine.round) || 1));
    const hasVoteScheduleData = engine.voteSchedule
        && typeof engine.voteSchedule === "object"
        && !Array.isArray(engine.voteSchedule);
    const hasCompletedVoteData = engine.completedVotesByRound
        && typeof engine.completedVotesByRound === "object"
        && !Array.isArray(engine.completedVotesByRound);
    const hasVotingPlan = hasVoteScheduleData && hasCompletedVoteData;
    const totalRounds = Math.max(
        MINIMUM_GAME_ROUNDS,
        currentRound,
        hasVotingPlan ? Math.trunc(Number(engine.totalRounds) || 0) : 0
    );

    engine.initialPlayerCount = playerCount;
    engine.totalRounds = totalRounds;
    engine.voteCycle = Math.max(0, Math.trunc(Number(engine.voteCycle) || 0));
    if (!hasVoteScheduleData) {
        engine.voteSchedule = getRoundVoteSchedule(playerCount, engine.capacity);
    }
    for (let round = 1; round <= totalRounds; round += 1) {
        const target = Number(engine.voteSchedule[round]);
        engine.voteSchedule[round] = Number.isFinite(target)
            ? Math.max(0, Math.trunc(target))
            : 0;
    }

    if (!hasCompletedVoteData) {
        engine.completedVotesByRound = {};
        for (let round = 1; round < currentRound; round += 1) {
            engine.completedVotesByRound[round] = Number(engine.voteSchedule[round] ?? 0);
        }
        if (engine.phase === PHASES.RESULTS && engine.voteResult?.status === "exiled") {
            engine.voteSchedule[currentRound] = Math.max(1, Number(engine.voteSchedule[currentRound] ?? 0));
            engine.completedVotesByRound[currentRound] = 1;
        } else if (
            engine.phase === PHASES.VOTING
            || (engine.phase === PHASES.RESULTS && engine.voteResult?.status === "tie")
        ) {
            engine.voteSchedule[currentRound] = Math.max(1, Number(engine.voteSchedule[currentRound] ?? 0));
        }
    }
}

function roundVoteTarget(engine, round = engine.round) {
    return Math.max(0, Math.trunc(Number(engine.voteSchedule?.[round]) || 0));
}

function completedRoundVotes(engine, round = engine.round) {
    return Math.max(0, Math.trunc(Number(engine.completedVotesByRound?.[round]) || 0));
}

function remainingRoundVotes(engine, round = engine.round) {
    return Math.max(0, roundVoteTarget(engine, round) - completedRoundVotes(engine, round));
}

function markRoundVoteCompleted(engine) {
    const round = Math.max(1, Number(engine.round ?? 1));
    const completed = completedRoundVotes(engine, round) + 1;
    engine.completedVotesByRound ??= {};
    engine.voteSchedule ??= {};
    engine.completedVotesByRound[round] = completed;
    engine.voteSchedule[round] = Math.max(roundVoteTarget(engine, round), completed);
}

function reconcileVotingPlan(engine, startRound = engine.round) {
    ensureVotingPlan(engine);
    const currentRound = Math.max(1, Number(engine.round ?? 1));
    const firstRound = Math.max(1, Math.trunc(Number(startRound) || currentRound));
    const activeCount = activePlayerIds(engine).length;
    const neededVotes = Math.max(0, activeCount - Number(engine.capacity ?? 0));

    if (firstRound > engine.totalRounds && neededVotes > 0) {
        engine.totalRounds = firstRound;
        engine.voteSchedule[firstRound] = Number(engine.voteSchedule[firstRound] ?? 0);
    }

    let plannedVotes = 0;
    for (let round = firstRound; round <= engine.totalRounds; round += 1) {
        plannedVotes += remainingRoundVotes(engine, round);
    }

    if (plannedVotes < neededVotes) {
        const targetRound = Math.max(firstRound, engine.totalRounds);
        engine.totalRounds = Math.max(engine.totalRounds, targetRound);
        engine.voteSchedule[targetRound] = roundVoteTarget(engine, targetRound) + neededVotes - plannedVotes;
        return;
    }

    let excessVotes = plannedVotes - neededVotes;
    const preserveCurrentVote = firstRound <= currentRound
        && activeCount > Number(engine.capacity ?? 0)
        && (
            engine.phase === PHASES.VOTING
            || (engine.phase === PHASES.RESULTS && engine.voteResult?.status === "tie")
        );
    for (let round = engine.totalRounds; round >= firstRound && excessVotes > 0; round -= 1) {
        const completed = completedRoundVotes(engine, round);
        const minimum = round === currentRound && preserveCurrentVote
            ? completed + 1
            : completed;
        const removable = Math.max(0, roundVoteTarget(engine, round) - minimum);
        const removed = Math.min(removable, excessVotes);
        engine.voteSchedule[round] = roundVoteTarget(engine, round) - removed;
        excessVotes -= removed;
    }
}

function resetSingleVoteEffects(engine) {
    engine.roundEffects ??= {};
    const roundMultipliers = engine.roundEffects.voteMultiplierPlayers ?? {};
    const roundDisabled = engine.roundEffects.voteDisabledPlayers ?? {};
    delete engine.roundEffects.discreditOwners;
    delete engine.roundEffects.previousVoteTargets;
    for (const id of engine.order) {
        const player = engine.players[id];
        if (!player) continue;
        player.voteMultiplier = roundMultipliers[id] ? 2 : 1;
        player.voteDisabled = Boolean(roundDisabled[id]);
        player.ignoreVotesIfHalf = false;
        player.ignoreVotesIfEven = false;
        player.selfPenaltyAgainst = false;
        player.loneVoteTriple = false;
        player.votersGetHealth = false;
    }
}

function activePlayerIds(engine) {
    return engine.order.filter((id) => engine.players[id]?.status === "active");
}

function revealedOrdinaryTraitCount(player) {
    return ORDINARY_TRAIT_KEYS.filter((trait) => player?.revealedTraits?.[trait]).length;
}

function canRevealTrait(player, trait) {
    if (trait === "special" || player?.status !== "active" || player?.revealedTraits?.[trait]) {
        return true;
    }
    return revealedOrdinaryTraitCount(player) < MAX_REVEALED_ORDINARY_TRAITS;
}

function canApplyGossip(player, trait) {
    if (
        player?.status !== "active"
        || !ORDINARY_TRAIT_KEYS.includes(trait)
        || player.revealedTraits?.[trait]
    ) {
        return false;
    }
    const additionalReveals = trait === "fact" || player.revealedTraits?.fact ? 1 : 2;
    return revealedOrdinaryTraitCount(player) + additionalReveals <= MAX_REVEALED_ORDINARY_TRAITS;
}

function recordFirstReveal(engine, playerId, trait) {
    if (trait === "special") return;
    engine.firstReveal ??= {};
    if (!engine.firstReveal[trait]) engine.firstReveal[trait] = playerId;
}

function resetVotes(engine) {
    for (const id of votingPlayerIds(engine)) {
        engine.players[id].voteSubmitted = false;
        engine.votes[id] = "";
    }
}

function advanceVoteCycle(engine) {
    engine.voteCycle = Math.max(0, Math.trunc(Number(engine.voteCycle) || 0)) + 1;
    return engine.voteCycle;
}

function createHiddenTraits() {
    return Object.fromEntries(TRAIT_KEYS.map((trait) => [trait, ""]));
}

function hiddenScenario(title) {
    return { status: "hidden", title, description: "Данные засекречены." };
}

function removedScenario(label, removedTitle, reason) {
    return {
        status: "removed",
        title: `${label} убрана`,
        description: `«${removedTitle}». ${reason}`,
        removedCardTitle: removedTitle
    };
}

function emptyVoteResult() {
    return { status: "pending", exiledPlayerId: "", candidates: [], counts: {} };
}

function appendLog(engine, message) {
    const createdAt = Date.now();
    engine.logSequence = Number(engine.logSequence ?? 0) + 1;
    const key = `event_${createdAt}_${engine.revision}_${engine.logSequence}`;
    engine.log[key] = { message, createdAt };
}
