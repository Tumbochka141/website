import test from "node:test";
import assert from "node:assert/strict";
import { LocalMultiplayer } from "./local-multiplayer.js";

test("локальная файловая версия создаёт комнату без Firebase", async () => {
    const multiplayer = new LocalMultiplayer();
    await multiplayer.connect();
    const roomId = await multiplayer.createRoom("Разработчик", 16, null, "bunker");
    await multiplayer.setRoomSettings({
        playerCount: 8,
        bunkerCapacity: 4,
        hostPlays: false,
        developerMode: true
    });

    const room = await multiplayer.getRoom();
    assert.equal(roomId, "LOCAL1");
    assert.equal(room.meta.hostId, multiplayer.user.uid);
    assert.equal(room.meta.settings.developerMode, true);
    assert.equal(room.players[multiplayer.user.uid].name, "Разработчик");
});

test("локальная комната передаёт команды ведущему", async () => {
    const multiplayer = new LocalMultiplayer();
    await multiplayer.createRoom("Разработчик");

    const commandPromise = new Promise((resolve) => {
        multiplayer.listenForCommands((command) => resolve(command));
    });
    await multiplayer.sendCommand("NEXT_PHASE", {}, 3);
    const command = await commandPromise;

    assert.equal(command.type, "NEXT_PHASE");
    assert.equal(command.from, multiplayer.user.uid);
    assert.equal(command.revision, 3);
});

test("локальная партия восстанавливается после обновления страницы и полностью сбрасывается", async () => {
    const previousStorage = globalThis.localStorage;
    const values = new Map();
    globalThis.localStorage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key)
    };

    try {
        const firstPage = new LocalMultiplayer();
        await firstPage.createRoom("Разработчик");
        await firstPage.setRoomSettings({
            playerCount: 6,
            bunkerCapacity: 3,
            hostPlays: true,
            developerMode: true
        });
        const pendingThreat = {
            status: "pending",
            finalistIds: ["local-host", "bot-1", "bot-2"],
            threatCount: 2,
            extraThreatIds: ["special-threat"]
        };
        await firstPage.setGame(
            { revision: 7, round: 5, phase: "threat", threatResolution: pendingThreat },
            { revision: 7, round: 5, phase: "threat", threatResolution: pendingThreat },
            { "local-host": { profession: "Инженер" } }
        );

        const refreshedPage = new LocalMultiplayer();
        await refreshedPage.connect();
        await refreshedPage.joinRoom("LOCAL1", "Разработчик");
        assert.equal((await refreshedPage.getEngine()).phase, "threat");
        assert.equal((await refreshedPage.getEngine()).threatResolution.status, "pending");
        assert.equal((await refreshedPage.getRoom()).hands["local-host"].profession, "Инженер");

        const failedThreat = { ...pendingThreat, status: "failed", resolvedAt: 12345 };
        await refreshedPage.setGame(
            { revision: 8, round: 5, phase: "finished", threatResolution: failedThreat },
            { revision: 8, round: 5, phase: "finished", threatResolution: failedThreat },
            { "local-host": { profession: "Инженер" } }
        );
        const finishedPage = new LocalMultiplayer();
        await finishedPage.connect();
        await finishedPage.joinRoom("LOCAL1", "Разработчик");
        assert.equal((await finishedPage.getEngine()).threatResolution.status, "failed");
        assert.equal((await finishedPage.getRoom()).meta.status, "finished");

        await finishedPage.resetGame();
        const resetRoom = await finishedPage.getRoom();
        assert.equal(resetRoom.meta.status, "lobby");
        assert.equal(resetRoom.engine, null);
        assert.equal(resetRoom.public, null);
        assert.deepEqual(resetRoom.hands, {});

        const pageAfterReset = new LocalMultiplayer();
        await pageAfterReset.connect();
        await pageAfterReset.joinRoom("LOCAL1", "Разработчик");
        assert.equal((await pageAfterReset.getRoom()).engine, null);
    } finally {
        if (previousStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = previousStorage;
    }
});
