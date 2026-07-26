import test from "node:test";
import assert from "node:assert/strict";
import {
    PHASES,
    TRAIT_KEYS,
    applyCommand,
    assertFirebaseSafe,
    createInitialGame,
    createPrivateStates,
    createPublicState
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

function send(engine, type, from, data = {}, hostId = "host") {
    return applyCommand(engine, { type, from, data }, hostId);
}

function finishRevealRound(engine) {
    while (engine.phase === PHASES.REVEAL) {
        const playerId = engine.order[engine.currentPlayerIndex];
        const trait = TRAIT_KEYS.find((key) => !engine.players[playerId].revealedTraits[key]);
        if (trait) send(engine, "REVEAL_TRAIT", playerId, { trait });
        send(engine, "FINISH_TURN", playerId);
    }
}

test("партия начинается с открытой карты бункера и верным числом раундов", () => {
    const engine = makeGame(8, 4);
    assert.equal(engine.phase, PHASES.REVEAL);
    assert.equal(engine.round, 1);
    assert.equal(engine.totalRounds, 5);
    assert.equal(engine.bunker.status, "revealed");
    assert.equal(engine.bunker.revealedRound, 1);
    assert.equal(engine.extraScenarios.bunker.length, 0);
});

test("первый раунд завершается без голосования и открывает новую карту бункера", () => {
    const engine = makeGame();
    finishRevealRound(engine);
    assert.equal(engine.phase, PHASES.DISCUSSION);

    send(engine, "NEXT_PHASE", "host");
    assert.equal(engine.phase, PHASES.REVEAL);
    assert.equal(engine.round, 2);
    assert.equal(engine.extraScenarios.bunker.length, 1);
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

    assert.equal(engine.phase, PHASES.FINISHED);
    assert.deepEqual(
        engine.order.filter((id) => engine.players[id].status === "active"),
        ["p1", "p2"]
    );
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
