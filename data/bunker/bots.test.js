import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, createInitialGame, PHASES, TRAIT_KEYS } from "./engine.js";
import { SPECIAL_CARDS } from "./cards.js";
import {
    fillWithDeveloperBots,
    getDeveloperBotCommands,
    isDeveloperBot
} from "./bots.js";

function giveBotSpecial(engine, playerId, specialId) {
    const special = SPECIAL_CARDS.find((card) => card.id === specialId);
    engine.characters[playerId].specialId = special.id;
    engine.characters[playerId].special = special.text;
    engine.players[playerId].specialUsed = false;
}

test("режим разработчика заполняет только свободные места", () => {
    const players = [["human", { name: "Человек" }]];
    const filled = fillWithDeveloperBots(players, 4);

    assert.equal(filled.length, 4);
    assert.equal(filled[0][0], "human");
    assert.equal(filled.filter(([id]) => isDeveloperBot(id)).length, 3);
});

test("бот раскрывает карту и завершает свой ход", () => {
    const players = fillWithDeveloperBots([], 3);
    const engine = createInitialGame(players, 1, () => 0.25);
    for (const player of Object.values(engine.players)) player.specialUsed = true;
    const commands = getDeveloperBotCommands(engine, () => 0);

    assert.deepEqual(commands.map(({ type }) => type), ["REVEAL_TRAIT", "FINISH_TURN"]);
    for (const command of commands) applyCommand(engine, command, "host");
    assert.equal(engine.players.dev_bot_1.hasFinishedTurn, true);
    assert.equal(engine.order[engine.currentPlayerIndex], "dev_bot_2");
});

test("бот оставляет последнюю обычную карту скрытой и завершает ход", () => {
    const players = fillWithDeveloperBots([], 3);
    const engine = createInitialGame(players, 1, () => 0.25);
    for (const player of Object.values(engine.players)) player.specialUsed = true;
    const playerId = engine.order[engine.currentPlayerIndex];
    const ordinaryTraits = TRAIT_KEYS.filter((trait) => trait !== "special");
    for (const trait of ordinaryTraits.slice(0, -1)) {
        engine.players[playerId].revealedTraits[trait] = engine.characters[playerId][trait];
    }

    const commands = getDeveloperBotCommands(engine, () => 0);

    assert.deepEqual(commands.map(({ type }) => type), ["FINISH_TURN"]);
    for (const command of commands) applyCommand(engine, command, "host");
    assert.equal(
        ordinaryTraits.filter((trait) => !engine.players[playerId].revealedTraits[trait]).length,
        1
    );
});

test("боты автоматически голосуют за допустимых активных игроков", () => {
    const players = fillWithDeveloperBots([], 3);
    const engine = createInitialGame(players, 1, () => 0.25);
    engine.phase = PHASES.VOTING;
    engine.round = 2;
    engine.currentPlayerIndex = -1;
    for (const player of Object.values(engine.players)) player.specialUsed = true;
    const commands = getDeveloperBotCommands(engine, () => 0);

    assert.equal(commands.length, 3);
    for (const command of commands) applyCommand(engine, command, "host");
    assert.equal(Object.values(engine.players).every((player) => player.voteSubmitted), true);
});

test("бот разыгрывает особую карту отдельным действием до обычного хода", () => {
    const players = fillWithDeveloperBots([], 3);
    const engine = createInitialGame(players, 1, () => 0.25);
    for (const player of Object.values(engine.players)) player.specialUsed = true;
    const special = SPECIAL_CARDS.find((card) => card.id === 32);
    engine.characters.dev_bot_1.specialId = special.id;
    engine.characters.dev_bot_1.special = special.text;
    engine.players.dev_bot_1.specialUsed = false;

    const [command] = getDeveloperBotCommands(engine, () => 0);
    assert.equal(command.type, "PLAY_SPECIAL");
    assert.equal(command.from, "dev_bot_1");
    applyCommand(engine, command, "host");
    assert.equal(engine.players.dev_bot_1.specialUsed, true);

    const regularCommands = getDeveloperBotCommands(engine, () => 0);
    assert.deepEqual(regularCommands.map(({ type }) => type), ["REVEAL_TRAIT", "FINISH_TURN"]);
});

test("бот с перераздачей ждёт конца раскрытия, чтобы включить все открытые карты", () => {
    const players = fillWithDeveloperBots([], 4);
    const engine = createInitialGame(players, 2, () => 0.25);
    for (const player of Object.values(engine.players)) player.specialUsed = true;
    const special = SPECIAL_CARDS.find((card) => card.id === 8);
    engine.characters.dev_bot_2.specialId = special.id;
    engine.characters.dev_bot_2.special = special.text;
    engine.players.dev_bot_2.specialUsed = false;
    for (const [index, playerId] of engine.order.entries()) {
        const health = `Здоровье ${index + 1}`;
        engine.characters[playerId].health = health;
        engine.players[playerId].revealedTraits.health = health;
    }

    const revealCommands = getDeveloperBotCommands(engine, () => 0);
    assert.equal(revealCommands.some(({ type }) => type === "PLAY_SPECIAL"), false);
    assert.equal(engine.players.dev_bot_2.specialUsed, false);

    engine.phase = PHASES.DISCUSSION;
    engine.currentPlayerIndex = -1;
    const [shuffle] = getDeveloperBotCommands(engine, () => 0);
    assert.equal(shuffle.type, "PLAY_SPECIAL");
    assert.equal(shuffle.from, "dev_bot_2");
    applyCommand(engine, shuffle, "host");

    assert.equal(engine.players.dev_bot_2.specialUsed, true);
    assert.deepEqual(new Set(engine.lastTraitShuffle.affectedIds), new Set(engine.order));
    for (const playerId of engine.order) {
        assert.notEqual(
            engine.characters[playerId].health,
            `Здоровье ${engine.order.indexOf(playerId) + 1}`
        );
    }
});

test("бот с картой №38 не пытается изгнать царя", () => {
    const players = fillWithDeveloperBots([], 3);
    const engine = createInitialGame(players, 1, () => 0.25);
    for (const player of Object.values(engine.players)) player.specialUsed = true;
    const special = SPECIAL_CARDS.find((card) => card.id === 38);
    engine.characters.dev_bot_3.specialId = special.id;
    engine.characters.dev_bot_3.special = special.text;
    engine.players.dev_bot_3.specialUsed = false;
    engine.players.dev_bot_3.status = "exiled";
    engine.players.dev_bot_1.bunkerKing = true;
    engine.players.dev_bot_1.immuneThisRound = true;
    engine.phase = PHASES.DISCUSSION;
    engine.currentPlayerIndex = -1;

    const [command] = getDeveloperBotCommands(engine, () => 0);

    assert.equal(command.type, "PLAY_SPECIAL");
    assert.equal(command.from, "dev_bot_3");
    assert.equal(command.data.targetId, "dev_bot_2");
    applyCommand(engine, command, "host");
    assert.equal(engine.players.dev_bot_1.status, "active");
    assert.equal(engine.players.dev_bot_2.status, "exiled");
});

test("бот завершает оба шага карты Строитель бункера", () => {
    const players = fillWithDeveloperBots([], 3);
    const engine = createInitialGame(players, 1, () => 0.25);
    for (const player of Object.values(engine.players)) player.specialUsed = true;
    const special = SPECIAL_CARDS.find((card) => card.id === 54);
    engine.characters.dev_bot_1.specialId = special.id;
    engine.characters.dev_bot_1.special = special.text;
    engine.players.dev_bot_1.specialUsed = false;

    const [start] = getDeveloperBotCommands(engine, () => 0);
    applyCommand(engine, start, "host");
    assert.equal(engine.pendingSpecialChoice.playerId, "dev_bot_1");

    const [finish] = getDeveloperBotCommands(engine, () => 0);
    applyCommand(engine, finish, "host");
    assert.equal(engine.pendingSpecialChoice, undefined);
    assert.equal(engine.players.dev_bot_1.specialUsed, true);
    assert.match(engine.characters.dev_bot_1.baggage, /;/);
});

test("бот восстанавливает повреждённое сохранение, завершая особый выбор до bunker vote", () => {
    const players = fillWithDeveloperBots([], 3);
    const engine = createInitialGame(players, 1, () => 0.25);
    for (const player of Object.values(engine.players)) player.specialUsed = true;
    const special = SPECIAL_CARDS.find((card) => card.id === 54);
    engine.characters.dev_bot_1.specialId = special.id;
    engine.characters.dev_bot_1.special = special.text;
    engine.players.dev_bot_1.specialUsed = false;
    applyCommand(engine, getDeveloperBotCommands(engine, () => 0)[0], "host");
    engine.pendingBunkerVote = {
        type: "sacrifice",
        sourceTarget: "primary:bunker",
        sourceInstanceId: engine.bunker.instanceId,
        candidateIds: [...engine.order],
        voterIds: [...engine.order],
        votes: {},
        revote: false
    };

    const [recovery] = getDeveloperBotCommands(engine, () => 0);

    assert.equal(recovery.type, "PLAY_SPECIAL");
    assert.equal(recovery.from, "dev_bot_1");
    applyCommand(engine, recovery, "host");
    assert.equal(engine.pendingSpecialChoice, undefined);
    assert.equal(engine.pendingBunkerVote.type, "sacrifice");
});

test("бот отвечает на обмен тайной картой другого бота", () => {
    const players = fillWithDeveloperBots([], 3);
    const engine = createInitialGame(players, 1, () => 0.25);
    for (const player of Object.values(engine.players)) player.specialUsed = true;
    const special = SPECIAL_CARDS.find((card) => card.id === 56);
    engine.characters.dev_bot_1.specialId = special.id;
    engine.characters.dev_bot_1.special = special.text;
    engine.players.dev_bot_1.specialUsed = false;

    const [start] = getDeveloperBotCommands(engine, () => 0);
    applyCommand(engine, start, "host");
    assert.equal(engine.pendingSecretShare.ownerId, "dev_bot_1");
    assert.equal(isDeveloperBot(engine.pendingSecretShare.targetId), true);

    const [response] = getDeveloperBotCommands(engine, () => 0);
    assert.equal(response.type, "RESPOND_SECRET_SHARE");
    applyCommand(engine, response, "host");

    assert.equal(engine.pendingSecretShare, undefined);
    assert.equal(engine.players.dev_bot_1.specialUsed, true);
    assert.equal(Object.keys(engine.sharedSecrets.dev_bot_1).length, 1);
});

test("боты голосуют при ожидающем голосовании интерактивной карты бункера", () => {
    const players = fillWithDeveloperBots([], 3);
    const engine = createInitialGame(players, 1, () => (53 - 0.5) / 80);

    assert.equal(engine.pendingBunkerVote.type, "sacrifice");
    const commands = getDeveloperBotCommands(engine, () => 0);
    assert.equal(commands.length, 3);
    assert.equal(commands.every(({ type }) => type === "BUNKER_VOTE"), true);
    assert.equal(commands.every(({ data }) => data.targetId === "dev_bot_1"), true);

    for (const command of commands) applyCommand(engine, command, "host");

    assert.deepEqual(
        new Set(Object.keys(engine.pendingBunkerVote.votes)),
        new Set(engine.order)
    );
    assert.deepEqual(getDeveloperBotCommands(engine, () => 0), []);
});

test("бот с №44 не проверяет скрытые биоданные по побочному каналу", () => {
    const engine = createInitialGame(fillWithDeveloperBots([], 3), 1, () => 0.25);
    for (const player of Object.values(engine.players)) player.specialUsed = true;
    giveBotSpecial(engine, "dev_bot_1", 44);
    engine.phase = PHASES.DISCUSSION;
    engine.currentPlayerIndex = -1;
    engine.characters.dev_bot_2.biology = "Мужчина, 34 года";

    assert.deepEqual(getDeveloperBotCommands(engine, () => 0), []);

    engine.players.dev_bot_2.revealedTraits.biology = "Мужчина, 34 года";
    const [command] = getDeveloperBotCommands(engine, () => 0);
    assert.equal(command.type, "PLAY_SPECIAL");
    assert.equal(command.data.targetId, "dev_bot_2");
});

test("bot #71 cancels #56 before the pending bot reveals a secret", () => {
    const engine = createInitialGame(fillWithDeveloperBots([], 4), 1, () => 0.25);
    for (const player of Object.values(engine.players)) player.specialUsed = true;
    giveBotSpecial(engine, "dev_bot_1", 56);
    giveBotSpecial(engine, "dev_bot_2", 71);

    applyCommand(engine, {
        type: "PLAY_SPECIAL",
        from: "dev_bot_1",
        data: { targetId: "dev_bot_3", trait: "health" }
    }, "host");

    const [reaction] = getDeveloperBotCommands(engine, () => 0);

    assert.deepEqual(reaction, {
        type: "PLAY_SPECIAL",
        from: "dev_bot_2",
        data: {}
    });
    applyCommand(engine, reaction, "host");
    assert.equal(engine.pendingSecretShare, undefined);
});

test("bot #50 redirects pending #56 with another valid bot and hidden owner trait", () => {
    const engine = createInitialGame(fillWithDeveloperBots([], 4), 1, () => 0.25);
    for (const player of Object.values(engine.players)) player.specialUsed = true;
    giveBotSpecial(engine, "dev_bot_1", 56);
    giveBotSpecial(engine, "dev_bot_2", 50);

    applyCommand(engine, {
        type: "PLAY_SPECIAL",
        from: "dev_bot_1",
        data: { targetId: "dev_bot_3", trait: "health" }
    }, "host");

    const [reaction] = getDeveloperBotCommands(engine, () => 0);

    assert.equal(reaction.type, "PLAY_SPECIAL");
    assert.equal(reaction.from, "dev_bot_2");
    assert.notEqual(reaction.data.targetId, "dev_bot_1");
    assert.notEqual(reaction.data.targetId, "dev_bot_3");
    assert.equal(isDeveloperBot(reaction.data.targetId), true);
    assert.notEqual(reaction.data.trait, "health");
    assert.equal(Boolean(engine.players.dev_bot_1.revealedTraits[reaction.data.trait]), false);

    applyCommand(engine, reaction, "host");
    assert.equal(engine.pendingSecretShare.targetId, reaction.data.targetId);

    const [response] = getDeveloperBotCommands(engine, () => 0);
    assert.equal(response.type, "RESPOND_SECRET_SHARE");
    assert.equal(response.from, reaction.data.targetId);
    applyCommand(engine, response, "host");
    assert.equal(engine.pendingSecretShare, undefined);
});

test("bot #50 redirects #54 to the other bunker baggage option", () => {
    const engine = createInitialGame(fillWithDeveloperBots([], 3), 1, () => 0.25);
    for (const player of Object.values(engine.players)) player.specialUsed = true;
    giveBotSpecial(engine, "dev_bot_1", 54);
    giveBotSpecial(engine, "dev_bot_2", 50);

    applyCommand(engine, getDeveloperBotCommands(engine, () => 0)[0], "host");
    applyCommand(engine, getDeveloperBotCommands(engine, () => 0)[0], "host");
    const originalChoice = engine.lastSpecialSnapshot.data.choice;
    const alternate = engine.lastSpecialSnapshot.choiceOptions.find((option) =>
        String(option.index) !== String(originalChoice));

    const [reaction] = getDeveloperBotCommands(engine, () => 0);

    assert.equal(reaction.type, "PLAY_SPECIAL");
    assert.equal(reaction.from, "dev_bot_2");
    assert.equal(reaction.data.choice, String(alternate.index));
    applyCommand(engine, reaction, "host");
    assert.equal(engine.characters.dev_bot_1.baggage.includes(alternate.title), true);
});
