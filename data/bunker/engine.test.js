import test from "node:test";
import assert from "node:assert/strict";
import {
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

function makePlayers(count) {
    return Array.from({ length: count }, (_, index) => [
        `p${index + 1}`,
        { name: `Игрок ${index + 1}` }
    ]);
}

function makeGame(count = 6, capacity = 3) {
    return createInitialGame(makePlayers(count), capacity, () => 0.37);
}

function makeGameWithBunkerCard(cardId, count = 4, capacity = 2) {
    return createInitialGame(
        makePlayers(count),
        capacity,
        () => (cardId - 0.5) / 80
    );
}

function withMathRandom(value, action) {
    const originalRandom = Math.random;
    Math.random = () => value;
    try {
        return action();
    } finally {
        Math.random = originalRandom;
    }
}

function setEngineRandomRolls(engine, predicate) {
    for (let seed = 1; seed <= 100_000; seed += 1) {
        let state = seed;
        const rolls = [];
        for (let index = 0; index < 3; index += 1) {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            rolls.push(state / 0x100000000);
        }
        if (predicate(rolls)) {
            engine.randomState = seed;
            return rolls;
        }
    }
    throw new Error("Не найдено подходящее состояние тестового генератора.");
}

function prepareFinal(engine, finalistIds = ["p1", "p2"]) {
    const finalists = new Set(finalistIds);
    for (const playerId of engine.order) {
        engine.players[playerId].status = finalists.has(playerId) ? "active" : "exiled";
    }
    engine.phase = PHASES.DISCUSSION;
    engine.round = engine.totalRounds;
    engine.bunkerRoundsRevealed = Object.fromEntries(
        Array.from({ length: engine.totalRounds }, (_, index) => [index + 1, true])
    );
}

function send(engine, type, from, data = {}, hostId = "host") {
    return applyCommand(engine, { type, from, data }, hostId);
}

function finishRevealRound(engine) {
    while (engine.phase === PHASES.REVEAL) {
        const playerId = engine.order[engine.currentPlayerIndex];
        const ordinaryTraits = TRAIT_KEYS.filter((key) => key !== "special");
        const revealedOrdinaryCount = ordinaryTraits.filter(
            (key) => engine.players[playerId].revealedTraits[key]
        ).length;
        const trait = revealedOrdinaryCount < ordinaryTraits.length - 1
            ? ordinaryTraits.find((key) => !engine.players[playerId].revealedTraits[key])
            : "";
        if (trait) send(engine, "REVEAL_TRAIT", playerId, { trait });
        send(engine, "FINISH_TURN", playerId);
    }
}

function assignSpecial(engine, playerId, specialId) {
    const special = SPECIAL_CARDS.find((card) => card.id === specialId);
    engine.characters[playerId].specialId = special.id;
    engine.characters[playerId].special = special.text;
    engine.players[playerId].revealedTraits.special = "";
    engine.players[playerId].specialUsed = false;
}

function beginSecondRound(engine) {
    finishRevealRound(engine);
    send(engine, "NEXT_PHASE", "host");
    assert.equal(engine.round, 2);
    assert.equal(engine.phase, PHASES.REVEAL);
}

test("партия начинается с открытой карты бункера и верным числом раундов", () => {
    const engine = makeGame(8, 4);
    assert.equal(engine.phase, PHASES.REVEAL);
    assert.equal(engine.round, 1);
    assert.equal(engine.totalRounds, 5);
    assert.equal(engine.bunker.status, "revealed");
    assert.ok(engine.bunker.cardId > 0);
    assert.match(engine.bunker.instanceId, /^bunker_card_\d+$/);
    assert.equal(engine.bunker.revealedRound, 1);
    assert.equal(engine.extraScenarios.bunker.length, 0);
});

test("старое сохранение восстанавливает cardId и instanceId открытой карты бункера", () => {
    const source = makeGameWithBunkerCard(51);
    const engine = makeGame(4, 2);
    engine.bunker = {
        status: "revealed",
        title: source.bunker.title,
        description: source.bunker.description
    };
    engine.bunkerRoundsRevealed = { 1: true };
    engine.bunkerCardSequence = 0;
    engine.bunkerEffectResults = {};

    send(engine, "SKIP_TURN", "host");

    assert.equal(engine.bunker.cardId, 51);
    assert.match(engine.bunker.instanceId, /^bunker_card_\d+$/);
    assert.equal(engine.bunker.revealedRound, 1);
    assert.equal(engine.bunkerEffectResults[engine.bunker.instanceId].status, "resolved");
    assert.equal(
        engine.order.filter((playerId) =>
            engine.characters[playerId].health === "Огнестрельное ранение").length,
        1
    );
});

test("миграция старой карты-голосования ждёт завершения особого выбора без дедлока", () => {
    const source = makeGameWithBunkerCard(53);
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 54);
    send(engine, "PLAY_SPECIAL", "p1");
    assert.equal(engine.pendingSpecialChoice.playerId, "p1");

    engine.bunker = {
        status: "revealed",
        title: source.bunker.title,
        description: source.bunker.description
    };
    engine.bunkerRoundsRevealed = { 1: true };
    engine.bunkerCardSequence = 0;
    engine.bunkerEffectResults = {};

    send(engine, "PLAY_SPECIAL", "p1", { choice: "0" });

    assert.equal(engine.pendingSpecialChoice, undefined);
    assert.equal(engine.pendingBunkerVote.type, "sacrifice");
    assert.equal(engine.bunker.cardId, 53);
});

test("повреждённое сохранение с двумя pending-действиями сначала завершает особый выбор", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 54);
    send(engine, "PLAY_SPECIAL", "p1");
    engine.pendingBunkerVote = {
        type: "sacrifice",
        sourceTarget: "primary:bunker",
        sourceInstanceId: engine.bunker.instanceId,
        candidateIds: [...engine.order],
        voterIds: [...engine.order],
        votes: {},
        revote: false
    };

    send(engine, "PLAY_SPECIAL", "p1", { choice: "0" });

    assert.equal(engine.pendingSpecialChoice, undefined);
    assert.equal(engine.pendingBunkerVote.type, "sacrifice");
    send(engine, "BUNKER_VOTE", "p1", { targetId: "p2" });
    assert.equal(engine.pendingBunkerVote.votes.p1, "p2");
});

test("короткая партия всё равно доходит до пятого раунда", () => {
    const engine = makeGame(6, 3);
    assert.equal(engine.totalRounds, 5);
});

test("первый раунд завершается без голосования и открывает новую карту бункера", () => {
    const engine = makeGame();
    finishRevealRound(engine);
    assert.equal(engine.phase, PHASES.DISCUSSION);

    send(engine, "NEXT_PHASE", "host");
    assert.equal(engine.phase, PHASES.REVEAL);
    assert.equal(engine.round, 2);
    assert.equal(engine.extraScenarios.bunker.length, 1);
    assert.ok(engine.extraScenarios.bunker[0].cardId > 0);
    assert.match(engine.extraScenarios.bunker[0].instanceId, /^bunker_card_\d+$/);
    assert.equal(engine.extraScenarios.bunker[0].revealedRound, 2);
});

test("со второго раунда обсуждение переходит в голосование", () => {
    const engine = makeGame();
    finishRevealRound(engine);
    send(engine, "NEXT_PHASE", "host");
    finishRevealRound(engine);
    send(engine, "NEXT_PHASE", "host");
    assert.equal(engine.phase, PHASES.VOTING);
});

test("карты бункера №51 и №52 сразу меняют и раскрывают здоровье случайного игрока", () => {
    for (const [cardId, expectedHealth] of [
        [51, "Огнестрельное ранение"],
        [52, "Зоофилия"]
    ]) {
        const first = makeGameWithBunkerCard(cardId);
        const second = makeGameWithBunkerCard(cardId);
        const affectedIds = (engine) => engine.order.filter((playerId) =>
            engine.characters[playerId].health === expectedHealth
            && engine.players[playerId].revealedTraits.health === expectedHealth);
        const firstAffected = affectedIds(first);
        const effect = first.bunkerEffectResults[first.bunker.instanceId];

        assert.equal(first.bunker.cardId, cardId);
        assert.equal(firstAffected.length, 1);
        assert.equal(first.firstReveal.health, firstAffected[0]);
        assert.deepEqual(affectedIds(second), firstAffected);
        assert.equal(effect.status, "resolved");
        assert.equal(effect.cardId, cardId);
    }
});

test("дед с ружьём меняет здоровье, не раскрывая последнюю скрытую карту", () => {
    const source = makeGameWithBunkerCard(51).bunker;
    const engine = makeGame(4, 2);
    const ordinaryTraits = TRAIT_KEYS.filter((trait) => trait !== "special");
    for (const playerId of engine.order) {
        for (const trait of ordinaryTraits.filter((trait) => trait !== "health")) {
            engine.players[playerId].revealedTraits[trait] = engine.characters[playerId][trait];
        }
    }
    const instanceId = "late_old_man";
    engine.extraScenarios.bunker.push({
        id: "late_old_man",
        cardId: 51,
        instanceId,
        title: source.title,
        description: source.description,
        revealedRound: engine.round
    });

    send(engine, "SKIP_TURN", "host");

    const affectedIds = engine.order.filter((playerId) =>
        engine.characters[playerId].health === "Огнестрельное ранение");
    assert.equal(affectedIds.length, 1);
    assert.equal(engine.players[affectedIds[0]].revealedTraits.health, "");
    assert.equal(
        ordinaryTraits.filter((trait) =>
            !engine.players[affectedIds[0]].revealedTraits[trait]).length,
        1
    );
    assert.equal(engine.bunkerEffectResults[instanceId].status, "resolved");
    assert.match(engine.bunkerEffectResults[instanceId].message, /остаётся скрытой/);
});

test("дед с ружьём выбирает случайно среди всех активных, даже если здоровье цели останется скрытым", () => {
    const source = makeGameWithBunkerCard(51).bunker;
    const engine = makeGame(4, 2);
    const ordinaryTraits = TRAIT_KEYS.filter((trait) => trait !== "special");
    for (const trait of ordinaryTraits.filter((trait) => trait !== "health")) {
        engine.players.p1.revealedTraits[trait] = engine.characters.p1[trait];
    }
    engine.extraScenarios.bunker.push({
        id: "fair_old_man",
        cardId: 51,
        instanceId: "fair_old_man",
        title: source.title,
        description: source.description,
        revealedRound: engine.round
    });
    setEngineRandomRolls(engine, ([roll]) => roll < 0.25);

    send(engine, "SKIP_TURN", "host");

    assert.equal(engine.characters.p1.health, "Огнестрельное ранение");
    assert.equal(engine.players.p1.revealedTraits.health, "");
    assert.equal(
        engine.order.slice(1).every((playerId) =>
            engine.characters[playerId].health !== "Огнестрельное ранение"),
        true
    );
});

test("карта бункера №53 проводит отдельное голосование, изгоняет жертву и открывает карту", () => {
    const engine = makeGameWithBunkerCard(53);
    const sourceInstanceId = engine.bunker.instanceId;

    assert.equal(engine.pendingBunkerVote.type, "sacrifice");
    assert.deepEqual(engine.pendingBunkerVote.voterIds, engine.order);
    assert.deepEqual(engine.pendingBunkerVote.candidateIds, engine.order);
    assert.throws(
        () => send(engine, "REVEAL_TRAIT", "p1", { trait: "health" }),
        /завершите голосование по карте бункера/
    );

    for (const playerId of engine.order) {
        send(engine, "BUNKER_VOTE", playerId, { targetId: "p4" });
    }
    assert.deepEqual(
        new Set(createPublicState(engine).pendingBunkerVote.submittedVoterIds),
        new Set(engine.order)
    );
    assert.throws(
        () => send(engine, "RESOLVE_BUNKER_VOTE", "p1"),
        /только ведущий/
    );

    setEngineRandomRolls(engine, ([roll]) => roll < 0.05);
    send(engine, "RESOLVE_BUNKER_VOTE", "host");

    assert.equal(engine.pendingBunkerVote, undefined);
    assert.equal(engine.players.p4.status, "exiled");
    assert.equal(engine.extraScenarios.bunker.length, 1);
    assert.equal(engine.bunkerEffectResults[sourceInstanceId].outcome, "sacrificed");
});

test("жертвенное голосование передаёт ход, если изгнан текущий игрок", () => {
    const engine = makeGameWithBunkerCard(53);
    assert.equal(engine.order[engine.currentPlayerIndex], "p1");

    for (const playerId of engine.order) {
        send(engine, "BUNKER_VOTE", playerId, { targetId: "p1" });
    }
    setEngineRandomRolls(engine, ([roll]) => roll < 0.05);
    send(engine, "RESOLVE_BUNKER_VOTE", "host");

    assert.equal(engine.players.p1.status, "exiled");
    assert.equal(engine.order[engine.currentPlayerIndex], "p2");
    assert.doesNotThrow(() => send(engine, "REVEAL_TRAIT", "p2", { trait: "health" }));
});

test("жертвенное голосование №53 не принимает голоса против иммунного игрока", () => {
    const engine = makeGameWithBunkerCard(53);
    engine.players.p1.immuneThisRound = true;

    assert.throws(
        () => send(engine, "BUNKER_VOTE", "p2", { targetId: "p1" }),
        /допустимого кандидата/
    );
    assert.equal(engine.pendingBunkerVote.candidateIds.includes("p1"), false);

    send(engine, "BUNKER_VOTE", "p1", { targetId: "p2" });
    send(engine, "RESOLVE_BUNKER_VOTE", "host");
    assert.equal(engine.players.p1.status, "active");
    assert.equal(engine.players.p2.status, "exiled");
});

test("карта бункера №62 возвращает выбранного царя и навсегда защищает его от изгнания", () => {
    const engine = makeGameWithBunkerCard(62);
    const kingCard = engine.bunker;
    engine.players.p4.status = "exiled";
    engine.players.p4.hasFinishedTurn = true;

    assert.equal(kingCard.cardId, 62);
    assert.equal(engine.pendingBunkerVote.type, "king");
    assert.equal(engine.pendingBunkerVote.candidateIds.includes("p4"), true);

    for (const playerId of engine.pendingBunkerVote.voterIds.filter((id) =>
        engine.players[id].status === "active")) {
        send(engine, "BUNKER_VOTE", playerId, { targetId: "p4" });
    }
    send(engine, "RESOLVE_BUNKER_VOTE", "host");

    assert.equal(engine.players.p4.status, "active");
    assert.equal(engine.players.p4.bunkerKing, true);
    assert.equal(engine.players.p4.immuneThisRound, true);
    assert.equal(engine.players.p4.hasFinishedTurn, false);
    assert.equal(engine.players.p4.revealedThisTurn, false);
    assert.equal(engine.bunkerEffectResults[kingCard.instanceId].outcome, "king_chosen");
    assert.equal(createPublicState(engine).players.p4.bunkerKing, true);
    assert.throws(
        () => send(engine, "HOST_EDIT", "host", {
            action: "set_status",
            playerId: "p4",
            status: "exiled"
        }),
        /Царя нельзя изгнать/
    );
});

test("удалённая карта бункера №62 не выпадает повторно и не создаёт второго царя", () => {
    const engine = makeGameWithBunkerCard(62);
    for (const playerId of engine.pendingBunkerVote.voterIds) {
        send(engine, "BUNKER_VOTE", playerId, { targetId: "p1" });
    }
    send(engine, "RESOLVE_BUNKER_VOTE", "host");

    assignSpecial(engine, "p4", 1);
    send(engine, "HOST_EDIT", "host", {
        action: "set_status",
        playerId: "p4",
        status: "exiled"
    });
    send(engine, "PLAY_SPECIAL", "p4", { scenarioTarget: "primary:bunker" });
    setEngineRandomRolls(engine, ([roll]) => Math.floor(roll * 80) === 61);

    send(engine, "HOST_EDIT", "host", {
        action: "add_scenario",
        scenarioType: "bunker",
        random: true
    });

    const addedCard = engine.extraScenarios.bunker.at(-1);
    assert.notEqual(addedCard.cardId, 62);
    assert.equal(engine.bunkerCardHistory[62], true);
    assert.equal(
        Object.values(engine.players).filter((player) => player.bunkerKing).length,
        1
    );
});

test("вернувшийся в фазе раскрытия царь догоняет пропущенные раунды до round - 1", () => {
    const engine = makeGameWithBunkerCard(62);
    const ordinaryTraits = TRAIT_KEYS.filter((trait) => trait !== "special");
    const returnedPlayer = engine.players.p4;
    engine.round = 4;
    engine.totalRounds = 5;
    engine.bunkerRoundsRevealed = { 1: true, 2: true, 3: true, 4: true };
    returnedPlayer.status = "exiled";
    returnedPlayer.hasFinishedTurn = true;
    returnedPlayer.revealedBeforeExile = ordinaryTraits.slice(0, 2);
    for (const trait of TRAIT_KEYS) {
        returnedPlayer.revealedTraits[trait] = engine.characters.p4[trait];
    }

    for (const playerId of engine.pendingBunkerVote.voterIds.filter((id) =>
        engine.players[id].status === "active")) {
        send(engine, "BUNKER_VOTE", playerId, { targetId: "p4" });
    }
    send(engine, "RESOLVE_BUNKER_VOTE", "host");

    assert.equal(returnedPlayer.status, "active");
    assert.equal(
        ordinaryTraits.filter((trait) => returnedPlayer.revealedTraits[trait]).length,
        engine.round - 1
    );
    assert.equal(returnedPlayer.hasFinishedTurn, false);
    assert.equal(returnedPlayer.revealedThisTurn, false);
});

test("царь из старого сохранения возвращается максимум с пятью открытыми обычными картами", () => {
    const engine = makeGameWithBunkerCard(62);
    const ordinaryTraits = TRAIT_KEYS.filter((trait) => trait !== "special");
    engine.players.p4.status = "exiled";
    for (const trait of TRAIT_KEYS) {
        engine.players.p4.revealedTraits[trait] = engine.characters.p4[trait];
    }
    delete engine.players.p4.revealedBeforeExile;

    for (const playerId of engine.pendingBunkerVote.voterIds.filter((id) =>
        engine.players[id].status === "active")) {
        send(engine, "BUNKER_VOTE", playerId, { targetId: "p4" });
    }
    send(engine, "RESOLVE_BUNKER_VOTE", "host");

    assert.equal(engine.players.p4.status, "active");
    assert.equal(
        ordinaryTraits.filter((trait) => engine.players.p4.revealedTraits[trait]).length,
        5
    );
    assert.equal(
        ordinaryTraits.filter((trait) => !engine.players.p4.revealedTraits[trait]).length,
        1
    );
});

test("отложенное жертвенное голосование исключает только что выбранного царя", () => {
    const engine = makeGame(4, 2);
    engine.pendingBunkerVote = {
        type: "king",
        sourceTarget: "primary:bunker",
        sourceInstanceId: "queued_king",
        candidateIds: [...engine.order],
        voterIds: [...engine.order],
        votes: Object.fromEntries(engine.order.map((id) => [id, "p1"])),
        revote: false
    };
    engine.bunkerVoteQueue = [{
        type: "sacrifice",
        sourceTarget: "extra:bunker:queued",
        sourceInstanceId: "queued_sacrifice",
        candidateIds: [...engine.order],
        voterIds: [...engine.order],
        votes: {},
        revote: false
    }];
    engine.bunkerEffectResults.queued_king = { cardId: 62, status: "voting", message: "" };
    engine.bunkerEffectResults.queued_sacrifice = { cardId: 53, status: "voting", message: "" };

    send(engine, "RESOLVE_BUNKER_VOTE", "host");

    assert.equal(engine.players.p1.bunkerKing, true);
    assert.equal(engine.pendingBunkerVote.type, "sacrifice");
    assert.equal(engine.pendingBunkerVote.candidateIds.includes("p1"), false);
    assert.throws(
        () => send(engine, "BUNKER_VOTE", "p2", { targetId: "p1" }),
        /допустимого кандидата/
    );
});

test("финальные карты бункера №1, №4 и №59 меняют набор угроз", () => {
    const suppressing = makeGameWithBunkerCard(1);
    const suppressingInstanceId = suppressing.bunker.instanceId;
    const suppressedThreatTitle = suppressing.scenarioSecrets.threat.title;
    prepareFinal(suppressing);
    send(suppressing, "NEXT_PHASE", "host");
    assert.equal(suppressing.threat.status, "suppressed");
    assert.equal(suppressing.threat.title, "Угроза не раскрыта");
    assert.equal(createPublicState(suppressing).threat.cardId, 0);
    assert.equal(JSON.stringify(suppressing.log).includes(suppressedThreatTitle), false);
    assert.equal(suppressing.threatResolution.threatCount, 0);
    assert.equal(suppressing.phase, PHASES.FINISHED);
    assert.equal(
        suppressing.bunkerEffectResults[suppressingInstanceId].outcome,
        "threat_suppressed"
    );

    const adding = makeGameWithBunkerCard(4);
    const addingInstanceId = adding.bunker.instanceId;
    prepareFinal(adding);
    send(adding, "NEXT_PHASE", "host");
    assert.equal(adding.extraScenarios.threat.length, 1);
    assert.equal(adding.threatResolution.threatCount, 2);
    assert.equal(adding.phase, PHASES.THREAT);
    assert.equal(adding.bunkerEffectResults[addingInstanceId].outcome, "threat_added");

    const replacing = makeGameWithBunkerCard(59);
    const replacingInstanceId = replacing.bunker.instanceId;
    const originalThreatTitle = replacing.scenarioSecrets.threat.title;
    prepareFinal(replacing);
    send(replacing, "NEXT_PHASE", "host");
    assert.notEqual(replacing.threat.title, originalThreatTitle);
    assert.equal(replacing.threatResolution.threatCount, 1);
    assert.equal(replacing.bunkerEffectResults[replacingInstanceId].outcome, "threat_replaced");
});

test("скрытая дополнительная угроза после нейтрализации не выдаёт номер карты", () => {
    const engine = makeGameWithBunkerCard(1);
    engine.scenarioSecrets.threat = {
        id: 11,
        title: "Угроза №11",
        description: "Опасности нет"
    };
    engine.extraScenarios.threat = [{
        id: "hidden_extra",
        cardId: 1,
        title: "Секретная дополнительная угроза",
        description: "Содержание не должно попасть в публичное состояние",
        hiddenUntilFinal: true
    }];
    prepareFinal(engine);

    send(engine, "NEXT_PHASE", "host");

    const publicThreat = createPublicState(engine).extraScenarios.threat[0];
    assert.equal(publicThreat.suppressed, true);
    assert.equal(publicThreat.cardId, 0);
    assert.equal(publicThreat.title, "Угроза не раскрыта");
    assert.equal(JSON.stringify(publicThreat).includes("Секретная дополнительная угроза"), false);
});

test("карты бункера №4 и №59 всегда добавляют или заменяют именно опасную угрозу", () => {
    const adding = makeGameWithBunkerCard(4);
    prepareFinal(adding);
    adding.randomState = 1;
    send(adding, "NEXT_PHASE", "host");
    const addedThreat = adding.extraScenarios.threat[0];
    assert.equal([11, 31].includes(Number(addedThreat.cardId)), false);
    assert.equal(adding.threatResolution.threatCount, 2);

    const replacing = makeGameWithBunkerCard(59);
    prepareFinal(replacing);
    replacing.randomState = 53;
    send(replacing, "NEXT_PHASE", "host");
    assert.equal([11, 31].includes(Number(replacing.threat.cardId)), false);
    assert.equal(replacing.threatResolution.threatCount, 1);
});

test("карта бункера №59 не создаёт угрозу, если заменять нечего", () => {
    const engine = makeGameWithBunkerCard(59);
    engine.scenarioSecrets.threat = {
        id: 11,
        title: "Угроза №11",
        description: "Угроз нет, все хорошо"
    };
    prepareFinal(engine);

    send(engine, "NEXT_PHASE", "host");

    assert.equal(engine.threat.cardId, 11);
    assert.equal(engine.threatResolution.threatCount, 0);
    assert.equal(engine.phase, PHASES.FINISHED);
    assert.equal(engine.bunkerEffectResults[engine.bunker.instanceId].outcome, "no_threat");
});

test("карта бункера №44 детерминированно спасает или уничтожает всех по броску", () => {
    const saved = makeGameWithBunkerCard(44);
    const savedInstanceId = saved.bunker.instanceId;
    prepareFinal(saved);
    setEngineRandomRolls(saved, ([roll]) => roll < 0.5);
    send(saved, "NEXT_PHASE", "host");

    assert.equal(saved.catastrophe.status, "neutralized");
    assert.equal(saved.threat.status, "suppressed");
    assert.equal(saved.phase, PHASES.FINISHED);
    assert.equal(saved.bunkerEffectResults[savedInstanceId].outcome, "saved");

    const destroyed = makeGameWithBunkerCard(44);
    const destroyedInstanceId = destroyed.bunker.instanceId;
    prepareFinal(destroyed);
    setEngineRandomRolls(destroyed, ([roll]) => roll >= 0.5);
    send(destroyed, "NEXT_PHASE", "host");

    assert.equal(
        destroyed.order.every((playerId) => destroyed.players[playerId].status === "dead"),
        true
    );
    assert.equal(destroyed.phase, PHASES.FINISHED);
    assert.equal(destroyed.threatResolution.status, "failed");
    assert.equal(destroyed.threatResolution.forcedByBunker, true);
    assert.equal(destroyed.bunkerEffectResults[destroyedInstanceId].outcome, "destroyed_all");
});

test("карта бункера №75 покрывает помощь, убийство игрока и пустой исход", () => {
    const helped = makeGameWithBunkerCard(75);
    const helpedInstanceId = helped.bunker.instanceId;
    prepareFinal(helped);
    setEngineRandomRolls(helped, ([roll]) => roll < 0.4);
    send(helped, "NEXT_PHASE", "host");
    assert.equal(helped.threat.status, "suppressed");
    assert.equal(helped.bunkerEffectResults[helpedInstanceId].outcome, "threat_suppressed");

    const killed = makeGameWithBunkerCard(75);
    const killedInstanceId = killed.bunker.instanceId;
    prepareFinal(killed);
    setEngineRandomRolls(
        killed,
        ([outcomeRoll, targetRoll]) =>
            outcomeRoll >= 0.4 && outcomeRoll < 0.6 && targetRoll >= 0.5
    );
    send(killed, "NEXT_PHASE", "host");
    assert.equal(killed.players.p2.status, "dead");
    assert.equal(killed.players.p1.status, "active");
    assert.equal(killed.bunkerEffectResults[killedInstanceId].outcome, "player_killed");

    const unchanged = makeGameWithBunkerCard(75);
    const unchangedInstanceId = unchanged.bunker.instanceId;
    prepareFinal(unchanged);
    setEngineRandomRolls(unchanged, ([roll]) => roll >= 0.6);
    send(unchanged, "NEXT_PHASE", "host");
    assert.equal(unchanged.players.p1.status, "active");
    assert.equal(unchanged.players.p2.status, "active");
    assert.equal(unchanged.bunkerEffectResults[unchangedInstanceId].outcome, "nothing");
});

test("ведущий может пропустить зависший ход, обычный игрок — нет", () => {
    const engine = makeGame(4, 2);
    const logSizeBefore = Object.keys(engine.log).length;
    assert.throws(
        () => send(engine, "SKIP_TURN", "p2"),
        /только ведущий/
    );
    send(engine, "SKIP_TURN", "host");
    assert.equal(engine.players.p1.hasFinishedTurn, true);
    assert.equal(engine.order[engine.currentPlayerIndex], "p2");
    assert.equal(Object.keys(engine.log).length, logSizeBefore + 2);
});

test("ничья запускает переголосование только между лидерами", () => {
    const engine = makeGame(4, 2);
    finishRevealRound(engine);
    send(engine, "NEXT_PHASE", "host");
    finishRevealRound(engine);
    send(engine, "NEXT_PHASE", "host");

    send(engine, "VOTE", "p1", { targetId: "p1" });
    send(engine, "VOTE", "p2", { targetId: "p1" });
    send(engine, "VOTE", "p3", { targetId: "p2" });
    send(engine, "VOTE", "p4", { targetId: "p2" });
    send(engine, "NEXT_PHASE", "host");
    assert.equal(engine.phase, PHASES.RESULTS);
    assert.equal(engine.voteResult.status, "tie");
    assert.deepEqual(new Set(engine.voteResult.candidates), new Set(["p1", "p2"]));

    send(engine, "NEXT_PHASE", "host");
    assert.equal(engine.phase, PHASES.VOTING);
    assert.throws(
        () => send(engine, "VOTE", "p1", { targetId: "p3" }),
        /лидеров/
    );
});

test("голоса с одной публичной ревизией принимаются параллельно", () => {
    const engine = makeGame(4, 2);
    engine.phase = PHASES.VOTING;
    engine.round = 2;
    engine.currentPlayerIndex = -1;
    const publicRevision = engine.revision;

    applyCommand(engine, {
        type: "VOTE",
        from: "p1",
        data: { targetId: "p3" },
        revision: publicRevision
    }, "host");
    applyCommand(engine, {
        type: "VOTE",
        from: "p2",
        data: { targetId: "p4" },
        revision: publicRevision
    }, "host");

    assert.equal(engine.votes.p1, "p3");
    assert.equal(engine.votes.p2, "p4");
});

test("секретный выбор особой карты виден только владельцу", () => {
    const engine = makeGame(4, 2);
    engine.pendingSpecialChoice = {
        type: "bunker_to_baggage",
        playerId: "p1",
        options: [
            { index: 0, title: "Вариант А", description: "Секрет А" },
            { index: 1, title: "Вариант Б", description: "Секрет Б" }
        ]
    };

    const publicState = createPublicState(engine);
    const privateStates = createPrivateStates(engine);
    assert.equal(publicState.pendingSpecialChoice.playerId, "p1");
    assert.equal("options" in publicState.pendingSpecialChoice, false);
    assert.equal(privateStates.p1.pendingSpecialChoice.options.length, 2);
    assert.equal(privateStates.p2.pendingSpecialChoice, undefined);
});

test("особую карту можно разыграть без предварительного раскрытия в подходящий момент", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p2", 46);
    const special = SPECIAL_CARDS.find((card) => card.id === 46);

    assert.equal(engine.phase, PHASES.REVEAL);
    assert.equal(engine.order[engine.currentPlayerIndex], "p1");
    assert.equal(Boolean(engine.players.p2.revealedTraits.special), false);
    assert.throws(
        () => send(engine, "PLAY_SPECIAL", "p2"),
        /голосование сейчас не ожидается/
    );
    assert.equal(engine.players.p2.specialUsed, false);

    beginSecondRound(engine);
    send(engine, "PLAY_SPECIAL", "p2");

    assert.equal(engine.players.p2.revealedTraits.special, special.text);
    assert.equal(engine.players.p2.ignoreVotesIfHalf, true);
    assert.equal(engine.players.p2.specialUsed, true);
    assert.throws(
        () => send(engine, "PLAY_SPECIAL", "p2"),
        /уже использована/
    );
});

test("карты №25 и №29 заменяют только уже открытые характеристики", () => {
    for (const [specialId, trait] of [[25, "health"], [29, "profession"]]) {
        const engine = makeGame(4, 2);
        assignSpecial(engine, "p1", specialId);

        assert.throws(
            () => send(engine, "PLAY_SPECIAL", "p1", { targetId: "p2" }),
            /открытой картой/
        );

        const previousValue = engine.characters.p2[trait];
        engine.players.p2.revealedTraits[trait] = previousValue;
        send(engine, "PLAY_SPECIAL", "p1", { targetId: "p2" });

        assert.notEqual(engine.characters.p2[trait], previousValue);
        assert.equal(engine.players.p2.revealedTraits[trait], engine.characters.p2[trait]);
        assert.equal(engine.players.p1.specialUsed, true);
    }
});

test("карты №5–9 гарантированно перераздают все открытые карты другим активным игрокам", () => {
    for (const [specialId, trait] of [
        [5, "baggage"],
        [6, "biology"],
        [7, "hobby"],
        [8, "health"],
        [9, "fact"]
    ]) {
        const engine = makeGame(6, 3);
        const participantIds = ["p2", "p3", "p4", "p5"];
        engine.phase = PHASES.DISCUSSION;
        engine.players.p1.status = "exiled";
        assignSpecial(engine, "p2", specialId);
        engine.characters.p1[trait] = `${trait}-exiled`;
        engine.players.p1.revealedTraits[trait] = `${trait}-exiled`;
        engine.characters.p6[trait] = `${trait}-hidden`;
        engine.players.p6.revealedTraits[trait] = "";
        for (const id of participantIds) {
            engine.characters[id][trait] = `${trait}-${id}`;
            engine.players[id].revealedTraits[trait] = `${trait}-${id}`;
        }
        const original = Object.fromEntries(
            engine.order.map((id) => [id, engine.characters[id][trait]])
        );
        engine.randomState = 1462;

        send(engine, "PLAY_SPECIAL", "p2");

        assert.deepEqual(
            participantIds.map((id) => engine.characters[id][trait]).sort(),
            participantIds.map((id) => original[id]).sort()
        );
        for (const id of participantIds) {
            assert.notEqual(engine.characters[id][trait], original[id]);
            assert.equal(engine.players[id].revealedTraits[trait], engine.characters[id][trait]);
            assert.notEqual(engine.lastTraitShuffle.sourceByRecipient[id], id);
        }
        assert.equal(engine.characters.p1[trait], `${trait}-exiled`);
        assert.equal(engine.characters.p6[trait], `${trait}-hidden`);
        assert.equal(engine.players.p6.revealedTraits[trait], "");
        assert.equal(engine.lastTraitShuffle.trait, trait);
        assert.equal(engine.lastTraitShuffle.round, engine.round);
        assert.deepEqual(
            new Set(createPublicState(engine).lastTraitShuffle.affectedIds),
            new Set(participantIds)
        );
        assert.equal(
            Object.values(engine.log).some((entry) =>
                entry.message.includes(`Перераздача «${TRAIT_LABELS[trait]}»`)),
            true
        );
    }
});

test("Абсолютный хаос заменяет каждую раскрытую обычную карту новым значением", () => {
    const engine = makeGame(4, 2);
    engine.phase = PHASES.DISCUSSION;
    assignSpecial(engine, "p2", 43);
    for (const playerId of ["p1", "p2", "p3"]) {
        engine.players[playerId].revealedTraits.health = engine.characters[playerId].health;
        engine.players[playerId].revealedTraits.fact = engine.characters[playerId].fact;
    }
    const before = structuredClone(engine.characters);

    send(engine, "PLAY_SPECIAL", "p2");

    for (const playerId of ["p1", "p2", "p3"]) {
        for (const trait of ["health", "fact"]) {
            assert.notEqual(engine.characters[playerId][trait], before[playerId][trait]);
            assert.equal(
                engine.players[playerId].revealedTraits[trait],
                engine.characters[playerId][trait]
            );
        }
    }
    assert.deepEqual(engine.characters.p4, before.p4);
    assert.equal(engine.players.p4.revealedTraits.health, "");
    assert.equal(
        Object.values(engine.log).some((entry) =>
            entry.message.includes("Абсолютный хаос заменил все раскрытые")),
        true
    );
});

test("раскрытие особой карты не заменяет обычную карту хода", () => {
    const engine = makeGame(4, 2);

    send(engine, "REVEAL_TRAIT", "p1", { trait: "special" });
    assert.equal(engine.players.p1.revealedThisTurn, false);
    send(engine, "REVEAL_TRAIT", "p1", { trait: "health" });
    assert.equal(engine.players.p1.revealedThisTurn, true);
    send(engine, "FINISH_TURN", "p1");

    send(engine, "REVEAL_TRAIT", "p2", { trait: "biology" });
    assert.equal(engine.players.p2.revealedThisTurn, true);
    assert.doesNotThrow(() => send(engine, "REVEAL_TRAIT", "p2", { trait: "special" }));
    assert.equal(engine.players.p2.revealedThisTurn, true);
});

test("после пяти открытых обычных карт шестая остаётся скрытой и ход можно завершить", () => {
    const engine = makeGame(4, 2);
    const ordinaryTraits = TRAIT_KEYS.filter((trait) => trait !== "special");
    const hiddenTrait = ordinaryTraits.at(-1);
    for (const trait of ordinaryTraits.slice(0, -1)) {
        engine.players.p1.revealedTraits[trait] = engine.characters.p1[trait];
    }

    assert.throws(
        () => send(engine, "REVEAL_TRAIT", "p1", { trait: hiddenTrait }),
        /Последняя обычная карта/
    );
    assert.throws(
        () => send(engine, "HOST_EDIT", "host", {
            action: "set_trait",
            playerId: "p1",
            trait: hiddenTrait,
            value: "Попытка открыть последнюю карту",
            revealed: true
        }),
        /должна остаться одна скрытая/
    );
    assert.doesNotThrow(() => send(engine, "FINISH_TURN", "p1"));
    assert.deepEqual(
        ordinaryTraits.filter((trait) => !engine.players.p1.revealedTraits[trait]),
        [hiddenTrait]
    );
});

test("автоматическое раскрытие не открывает шестую обычную карту", () => {
    const engine = makeGame(4, 2);
    const ordinaryTraits = TRAIT_KEYS.filter((trait) => trait !== "special");
    engine.round = 2;
    assignSpecial(engine, "p1", 60);
    for (const playerId of engine.order) {
        for (const trait of ordinaryTraits.slice(0, -1)) {
            engine.players[playerId].revealedTraits[trait] = engine.characters[playerId][trait];
        }
    }

    send(engine, "PLAY_SPECIAL", "p1");

    assert.equal(engine.players.p1.specialUsed, true);
    for (const playerId of engine.order) {
        assert.equal(
            ordinaryTraits.filter((trait) => !engine.players[playerId].revealedTraits[trait]).length,
            1
        );
    }
});

test("Последняя диверсия уменьшает вместимость без лишнего пустого раунда", () => {
    const engine = makeGame(8, 3);
    assignSpecial(engine, "p8", 30);
    engine.round = 3;
    engine.totalRounds = 6;
    engine.phase = PHASES.REVEAL;
    engine.bunkerRoundsRevealed = { 1: true, 2: true, 3: true };
    engine.players.p8.status = "exiled";

    assert.equal(getSpecialAvailability(engine, "p8", 30).allowed, true);
    send(engine, "PLAY_SPECIAL", "p8");

    assert.equal(engine.capacity, 2);
    assert.equal(engine.totalRounds, 7);
    assert.equal(engine.players.p8.specialUsed, true);
    assert.equal(
        Object.values(engine.log).some((entry) =>
            entry.message.includes("вместимость бункера уменьшена до 2")),
        true
    );

    const capped = makeGame(4, 1);
    assignSpecial(capped, "p4", 30);
    capped.players.p4.status = "exiled";
    const availability = getSpecialAvailability(capped, "p4", 30);
    assert.equal(availability.allowed, false);
    assert.match(availability.reason, /нельзя уменьшить/);
});

test("Последняя диверсия при ничьей учитывает переголосование текущего раунда", () => {
    const engine = makeGame(8, 3);
    assignSpecial(engine, "p8", 30);
    engine.round = 3;
    engine.totalRounds = 6;
    engine.phase = PHASES.RESULTS;
    engine.bunkerRoundsRevealed = { 1: true, 2: true, 3: true };
    engine.players.p8.status = "exiled";
    engine.voteResult = {
        status: "tie",
        exiledPlayerId: "",
        candidates: ["p1", "p2"],
        counts: { p1: 3, p2: 3 }
    };

    send(engine, "PLAY_SPECIAL", "p8");

    assert.equal(engine.capacity, 2);
    assert.equal(engine.totalRounds, 7);
});

test("увеличение вместимости ведущим сокращает лишние будущие раунды", () => {
    const engine = makeGame(10, 3);
    assert.equal(engine.totalRounds, 8);

    send(engine, "HOST_EDIT", "host", { action: "set_capacity", capacity: 5 });

    assert.equal(engine.capacity, 5);
    assert.equal(engine.totalRounds, 6);
});

test("увеличение вместимости отменяет ставшее ненужным голосование и переголосование", () => {
    for (const [phase, voteResult] of [
        [PHASES.VOTING, {
            status: "pending",
            exiledPlayerId: "",
            candidates: [],
            counts: {}
        }],
        [PHASES.RESULTS, {
            status: "tie",
            exiledPlayerId: "",
            candidates: ["p1", "p2"],
            counts: { p1: 1, p2: 1 }
        }]
    ]) {
        const engine = makeGame(4, 2);
        engine.round = 2;
        engine.phase = phase;
        engine.currentPlayerIndex = -1;
        engine.players.p4.status = "exiled";
        engine.voteResult = voteResult;
        engine.votes.p1 = "p2";
        engine.players.p1.voteSubmitted = true;

        send(engine, "HOST_EDIT", "host", { action: "set_capacity", capacity: 3 });

        assert.equal(engine.phase, PHASES.DISCUSSION);
        assert.equal(engine.voteResult.status, "pending");
        assert.equal(Object.values(engine.votes).every((targetId) => targetId === ""), true);
        assert.equal(engine.players.p1.status, "active");
    }
});

test("защитная особая карта активируется тайно", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 10);

    send(engine, "PLAY_SPECIAL", "p1");

    assert.equal(engine.players.p1.specialUsed, true);
    assert.equal(engine.players.p1.revealedTraits.special, "");
    assert.equal(createPublicState(engine).players.p1.revealedTraits.special, "");
    assert.equal(createPublicState(engine).lastSpecial.specialId, 0);
});

test("особая карта №38 передаёт ход после изгнания текущего игрока", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p4", 38);
    engine.players.p4.status = "exiled";
    assert.equal(engine.order[engine.currentPlayerIndex], "p1");

    send(engine, "PLAY_SPECIAL", "p4", { targetId: "p1" });

    assert.equal(engine.players.p1.status, "exiled");
    assert.equal(engine.order[engine.currentPlayerIndex], "p2");
    assert.doesNotThrow(() => send(engine, "REVEAL_TRAIT", "p2", { trait: "health" }));
});

test("внеочередное изгнание последнего игрока завершает партию без пустого раунда", () => {
    const engine = makeGame(4, 1);
    assignSpecial(engine, "p4", 38);
    engine.round = 2;
    engine.phase = PHASES.DISCUSSION;
    engine.currentPlayerIndex = -1;
    engine.players.p2.status = "exiled";
    engine.players.p3.status = "exiled";
    engine.players.p4.status = "exiled";

    send(engine, "PLAY_SPECIAL", "p4", { targetId: "p1" });
    assert.equal(Object.values(engine.players).some((player) => player.status === "active"), false);

    send(engine, "NEXT_PHASE", "host");

    assert.equal(engine.phase, PHASES.FINISHED);
    assert.equal(engine.round, 2);
    assert.equal(engine.threatResolution.status, "failed");
    assert.equal(engine.threatResolution.finalistIds.length, 0);
});

test("План Б после результата возвращает изгнанного и начинает чистое переголосование", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 28);
    beginSecondRound(engine);
    finishRevealRound(engine);
    send(engine, "NEXT_PHASE", "host");
    for (const id of engine.order) send(engine, "VOTE", id, { targetId: "p4" });
    send(engine, "NEXT_PHASE", "host");
    assert.equal(engine.phase, PHASES.RESULTS);
    assert.equal(engine.players.p4.status, "exiled");

    send(engine, "PLAY_SPECIAL", "p1");

    assert.equal(engine.phase, PHASES.VOTING);
    assert.equal(engine.players.p4.status, "active");
    assert.equal(engine.voteResult.status, "pending");
    assert.throws(
        () => send(engine, "VOTE", "p1", { targetId: "p4" }),
        /другого кандидата/
    );
    assert.doesNotThrow(() => send(engine, "VOTE", "p1", { targetId: "p3" }));
});

test("после отмены Плана Б сохраняется снимок для другой карты №28", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 28);
    assignSpecial(engine, "p2", 71);
    assignSpecial(engine, "p3", 28);
    beginSecondRound(engine);
    finishRevealRound(engine);
    send(engine, "NEXT_PHASE", "host");
    for (const id of engine.order) send(engine, "VOTE", id, { targetId: "p4" });
    send(engine, "NEXT_PHASE", "host");

    send(engine, "PLAY_SPECIAL", "p1");
    send(engine, "PLAY_SPECIAL", "p2");

    assert.equal(engine.phase, PHASES.RESULTS);
    assert.ok(engine.preVotingResultSnapshot);
    assert.doesNotThrow(() => assertFirebaseSafe(engine));
    assert.doesNotThrow(() => send(engine, "PLAY_SPECIAL", "p3"));
    assert.equal(engine.phase, PHASES.VOTING);
});

test("Подмена цели меняет только настоящий выбор предыдущей карты", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 50);
    assignSpecial(engine, "p2", 2);

    send(engine, "PLAY_SPECIAL", "p2", { targetId: "p3" });
    send(engine, "PLAY_SPECIAL", "p1", { targetId: "p4" });

    assert.equal(Boolean(engine.players.p3.cannotVoteAgainst?.p2), false);
    assert.equal(engine.players.p4.cannotVoteAgainst.p2, true);
    assert.equal(engine.players.p1.specialUsed, true);
    assert.equal(createPublicState(engine).lastSpecial.specialId, 50);
    assert.equal(createPublicState(engine).lastSpecial.playedBy, "p1");
});

test("Галя отменяет Подмену цели, а не исходную особую карту", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 50);
    assignSpecial(engine, "p2", 2);
    assignSpecial(engine, "p3", 71);

    send(engine, "PLAY_SPECIAL", "p2", { targetId: "p3" });
    send(engine, "PLAY_SPECIAL", "p1", { targetId: "p4" });
    send(engine, "PLAY_SPECIAL", "p3");

    assert.equal(Boolean(engine.players.p3.cannotVoteAgainst?.p2), true);
    assert.equal(Boolean(engine.players.p4.cannotVoteAgainst?.p2), false);
    assert.equal(engine.players.p2.specialUsed, true);
    assert.equal(engine.players.p1.specialUsed, false);
    assert.equal(engine.players.p3.specialUsed, false);
    assert.equal(createPublicState(engine).lastSpecial, undefined);
});

test("невалидная Подмена цели не откатывает уже сыгранную карту", () => {
    const regular = makeGame(4, 2);
    assignSpecial(regular, "p1", 50);
    assignSpecial(regular, "p2", 2);
    regular.players.p1.revealedTraits.special = regular.characters.p1.special;
    send(regular, "PLAY_SPECIAL", "p2", { targetId: "p3" });
    const regularBefore = structuredClone(regular);

    assert.throws(
        () => send(regular, "PLAY_SPECIAL", "p1", { targetId: "missing" }),
        /активного игрока/
    );
    assert.deepEqual(regular, regularBefore);

    const pending = makeGame(4, 2);
    assignSpecial(pending, "p1", 56);
    assignSpecial(pending, "p2", 50);
    pending.players.p2.revealedTraits.special = pending.characters.p2.special;
    send(pending, "PLAY_SPECIAL", "p1", { targetId: "p3", trait: "health" });
    const pendingBefore = structuredClone(pending);

    assert.throws(
        () => send(pending, "PLAY_SPECIAL", "p2", { targetId: "missing", trait: "fact" }),
        /активного игрока/
    );
    assert.deepEqual(pending, pendingBefore);
});

test("устаревшая реакция не применяется к следующей особой карте", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 50);
    assignSpecial(engine, "p2", 2);
    assignSpecial(engine, "p3", 27);

    send(engine, "PLAY_SPECIAL", "p2", { targetId: "p3" });
    const staleRedirect = {
        type: "PLAY_SPECIAL",
        from: "p1",
        data: { targetId: "p4" },
        revision: engine.revision
    };
    send(engine, "PLAY_SPECIAL", "p3", { targetId: "p4" });
    const stateBeforeStaleCommand = structuredClone(engine);

    assert.throws(
        () => applyCommand(engine, staleRedirect, "host"),
        /Команда устарела/
    );
    assert.deepEqual(engine, stateBeforeStaleCommand);
});

test("Подмена цели выбирает другой вариант Строителя бункера №54", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 54);
    assignSpecial(engine, "p2", 50);

    send(engine, "PLAY_SPECIAL", "p1");
    const options = engine.pendingSpecialChoice.options.map((option) => ({ ...option }));
    send(engine, "PLAY_SPECIAL", "p1", { choice: "1" });
    const publicState = createPublicState(engine);
    const privateStates = createPrivateStates(engine);
    assert.equal(publicState.lastSpecial.choiceOptions, undefined);
    assert.equal(publicState.lastSpecial.hasChoiceOptions, true);
    assert.equal(getSpecialAvailability(publicState, "p2", 50).allowed, true);
    assert.deepEqual(
        privateStates.p2.specialReactionChoiceOptions.map(({ index }) => index),
        [0, 1]
    );
    assert.equal(privateStates.p3.specialReactionChoiceOptions, undefined);

    send(engine, "PLAY_SPECIAL", "p2", { choice: 0 });

    assert.equal(engine.characters.p1.baggage.includes(options[0].title), true);
    assert.equal(engine.characters.p1.baggage.includes(options[1].title), false);
    assert.equal(engine.players.p1.specialUsed, true);
    assert.equal(engine.players.p2.specialUsed, true);
    assert.equal(createPublicState(engine).lastSpecial.specialId, 50);
});

test("Подмена цели перенаправляет №56 до показа тайны и закрывает реакцию после обмена", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 56);
    assignSpecial(engine, "p2", 50);

    send(engine, "PLAY_SPECIAL", "p1", { targetId: "p3", trait: "health" });
    send(engine, "PLAY_SPECIAL", "p2", { targetId: "p4", trait: "fact" });

    assert.equal(engine.pendingSecretShare.ownerId, "p1");
    assert.equal(engine.pendingSecretShare.targetId, "p4");
    assert.equal(engine.sharedSecrets, undefined);
    assert.equal(engine.players.p2.specialUsed, true);
    assert.throws(
        () => send(engine, "RESPOND_SECRET_SHARE", "p3", { trait: "biology" }),
        /обмен тайными картами/
    );
    assert.doesNotThrow(() => assertFirebaseSafe(engine));

    send(engine, "RESPOND_SECRET_SHARE", "p4", { trait: "hobby" });

    assert.equal(engine.pendingSecretShare, undefined);
    assert.equal(Object.keys(engine.sharedSecrets.p1).length, 1);
    assert.equal(Object.keys(engine.sharedSecrets.p4).length, 1);
    assert.equal(engine.sharedSecrets.p3, undefined);
    assert.equal(engine.players.p1.specialUsed, true);
    assert.equal(engine.players.p2.specialUsed, true);
    assert.equal(createPublicState(engine).lastSpecial.specialId, 50);

    assignSpecial(engine, "p3", 71);
    assert.throws(
        () => send(engine, "PLAY_SPECIAL", "p3"),
        /только сразу/
    );
});

test("Галя отменяет Подмену цели №56 до раскрытия тайной информации", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 56);
    assignSpecial(engine, "p2", 50);
    assignSpecial(engine, "p3", 71);

    send(engine, "PLAY_SPECIAL", "p1", { targetId: "p3", trait: "health" });
    send(engine, "PLAY_SPECIAL", "p2", { targetId: "p4", trait: "fact" });
    send(engine, "PLAY_SPECIAL", "p3");

    assert.equal(engine.pendingSecretShare.ownerId, "p1");
    assert.equal(engine.pendingSecretShare.targetId, "p3");
    assert.equal(engine.sharedSecrets, undefined);
    assert.throws(
        () => send(engine, "RESPOND_SECRET_SHARE", "p4", { trait: "hobby" }),
        /обмен тайными картами/
    );
    send(engine, "RESPOND_SECRET_SHARE", "p3", { trait: "biology" });

    assert.equal(Object.keys(engine.sharedSecrets.p1).length, 1);
    assert.equal(Object.keys(engine.sharedSecrets.p3).length, 1);
    assert.equal(engine.sharedSecrets.p4, undefined);
    assert.equal(engine.players.p1.specialUsed, true);
    assert.equal(engine.players.p2.specialUsed, false);
    assert.equal(engine.players.p3.specialUsed, false);
});

test("ведущий может отменить зависший двухэтапный обмен", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 56);

    send(engine, "PLAY_SPECIAL", "p1", { targetId: "p2", trait: "health" });
    assert.throws(
        () => send(engine, "CANCEL_PENDING", "p3"),
        /обмен тайными картами/
    );
    send(engine, "CANCEL_PENDING", "host");

    assert.equal(engine.pendingSecretShare, undefined);
    assert.equal(engine.pendingSecretSharePrivate, undefined);
    assert.equal(engine.players.p1.specialUsed, true);
    assert.doesNotThrow(() => send(engine, "SKIP_TURN", "host"));
});

test("Обмен возрастом №44 принимает только открытые биоданные с возрастом", () => {
    const hiddenAge = makeGame(4, 2);
    assignSpecial(hiddenAge, "p1", 44);
    hiddenAge.characters.p2.biology = "Мужчина, 33 года";

    assert.throws(
        () => send(hiddenAge, "PLAY_SPECIAL", "p1", { targetId: "p2" }),
        /открытыми биоданными/
    );

    const revealedAge = makeGame(4, 2);
    assignSpecial(revealedAge, "p1", 44);
    revealedAge.characters.p2.biology = "Мужчина, 34 года";
    revealedAge.players.p2.revealedTraits.biology = "Мужчина, 34 года";
    send(revealedAge, "PLAY_SPECIAL", "p1", { targetId: "p2" });

    assert.equal(revealedAge.characters.p2.biology, "Мужчина, 43 года");
    assert.equal(revealedAge.players.p2.revealedTraits.biology, "Мужчина, 43 года");
});

test("Чума №41 требует другого игрока и заражает обоих", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 41);

    assert.throws(
        () => send(engine, "PLAY_SPECIAL", "p1", { targetId: "p1" }),
        /другого игрока/
    );
    assert.equal(engine.players.p1.specialUsed, false);

    send(engine, "PLAY_SPECIAL", "p1", { targetId: "p2" });

    assert.equal(engine.characters.p1.health, "Чума");
    assert.equal(engine.characters.p2.health, "Чума");
});

test("дополнительные карты багажа и здоровья не остаются невидимыми", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 47);
    beginSecondRound(engine);
    const baggageBefore = engine.characters.p1.baggage;

    send(engine, "PLAY_SPECIAL", "p1");

    assert.match(engine.characters.p1.baggage, /дополнительно:/);
    assert.notEqual(engine.characters.p1.baggage, baggageBefore);
    assert.equal(engine.players.p1.revealedTraits.baggage, engine.characters.p1.baggage);
});

test("Порча добавляет и раскрывает здоровье, а не заменяет исходное", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 65);
    beginSecondRound(engine);
    const healthBefore = engine.characters.p2.health;
    send(engine, "PLAY_SPECIAL", "p1");

    while (engine.phase === PHASES.REVEAL) {
        const playerId = engine.order[engine.currentPlayerIndex];
        const trait = ["biology", "fact", "hobby", "baggage"]
            .find((key) => !engine.players[playerId].revealedTraits[key]);
        send(engine, "REVEAL_TRAIT", playerId, { trait });
        send(engine, "FINISH_TURN", playerId);
    }
    send(engine, "NEXT_PHASE", "host");
    send(engine, "VOTE", "p2", { targetId: "p1" });
    send(engine, "NEXT_PHASE", "host");

    assert.match(engine.characters.p2.health, new RegExp(`^${healthBefore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}; дополнительно:`));
    assert.equal(engine.players.p2.revealedTraits.health, engine.characters.p2.health);
});

test("Сплетни раскрывают выбранную характеристику и дополнительный факт", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 67);
    assert.equal(engine.players.p2.revealedTraits.fact, "");

    send(engine, "PLAY_SPECIAL", "p1", { targetId: "p2", trait: "health" });

    assert.equal(engine.players.p2.revealedTraits.health, engine.characters.p2.health);
    assert.equal(engine.players.p2.revealedTraits.fact, engine.characters.p2.fact);
    assert.match(engine.characters.p2.fact, /дополнительный факт:/);
});

test("Сплетни не раскрывают шестую обычную карту", () => {
    const engine = makeGame(4, 2);
    const ordinaryTraits = TRAIT_KEYS.filter((trait) => trait !== "special");
    assignSpecial(engine, "p1", 67);
    for (const trait of ordinaryTraits.filter((trait) =>
        !["health", "fact"].includes(trait))) {
        engine.players.p2.revealedTraits[trait] = engine.characters.p2[trait];
    }

    assert.throws(
        () => send(engine, "PLAY_SPECIAL", "p1", { targetId: "p2", trait: "health" }),
        /вместе с дополнительным фактом/
    );
    assert.equal(engine.players.p1.specialUsed, false);

    send(engine, "PLAY_SPECIAL", "p1", { targetId: "p2", trait: "fact" });

    assert.equal(engine.players.p2.revealedTraits.fact, engine.characters.p2.fact);
    assert.equal(
        ordinaryTraits.filter((trait) => engine.players.p2.revealedTraits[trait]).length,
        5
    );
    assert.equal(engine.players.p2.revealedTraits.health, "");
});

test("Переселение душ переносит признак использования вместе с особой картой", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 55);
    assignSpecial(engine, "p2", 32);

    send(engine, "PLAY_SPECIAL", "p1", { targetId: "p2" });
    send(engine, "HOST_EDIT", "host", { action: "set_status", playerId: "p1", status: "exiled" });

    assert.equal(engine.characters.p1.specialId, 32);
    assert.equal(engine.players.p1.specialUsed, false);
    assert.equal(engine.characters.p2.specialId, 55);
    assert.equal(engine.players.p2.specialUsed, true);
});

test("Отчаяние и Нумеролог считают людей, а не вес их голосов", () => {
    for (const specialId of [46, 48]) {
        const engine = makeGame(4, 2);
        assignSpecial(engine, "p1", specialId);
        beginSecondRound(engine);
        send(engine, "PLAY_SPECIAL", "p1");
        finishRevealRound(engine);
        send(engine, "NEXT_PHASE", "host");
        engine.players.p2.voteMultiplier = 2;
        send(engine, "VOTE", "p2", { targetId: "p1" });
        send(engine, "VOTE", "p3", { targetId: "p4" });
        send(engine, "NEXT_PHASE", "host");

        assert.equal(engine.voteResult.counts.p1, 2);
    }
});

test("штрафы нескольких карт начала раунда складываются", () => {
    const engine = makeGame(4, 2);
    beginSecondRound(engine);
    assignSpecial(engine, "p1", 59);
    assignSpecial(engine, "p2", 61);

    send(engine, "PLAY_SPECIAL", "p1");
    send(engine, "PLAY_SPECIAL", "p2");
    assert.deepEqual(engine.roundEffects.missingTraitBonuses, ["health", "baggage"]);

    while (engine.phase === PHASES.REVEAL) {
        const playerId = engine.order[engine.currentPlayerIndex];
        const trait = ["biology", "fact", "hobby"]
            .find((key) => !engine.players[playerId].revealedTraits[key]);
        send(engine, "REVEAL_TRAIT", playerId, { trait });
        send(engine, "FINISH_TURN", playerId);
    }
    send(engine, "NEXT_PHASE", "host");
    send(engine, "VOTE", "p4", { targetId: "p3" });
    send(engine, "NEXT_PHASE", "host");

    assert.equal(engine.voteResult.counts.p1, 2);
    assert.equal(engine.voteResult.counts.p3, 3);
});

test("автоматические штрафы не изгоняют игрока с иммунитетом или царя", () => {
    for (const protection of ["immune", "king"]) {
        const engine = makeGame(4, 2);
        engine.phase = PHASES.VOTING;
        engine.round = 2;
        engine.currentPlayerIndex = -1;
        engine.roundEffects.missingTraitBonuses = ["health", "baggage"];
        for (const playerId of ["p2", "p3", "p4"]) {
            engine.players[playerId].revealedTraits.health = engine.characters[playerId].health;
            engine.players[playerId].revealedTraits.baggage = engine.characters[playerId].baggage;
        }
        if (protection === "king") {
            engine.players.p1.bunkerKing = true;
        } else {
            engine.players.p1.immuneThisRound = true;
        }

        send(engine, "VOTE", "p2", { targetId: "p3" });
        send(engine, "NEXT_PHASE", "host");

        assert.equal(engine.players.p1.status, "active");
        assert.equal(engine.players.p3.status, "exiled");
        assert.equal(engine.voteResult.counts.p1, undefined);
        assert.equal(engine.voteResult.exiledPlayerId, "p3");
    }
});

test("автоматические штрафы не добавляют новых кандидатов в переголосование", () => {
    const engine = makeGame(4, 2);
    engine.phase = PHASES.VOTING;
    engine.round = 2;
    engine.currentPlayerIndex = -1;
    engine.voteResult = {
        status: "tie",
        exiledPlayerId: "",
        candidates: ["p2", "p3"],
        counts: { p2: 1, p3: 1 }
    };
    engine.roundEffects.missingTraitBonuses = ["health", "baggage"];
    for (const playerId of ["p2", "p3", "p4"]) {
        engine.players[playerId].revealedTraits.health = engine.characters[playerId].health;
        engine.players[playerId].revealedTraits.baggage = engine.characters[playerId].baggage;
    }

    send(engine, "VOTE", "p2", { targetId: "p3" });
    send(engine, "NEXT_PHASE", "host");

    assert.equal(engine.players.p1.status, "active");
    assert.equal(engine.players.p3.status, "exiled");
    assert.equal(engine.voteResult.counts.p1, undefined);
    assert.equal(engine.voteResult.exiledPlayerId, "p3");
});

test("обычная партия доходит до финального состава бункера", () => {
    const engine = makeGame(4, 2);

    finishRevealRound(engine);
    send(engine, "NEXT_PHASE", "host");
    finishRevealRound(engine);
    send(engine, "NEXT_PHASE", "host");
    for (const id of engine.order) send(engine, "VOTE", id, { targetId: "p4" });
    send(engine, "NEXT_PHASE", "host");
    send(engine, "NEXT_PHASE", "host");

    assert.equal(engine.round, 3);
    assert.equal(engine.phase, PHASES.REVEAL);
    assert.equal(engine.players.p4.status, "exiled");

    finishRevealRound(engine);
    send(engine, "NEXT_PHASE", "host");
    for (const id of ["p1", "p2", "p3", "p4"]) {
        send(engine, "VOTE", id, { targetId: "p3" });
    }
    send(engine, "NEXT_PHASE", "host");
    send(engine, "NEXT_PHASE", "host");

    assert.equal(engine.phase, PHASES.REVEAL);
    assert.equal(engine.round, 4);

    finishRevealRound(engine);
    send(engine, "NEXT_PHASE", "host");
    assert.equal(engine.round, 5);
    assert.equal(engine.phase, PHASES.REVEAL);

    finishRevealRound(engine);
    engine.extraScenarios.threat = [{
        id: "test_threat",
        title: "Дополнительная угроза",
        description: "Финалисты должны пройти ещё одну проверку."
    }];
    send(engine, "NEXT_PHASE", "host");
    assert.equal(engine.phase, PHASES.THREAT);
    assert.equal(engine.threat.status, "revealed");
    assert.equal(engine.threatResolution.status, "pending");
    assert.equal(engine.threatResolution.threatCount, 2);
    assert.deepEqual(
        engine.order.filter((id) => engine.players[id].status === "active"),
        ["p1", "p2"]
    );

    send(engine, "RESOLVE_THREAT", "host", { outcome: "survived" });
    assert.equal(engine.phase, PHASES.FINISHED);
    assert.equal(engine.threatResolution.status, "survived");
});

test("дополнительные раунды отбора не раскрывают шестую обычную карту", () => {
    const engine = makeGame(8, 3);
    const ordinaryTraits = TRAIT_KEYS.filter((trait) => trait !== "special");
    engine.round = 5;
    engine.totalRounds = 6;
    engine.phase = PHASES.RESULTS;
    engine.voteResult = {
        status: "exiled",
        exiledPlayerId: "p5",
        candidates: ["p5"],
        counts: { p5: 4 }
    };
    engine.bunkerRoundsRevealed = Object.fromEntries(
        Array.from({ length: engine.totalRounds }, (_, index) => [index + 1, true])
    );
    for (const playerId of engine.order) {
        const active = ["p1", "p2", "p3", "p4"].includes(playerId);
        engine.players[playerId].status = active ? "active" : "exiled";
        if (!active) continue;
        for (const trait of ordinaryTraits.slice(0, 5)) {
            engine.players[playerId].revealedTraits[trait] = engine.characters[playerId][trait];
        }
    }

    send(engine, "NEXT_PHASE", "host");

    assert.equal(engine.round, 6);
    assert.equal(engine.phase, PHASES.DISCUSSION);
    assert.equal(engine.currentPlayerIndex, -1);
    for (const playerId of ["p1", "p2", "p3", "p4"]) {
        const hidden = ordinaryTraits.filter((trait) =>
            !engine.players[playerId].revealedTraits[trait]);
        assert.equal(hidden.length, 1);
    }

    send(engine, "NEXT_PHASE", "host");
    for (const playerId of ["p1", "p2", "p3", "p4"]) {
        send(engine, "VOTE", playerId, { targetId: "p4" });
    }
    send(engine, "NEXT_PHASE", "host");
    send(engine, "NEXT_PHASE", "host");

    assert.ok([PHASES.THREAT, PHASES.FINISHED].includes(engine.phase));
    assert.deepEqual(
        engine.order.filter((id) => engine.players[id].status === "active"),
        ["p1", "p2", "p3"]
    );
    for (const playerId of ["p1", "p2", "p3"]) {
        assert.equal(
            ordinaryTraits.filter((trait) => !engine.players[playerId].revealedTraits[trait]).length,
            1
        );
    }
});

test("только ведущий может завершить финальную угрозу поражением", () => {
    const engine = makeGame(4, 2);
    engine.phase = PHASES.THREAT;
    engine.threatResolution = {
        status: "pending",
        finalistIds: ["p1", "p2"],
        threatCount: 1
    };

    assert.throws(
        () => send(engine, "RESOLVE_THREAT", "p1", { outcome: "failed" }),
        /определяет ведущий/
    );
    assert.throws(
        () => send(engine, "RESOLVE_THREAT", "host", { outcome: "ничья" }),
        /Неизвестный исход/
    );
    send(engine, "RESOLVE_THREAT", "host", { outcome: "failed" });

    assert.equal(engine.phase, PHASES.FINISHED);
    assert.equal(engine.threatResolution.status, "failed");
    assert.throws(
        () => send(engine, "RESOLVE_THREAT", "host", { outcome: "survived" }),
        /нет активной финальной угрозы/
    );
});

test("неудача против единственной угрозы №36 отнимает багаж, но не убивает финалистов", () => {
    const engine = makeGame(4, 2);
    engine.scenarioSecrets.threat = {
        id: 36,
        title: "Угроза №36",
        description: "Домовой ворует вещи, но не угрожает жизни."
    };
    prepareFinal(engine);
    send(engine, "NEXT_PHASE", "host");

    assert.equal(engine.phase, PHASES.THREAT);
    assert.equal(engine.threat.cardId, 36);
    assert.equal(engine.threatResolution.threatCount, 1);
    assert.equal(engine.threatResolution.lethalThreatCount, 0);
    assert.equal(engine.threatResolution.nonlethalThreatCount, 1);

    send(engine, "RESOLVE_THREAT", "host", { outcome: "failed" });

    assert.equal(engine.phase, PHASES.FINISHED);
    assert.equal(engine.threatResolution.status, "survived");
    assert.equal(engine.threatResolution.nonlethalFailure, true);
    for (const playerId of ["p1", "p2"]) {
        assert.equal(engine.players[playerId].status, "active");
        assert.equal(engine.characters[playerId].baggage, "Багаж потерян из-за домового");
        assert.equal(
            engine.players[playerId].revealedTraits.baggage,
            "Багаж потерян из-за домового"
        );
    }
});

test("в смешанном финале домовой получает отдельный несмертельный исход", () => {
    const engine = makeGame(4, 2);
    engine.extraScenarios.threat = [{
        id: "mixed_house_spirit",
        cardId: 36,
        title: "Угроза №36",
        description: "Домовой ворует вещи"
    }];
    prepareFinal(engine);
    send(engine, "NEXT_PHASE", "host");

    assert.equal(engine.threatResolution.lethalThreatCount, 1);
    assert.equal(engine.threatResolution.nonlethalThreatCount, 1);
    send(engine, "RESOLVE_THREAT", "host", { outcome: "nonlethal_failed" });

    assert.equal(engine.phase, PHASES.FINISHED);
    assert.equal(engine.threatResolution.status, "survived");
    assert.equal(engine.threatResolution.nonlethalFailure, true);
    assert.equal(engine.threatResolution.lethalThreatsResolved, true);
    for (const playerId of engine.threatResolution.finalistIds) {
        assert.equal(engine.players[playerId].status, "active");
        assert.equal(engine.characters[playerId].baggage, "Багаж потерян из-за домового");
    }
});

test("личная угроза учитывается только если отмеченный игрок дошёл до финала", () => {
    const createPersonalThreatGame = (targetSurvives) => {
        const engine = makeGame(4, 2);
        assignSpecial(engine, "p1", 45);
        send(engine, "PLAY_SPECIAL", "p1", { targetId: "p2" });
        engine.players[targetSurvives ? "p3" : "p2"].status = "exiled";
        engine.players.p4.status = "exiled";
        engine.phase = PHASES.DISCUSSION;
        engine.round = engine.totalRounds;
        send(engine, "NEXT_PHASE", "host");
        return engine;
    };

    const activeTarget = createPersonalThreatGame(true);
    const personalThreatId = activeTarget.extraScenarios.threat[0].id;
    assert.equal(activeTarget.threatResolution.threatCount, 2);
    assert.deepEqual(activeTarget.threatResolution.extraThreatIds, [personalThreatId]);

    const exiledTarget = createPersonalThreatGame(false);
    assert.equal(exiledTarget.threatResolution.threatCount, 1);
    assert.deepEqual(exiledTarget.threatResolution.extraThreatIds, []);
});

test("тайная угроза раскрывает содержание только в финале", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 24);
    engine.players.p1.status = "exiled";
    send(engine, "PLAY_SPECIAL", "p1");

    const publicBeforeFinal = createPublicState(engine);
    assert.equal(publicBeforeFinal.extraScenarios.threat[0].title, "Тайная угроза");
    assert.match(publicBeforeFinal.extraScenarios.threat[0].description, /только в финале/);
    assert.equal(engine.extraScenarios.threat[0].title, "Налёт мародёров");

    engine.players.p4.status = "exiled";
    engine.phase = PHASES.DISCUSSION;
    engine.round = engine.totalRounds;
    send(engine, "NEXT_PHASE", "host");

    const publicFinal = createPublicState(engine);
    assert.equal(publicFinal.extraScenarios.threat[0].title, "Налёт мародёров");
    assert.equal(publicFinal.threatResolution.threatCount, 2);
});

test("особые карты №1, №11 и №64 безвозвратно убирают выбранную основную карту бункера", () => {
    for (const specialId of [1, 11, 64]) {
        const engine = makeGame(4, 2);
        const removedTitle = engine.bunker.title;
        assignSpecial(engine, "p1", specialId);

        if (specialId === 64) {
            send(engine, "PLAY_SPECIAL", "p1", { scenarioTarget: "primary:bunker" });
            send(engine, "HOST_EDIT", "host", {
                action: "set_status",
                playerId: "p1",
                status: "exiled"
            });
        } else {
            send(engine, "HOST_EDIT", "host", {
                action: "set_status",
                playerId: "p1",
                status: "exiled"
            });
            send(engine, "PLAY_SPECIAL", "p1", { scenarioTarget: "primary:bunker" });
        }

        assert.equal(engine.bunker.status, "removed", `особая карта №${specialId}`);
        assert.equal(engine.bunker.removedCardTitle, removedTitle, `особая карта №${specialId}`);
        assert.throws(
            () => send(engine, "REVEAL_SCENARIO", "host", { scenarioType: "bunker" }),
            /нельзя раскрыть/
        );
        if (specialId === 1) {
            assert.equal(engine.extraScenarios.exile.length, 1);
            assert.match(engine.extraScenarios.exile[0].title, new RegExp(removedTitle));
        }
    }
});

test("особая карта №3 заменяет карту новым экземпляром и сохраняет номер раунда", () => {
    const engine = makeGame(4, 2);
    const original = { ...engine.bunker };
    assignSpecial(engine, "p1", 3);

    withMathRandom(0, () => send(engine, "PLAY_SPECIAL", "p1", {
        scenarioTarget: "primary:bunker"
    }));

    assert.notEqual(engine.bunker.title, original.title);
    assert.notEqual(engine.bunker.cardId, original.cardId);
    assert.notEqual(engine.bunker.instanceId, original.instanceId);
    assert.equal(engine.bunker.revealedRound, original.revealedRound);
    assert.equal(engine.bunker.status, "revealed");
});

test("особая карта №54 предлагает разные карты и блокирует посторонние команды до выбора", () => {
    const engine = makeGame(4, 2);
    const baggageBefore = engine.characters.p1.baggage;
    assignSpecial(engine, "p1", 54);

    withMathRandom(0, () => send(engine, "PLAY_SPECIAL", "p1"));
    const [first, second] = engine.pendingSpecialChoice.options;

    assert.notEqual(first.title, second.title);
    assert.throws(
        () => send(engine, "HOST_EDIT", "host", {
            action: "set_status",
            playerId: "p1",
            status: "exiled"
        }),
        /завершите ожидающее действие/
    );

    send(engine, "PLAY_SPECIAL", "p1", { choice: first.index });

    assert.equal(engine.pendingSpecialChoice, undefined);
    assert.equal(engine.players.p1.specialUsed, true);
    assert.notEqual(engine.characters.p1.baggage, baggageBefore);
    assert.match(engine.characters.p1.baggage, new RegExp(first.title));
});

test("ведущий может отменить зависший выбор карты №54", () => {
    const engine = makeGame(4, 2);
    const baggageBefore = engine.characters.p1.baggage;
    assignSpecial(engine, "p1", 54);

    send(engine, "PLAY_SPECIAL", "p1");
    send(engine, "CANCEL_PENDING", "host");

    assert.equal(engine.pendingSpecialChoice, undefined);
    assert.equal(engine.pendingSpecialSnapshot, undefined);
    assert.equal(engine.characters.p1.baggage, baggageBefore);
    assert.equal(engine.players.p1.specialUsed, true);
    assert.doesNotThrow(() => send(engine, "SKIP_TURN", "host"));
});

test("особая карта №64 отклоняет устаревшую цель и привязывает саботаж к экземпляру карты", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 64);

    assert.throws(
        () => send(engine, "PLAY_SPECIAL", "p1", {
            scenarioTarget: "extra:bunker:missing"
        }),
        /существующую открытую карту/
    );
    assert.equal(engine.players.p1.specialUsed, false);
    assert.equal(engine.players.p1.sabotageScenarioTarget, undefined);

    const markedInstanceId = engine.bunker.instanceId;
    send(engine, "PLAY_SPECIAL", "p1", { scenarioTarget: "primary:bunker" });
    assert.equal(engine.players.p1.sabotageScenarioInstanceId, markedInstanceId);
    assert.equal(createPublicState(engine).bunkerSabotageTargets[0].instanceId, markedInstanceId);

    assignSpecial(engine, "p2", 3);
    withMathRandom(0, () => send(engine, "PLAY_SPECIAL", "p2", {
        scenarioTarget: "primary:bunker"
    }));
    const replacementInstanceId = engine.bunker.instanceId;
    assert.notEqual(replacementInstanceId, markedInstanceId);

    send(engine, "HOST_EDIT", "host", {
        action: "set_status",
        playerId: "p1",
        status: "exiled"
    });
    assert.equal(engine.bunker.status, "revealed");
    assert.equal(engine.bunker.instanceId, replacementInstanceId);
    assert.deepEqual(createPublicState(engine).bunkerSabotageTargets, []);
});

test("отмена особой карты изгнанного игрока оставляет его новое досье полностью открытым", () => {
    const engine = makeGame(4, 2);
    const originalBunker = { ...engine.bunker };
    assignSpecial(engine, "p1", 1);
    assignSpecial(engine, "p2", 71);
    send(engine, "HOST_EDIT", "host", {
        action: "set_status",
        playerId: "p1",
        status: "exiled"
    });
    send(engine, "PLAY_SPECIAL", "p1", { scenarioTarget: "primary:bunker" });

    withMathRandom(0.2, () => send(engine, "PLAY_SPECIAL", "p2"));

    assert.equal(engine.players.p1.status, "exiled");
    assert.equal(
        TRAIT_KEYS.every((trait) =>
            engine.players.p1.revealedTraits[trait] === engine.characters.p1[trait]),
        true
    );
    assert.equal(engine.bunker.status, "revealed");
    assert.equal(engine.bunker.title, originalBunker.title);
    assert.equal(engine.bunker.instanceId, originalBunker.instanceId);
    assert.equal(engine.extraScenarios.exile?.length ?? 0, 0);
});

test("переход фазы ждёт завершения двухэтапной особой карты", () => {
    const engine = makeGame(4, 2);
    engine.phase = PHASES.DISCUSSION;
    engine.pendingSpecialChoice = {
        type: "bunker_to_baggage",
        playerId: "p1",
        options: []
    };
    assert.throws(
        () => send(engine, "NEXT_PHASE", "host"),
        /завершите ожидающее действие/
    );

    delete engine.pendingSpecialChoice;
    engine.pendingSecretShare = { ownerId: "p1", targetId: "p2" };
    assert.throws(
        () => send(engine, "NEXT_PHASE", "host"),
        /завершите ожидающее действие/
    );
});

test("ожидающий выбор карты №54 можно завершить даже после изгнания владельца", () => {
    const engine = makeGame(4, 2);
    assignSpecial(engine, "p1", 54);
    send(engine, "PLAY_SPECIAL", "p1");
    const choice = engine.pendingSpecialChoice.options[0].index;

    engine.players.p1.status = "exiled";
    engine.phase = PHASES.RESULTS;
    assert.doesNotThrow(() => send(engine, "PLAY_SPECIAL", "p1", { choice }));
    assert.equal(engine.pendingSpecialChoice, undefined);
    assert.equal(engine.players.p1.specialUsed, true);
});

test("после начала финальной угрозы условия и состав нельзя рассинхронизировать", () => {
    const engine = makeGame(4, 2);
    engine.phase = PHASES.THREAT;
    engine.threatResolution = {
        status: "pending",
        finalistIds: ["p1", "p2"],
        threatCount: 1,
        extraThreatIds: []
    };

    assert.throws(
        () => send(engine, "HOST_EDIT", "host", { action: "set_capacity", capacity: 1 }),
        /редактор партии заблокирован/
    );
    assert.throws(
        () => send(engine, "REVEAL_SCENARIO", "host", { scenarioType: "catastrophe" }),
        /карты условий менять нельзя/
    );

    engine.phase = PHASES.FINISHED;
    engine.threatResolution.status = "survived";
    assert.throws(
        () => send(engine, "HOST_EDIT", "host", { action: "set_status", playerId: "p1", status: "exiled" }),
        /редактор партии заблокирован/
    );
});

test("после изгнания раскрывается всё досье игрока", () => {
    const engine = makeGame(4, 2);
    finishRevealRound(engine);
    send(engine, "NEXT_PHASE", "host");
    finishRevealRound(engine);
    send(engine, "NEXT_PHASE", "host");
    for (const id of engine.order) send(engine, "VOTE", id, { targetId: "p4" });
    send(engine, "NEXT_PHASE", "host");

    assert.equal(engine.players.p4.status, "exiled");
    assert.equal(TRAIT_KEYS.every((trait) =>
        engine.players.p4.revealedTraits[trait] === engine.characters.p4[trait]), true);
});

test("при возвращении игрока восстанавливается число карт до изгнания", () => {
    const engine = makeGame(4, 2);
    finishRevealRound(engine);
    const revealedBefore = TRAIT_KEYS.filter((trait) => engine.players.p1.revealedTraits[trait]);

    send(engine, "HOST_EDIT", "host", { action: "set_status", playerId: "p1", status: "exiled" });
    assert.equal(TRAIT_KEYS.every((trait) => engine.players.p1.revealedTraits[trait]), true);

    send(engine, "HOST_EDIT", "host", { action: "set_status", playerId: "p1", status: "active" });
    assert.deepEqual(
        TRAIT_KEYS.filter((trait) => engine.players.p1.revealedTraits[trait]),
        revealedBefore
    );
});

test("Второй шанс в результатах догоняет раскрытие до текущего раунда", () => {
    const engine = makeGame(4, 2);
    const ordinaryTraits = TRAIT_KEYS.filter((trait) => trait !== "special");
    const returnedPlayer = engine.players.p4;
    engine.round = 4;
    engine.totalRounds = 5;
    engine.phase = PHASES.RESULTS;
    engine.currentPlayerIndex = -1;
    engine.bunkerRoundsRevealed = { 1: true, 2: true, 3: true, 4: true, 5: true };
    engine.players.p3.status = "exiled";
    returnedPlayer.status = "exiled";
    returnedPlayer.secondChance = true;
    returnedPlayer.hasFinishedTurn = true;
    returnedPlayer.revealedBeforeExile = ordinaryTraits.slice(0, 2);
    for (const trait of TRAIT_KEYS) {
        returnedPlayer.revealedTraits[trait] = engine.characters.p4[trait];
    }
    engine.voteResult = {
        status: "exiled",
        exiledPlayerId: "p3",
        candidates: ["p3"],
        counts: { p3: 3 }
    };

    send(engine, "NEXT_PHASE", "host");

    assert.equal(engine.round, 5);
    assert.equal(engine.phase, PHASES.REVEAL);
    assert.equal(returnedPlayer.status, "active");
    assert.equal(
        ordinaryTraits.filter((trait) => returnedPlayer.revealedTraits[trait]).length,
        4
    );
    assert.equal(returnedPlayer.hasFinishedTurn, false);
    assert.equal(returnedPlayer.revealedThisTurn, false);
});

test("Второй шанс возвращает игрока после внеочередного изгнания без обычного голосования", () => {
    const engine = makeGame(6, 4);
    engine.round = 5;
    engine.totalRounds = 5;
    engine.phase = PHASES.DISCUSSION;
    engine.currentPlayerIndex = -1;
    engine.bunkerRoundsRevealed = { 1: true, 2: true, 3: true, 4: true, 5: true };
    engine.players.p5.status = "exiled";
    engine.players.p6.status = "exiled";
    engine.players.p6.secondChance = true;
    engine.players.p6.revealedBeforeExile = ["profession", "health"];

    send(engine, "NEXT_PHASE", "host");

    assert.equal(engine.players.p6.status, "active");
    assert.equal(engine.players.p6.secondChance, false);
    assert.equal(engine.round, 6);
    assert.equal(engine.totalRounds, 6);
    assert.equal(engine.phase, PHASES.DISCUSSION);
});

test("Второй шанс срабатывает после внеочередного изгнания уже в первом раунде", () => {
    const engine = makeGame(6, 3);
    engine.phase = PHASES.DISCUSSION;
    engine.currentPlayerIndex = -1;
    engine.players.p6.status = "exiled";
    engine.players.p6.secondChance = true;
    engine.players.p6.revealedBeforeExile = [];

    send(engine, "NEXT_PHASE", "host");

    assert.equal(engine.players.p6.status, "active");
    assert.equal(engine.players.p6.secondChance, false);
    assert.equal(engine.round, 2);
    assert.equal(engine.phase, PHASES.REVEAL);
});

test("колода особых карт содержит непрерывные номера от 1 до 71", () => {
    assert.deepEqual(
        SPECIAL_CARDS.map((card) => card.id),
        Array.from({ length: 71 }, (_, index) => index + 1)
    );
});

test("состояния движка безопасны для Firebase", () => {
    const engine = makeGame();
    assert.doesNotThrow(() => assertFirebaseSafe(engine));
    assert.doesNotThrow(() => assertFirebaseSafe(createPublicState(engine)));
    assert.doesNotThrow(() => assertFirebaseSafe(createPrivateStates(engine)));
});
