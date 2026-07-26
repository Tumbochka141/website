import test from "node:test";
import assert from "node:assert/strict";
import {
    PHASES,
    ROLES,
    applyCommand,
    assertFirebaseSafe,
    createInitialGame,
    createPrivateStates,
    createPublicState,
    getRoleLineup
} from "./engine.js";

function makeGame(roleMap) {
    const players = Object.keys(roleMap).map((id) => [id, { name: id.toUpperCase() }]);
    const engine = createInitialGame(players, {
        includeDetective: false,
        includeDoctor: false,
        includeEscort: false,
        includeManiac: false,
        includeJester: false
    }, () => 0.42);
    engine.roles = { ...roleMap };
    return engine;
}

function send(engine, type, from, data = {}, hostId = "host") {
    return applyCommand(engine, { type, from, data }, hostId);
}

test("расширенный состав для десяти игроков содержит все семь ролей", () => {
    const lineup = getRoleLineup(10);
    assert.equal(lineup[ROLES.MAFIA], 2);
    assert.equal(lineup[ROLES.DETECTIVE], 1);
    assert.equal(lineup[ROLES.DOCTOR], 1);
    assert.equal(lineup[ROLES.ESCORT], 1);
    assert.equal(lineup[ROLES.MANIAC], 1);
    assert.equal(lineup[ROLES.JESTER], 1);
    assert.equal(lineup[ROLES.CITIZEN], 3);
});

test("доктор спасает цель мафии, а путана блокирует маньяка", () => {
    const engine = makeGame({
        host: ROLES.MAFIA,
        doctor: ROLES.DOCTOR,
        police: ROLES.DETECTIVE,
        escort: ROLES.ESCORT,
        maniac: ROLES.MANIAC,
        jester: ROLES.JESTER,
        citizen: ROLES.CITIZEN
    });
    send(engine, "MAFIA_VOTE", "host", { targetId: "citizen" });
    send(engine, "DOCTOR_HEAL", "doctor", { targetId: "citizen" });
    send(engine, "DETECTIVE_CHECK", "police", { targetId: "host" });
    send(engine, "ESCORT_BLOCK", "escort", { targetId: "maniac" });
    send(engine, "MANIAC_KILL", "maniac", { targetId: "doctor" });

    const beforeDay = createPublicState(engine);
    assert.equal(beforeDay.nightActionsSubmitted, 5);
    assert.equal(beforeDay.nightActionsRequired, 5);

    send(engine, "START_DAY", "host");
    assert.deepEqual(engine.lastNight.killedPlayerIds, []);
    assert.equal(engine.lastNight.someoneWasSaved, true);
    assert.equal(createPrivateStates(engine).police.checks.host, true);
});

test("заблокированный полицейский не получает результат проверки", () => {
    const engine = makeGame({
        host: ROLES.MAFIA,
        police: ROLES.DETECTIVE,
        escort: ROLES.ESCORT,
        citizen: ROLES.CITIZEN
    });
    send(engine, "MAFIA_VOTE", "host", { targetId: "citizen" });
    send(engine, "DETECTIVE_CHECK", "police", { targetId: "host" });
    send(engine, "ESCORT_BLOCK", "escort", { targetId: "police" });
    send(engine, "START_DAY", "host");
    assert.deepEqual(createPrivateStates(engine).police.checks, {});
});

test("самоубийца побеждает при дневной казни", () => {
    const engine = makeGame({
        host: ROLES.MAFIA,
        jester: ROLES.JESTER,
        citizen1: ROLES.CITIZEN,
        citizen2: ROLES.CITIZEN
    });
    send(engine, "MAFIA_VOTE", "host", { targetId: "citizen2" });
    send(engine, "START_DAY", "host");
    send(engine, "START_VOTING", "host");
    send(engine, "VOTE", "host", { targetId: "jester" });
    send(engine, "VOTE", "jester", { targetId: "host" });
    send(engine, "VOTE", "citizen1", { targetId: "jester" });
    send(engine, "FINISH_VOTING", "host");
    assert.equal(engine.phase, PHASES.FINISHED);
    assert.equal(engine.winner, "jester");
});

test("ночная смерть не приносит самоубийце победу", () => {
    const engine = makeGame({
        host: ROLES.MAFIA,
        jester: ROLES.JESTER,
        citizen1: ROLES.CITIZEN,
        citizen2: ROLES.CITIZEN
    });
    send(engine, "MAFIA_VOTE", "host", { targetId: "jester" });
    send(engine, "START_DAY", "host");
    assert.equal(engine.winner, null);
    assert.equal(engine.players.jester.alive, false);
});

test("город побеждает после изгнания последнего мафиози", () => {
    const engine = makeGame({
        host: ROLES.CITIZEN,
        mafia: ROLES.MAFIA,
        citizen1: ROLES.CITIZEN,
        citizen2: ROLES.CITIZEN
    });
    send(engine, "MAFIA_VOTE", "mafia", { targetId: "citizen2" }, "host");
    send(engine, "START_DAY", "host");
    send(engine, "START_VOTING", "host");
    send(engine, "VOTE", "host", { targetId: "mafia" });
    send(engine, "VOTE", "mafia", { targetId: "host" });
    send(engine, "VOTE", "citizen1", { targetId: "mafia" });
    send(engine, "FINISH_VOTING", "host");
    assert.equal(engine.winner, "city");
});

test("мафия побеждает при численном паритете", () => {
    const engine = makeGame({
        host: ROLES.MAFIA,
        citizen1: ROLES.CITIZEN,
        citizen2: ROLES.CITIZEN,
        citizen3: ROLES.CITIZEN
    });
    engine.players.citizen3.alive = false;
    send(engine, "MAFIA_VOTE", "host", { targetId: "citizen2" });
    send(engine, "START_DAY", "host");
    assert.equal(engine.winner, "mafia");
});

test("маньяк побеждает, оставшись единственным выжившим", () => {
    const engine = makeGame({
        host: ROLES.MANIAC,
        citizen1: ROLES.CITIZEN,
        citizen2: ROLES.CITIZEN,
        citizen3: ROLES.CITIZEN
    });
    engine.players.citizen2.alive = false;
    engine.players.citizen3.alive = false;
    send(engine, "MANIAC_KILL", "host", { targetId: "citizen1" });
    send(engine, "START_DAY", "host");
    assert.equal(engine.winner, "maniac");
});

test("голосование с ничьёй никого не исключает", () => {
    const engine = makeGame({
        host: ROLES.MAFIA,
        citizen1: ROLES.CITIZEN,
        citizen2: ROLES.CITIZEN,
        citizen3: ROLES.CITIZEN
    });
    send(engine, "MAFIA_VOTE", "host", { targetId: "citizen3" });
    send(engine, "START_DAY", "host");
    send(engine, "START_VOTING", "host");
    send(engine, "VOTE", "host", { targetId: "citizen1" });
    send(engine, "VOTE", "citizen1", { targetId: "citizen2" });
    send(engine, "VOTE", "citizen2", { targetId: "host" });
    send(engine, "FINISH_VOTING", "host");
    assert.equal(engine.lastVote.tie, true);
    assert.equal(engine.phase, PHASES.VERDICT);
});

test("публичное и личное состояние безопасны для Firebase", () => {
    const engine = makeGame({
        host: ROLES.MAFIA,
        police: ROLES.DETECTIVE,
        citizen1: ROLES.CITIZEN,
        citizen2: ROLES.CITIZEN
    });
    assert.doesNotThrow(() => assertFirebaseSafe(engine));
    assert.doesNotThrow(() => assertFirebaseSafe(createPublicState(engine)));
    assert.doesNotThrow(() => assertFirebaseSafe(createPrivateStates(engine)));
});
