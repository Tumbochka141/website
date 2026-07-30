const LOCAL_ROOM_ID = "LOCAL1";
const LOCAL_ROOM_STORAGE_KEY = "eulennest-bunker-local-room-v1";

export class LocalMultiplayer {
    constructor() {
        this.user = null;
        this.roomId = null;
        this.playerRef = null;
        this.room = readPersistedRoom();
        this.unsubscribers = [];
        this.roomListeners = [];
        this.publicListeners = [];
        this.handListeners = [];
        this.commandListeners = [];
        this.commandSequence = 0;
    }

    async connect() {
        this.user ??= { uid: "local-host" };
        return this.user;
    }

    static normalizeRoomId(value) {
        return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    }

    async createRoom(playerName, maxPlayers = 16, avatarUrl = null, gameType = "bunker") {
        await this.connect();
        const safeName = sanitizeName(playerName);
        this.roomId = LOCAL_ROOM_ID;
        this.playerRef = { local: true };
        this.room = {
            meta: {
                hostId: this.user.uid,
                status: "lobby",
                maxPlayers,
                gameType,
                createdAt: Date.now()
            },
            players: {
                [this.user.uid]: {
                    name: safeName,
                    joinedAt: Date.now(),
                    online: true
                }
            },
            engine: null,
            public: null,
            hands: {},
            commands: {}
        };
        this.persist();
        return this.roomId;
    }

    async joinRoom(roomId, playerName) {
        await this.connect();
        if (!this.room || LocalMultiplayer.normalizeRoomId(roomId) !== LOCAL_ROOM_ID) {
            throw new Error("Локальная комната существует только пока открыта эта вкладка. Создайте новую.");
        }
        this.room.players[this.user.uid] = {
            ...(this.room.players[this.user.uid] ?? {}),
            name: sanitizeName(playerName),
            online: true
        };
        this.roomId = LOCAL_ROOM_ID;
        this.playerRef = { local: true };
        this.persist();
        this.emitRoom();
        return this.roomId;
    }

    subscribeRoom(callback) {
        return this.subscribe(this.roomListeners, callback, () => this.roomSnapshot());
    }

    subscribePublicState(callback) {
        return this.subscribe(this.publicListeners, callback, () => clone(this.room?.public));
    }

    subscribeHand(callback) {
        return this.subscribe(this.handListeners, callback, () =>
            clone(this.room?.hands?.[this.user.uid] ?? {}));
    }

    listenForCommands(callback) {
        return this.subscribe(this.commandListeners, callback);
    }

    async sendCommand(type, data, revision) {
        this.requireRoom();
        const commandId = `local-command-${++this.commandSequence}`;
        const command = {
            type,
            data,
            revision,
            from: this.user.uid,
            createdAt: Date.now()
        };
        this.room.commands[commandId] = command;
        queueMicrotask(() => {
            for (const listener of [...this.commandListeners]) listener(clone(command), commandId);
        });
    }

    async setRoomSettings(settings) {
        this.requireHost();
        this.room.meta.settings = clone(settings);
        this.persist();
        this.emitRoom();
    }

    async removeCommand(commandId) {
        if (this.room?.commands) {
            delete this.room.commands[commandId];
            this.persist();
        }
    }

    async reportCommandError(playerId, message) {
        this.requireRoom();
        this.room.public ??= {};
        this.room.public.commandErrors ??= {};
        this.room.public.commandErrors[playerId] = {
            message: String(message ?? "Ошибка игровой команды").slice(0, 300),
            createdAt: Date.now()
        };
        this.persist();
        this.emitPublic();
    }

    async setGame(engine, publicState, hands) {
        this.requireHost();
        this.room.engine = clone(engine);
        this.room.public = clone(publicState);
        this.room.hands = clone(hands);
        this.room.meta.status = publicState.phase === "finished" ? "finished" : "playing";
        this.persist();
        this.emitRoom();
        this.emitPublic();
        this.emitHand();
    }

    async getEngine() {
        this.requireRoom();
        return clone(this.room.engine);
    }

    async getRoom() {
        this.requireRoom();
        return clone(this.room);
    }

    async removePlayer(playerId) {
        this.requireHost();
        if (!playerId || playerId === this.user.uid) {
            throw new Error("Ведущий не может удалить себя этой кнопкой.");
        }
        delete this.room.players[playerId];
        this.persist();
        this.emitRoom();
    }

    async resetGame() {
        this.requireHost();
        this.room.engine = null;
        this.room.public = null;
        this.room.hands = {};
        this.room.commands = {};
        this.room.meta.status = "lobby";
        this.persist();
        this.emitPublic();
        this.emitHand();
        this.emitRoom();
    }

    async deleteRoom() {
        this.requireHost();
        this.clearListeners();
        this.room = null;
        this.roomId = null;
        this.playerRef = null;
        clearPersistedRoom();
    }

    async leave() {
        this.clearListeners();
        this.room = null;
        this.roomId = null;
        this.playerRef = null;
        clearPersistedRoom();
    }

    clearListeners() {
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    }

    subscribe(listeners, callback, initialValue) {
        listeners.push(callback);
        if (initialValue) callback(initialValue());
        const unsubscribe = () => {
            const index = listeners.indexOf(callback);
            if (index >= 0) listeners.splice(index, 1);
        };
        this.unsubscribers.push(unsubscribe);
        return unsubscribe;
    }

    emitRoom() {
        const snapshot = this.roomSnapshot();
        for (const listener of [...this.roomListeners]) listener(snapshot);
    }

    emitPublic() {
        const snapshot = clone(this.room?.public);
        for (const listener of [...this.publicListeners]) listener(snapshot);
    }

    emitHand() {
        const snapshot = clone(this.room?.hands?.[this.user?.uid] ?? {});
        for (const listener of [...this.handListeners]) listener(snapshot);
    }

    roomSnapshot() {
        return {
            meta: clone(this.room?.meta),
            players: clone(this.room?.players ?? {})
        };
    }

    persist() {
        const storage = getStorage();
        if (!storage || !this.room) return;
        try {
            storage.setItem(LOCAL_ROOM_STORAGE_KEY, JSON.stringify(this.room));
        } catch (error) {
            console.warn("Не удалось сохранить локальную партию:", error);
        }
    }

    requireRoom() {
        if (!this.roomId || !this.room || !this.user) {
            throw new Error("Сначала создайте локальную комнату.");
        }
    }

    requireHost() {
        this.requireRoom();
        if (this.room.meta.hostId !== this.user.uid) {
            throw new Error("Это действие доступно только ведущему.");
        }
    }
}

function sanitizeName(value) {
    const name = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
    return name || "Игрок";
}

function clone(value) {
    if (value === undefined || value === null) return value ?? null;
    return structuredClone(value);
}

function readPersistedRoom() {
    const storage = getStorage();
    if (!storage) return null;
    try {
        const room = JSON.parse(storage.getItem(LOCAL_ROOM_STORAGE_KEY) ?? "null");
        if (!room?.meta?.hostId || !room?.players || room.meta.gameType !== "bunker") return null;
        room.commands = {};
        return room;
    } catch {
        clearPersistedRoom();
        return null;
    }
}

function clearPersistedRoom() {
    const storage = getStorage();
    try {
        storage?.removeItem(LOCAL_ROOM_STORAGE_KEY);
    } catch {
        // Хранилище может быть запрещено настройками браузера.
    }
}

function getStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}
