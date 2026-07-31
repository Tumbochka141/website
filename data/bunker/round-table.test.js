import test from "node:test";
import assert from "node:assert/strict";

import {
    PHASES,
    TRAIT_KEYS,
    applyCommand,
    createInitialGame,
    createPublicState,
    getOfficialBunkerCapacity,
    getRoundVoteSchedule
} from "./engine.js";
import { SPECIAL_CARDS } from "./cards.js";

const OFFICIAL_ROUND_VOTES = {
    4: [0, 0, 0, 1, 1],
    5: [0, 0, 1, 1, 1],
    6: [0, 0, 1, 1, 1],
    7: [0, 1, 1, 1, 1],
    8: [0, 1, 1, 1, 1],
    9: [0, 1, 1, 1, 2],
    10: [0, 1, 1, 1, 2],
    11: [0, 1, 1, 2, 2],
    12: [0, 1, 1, 2, 2],
    13: [0, 1, 2, 2, 2],
    14: [0, 1, 2, 2, 2],
    15: [0, 2, 2, 2, 2],
    16: [0, 2, 2, 2, 2]
};

function scheduleFrom(values) {
    return Object.fromEntries(values.map((votes, index) => [index + 1, votes]));
}

function makePlayers(count) {
    return Array.from({ length: count }, (_, index) => [
        `p${index + 1}`,
        { name: `Игрок ${index + 1}` }
    ]);
}

function makeGame(count, capacity = getOfficialBunkerCapacity(count)) {
    return createInitialGame(makePlayers(count), capacity, () => 0.37);
}

function send(engine, type, from = "host", data = {}) {
    return applyCommand(engine, { type, from, data }, "host");
}

function activePlayerIds(engine) {
    return engine.order.filter((id) => engine.players[id]?.status === "active");
}

function finishRevealRound(engine) {
    let guard = engine.order.length + 1;
    while (engine.phase === PHASES.REVEAL && guard > 0) {
        guard -= 1;
        const playerId = engine.order[engine.currentPlayerIndex];
        const ordinaryTraits = TRAIT_KEYS.filter((trait) => trait !== "special");
        const revealedCount = ordinaryTraits.filter(
            (trait) => engine.players[playerId].revealedTraits[trait]
        ).length;
        const trait = revealedCount < ordinaryTraits.length - 1
            ? ordinaryTraits.find((key) => !engine.players[playerId].revealedTraits[key])
            : "";
        if (trait) send(engine, "REVEAL_TRAIT", playerId, { trait });
        send(engine, "FINISH_TURN", playerId);
    }
    assert.notEqual(guard, 0, "раунд раскрытия должен завершиться");
    assert.equal(engine.phase, PHASES.DISCUSSION);
}

function castDecisiveVote(engine, targetId, voterId = "") {
    assert.equal(engine.phase, PHASES.VOTING);
    const voter = voterId || activePlayerIds(engine).find((id) => id !== targetId) || targetId;
    send(engine, "VOTE", voter, { targetId });
    send(engine, "NEXT_PHASE");
    assert.equal(engine.phase, PHASES.RESULTS);
    assert.equal(engine.voteResult.status, "exiled");
    assert.equal(engine.voteResult.exiledPlayerId, targetId);
}

function assignSpecial(engine, playerId, specialId) {
    const special = SPECIAL_CARDS.find((card) => card.id === specialId);
    assert.ok(special, `особая карта №${specialId} должна существовать`);
    engine.characters[playerId].specialId = special.id;
    engine.characters[playerId].special = special.text;
    engine.players[playerId].revealedTraits.special = "";
    engine.players[playerId].specialUsed = false;
}

function finishCurrentRound(engine, protectedIds = new Set()) {
    const round = engine.round;
    finishRevealRound(engine);
    const targetVotes = Number(engine.voteSchedule?.[round] ?? 0);
    send(engine, "NEXT_PHASE");

    if (!targetVotes) return;
    assert.equal(engine.phase, PHASES.VOTING);
    for (let voteIndex = 0; voteIndex < targetVotes; voteIndex += 1) {
        const candidates = activePlayerIds(engine).filter((id) => !protectedIds.has(id));
        const targetId = candidates.at(-1);
        assert.ok(targetId, `в раунде ${round} должен остаться кандидат на изгнание`);
        castDecisiveVote(engine, targetId);
        assert.equal(Number(engine.completedVotesByRound?.[round] ?? 0), voteIndex + 1);
        send(engine, "NEXT_PHASE");
        if (voteIndex + 1 < targetVotes) {
            assert.equal(engine.round, round);
            assert.equal(engine.phase, PHASES.DISCUSSION);
            send(engine, "NEXT_PHASE");
            assert.equal(engine.phase, PHASES.VOTING);
        }
    }
}

test("официальная таблица задаёт вместимость и голоса для 4–16 игроков", () => {
    for (const [countText, values] of Object.entries(OFFICIAL_ROUND_VOTES)) {
        const count = Number(countText);
        const expectedSchedule = scheduleFrom(values);
        const capacity = Math.floor(count / 2);

        assert.equal(getOfficialBunkerCapacity(count), capacity, `${count} игроков: вместимость`);
        assert.deepEqual(getRoundVoteSchedule(count), expectedSchedule, `${count} игроков: расписание`);

        const engine = makeGame(count);
        assert.equal(engine.capacity, capacity);
        assert.equal(engine.totalRounds, 5);
        assert.deepEqual(engine.voteSchedule, expectedSchedule);
        assert.equal(typeof engine.completedVotesByRound, "object");
        for (let round = 1; round <= 5; round += 1) {
            assert.equal(Number(engine.completedVotesByRound?.[round] ?? 0), 0);
        }

        const publicState = createPublicState(engine);
        assert.equal(publicState.roundVoteTarget, expectedSchedule[1]);
        assert.equal(publicState.roundVotesCompleted, 0);
    }

    assert.deepEqual(
        getRoundVoteSchedule(8, 3),
        scheduleFrom([0, 1, 1, 1, 2]),
        "уменьшенная вместимость добавляет позднее голосование"
    );
    assert.deepEqual(
        getRoundVoteSchedule(8, 5),
        scheduleFrom([0, 0, 1, 1, 1]),
        "увеличенная вместимость убирает ранние голосования"
    );
});

test("старое сохранение мигрирует с длинной схемы на оставшуюся часть пяти раундов", () => {
    const engine = makeGame(9);
    engine.round = 3;
    engine.totalRounds = 7;
    engine.phase = PHASES.DISCUSSION;
    engine.currentPlayerIndex = -1;
    engine.players.p9.status = "exiled";
    delete engine.initialPlayerCount;
    delete engine.voteSchedule;
    delete engine.completedVotesByRound;

    send(engine, "HOST_EDIT", "host", { action: "set_capacity", capacity: 4 });

    assert.equal(engine.initialPlayerCount, 9);
    assert.equal(engine.totalRounds, 5);
    assert.deepEqual(engine.voteSchedule, scheduleFrom(OFFICIAL_ROUND_VOTES[9]));
    assert.equal(engine.completedVotesByRound[2], 1);
    assert.equal(engine.completedVotesByRound[3] ?? 0, 0);
});

test("стандартная партия для каждого состава заканчивает пятый раунд официальным числом финалистов", () => {
    for (const countText of Object.keys(OFFICIAL_ROUND_VOTES)) {
        const count = Number(countText);
        const engine = makeGame(count);

        while (engine.round <= 5 && ![PHASES.THREAT, PHASES.FINISHED].includes(engine.phase)) {
            const currentRound = engine.round;
            finishCurrentRound(engine);
            if (currentRound < 5) {
                assert.equal(engine.round, currentRound + 1, `${count} игроков: переход после раунда ${currentRound}`);
            }
        }

        assert.equal(engine.round, 5, `${count} игроков: партия не создаёт шестой раунд`);
        assert.equal(engine.totalRounds, 5, `${count} игроков: всего пять раундов`);
        assert.equal(
            activePlayerIds(engine).length,
            getOfficialBunkerCapacity(count),
            `${count} игроков: правильный финальный состав`
        );
        assert.ok(
            [PHASES.THREAT, PHASES.FINISHED].includes(engine.phase),
            `${count} игроков: после отбора начинается финал`
        );
    }
});

test("два успешных голосования проходят в одном раунде и имеют публичный прогресс", () => {
    const engine = makeGame(15);
    finishCurrentRound(engine);
    assert.equal(engine.round, 2);

    finishRevealRound(engine);
    send(engine, "NEXT_PHASE");
    assert.equal(engine.phase, PHASES.VOTING);
    assert.equal(createPublicState(engine).roundVoteTarget, 2);
    assert.equal(createPublicState(engine).roundVotesCompleted, 0);

    castDecisiveVote(engine, "p15");
    assert.equal(createPublicState(engine).roundVotesCompleted, 1);
    send(engine, "NEXT_PHASE");
    assert.equal(engine.round, 2);
    assert.equal(engine.phase, PHASES.DISCUSSION);
    send(engine, "NEXT_PHASE");
    assert.equal(engine.round, 2);
    assert.equal(engine.phase, PHASES.VOTING);

    castDecisiveVote(engine, "p14");
    assert.equal(createPublicState(engine).roundVotesCompleted, 2);
    send(engine, "NEXT_PHASE");
    assert.equal(engine.round, 3);
    assert.equal(engine.phase, PHASES.REVEAL);
});

test("запоздавший голос из предыдущего голосования не попадает в следующее", () => {
    const engine = makeGame(15);
    finishCurrentRound(engine);
    finishRevealRound(engine);
    send(engine, "NEXT_PHASE");

    const firstVoteCycle = createPublicState(engine).voteCycle;
    castDecisiveVote(engine, "p15");
    send(engine, "NEXT_PHASE");
    send(engine, "NEXT_PHASE");

    const secondVoteCycle = createPublicState(engine).voteCycle;
    assert.notEqual(secondVoteCycle, firstVoteCycle);
    assert.throws(
        () => send(engine, "VOTE", "p1", { targetId: "p14", voteCycle: firstVoteCycle }),
        /голосование уже сменилось/i
    );
    assert.equal(engine.players.p1.voteSubmitted, false);

    send(engine, "VOTE", "p1", { targetId: "p14", voteCycle: secondVoteCycle });
    assert.equal(engine.players.p1.voteSubmitted, true);
});

test("повторная команда ведущего не перескакивает через подготовку второго голосования", () => {
    const engine = makeGame(15);
    finishCurrentRound(engine);
    finishRevealRound(engine);
    send(engine, "NEXT_PHASE");
    castDecisiveVote(engine, "p15");

    const revision = engine.revision;
    const command = { type: "NEXT_PHASE", from: "host", data: {}, revision };
    applyCommand(engine, command, "host");
    assert.equal(engine.phase, PHASES.DISCUSSION);
    assert.throws(() => applyCommand(engine, command, "host"), /команда устарела/i);
    assert.equal(engine.phase, PHASES.DISCUSSION);
    assert.equal(engine.round, 2);
});

test("ничья запускает переголосование и не расходует квоту раунда", () => {
    const engine = makeGame(15);
    finishCurrentRound(engine);
    finishRevealRound(engine);
    send(engine, "NEXT_PHASE");

    send(engine, "VOTE", "p1", { targetId: "p14" });
    send(engine, "VOTE", "p2", { targetId: "p15" });
    send(engine, "NEXT_PHASE");

    assert.equal(engine.phase, PHASES.RESULTS);
    assert.equal(engine.voteResult.status, "tie");
    assert.equal(Number(engine.completedVotesByRound?.[2] ?? 0), 0);
    assert.equal(createPublicState(engine).roundVotesCompleted, 0);

    send(engine, "NEXT_PHASE");
    assert.equal(engine.phase, PHASES.VOTING);
    send(engine, "VOTE", "p1", { targetId: "p14" });
    send(engine, "NEXT_PHASE");

    assert.equal(engine.voteResult.status, "exiled");
    assert.equal(Number(engine.completedVotesByRound?.[2] ?? 0), 1);
    send(engine, "NEXT_PHASE");
    assert.equal(engine.round, 2);
    assert.equal(engine.phase, PHASES.DISCUSSION);
    send(engine, "NEXT_PHASE");
    assert.equal(engine.phase, PHASES.VOTING, "после переголосования остаётся второе плановое голосование");
});

test("Второй шанс не возвращает изгнанного между двумя голосованиями одного раунда", () => {
    const engine = makeGame(15);
    assignSpecial(engine, "p15", 40);
    send(engine, "PLAY_SPECIAL", "p15");
    assert.equal(engine.players.p15.secondChance, true);

    finishCurrentRound(engine);
    finishRevealRound(engine);
    send(engine, "NEXT_PHASE");
    castDecisiveVote(engine, "p15");

    send(engine, "NEXT_PHASE");
    assert.equal(engine.round, 2);
    assert.equal(engine.phase, PHASES.DISCUSSION);
    assert.equal(engine.players.p15.status, "exiled");
    assert.equal(engine.players.p15.secondChance, true);

    send(engine, "NEXT_PHASE");
    assert.equal(engine.phase, PHASES.VOTING);
    castDecisiveVote(engine, "p14");
    send(engine, "NEXT_PHASE");
    assert.equal(engine.round, 3);
    assert.equal(engine.players.p15.status, "active", "возврат происходит только на границе раундов");
    assert.equal(engine.players.p15.secondChance, false);
});

test("эффект одного голосования сбрасывается, а эффект всего раунда сохраняется перед вторым голосованием", () => {
    const engine = makeGame(15);
    finishCurrentRound(engine);
    finishRevealRound(engine);
    assignSpecial(engine, "p1", 4);
    assignSpecial(engine, "p2", 70);

    send(engine, "PLAY_SPECIAL", "p1");
    send(engine, "PLAY_SPECIAL", "p2");
    assert.equal(engine.players.p1.voteMultiplier, 2, "Громкий голос действует на первое голосование");
    assert.equal(engine.players.p2.immuneThisRound, true, "Иммунитет включён на весь раунд");

    send(engine, "NEXT_PHASE");
    castDecisiveVote(engine, "p15", "p3");
    send(engine, "NEXT_PHASE");

    assert.equal(engine.round, 2);
    assert.equal(engine.phase, PHASES.DISCUSSION);
    assert.equal(engine.players.p1.voteMultiplier, 1, "одноразовый множитель сброшен перед вторым голосованием");
    assert.equal(engine.players.p2.immuneThisRound, true, "раундовый иммунитет переживает границу голосований");

    send(engine, "NEXT_PHASE");
    assert.equal(engine.phase, PHASES.VOTING);
    assert.equal(engine.players.p1.voteMultiplier, 1);
    assert.equal(engine.players.p2.immuneThisRound, true);
    castDecisiveVote(engine, "p14", "p3");
    send(engine, "NEXT_PHASE");

    assert.equal(engine.round, 3);
    assert.equal(engine.players.p2.immuneThisRound, false, "раундовый иммунитет сброшен только в новом раунде");
});

test("План Б откатывает прогресс первого голосования и повторный результат снова даёт один из двух", () => {
    const engine = makeGame(15);
    finishCurrentRound(engine);
    finishRevealRound(engine);
    assignSpecial(engine, "p1", 28);
    send(engine, "NEXT_PHASE");

    castDecisiveVote(engine, "p15", "p2");
    assert.equal(Number(engine.completedVotesByRound?.[2] ?? 0), 1);
    assert.equal(createPublicState(engine).roundVotesCompleted, 1);
    assert.equal(engine.players.p15.status, "exiled");

    send(engine, "PLAY_SPECIAL", "p1");
    assert.equal(engine.phase, PHASES.VOTING);
    assert.equal(engine.players.p15.status, "active");
    assert.equal(Number(engine.completedVotesByRound?.[2] ?? 0), 0);
    assert.equal(createPublicState(engine).roundVoteTarget, 2);
    assert.equal(createPublicState(engine).roundVotesCompleted, 0);

    castDecisiveVote(engine, "p15", "p3");
    assert.equal(Number(engine.completedVotesByRound?.[2] ?? 0), 1);
    assert.equal(createPublicState(engine).roundVotesCompleted, 1);

    send(engine, "NEXT_PHASE");
    assert.equal(engine.round, 2);
    assert.equal(engine.phase, PHASES.DISCUSSION);
});

test("Последняя диверсия в пятом раунде добавляет голосование без шестого раунда", () => {
    const engine = makeGame(8);
    assignSpecial(engine, "p8", 30);

    for (let round = 1; round <= 4; round += 1) {
        finishCurrentRound(engine, new Set(["p8"]));
    }
    assert.equal(engine.round, 5);
    assert.equal(activePlayerIds(engine).length, 5);

    finishRevealRound(engine);
    send(engine, "NEXT_PHASE");
    castDecisiveVote(engine, "p8");
    assert.equal(Number(engine.completedVotesByRound?.[5] ?? 0), 1);

    send(engine, "PLAY_SPECIAL", "p8");
    assert.equal(engine.capacity, 3);
    assert.equal(engine.totalRounds, 5);
    assert.equal(createPublicState(engine).roundVoteTarget, 2);
    assert.equal(createPublicState(engine).roundVotesCompleted, 1);

    send(engine, "NEXT_PHASE");
    assert.equal(engine.round, 5);
    assert.equal(engine.phase, PHASES.DISCUSSION);
    send(engine, "NEXT_PHASE");
    assert.equal(engine.phase, PHASES.VOTING);
    castDecisiveVote(engine, activePlayerIds(engine).at(-1));
    assert.equal(Number(engine.completedVotesByRound?.[5] ?? 0), 2);

    send(engine, "NEXT_PHASE");
    assert.equal(engine.round, 5);
    assert.equal(engine.totalRounds, 5);
    assert.equal(activePlayerIds(engine).length, 3);
    assert.ok([PHASES.THREAT, PHASES.FINISHED].includes(engine.phase));
});
