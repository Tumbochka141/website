import { PHASES, TRAIT_KEYS, getSpecialAvailability } from "./engine.js";

const BOT_ID_PREFIX = "dev_bot_";
const ORDINARY_TRAIT_KEYS = TRAIT_KEYS.filter((trait) => trait !== "special");
const MAX_REVEALED_ORDINARY_TRAITS = ORDINARY_TRAIT_KEYS.length - 1;
const BOT_NAMES = [
    "Бот Альфа",
    "Бот Браво",
    "Бот Вега",
    "Бот Гамма",
    "Бот Дельта",
    "Бот Енот",
    "Бот Жук",
    "Бот Искра",
    "Бот Крот",
    "Бот Луна",
    "Бот Маяк",
    "Бот Норд",
    "Бот Омега",
    "Бот Пиксель",
    "Бот Радар"
];

export function isDeveloperBot(playerId) {
    return String(playerId ?? "").startsWith(BOT_ID_PREFIX);
}

export function fillWithDeveloperBots(players, targetCount) {
    const result = [...players];
    const usedIds = new Set(result.map(([playerId]) => playerId));

    for (let index = 0; result.length < targetCount; index += 1) {
        const playerId = `${BOT_ID_PREFIX}${index + 1}`;
        if (usedIds.has(playerId)) continue;
        result.push([playerId, {
            name: BOT_NAMES[index] ?? `Бот ${index + 1}`,
            online: true,
            isBot: true
        }]);
        usedIds.add(playerId);
    }

    return result;
}

export function getDeveloperBotCommands(engine, random = Math.random) {
    if (!engine || engine.phase === PHASES.FINISHED) return [];

    const reactionCommand = getDeveloperBotReactionCommand(engine, random);
    if (reactionCommand) return [reactionCommand];

    const pendingTarget = engine.pendingSecretShare?.targetId;
    if (engine.pendingSecretShare) {
        if (!isDeveloperBot(pendingTarget)) return [];
        const trait = TRAIT_KEYS.find((key) =>
            key !== "special" && !engine.players?.[pendingTarget]?.revealedTraits?.[key]);
        return trait
            ? [{ type: "RESPOND_SECRET_SHARE", from: pendingTarget, data: { trait } }]
            : [];
    }

    const pendingChoice = engine.pendingSpecialChoice;
    if (pendingChoice) {
        if (!isDeveloperBot(pendingChoice.playerId)) return [];
        const choice = pendingChoice.options?.[0]?.index;
        return choice === undefined
            ? []
            : [{ type: "PLAY_SPECIAL", from: pendingChoice.playerId, data: { choice: String(choice) } }];
    }

    if (engine.pendingBunkerVote) {
        const vote = engine.pendingBunkerVote;
        return (vote.voterIds ?? [])
            .filter((playerId) => isDeveloperBot(playerId) && !vote.votes?.[playerId])
            .map((playerId) => {
                const targetId = pick(vote.candidateIds ?? [], random);
                return targetId
                    ? { type: "BUNKER_VOTE", from: playerId, data: { targetId } }
                    : null;
            })
            .filter(Boolean);
    }

    const specialCommand = getDeveloperBotSpecialCommand(engine, random);
    if (specialCommand) return [specialCommand];

    if (engine.phase === PHASES.REVEAL) {
        const playerId = engine.order?.[engine.currentPlayerIndex];
        const player = engine.players?.[playerId];
        if (!isDeveloperBot(playerId) || !player || player.status !== "active") return [];

        const forcedTrait = engine.roundEffects?.forcedTrait;
        const revealedOrdinaryCount = ORDINARY_TRAIT_KEYS.filter((trait) =>
            player.revealedTraits?.[trait]).length;
        const trait = revealedOrdinaryCount >= MAX_REVEALED_ORDINARY_TRAITS
            ? null
            : forcedTrait && !player.revealedTraits?.[forcedTrait]
                ? forcedTrait
                : ORDINARY_TRAIT_KEYS.find((key) => !player.revealedTraits?.[key]);
        return [
            ...(trait ? [{ type: "REVEAL_TRAIT", from: playerId, data: { trait } }] : []),
            { type: "FINISH_TURN", from: playerId, data: {} }
        ];
    }

    if (engine.phase === PHASES.VOTING) {
        const commands = [];
        for (const playerId of votingBotIds(engine)) {
            const player = engine.players[playerId];
            if (player.voteSubmitted || player.voteDisabled) continue;
            const candidates = voteCandidates(engine, playerId);
            if (!candidates.length) continue;
            const targetId = candidates[Math.floor(random() * candidates.length)];
            commands.push({ type: "VOTE", from: playerId, data: { targetId } });
        }
        return commands;
    }

    return [];
}

export function getDeveloperBotSpecialCommand(engine, random = Math.random) {
    return findDeveloperBotSpecialCommand(engine, random);
}

function getDeveloperBotReactionCommand(engine, random) {
    return findDeveloperBotSpecialCommand(
        engine,
        random,
        (specialId) => specialId === 50 || specialId === 71
    );
}

function findDeveloperBotSpecialCommand(engine, random, acceptsSpecial = () => true) {
    for (const playerId of engine.order ?? []) {
        const player = engine.players?.[playerId];
        const specialId = Number(engine.characters?.[playerId]?.specialId ?? 0);
        if (!isDeveloperBot(playerId) || !player || !specialId || player.specialUsed) continue;
        if (!acceptsSpecial(specialId)) continue;
        if (!getSpecialAvailability(engine, playerId, specialId).allowed) continue;
        const data = buildSpecialData(engine, playerId, specialId, random);
        if (data === null) continue;
        return { type: "PLAY_SPECIAL", from: playerId, data };
    }
    return null;
}

function buildSpecialData(engine, playerId, specialId, random) {
    const ordinaryTraits = TRAIT_KEYS.filter((trait) => trait !== "special");
    const otherActiveIds = activeIds(engine).filter((id) => id !== playerId);
    const otherBotIds = otherActiveIds.filter(isDeveloperBot);
    const pickOther = () => pick(otherBotIds.length ? otherBotIds : otherActiveIds, random);
    const bunkerTargets = openBunkerTargets(engine);

    if (specialId === 50) return buildRedirectSpecialData(engine, random);
    if (specialId === 71) return {};
    if ([1, 3, 11, 64].includes(specialId)) {
        const scenarioTarget = pick(bunkerTargets, random);
        return scenarioTarget ? { scenarioTarget } : null;
    }
    if ([2, 12, 18, 20, 27, 41, 42, 45, 49, 55].includes(specialId)) {
        const targetId = pickOther();
        return targetId ? { targetId } : null;
    }
    if ([16, 17, 21, 22, 23].includes(specialId)) {
        const trait = ({ 16: "baggage", 17: "biology", 21: "hobby", 22: "health", 23: "fact" })[specialId];
        const targetId = activeNeighborIds(engine, playerId).find((id) =>
            engine.players[id].revealedTraits?.[trait]
            && engine.players[playerId].revealedTraits?.[trait]);
        return targetId ? { targetId } : null;
    }
    if (specialId === 25 || specialId === 29) {
        const trait = specialId === 25 ? "health" : "profession";
        const candidates = activeIds(engine).filter((id) => engine.players[id].revealedTraits?.[trait]);
        const targetId = pick(candidates, random);
        return targetId ? { targetId } : null;
    }
    if (specialId === 26) {
        if (engine.phase !== PHASES.REVEAL) return null;
        const trait = ordinaryTraits.find((key) =>
            activeIds(engine).some((id) => !engine.players[id].revealedTraits?.[key]));
        return trait ? { trait } : null;
    }
    if (specialId === 28) return null;
    if (specialId === 31) return { trait: pick(ordinaryTraits, random) };
    if (specialId === 38) {
        const targetId = pick(
            otherActiveIds.filter((id) => !engine.players[id]?.bunkerKing),
            random
        );
        return targetId ? { targetId } : null;
    }
    if (specialId === 44) {
        const candidates = otherActiveIds.filter((id) =>
            /\d+/.test(engine.players?.[id]?.revealedTraits?.biology ?? ""));
        const targetId = pick(candidates, random);
        return targetId ? { targetId } : null;
    }
    if (specialId === 53) return { choice: random() < .5 ? "younger" : "older" };
    if (specialId === 54) return {};
    if (specialId === 56) {
        const trait = ordinaryTraits.find((key) => !engine.players[playerId].revealedTraits?.[key]);
        const candidates = otherBotIds.filter((id) =>
            ordinaryTraits.some((key) => !engine.players[id].revealedTraits?.[key]));
        const targetId = pick(candidates, random);
        return trait && targetId ? { targetId, trait } : null;
    }
    if (specialId === 57) return { choice: random() < .5 ? "before" : "after" };
    if (specialId === 67) {
        const candidates = otherActiveIds
            .map((id) => ({
                id,
                traits: ordinaryTraits.filter((key) => {
                    const target = engine.players[id];
                    if (target.revealedTraits?.[key]) return false;
                    const revealedCount = ordinaryTraits.filter((trait) =>
                        target.revealedTraits?.[trait]).length;
                    const additionalReveals = key === "fact" || target.revealedTraits?.fact ? 1 : 2;
                    return revealedCount + additionalReveals <= ordinaryTraits.length - 1;
                })
            }))
            .filter((item) => item.traits.length);
        const target = pick(candidates, random);
        return target ? { targetId: target.id, trait: pick(target.traits, random) } : null;
    }
    if (specialId === 69) return { choice: random() < .5 ? "female" : "male" };
    if ([5, 6, 7, 8, 9].includes(specialId)) {
        // Ждём, пока игроки закончат раскрытие раунда, иначе бот
        // перераздаст только первые две карты и пропустит остальных.
        if (engine.phase === PHASES.REVEAL) return null;
        const trait = ({ 5: "baggage", 6: "biology", 7: "hobby", 8: "health", 9: "fact" })[specialId];
        return activeIds(engine).filter((id) => engine.players[id].revealedTraits?.[trait]).length >= 2
            ? {}
            : null;
    }
    if (specialId === 13) return engine.firstReveal?.health ? {} : null;
    if ([15, 19].includes(specialId)) {
        return activeIds(engine).some((id) => /\d+/.test(engine.players[id].revealedTraits?.biology ?? ""))
            ? {}
            : null;
    }
    if (specialId === 43) {
        return activeIds(engine).some((id) =>
            ordinaryTraits.some((key) => engine.players[id].revealedTraits?.[key]))
            ? {}
            : null;
    }
    if ([10, 14].includes(specialId)) return activeIds(engine).length >= 2 ? {} : null;
    return {};
}

function buildRedirectSpecialData(engine, random) {
    const previous = engine.lastSpecialSnapshot;
    const previousSpecialId = Number(previous?.specialId ?? 0);
    const previousData = previous?.data ?? {};
    if (!previous?.playedBy || !previous?.state || [50, 71].includes(previousSpecialId)) {
        return null;
    }

    if (previousSpecialId === 54) {
        const choices = (previous.choiceOptions ?? []).filter((option) =>
            String(option.index) !== String(previousData.choice));
        const choice = pick(choices, random)?.index;
        return choice === undefined ? null : { choice: String(choice) };
    }

    const snapshotEngine = {
        ...engine,
        ...structuredClone(previous.state)
    };
    if (previousSpecialId === 56) {
        return buildSecretShareRedirectData(snapshotEngine, previous, random);
    }

    if (previousSpecialId === 26) {
        const traits = ORDINARY_TRAIT_KEYS.filter((trait) =>
            trait !== previousData.trait
            && activeIds(snapshotEngine).some((id) =>
                !snapshotEngine.players?.[id]?.revealedTraits?.[trait]));
        const trait = pick(traits, random);
        return trait ? { trait } : null;
    }

    for (let firstIndex = 0; firstIndex < 32; firstIndex += 1) {
        for (let secondIndex = 0; secondIndex < 32; secondIndex += 1) {
            const values = [(firstIndex + .5) / 32, (secondIndex + .5) / 32];
            let valueIndex = 0;
            const candidate = buildSpecialData(
                snapshotEngine,
                previous.playedBy,
                previousSpecialId,
                () => values[Math.min(valueIndex++, values.length - 1)]
            );
            if (candidate !== null && !sameSpecialData(candidate, previousData)) return candidate;
        }
    }

    return null;
}

function buildSecretShareRedirectData(engine, previous, random) {
    const ownerId = previous.playedBy;
    const previousData = previous.data ?? {};
    const ownerTraits = ORDINARY_TRAIT_KEYS.filter((trait) =>
        !engine.players?.[ownerId]?.revealedTraits?.[trait]);
    const alternateTraits = ownerTraits.filter((trait) => trait !== previousData.trait);
    const trait = pick(alternateTraits.length ? alternateTraits : ownerTraits, random);

    const targetIds = activeIds(engine).filter((id) =>
        id !== ownerId
        && ORDINARY_TRAIT_KEYS.some((candidateTrait) =>
            !engine.players?.[id]?.revealedTraits?.[candidateTrait]));
    const alternateTargetIds = targetIds.filter((id) => id !== previousData.targetId);
    const preferredTargetIds = alternateTargetIds.length ? alternateTargetIds : targetIds;
    const botTargetIds = preferredTargetIds.filter(isDeveloperBot);
    const targetId = pick(botTargetIds.length ? botTargetIds : preferredTargetIds, random);

    if (!targetId || !trait) return null;
    if (targetId === previousData.targetId && trait === previousData.trait) return null;
    return { targetId, trait };
}

function sameSpecialData(left, right) {
    const keys = [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].sort();
    return keys.every((key) => String(left?.[key] ?? "") === String(right?.[key] ?? ""));
}

function activeIds(engine) {
    return (engine.order ?? []).filter((id) => engine.players?.[id]?.status === "active");
}

function activeNeighborIds(engine, playerId) {
    const ids = activeIds(engine);
    const index = ids.indexOf(playerId);
    if (index < 0 || ids.length < 2) return [];
    return [...new Set([
        ids[(index - 1 + ids.length) % ids.length],
        ids[(index + 1) % ids.length]
    ])];
}

function openBunkerTargets(engine) {
    const targets = [];
    if (engine.bunker?.status === "revealed") targets.push("primary:bunker");
    for (const card of engine.extraScenarios?.bunker ?? []) {
        targets.push(`extra:bunker:${card.id}`);
    }
    return targets;
}

function pick(items, random) {
    if (!items?.length) return undefined;
    return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

function votingBotIds(engine) {
    const lastExiled = engine.lastExiledPlayerId;
    return engine.order.filter((playerId) => {
        const player = engine.players?.[playerId];
        return isDeveloperBot(playerId)
            && (player?.status === "active" || playerId === lastExiled || player?.persistentVoter);
    });
}

function voteCandidates(engine, voterId) {
    const voter = engine.players[voterId];
    const tied = engine.voteResult?.status === "tie"
        ? new Set(engine.voteResult.candidates ?? [])
        : null;

    return engine.order.filter((targetId) => {
        const target = engine.players?.[targetId];
        if (!target || target.status !== "active" || target.immuneThisRound || target.bunkerKing) return false;
        if (tied && !tied.has(targetId)) return false;
        if (voter.cannotVoteAgainst?.[targetId]) return false;
        if (voter.forcedSelfVote && targetId !== voterId) return false;
        if (engine.roundEffects?.previousVoteTargets?.[voterId] === targetId) return false;
        return true;
    });
}
