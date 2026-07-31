(() => {
  // firebase-config.js
  var firebaseConfig = {
    apiKey: "AIzaSyDDKO_bDhCnkrap5yOsjzxZtRNWz8Xh9Xg",
    authDomain: "ealennest.firebaseapp.com",
    databaseURL: "https://ealennest-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "ealennest",
    storageBucket: "ealennest.firebasestorage.app",
    messagingSenderId: "1009418443211",
    appId: "1:1009418443211:web:db5c6cfd897c52f02a7e4e",
    measurementId: "G-5G0E86C4SB"
  };
  var isFirebaseConfigured = Boolean(firebaseConfig.databaseURL) && !Object.values(firebaseConfig).some((value) => value.includes("PASTE_"));

  // data/bunker/local-multiplayer.js
  var LOCAL_ROOM_ID = "LOCAL1";
  var LOCAL_ROOM_STORAGE_KEY = "eulennest-bunker-local-room-v1";
  var LocalMultiplayer = class _LocalMultiplayer {
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
      if (!this.room || _LocalMultiplayer.normalizeRoomId(roomId) !== LOCAL_ROOM_ID) {
        throw new Error("\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u0430\u044F \u043A\u043E\u043C\u043D\u0430\u0442\u0430 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u043A\u0430 \u043E\u0442\u043A\u0440\u044B\u0442\u0430 \u044D\u0442\u0430 \u0432\u043A\u043B\u0430\u0434\u043A\u0430. \u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043D\u043E\u0432\u0443\u044E.");
      }
      this.room.players[this.user.uid] = {
        ...this.room.players[this.user.uid] ?? {},
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
      return this.subscribe(this.handListeners, callback, () => clone(this.room?.hands?.[this.user.uid] ?? {}));
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
        message: String(message ?? "\u041E\u0448\u0438\u0431\u043A\u0430 \u0438\u0433\u0440\u043E\u0432\u043E\u0439 \u043A\u043E\u043C\u0430\u043D\u0434\u044B").slice(0, 300),
        createdAt: Date.now()
      };
      this.persist();
      this.emitPublic();
    }
    async setGame(engine, publicState2, hands) {
      this.requireHost();
      this.room.engine = clone(engine);
      this.room.public = clone(publicState2);
      this.room.hands = clone(hands);
      this.room.meta.status = publicState2.phase === "finished" ? "finished" : "playing";
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
        throw new Error("\u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u0435\u0431\u044F \u044D\u0442\u043E\u0439 \u043A\u043D\u043E\u043F\u043A\u043E\u0439.");
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
        console.warn("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u0443\u044E \u043F\u0430\u0440\u0442\u0438\u044E:", error);
      }
    }
    requireRoom() {
      if (!this.roomId || !this.room || !this.user) {
        throw new Error("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0441\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u0443\u044E \u043A\u043E\u043C\u043D\u0430\u0442\u0443.");
      }
    }
    requireHost() {
      this.requireRoom();
      if (this.room.meta.hostId !== this.user.uid) {
        throw new Error("\u042D\u0442\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0435\u0434\u0443\u0449\u0435\u043C\u0443.");
      }
    }
  };
  function sanitizeName(value) {
    const name = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
    return name || "\u0418\u0433\u0440\u043E\u043A";
  }
  function clone(value) {
    if (value === void 0 || value === null) return value ?? null;
    return structuredClone(value);
  }
  function readPersistedRoom() {
    const storage = getStorage();
    if (!storage) return null;
    try {
      const room2 = JSON.parse(storage.getItem(LOCAL_ROOM_STORAGE_KEY) ?? "null");
      if (!room2?.meta?.hostId || !room2?.players || room2.meta.gameType !== "bunker") return null;
      room2.commands = {};
      return room2;
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
    }
  }
  function getStorage() {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  // data/bunker/cards.js
  var PROFESSIONS = [
    "\u0410\u0440\u0445\u0435\u043E\u043B\u043E\u0433",
    "\u0410\u0432\u0442\u043E\u043C\u0435\u0445\u0430\u043D\u0438\u043A",
    "\u0410\u0434\u0432\u043E\u043A\u0430\u0442",
    "\u0412\u0438\u0440\u0443\u0441\u043E\u043B\u043E\u0433",
    "\u0411\u0440\u0430\u043A\u043E\u043D\u044C\u0435\u0440",
    "\u0412\u043E\u0435\u043D\u043D\u044B\u0439",
    "\u0412\u0438\u0434\u0435\u043E\u0438\u043D\u0436\u0435\u043D\u0435\u0440",
    "\u0411\u0438\u043E\u043B\u043E\u0433",
    "\u0413\u043E\u043C\u0435\u043E\u043F\u0430\u0442",
    "\u0414\u0435\u0442\u0435\u043A\u0442\u0438\u0432",
    "\u0413\u0440\u0430\u0431\u0438\u0442\u0435\u043B\u044C",
    "\u0414\u0438\u0437\u0430\u0439\u043D\u0435\u0440",
    "\u041A\u043E\u0443\u0447",
    "\u0416\u0443\u0440\u043D\u0430\u043B\u0438\u0441\u0442",
    "\u0418\u0441\u0442\u043E\u0440\u0438\u043A",
    "\u041B\u0435\u0441\u043D\u0438\u043A",
    "\u0414\u043E\u043C\u043E\u0445\u043E\u0437\u044F\u0439\u043A\u0430",
    "\u0417\u043D\u0430\u0445\u0430\u0440\u044C",
    "\u041C\u0430\u0440\u043A\u0435\u0442\u043E\u043B\u043E\u0433",
    "\u041C\u0435\u0434\u0441\u0435\u0441\u0442\u0440\u0430",
    "\u041B\u0451\u0442\u0447\u0438\u043A-\u0438\u043D\u0436\u0435\u043D\u0435\u0440",
    "\u041F\u043E\u0432\u0430\u0440",
    "\u041F\u0430\u043F\u0430\u0440\u0430\u0446\u0446\u0438",
    "\u041F\u0435\u0440\u0435\u0432\u043E\u0434\u0447\u0438\u043A",
    "\u041F\u043E\u0436\u0430\u0440\u043D\u044B\u0439",
    "\u041C\u043E\u0434\u0435\u043B\u044C",
    "\u041F\u0438\u0441\u0430\u0442\u0435\u043B\u044C",
    "\u041F\u0440\u043E\u0434\u0430\u0432\u0435\u0446",
    "\u041F\u043E\u043B\u0438\u0446\u0435\u0439\u0441\u043A\u0438\u0439",
    "\u041F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0438\u0441\u0442",
    "\u0421\u0442\u043E\u043C\u0430\u0442\u043E\u043B\u043E\u0433",
    "\u0421\u0435\u043A\u0441\u043E\u043B\u043E\u0433",
    "\u0421\u043F\u0435\u0446\u0430\u0433\u0435\u043D\u0442",
    "\u0420\u043E\u0431\u043E\u0442\u043E\u0442\u0435\u0445\u043D\u0438\u043A",
    "\u041F\u0441\u0438\u0445\u043E\u043B\u043E\u0433",
    "\u0420\u0430\u0437\u043D\u043E\u0440\u0430\u0431\u043E\u0447\u0438\u0439",
    "\u0422\u0430\u0442\u0443-\u043C\u0430\u0441\u0442\u0435\u0440",
    "\u0421\u0442\u0440\u043E\u0438\u0442\u0435\u043B\u044C",
    "\u0421\u0443\u0434\u044C\u044F",
    "\u0425\u0430\u043A\u0435\u0440",
    "\u0424\u0438\u0437\u0438\u043A",
    "\u0424\u0438\u043B\u043E\u0441\u043E\u0444",
    "\u0425\u0438\u0440\u0443\u0440\u0433",
    "\u0424\u0435\u0440\u043C\u0435\u0440",
    "\u0425\u0438\u043C\u0438\u043A",
    "\u042D\u043A\u0441\u043A\u0443\u0440\u0441\u043E\u0432\u043E\u0434",
    "\u042D\u043A\u043E\u043B\u043E\u0433",
    "\u042D\u043A\u0441\u0442\u0440\u0430\u0441\u0435\u043D\u0441",
    "\u042D\u0442\u043D\u043E\u0433\u0440\u0430\u0444",
    "\u042D\u043B\u0435\u043A\u0442\u0440\u0438\u043A",
    "\u041F\u0430\u043F\u0430 \u0420\u0438\u043C\u0441\u043A\u0438\u0439",
    "\u041F\u0440\u0435\u0437\u0438\u0434\u0435\u043D\u0442",
    "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u041D\u043E\u0432\u043E\u0439 \u041F\u043E\u0447\u0442\u044B",
    "\u0421\u0442\u0438\u043B\u0438\u0441\u0442",
    "\u0428\u043F\u0438\u043E\u043D-\u043D\u0435\u043B\u0435\u0433\u0430\u043B",
    "\u0424\u0438\u0437\u0440\u0443\u043A",
    "\u041A\u0430\u043F\u0438\u0442\u0430\u043D \u043F\u043E\u0434\u043B\u043E\u0434\u043A\u0438",
    "\u042D\u043A\u0437\u043E\u0440\u0446\u0438\u0441\u0442",
    "\u041F\u043E\u0440\u043D\u043E\u0430\u043A\u0442\u0451\u0440",
    "\u041F\u0430\u0442\u043E\u043B\u043E\u0433\u043E\u0430\u043D\u0430\u0442\u043E\u043C",
    "\u041E\u043B\u0435\u043D\u0435\u0432\u043E\u0434",
    "\u041F\u043E\u043F\u0440\u043E\u0448\u0430\u0439\u043A\u0430",
    "\u041A\u043E\u0441\u043C\u043E\u043D\u0430\u0432\u0442",
    "\u041A\u043E\u043D\u044E\u0445",
    "\u041F\u0440\u043E\u043A\u0442\u043E\u043B\u043E\u0433",
    "\u041A\u043B\u043E\u0443\u043D",
    "\u041A\u043E\u043B\u0434\u0443\u043D\u044C\u044F",
    "\u041A\u043E\u043B\u043B\u0435\u043A\u0442\u043E\u0440",
    "\u0412\u0435\u0442\u0435\u0440\u0438\u043D\u0430\u0440",
    "\u0411\u043E\u043A\u0441\u0451\u0440",
    "\u0411\u043B\u043E\u0433\u0435\u0440",
    "\u0411\u0430\u0440\u043C\u0435\u043D",
    "\u0411\u0430\u043D\u0449\u0438\u043A",
    "\u0424\u0443\u0442\u0431\u043E\u043B\u0438\u0441\u0442",
    "\u0414\u0435\u0433\u0443\u0441\u0442\u0430\u0442\u043E\u0440 \u043A\u043E\u0440\u043C\u043E\u0432",
    "\u0413\u0440\u043E\u0431\u043E\u0432\u0449\u0438\u043A",
    "\u0412\u043E\u0436\u0430\u0442\u044B\u0439",
    "\u0414\u0430\u043B\u044C\u043D\u043E\u0431\u043E\u0439\u0449\u0438\u043A",
    "\u041C\u0430\u0441\u0441\u0430\u0436\u0438\u0441\u0442",
    "\u0422\u0430\u043A\u0441\u0438\u0441\u0442",
    "\u041C\u0438\u043D\u0438\u0441\u0442\u0440 \u043A\u0443\u043B\u044C\u0442\u0443\u0440\u044B",
    "\u0421\u043C\u043E\u0442\u0440\u0438\u0442\u0435\u043B\u044C \u043C\u0430\u044F\u043A\u0430",
    "\u0420\u044D\u043F\u0435\u0440",
    "SMM-\u0441\u043F\u0435\u0446\u0438\u0430\u043B\u0438\u0441\u0442",
    "\u0421\u0432\u044F\u0449\u0435\u043D\u043D\u0438\u043A",
    "\u0421\u0430\u043D\u0442\u0435\u0445\u043D\u0438\u043A",
    "\u041F\u0441\u0438\u0445\u0438\u0430\u0442\u0440",
    "\u0418\u043D\u0444\u043E\u0446\u044B\u0433\u0430\u043D",
    "\u041A\u0438\u043D\u043E\u0440\u0435\u0436\u0438\u0441\u0441\u0451\u0440",
    "\u041A\u0430\u0441\u043A\u0430\u0434\u0451\u0440",
    "\u041A\u0438\u0431\u0435\u0440\u0441\u043F\u043E\u0440\u0442\u0441\u043C\u0435\u043D",
    "\u0425\u043E\u0440\u0435\u043E\u0433\u0440\u0430\u0444",
    "\u0428\u0430\u0445\u0442\u0451\u0440",
    "\u0418\u043D\u0441\u043F\u0435\u043A\u0442\u043E\u0440 \u0413\u0410\u0418",
    "\u0421\u043E\u043C\u0435\u043B\u044C\u0435",
    "\u041D\u0430\u0440\u043A\u043E\u0434\u0438\u043B\u0435\u0440",
    "\u041C\u044F\u0441\u043D\u0438\u043A",
    "\u0428\u0430\u0445\u0442\u0451\u0440",
    "\u0421\u043C\u043E\u0442\u0440\u0438\u0442\u0435\u043B\u044C \u043C\u0443\u0437\u0435\u044F",
    "\u0422\u0435\u043B\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0435\u043B\u044C",
    "\u0422\u0430\u043C\u0430\u0434\u0430",
    "\u0421\u0443\u0442\u0435\u043D\u0435\u0440",
    "\u0423\u0431\u043E\u0440\u0449\u0438\u043A"
  ];
  var HEALTH = [
    "\u0413\u0438\u0433\u0430\u043D\u0442\u0438\u0437\u043C \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u044B\u0445 \u0447\u0430\u0441\u0442\u0435\u0439 \u0442\u0435\u043B\u0430",
    "\u0411\u0435\u0441\u043F\u043B\u043E\u0434\u0438\u0435",
    "\u0413\u0430\u043B\u043B\u044E\u0446\u0438\u043D\u0430\u0446\u0438\u0438",
    "\u0414\u0435\u043F\u0440\u0435\u0441\u0441\u0438\u044F",
    "\u0410\u043B\u043A\u043E\u0433\u043E\u043B\u0438\u0437\u043C",
    "\u0413\u043B\u0443\u0445\u043E\u0442\u0430",
    "\u0417\u0430\u0438\u043A\u0430",
    "\u041D\u0430\u0440\u043A\u043E\u0437\u0430\u0432\u0438\u0441\u0438\u043C\u043E\u0441\u0442\u044C",
    "\u0418\u0433\u0440\u043E\u0437\u0430\u0432\u0438\u0441\u0438\u043C\u043E\u0441\u0442\u044C",
    "\u041A\u043E\u0444\u0435\u0437\u0430\u0432\u0438\u0441\u0438\u043C\u043E\u0441\u0442\u044C",
    "\u041A\u0430\u0440\u043B\u0438\u043A",
    "\u041A\u043B\u0435\u043F\u0442\u043E\u043C\u0430\u043D\u0438\u044F",
    "\u041B\u0443\u043D\u0430\u0442\u0438\u0437\u043C",
    "\u0418\u0434\u0435\u0430\u043B\u044C\u043D\u043E \u0437\u0434\u043E\u0440\u043E\u0432",
    "\u041C\u0430\u043D\u0438\u044F \u043F\u0440\u0435\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u043D\u0438\u044F",
    "\u041C\u0438\u0433\u0440\u0435\u043D\u044C",
    "\u041D\u0435 \u043E\u0431\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u043B\u0441\u044F",
    "\u041D\u0435\u0442 \u043D\u043E\u0433\u0438",
    "\u041F\u043E\u043D\u043E\u0441",
    "\u041F\u043E\u0432\u044B\u0448\u0435\u043D\u043D\u0430\u044F \u0432\u043E\u043B\u043E\u0441\u0430\u0442\u043E\u0441\u0442\u044C",
    "\u041F\u043E\u0442\u0435\u0440\u044F \u043E\u0431\u043E\u043D\u044F\u043D\u0438\u044F",
    "\u0420\u0430\u0437\u0434\u0432\u043E\u0435\u043D\u0438\u0435 \u043B\u0438\u0447\u043D\u043E\u0441\u0442\u0438",
    "\u041D\u0435\u0442 \u0440\u0443\u043A\u0438",
    "\u0421\u0435\u043A\u0441\u0443\u0430\u043B\u044C\u043D\u0430\u044F \u043E\u0437\u0430\u0431\u043E\u0447\u0435\u043D\u043D\u043E\u0441\u0442\u044C",
    "\u0421\u043B\u0435\u043F\u043E\u0439",
    "\u0421\u043A\u043B\u0435\u0440\u043E\u0437",
    "\u0421\u0443\u0438\u0446\u0438\u0434\u0430\u043B\u044C\u043D\u044B\u0435 \u043C\u044B\u0441\u043B\u0438",
    "\u0425\u0432\u043E\u0441\u0442",
    "\u0422\u0440\u0435\u043C\u043E\u0440 \u0440\u0443\u043A",
    "\u0424\u0440\u0438\u0433\u0438\u0434\u043D\u043E\u0441\u0442\u044C/\u0438\u043C\u043F\u043E\u0442\u0435\u043D\u0446\u0438\u044F",
    "2 \u0441\u0435\u0440\u0434\u0446\u0430 \u0438 4 \u043F\u043E\u0447\u043A\u0438",
    "\u0411\u0435\u0437\u0437\u0443\u0431\u044B\u0439",
    "\u041F\u0430\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0430\u0442\u0430\u043A\u0438",
    "\u0421\u043B\u044B\u0448\u0438\u0442 \u0433\u043E\u043B\u043E\u0441\u0430",
    "\u041F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E \u043F\u043B\u044E\u0435\u0442\u0441\u044F",
    "\u0412\u0435\u043B\u0438\u043A\u0430\u043D",
    "\u0412\u0435\u0447\u043D\u043E \u043E\u0434\u043D\u043E\u0433\u043E \u0432\u043E\u0437\u0440\u0430\u0441\u0442\u0430",
    "\u0413\u043E\u0440\u0431\u0430\u0442\u044B\u0439",
    "\u041C\u0435\u0442\u0435\u043E\u0440\u0438\u0437\u043C",
    "\u0411\u0435\u0440\u0435\u043C\u0435\u043D\u0435\u0435\u0442 \u043A\u0430\u0436\u0434\u044B\u0439 \u0433\u043E\u0434 \u0441\u0430\u043C \u043F\u043E \u0441\u0435\u0431\u0435",
    "\u0413\u0435\u043C\u043E\u0440\u0440\u043E\u0439",
    "\u0421\u0443\u043F\u0435\u0440\u0441\u043B\u0443\u0445",
    "\u0412\u0435\u0447\u043D\u043E \u0433\u043E\u043B\u043E\u0434\u0435\u043D",
    "\u0416\u0430\u0431\u0440\u044B",
    "\u041F\u0440\u0438\u0442\u044F\u0433\u0438\u0432\u0430\u0435\u0442 \u043C\u0435\u0442\u0430\u043B\u043B",
    "\u041E\u043F\u043B\u043E\u0434\u043E\u0442\u0432\u043E\u0440\u044F\u0435\u0442 \u043F\u0430\u043B\u044C\u0446\u0435\u043C",
    "\u041E\u0447\u0435\u043D\u044C \u0431\u043E\u043B\u044C\u0448\u0430\u044F \u0433\u0440\u0443\u0434\u044C",
    "\u0411\u043E\u0438\u0442\u0441\u044F \u0441\u043E\u043B\u043D\u0446\u0430",
    "\u041D\u0443\u043B\u0435\u0432\u043E\u0439 \u0438\u043C\u043C\u0443\u043D\u0438\u0442\u0435\u0442",
    "\u041F\u0443\u0441\u043A\u0430\u0435\u0442 \u0441\u043B\u044E\u043D\u0438",
    "\u0420\u043E\u0436\u0430\u0435\u0442 \u043D\u0435\u0432\u0435\u0434\u043E\u043C\u0443\u044E \u0437\u0432\u0435\u0440\u0443\u0448\u043A\u0443",
    "\u0421\u0438\u0444\u0438\u043B\u0438\u0441",
    "\u041F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E \u043C\u0430\u0442\u0435\u0440\u0438\u0442\u0441\u044F",
    "\u041F\u0443\u0447\u0435\u0433\u043B\u0430\u0437\u0438\u0435",
    "\u041F\u043E\u043B\u043E\u0432\u044B\u0435 \u043E\u0440\u0433\u0430\u043D\u044B \u043F\u043E\u0434 \u043C\u044B\u0448\u043A\u043E\u0439",
    "\u041D\u0435\u0443\u0441\u0442\u0440\u0430\u043D\u0438\u043C\u044B\u0435 \u0432\u0448\u0438",
    "\u0411\u0438\u043F\u043E\u043B\u044F\u0440\u043A\u0430",
    "\u0413\u043E\u0432\u043E\u0440\u0438\u0442 \u0441\u0430\u043C \u0441 \u0441\u043E\u0431\u043E\u0439",
    "\u0410\u043D\u043E\u0440\u0435\u043A\u0441\u0438\u044F",
    "\u041F\u0438\u0432\u043D\u043E\u0439 \u0436\u0438\u0432\u043E\u0442",
    "\u0412\u043E\u0435\u0442 \u043F\u043E \u043D\u043E\u0447\u0430\u043C",
    "\u041F\u0430\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043D \u043D\u0438\u0436\u0435 \u043F\u043E\u044F\u0441\u0430"
  ];
  var BIOLOGY = [
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 19 \u043B\u0435\u0442, \u043B\u0435\u0441\u0431\u0438\u044F\u043D\u043A\u0430",
    "\u0410\u043D\u0434\u0440\u043E\u0438\u0434",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 18 \u043B\u0435\u0442",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 21 \u0433\u043E\u0434",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 22 \u0433\u043E\u0434\u0430, \u0431\u0438\u0441\u0435\u043A\u0441\u0443\u0430\u043B\u044C\u043D\u0430",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 24 \u0433\u043E\u0434\u0430",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 31 \u0433\u043E\u0434",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 27 \u043B\u0435\u0442",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 30 \u043B\u0435\u0442",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 34 \u0433\u043E\u0434\u0430",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 25 \u043B\u0435\u0442, \u043B\u0435\u0441\u0431\u0438\u044F\u043D\u043A\u0430",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 33 \u0433\u043E\u0434\u0430, \u043B\u0435\u0441\u0431\u0438\u044F\u043D\u043A\u0430",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 65 \u043B\u0435\u0442",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 36 \u043B\u0435\u0442",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 99 \u043B\u0435\u0442",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 200 \u043B\u0435\u0442, \u043B\u0435\u0441\u0431\u0438\u044F\u043D\u043A\u0430",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 27 \u043B\u0435\u0442, \u0433\u0435\u0439",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 24 \u0433\u043E\u0434\u0430, \u0431\u0438\u0441\u0435\u043A\u0441\u0443\u0430\u043B\u0435\u043D",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 26 \u043B\u0435\u0442",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 23 \u0433\u043E\u0434\u0430, \u0433\u0435\u0439",
    "\u041A\u043E\u0442\u0433\u0435\u043D\u0434\u0435\u0440",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 18 \u043B\u0435\u0442",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 32 \u0433\u043E\u0434\u0430, \u0433\u0435\u0439",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 29 \u043B\u0435\u0442",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 30 \u043B\u0435\u0442",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 42 \u0433\u043E\u0434\u0430, \u0433\u0435\u0439",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 35 \u043B\u0435\u0442",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 39 \u043B\u0435\u0442",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 101 \u0433\u043E\u0434, \u0433\u0435\u0439",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 33 \u0433\u043E\u0434\u0430",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 75 \u043B\u0435\u0442",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 16 \u043B\u0435\u0442, \u0431\u0435\u0440\u0435\u043C\u0435\u043D\u043D\u0430, \u043B\u0435\u0441\u0431\u0438\u044F\u043D\u043A\u0430",
    "\u0413\u043D\u043E\u043C, 152 \u0433\u043E\u0434\u0430",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 32 \u0433\u043E\u0434\u0430",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 35 \u043B\u0435\u0442",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 49 \u043B\u0435\u0442",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 52 \u0433\u043E\u0434\u0430, \u0433\u0438\u043F\u0435\u0440\u0441\u0435\u043A\u0441\u0443\u0430\u043B\u044C\u043D\u0430",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 65 \u043B\u0435\u0442, \u0430\u0441\u0435\u043A\u0441\u0443\u0430\u043B\u044C\u043D\u0430",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 83 \u0433\u043E\u0434\u0430, \u0441\u0442\u0435\u0440\u0438\u043B\u044C\u043D\u0430",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 21 \u0433\u043E\u0434, \u0441\u0442\u0435\u0440\u0438\u043B\u044C\u043D\u0430",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 23 \u0433\u043E\u0434\u0430",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 25 \u043B\u0435\u0442, \u0430\u0441\u0435\u043A\u0441\u0443\u0430\u043B\u044C\u043D\u0430",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 48 \u043B\u0435\u0442",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 53 \u0433\u043E\u0434\u0430",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 71 \u0433\u043E\u0434",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 17 \u043B\u0435\u0442, \u0433\u0438\u043F\u0435\u0440\u0441\u0435\u043A\u0441\u0443\u0430\u043B\u0435\u043D",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 28 \u043B\u0435\u0442, \u0441\u0442\u0435\u0440\u0438\u043B\u0435\u043D",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 29 \u043B\u0435\u0442, \u0441\u0442\u0435\u0440\u0438\u043B\u044C\u043D\u0430",
    "\u041A\u0435\u043D\u0442\u0430\u0432\u0440",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430, 91 \u0433\u043E\u0434",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430, 19 \u043B\u0435\u0442",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430 62 \u0433\u043E\u0434\u0430",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430 85 \u043B\u0435\u0442 \u0441\u0442\u0435\u0440\u0438\u043B\u0435\u043D",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430 26 \u043B\u0435\u0442",
    "\u0416\u0435\u043D\u0449\u0438\u043D\u0430 120 \u043B\u0435\u0442 \u0433\u0438\u043F\u0435\u0440\u0441\u0435\u043A\u0441\u0443\u0430\u043B\u044C\u043D\u0430",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430 25 \u043B\u0435\u0442",
    "\u0420\u0435\u043F\u0442\u0438\u043B\u043E\u0438\u0434",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430 31 \u0433\u043E\u0434",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430 92 \u0433\u043E\u0434 \u0433\u0438\u043F\u0435\u0440\u0441\u0435\u043A\u0441\u0443\u0430\u043B\u0435\u043D",
    "\u042D\u043B\u044C\u0444\u0438\u0439\u043A\u0430 267 \u043B\u0435\u0442",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430 39 \u043B\u0435\u0442",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430 22 \u0433\u043E\u0434\u0430 \u0430\u0441\u0435\u043A\u0441\u0443\u0430\u043B\u0435\u043D",
    "\u041C\u0443\u0436\u0447\u0438\u043D\u0430 32 \u0433\u043E\u0434\u0430 \u0430\u0441\u0435\u043A\u0441\u0443\u0430\u043B\u0435\u043D"
  ];
  var FACTS = [
    "\u0431\u043E\u0438\u0442\u0441\u044F \u043C\u044B\u0442\u044C\u0441\u044F",
    "\u0431\u043E\u0438\u0442\u0441\u044F \u043C\u0443\u0436\u0447\u0438\u043D",
    "\u0432\u0435\u0440\u043D\u0443\u043B\u0441\u044F \u0438\u0437 \u0433\u043E\u0440\u044F\u0447\u0435\u0439 \u0442\u043E\u0447\u043A\u0438",
    "\u0431\u0435\u0437\u043E\u0442\u043A\u0430\u0437\u043D\u044B\u0439",
    "\u0431\u0440\u043E\u0434\u044F\u0436\u043D\u0438\u0447\u0430\u043B 2 \u0433\u043E\u0434\u0430",
    "\u0432\u044B\u0440\u043E\u0441 \u0432 \u0441\u0435\u043C\u044C\u0435 \u043B\u0435\u0441\u043D\u0438\u043A\u0430",
    "\u0432\u0438\u0434\u0435\u043B \u0438\u043D\u043E\u043F\u043B\u0430\u043D\u0435\u0442\u044F\u043D",
    "\u0432\u043B\u0430\u0434\u0435\u0435\u0442 5 \u044F\u0437\u044B\u043A\u0430\u043C\u0438",
    "\u0431\u043E\u0438\u0442\u0441\u044F \u0436\u0435\u043D\u0449\u0438\u043D",
    "\u0432\u0437\u043B\u043E\u043C\u0430\u043B \u0431\u0430\u0437\u0443 \u0434\u0430\u043D\u043D\u044B\u0439 \u0446\u0440\u0443",
    "\u0432\u0440\u0435\u0442 \u0438 \u043F\u0440\u0435\u0443\u0432\u0435\u043B\u0438\u0447\u0438\u0432\u0430\u0435\u0442",
    "\u0434\u0435\u0440\u0436\u0430\u043B \u0434\u043E\u043C\u0430 40 \u043A\u043E\u0448\u0435\u043A",
    "\u0433\u0438\u043F\u043D\u043E\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0443\u043B\u044B\u0431\u043A\u0430",
    "\u0433\u0440\u044F\u0437\u043D\u043E \u0440\u0443\u0433\u0430\u0435\u0442\u0441\u044F",
    "\u0437\u043D\u0430\u0435\u0442 \u043D\u0430\u0438\u0437\u0443\u0441\u0442\u044C \u0441\u0442\u0438\u0445\u0438 \u043F\u0443\u0448\u043A\u0438\u043D\u0430",
    "\u0437\u043D\u0430\u0435\u0442 \u0430\u0437\u0431\u0443\u043A\u0443 \u043C\u043E\u0440\u0437\u0435",
    "\u0437\u043D\u0430\u0435\u0442 \u043B\u0438\u0447\u043D\u043E \u043F\u0440\u0435\u0437\u0438\u0434\u0435\u043D\u0442\u0430",
    "\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u043B \u0430\u0439\u0442\u0438 \u0441\u0442\u0430\u0440\u0442\u0430\u043F",
    "\u0434\u0443\u0448\u0430 \u043A\u043E\u043C\u043F\u0430\u043D\u0438 \u0438",
    "\u0437\u0430\u043D\u0443\u0434\u0430",
    "\u0438\u0441\u0442\u0435\u0440\u0438\u0447\u043D\u044B\u0439",
    "\u0438\u0437\u0432\u0440\u0430\u0449\u0435\u043D\u0435\u0446",
    "\u043C\u0430\u043D\u044C\u044F\u043A \u0443\u0431\u0438\u0439\u0446\u0430",
    "\u043C\u0430\u043D\u044C\u044F\u043A \u043F\u0435\u0434\u043E\u0444\u0438\u043B",
    "\u043D\u044B\u0442\u0438\u043A",
    "\u043D\u0435 \u043F\u0443\u0441\u043A\u0430\u044E\u0442 \u0432 \u043A\u0430\u0437\u0438\u043D\u043E",
    "\u043D\u043E\u0431\u0435\u043B\u0435\u0432\u0441\u043A\u0438\u0439 \u043B\u0430\u0443\u0440\u0435\u0430\u0442 \u043F\u043E \u0431\u0438\u043E\u0438\u043D\u0436\u0435\u043D\u0435\u0440\u0438\u0438",
    "\u043E\u0441\u0442\u0430\u043B\u0441\u044F \u0432 \u0436\u0438\u0432\u044B\u0445 \u043D\u0430 \u043D\u0435\u043E\u0431\u0438\u0442\u0430\u0435\u043C\u043E\u043C \u043E\u0441\u0442\u0440\u043E\u0432\u0435",
    "\u043D\u0430\u0440\u043A\u043E\u0434\u0438\u043B\u0435\u0440",
    "\u043E\u0431\u043B\u0430\u0434\u0430\u0442\u0435\u043B\u044C \u0443\u043D\u0438\u043A\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0441\u043E\u043F\u0440\u0430\u043D\u043E",
    "\u043F\u0438\u0441\u0430\u0435\u0442\u0441\u044F \u043F\u043E \u043D\u043E\u0447\u0430\u043C",
    "\u043E\u0442\u0447\u0438\u0441\u043B\u0435\u043D \u0438\u0437 \u043A\u043B\u0443\u0431\u0430 \u043D\u0430\u0432\u044B\u043A\u0438 \u0432\u044B\u0436\u0438\u0432\u0430\u043D\u0438\u044F",
    "\u043F\u0438\u0448\u0438\u0442 \u0441 \u0430\u0448\u0438\u043F\u043A\u0430\u043C\u0438",
    "\u043F\u0440\u043E\u0448\u0435\u043B \u0434\u0432\u0443\u0445\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u044B\u0435 \u043A\u0443\u0440\u0441\u044B \u043F\u0441\u0438\u0445\u043E\u043B\u043E\u0433\u0430",
    "\u043F\u043E\u0434\u0445\u043E\u0434\u0438\u0442 \u0441\u0437\u0430\u0434\u0438 \u0438 \u0434\u044B\u0448\u0438\u0442",
    "\u043F\u043E\u043D\u0438\u043C\u0430\u0435\u0442 \u044F\u0437\u044B\u043A \u0436\u0438\u0432\u043E\u0442\u043D\u044B\u0445",
    "\u043F\u0441\u0438\u0445\u043E\u043F\u0430\u0442",
    "\u043F\u043E\u0431\u0435\u0434\u0438\u0442\u0435\u043B\u044C \u043F\u0430\u0440\u0430\u043E\u043B\u0438\u043C\u043F\u0438\u0439\u0441\u043A\u0438\u0445 \u0438\u0433\u0440",
    "\u043F\u0440\u043E\u0434\u0430\u043B \u043F\u043E\u0447\u043A\u0443",
    "\u0441\u0434\u0435\u043B\u0430\u0435\u0442 \u0441\u0430\u043C\u043E\u0433\u043E\u043D \u0438\u0437 \u0447\u0435\u0433\u043E \u0443\u0433\u043E\u0434\u043D\u043E",
    "\u0440\u0430\u0431\u043E\u0442\u0430\u043B \u0432 \u043F\u0440\u043E\u0441\u0442\u0438\u0442\u0443\u0446\u0438\u0438",
    "\u0440\u0430\u0437\u0433\u043E\u0432\u0430\u0440\u0438\u0432\u0430\u0435\u0442 \u0441 \u0434\u0443\u0445\u0430\u043C\u0438",
    "\u0442\u043E\u043B\u044C\u043A\u043E \u0438\u0437 \u043E\u0447\u0430\u0433\u0430 \u044D\u043F\u0438\u0434\u0435\u043C\u0438\u0438",
    "\u0441\u043F\u043B\u0435\u0442\u043D\u0438\u043A",
    "\u0441\u0442\u0440\u043E\u0438\u043B \u043F\u043E\u0434\u043E\u0431\u043D\u044B\u0435 \u0431\u0443\u043D\u043A\u0435\u0440\u044B",
    "\u0442\u043E\u0440\u043C\u043E\u0437",
    "\u0441\u043E\u0441\u0442\u043E\u044F\u043B \u0432 \u0441\u0435\u043A\u0442\u0435",
    "\u0442\u0435\u043B\u0435\u043F\u0430\u0442",
    "\u0431\u043E\u0438\u0442\u0441\u044F \u0441\u0435\u043A\u0441\u0430",
    "\u0445\u0440\u0430\u043F\u0438\u0442",
    "\u0447\u0438\u0442\u0430\u043B \u0432\u0441\u0435 \u043A\u043D\u0438\u0433\u0438 \u043B\u0430\u0432\u043A\u0440\u0430\u0444\u0442\u0430",
    "\u043F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E \u0432\u0441\u0435\u0445 \u0431\u043B\u0430\u0433\u043E\u0441\u043B\u043E\u0432\u043B\u044F\u0435\u0442",
    "\u043F\u0438\u0441\u0430\u0435\u0442\u0441\u044F \u043A\u043E\u0433\u0434\u0430 \u0435\u0433\u043E \u0442\u0440\u043E\u0433\u0430\u044E\u0442",
    "\u043F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E \u0443\u0431\u0438\u0440\u0430\u0435\u0442\u0441\u044F",
    "\u0434\u0435\u0432\u0441\u0442\u0432\u0435\u043D\u043D\u0438\u043A",
    "\u0430\u043A\u0442\u0438\u0432\u0438\u0441\u0442 \u0433\u0440\u0438\u043D\u043F\u0438\u0441\u0430",
    "\u043D\u0435\u043D\u0430\u0432\u0438\u0434\u0438\u0442 \u0434\u0435\u0442\u0435\u0439",
    "\u0434\u043E\u0432\u043E\u0434\u0438\u0442 \u0434\u043E \u043E\u0440\u0433\u0430\u0437\u043C\u0430 \u0448\u0435\u043F\u043E\u0442\u043E\u043C",
    "\u043A\u0440\u0430\u0439\u043D\u0435 \u0441\u0435\u043A\u0441\u0443\u0430\u043B\u0435\u043D",
    "\u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440 \u043A\u0432\u0438\u0437\u043E\u0432 \u0438 \u0432\u0438\u043A\u0442\u043E\u0440\u0438\u043D",
    "\u043F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E \u0441\u043C\u043E\u0442\u0440\u0438\u0442 \u043F\u043E\u0440\u0435\u0432\u043E",
    "\u043D\u0435 \u043B\u044E\u0431\u0438\u0442 \u043A\u043E\u0448\u0435\u043A",
    "\u0447\u0438\u0442\u0430\u0435\u0442 \u043C\u044B\u0441\u043B\u0438",
    "\u043A\u0443\u0441\u0430\u0435\u0442 \u043E\u043A\u0440\u0443\u0436\u0430\u044E\u0449\u0438\u0445",
    "\u043C\u0430\u0441\u0442\u0443\u0440\u0431\u0438\u0440\u0443\u0435\u0442 \u043F\u0440\u0438 \u043E\u043A\u0440\u0443\u0436\u0430\u044E\u0449\u0438\u0445",
    "\u0440\u0430\u0437\u0433\u043E\u0432\u0430\u0440\u0438\u0432\u0430\u0435\u0442 \u0441 \u0443\u043C\u0435\u0440\u0448\u0438\u043C\u0438",
    "\u043F\u0440\u043E\u043A\u043B\u044F\u0442 \u0446\u044B\u0433\u0430\u043D\u043A\u043E\u0439",
    "\u043F\u0440\u0435\u0434\u0432\u0438\u0434\u0438\u0442 \u0431\u0443\u0434\u0443\u0449\u0435\u0435 \u043D\u0430 10 \u0441\u0435\u043A\u0443\u043D\u0434 \u0432\u043F\u0435\u0440\u0435\u0434",
    "\u0431\u043E\u043B\u044C\u0448\u0430\u044F \u0433\u0440\u0443\u0434\u044C \u043D\u0430 \u0441\u043F\u0438\u043D\u0435",
    "\u0430\u043D\u0430\u0440\u0445\u0438\u0441\u0442",
    "\u0432 \u0440\u043E\u0437\u044B\u0441\u043A\u0435 \u0438\u043D\u0442\u0435\u0440\u043F\u043E\u043B\u0430",
    "\u043E\u0431\u043B\u0438\u0437\u044B\u0432\u0430\u0435\u0442 \u043E\u043A\u0440\u0443\u0436\u0430\u044E\u0449\u0438\u0445",
    "\u0444\u043E\u0431\u0438\u044F \u0442\u0435\u0445\u043D\u0438\u043A\u0438 \u0438 \u0438\u0437\u043B\u0443\u0447\u0435\u043D\u0438\u044F",
    "\u0445\u043E\u0434\u044F\u0447\u0438\u0439 \u043A\u0430\u043B\u044C\u043A\u0443\u043B\u044F\u0442\u043E\u0440",
    "\u043F\u0440\u0435\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u0432\u043E\u0434\u0443 \u0432 \u0432\u0438\u043D\u043E",
    "\u0441\u0431\u0435\u0436\u0430\u043B \u0438\u0437 \u0442\u044E\u0440\u044C\u043C\u044B",
    "\u0434\u0430\u0435\u0442 \u0441\u043E\u0432\u0435\u0442\u044B \u0432\u043E \u0432\u0440\u0435\u043C\u044F \u0441\u0435\u043A\u0441\u0430",
    "\u0441\u043F\u0438\u0442 \u0441\u0443\u0442\u043A\u0430\u043C\u0438",
    "\u0432\u043E\u0440\u0443\u0435\u0442 \u0435\u0434\u0443",
    "\u0432\u043E\u0441\u043F\u0438\u0442\u0430\u043D \u0432\u043E\u043B\u043A\u0430\u043C\u0438",
    "\u043F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E \u0435\u0441\u0442 \u0447\u0435\u0441\u043D\u043E\u043A",
    "\u0432\u0441\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u043B\u044E\u0431\u044B\u0435 \u0437\u0430\u043C\u043A\u0438",
    "\u043D\u0435 \u043D\u043E\u0441\u0438\u0442 \u0442\u0440\u0443\u0441\u044B",
    "\u043D\u0435 \u0441\u0442\u0438\u0440\u0430\u0435\u0442 \u043E\u0434\u0435\u0436\u0434\u0443",
    "\u043D\u0435 \u0447\u0438\u0441\u0442\u0438\u0442 \u0437\u0443\u0431\u044B",
    "\u0441\u0442\u0430\u0432\u0438\u0442 \u0434\u0438\u0430\u0433\u043D\u043E\u0437 \u043F\u043E \u0430\u0432\u0430\u0442\u0430\u0440\u043A\u0435",
    "\u0441\u0442\u0440\u0435\u043B\u043E\u043A \u0441 \u043E\u043B\u0438\u043C\u043F\u0438\u0439\u0441\u043A\u0438\u0445 \u0438\u0433\u0440",
    "\u0433\u043E\u0432\u043E\u0440\u0438\u0442 \u0440\u0430\u0437\u043D\u044B\u043C\u0438 \u0433\u043E\u043B\u043E\u0441\u0430\u043C\u0438",
    "\u0447\u0430\u0441\u0430\u043C\u0438 \u0441\u0438\u0434\u0438\u0442 \u0432 \u0442\u0443\u0430\u043B\u0435\u0442\u0435",
    "\u043F\u043E\u0432\u0435\u043B\u0435\u0432\u0430\u0435\u0442 \u043D\u0430\u0441\u0435\u043A\u043E\u043C\u044B\u043C\u0438",
    "6 \u043F\u0430\u043B\u044C\u0446\u0435\u0432 \u043D\u0430 \u0440\u0443\u043A\u0430\u0445",
    "\u043F\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u0432\u043E\u0437\u0434\u0443\u0445\u043E\u043C",
    "\u0433\u0440\u044B\u0437\u0435\u0442 \u043F\u0440\u043E\u0432\u043E\u0434\u0430",
    "\u0435\u0437\u0434\u0438\u0442 \u043D\u0430 \u0441\u0430\u043C\u043E\u043A\u0430\u0442\u0435 \u0438 \u0441\u0431\u0438\u0432\u0430\u0435\u0442 \u0441\u0442\u0430\u0440\u0443\u0448\u0435\u043A",
    "\u0437\u043D\u0430\u0435\u0442 \u043D\u0430\u0438\u0437\u0443\u0441\u0442\u044C \u0432\u0441\u0435 \u0441\u0432\u044F\u0449\u0435\u043D\u043D\u044B\u0435 \u043A\u043D\u0438\u0433\u0438",
    "\u043F\u0430\u0445\u043D\u0435\u0442 \u0442\u0443\u0430\u043B\u0435\u0442\u043D\u044B\u043C \u043E\u0441\u0432\u0435\u0436\u0438\u0442\u0435\u043B\u0435\u043C",
    "\u043E\u0442\u0431\u0438\u0440\u0430\u0435\u0442 \u043A\u043E\u043D\u0444\u0435\u0442\u044B \u0443 \u0434\u0435\u0442\u0435\u0439",
    "\u0444\u043E\u0431\u0438\u044F \u0432\u043E\u043B\u043E\u0441\u0430\u0442\u043E\u0439 \u0433\u0440\u0443\u0434\u0438",
    "\u0441\u0441\u044B\u0442 \u0432\u0441\u0435\u0433\u0434\u0430 \u043C\u0438\u043C\u043E"
  ];
  var HOBBIES = [
    "\u041B\u044E\u0431\u0438\u0442\u0435\u043B\u044C\u0441\u043A\u0430\u044F \u0440\u0430\u0434\u0438\u043E\u0441\u0432\u044F\u0437\u044C",
    "\u0441\u043E\u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E\u0435 \u0438\u0441\u043A\u0443\u0441\u0441\u0442\u0432\u043E",
    "\u0440\u0430\u0437\u0433\u043E\u0432\u043E\u0440\u044B \u043F\u043E \u0434\u0443\u0448\u0430\u043C",
    "\u0443\u0444\u043E\u043B\u043E\u0433\u0438\u044F \u0438 \u043C\u0438\u0441\u0442\u0438\u043A\u0430",
    "\u043D\u0435\u0442\u0440\u0430\u0434\u0438\u0446\u0438\u043E\u043D\u043D\u0430\u044F \u043C\u0435\u0434\u0438\u0446\u0438\u043D\u0430",
    "\u0445\u043E\u043B\u043E\u0434\u043D\u043E\u0435 \u043E\u0440\u0443\u0436\u0438\u0435",
    "\u043C\u0430\u0441\u0441\u0430\u0436 \u0438 \u0430\u043A\u0443\u043F\u0443\u043D\u043A\u0442\u0443\u0440\u0430",
    "\u0440\u043E\u0431\u043E\u0442\u043E\u0442\u0435\u0445\u043D\u0438\u043A\u0430",
    "\u0431\u043E\u043A\u0441",
    "\u0433\u0440\u0438\u0431\u044B \u0438 \u0433\u043E\u043C\u0435\u043E\u043F\u0430\u0442\u0438\u044F",
    "\u0441\u043F\u043E\u0440\u0442\u0438\u0432\u043D\u044B\u0435 \u0442\u0430\u043D\u0446\u044B",
    "\u0438\u0433\u0440\u0430\u0442\u044C \u0432 \u043A\u043E\u043C\u043F",
    "\u0444\u043B\u0443\u0434\u0438\u0442\u044C \u0432 \u0447\u0430\u0442\u0430\u0445",
    "\u043E\u0445\u043E\u0442\u0430 \u0438 \u0440\u044B\u0431\u0430\u043B\u043A\u0430",
    "\u0441\u0438\u0434\u0435\u0442\u044C \u0432 \u0434\u0432\u0430\u0447\u0435",
    "\u0434\u043E\u043A\u0441\u0438\u0442\u044C \u0434\u0435\u0442\u0435\u0439",
    "\u0433\u0438\u0434\u0440\u043E\u043F\u043E\u043D\u0438\u043A\u0430",
    "\u043D\u0430\u0441\u0442\u043E\u043B\u044C\u043D\u044B\u0435 \u0438\u0433\u0440\u044B",
    "\u0447\u0435\u0440\u043D\u0430\u044F \u043C\u0430\u0433\u0438\u044F",
    "\u043F\u0438\u0440\u043E\u0442\u0435\u0445\u043D\u0438\u043A\u0430",
    "\u0441\u0432\u0438\u043D\u0433 \u0432\u0435\u0447\u0435\u0440\u0438\u043D\u043A\u0438",
    "\u043A\u0440\u0430\u0435\u0432\u0435\u0434\u0435\u043D\u0438\u0435",
    "\u043A\u0438\u043D\u043E \u0438 \u0441\u0435\u0440\u0438\u0430\u043B\u044B",
    "\u0432\u0443\u0430\u0439\u0435\u0440\u0438\u0437\u043C",
    "\u043C\u0435\u0434\u0438\u0442\u0430\u0446\u0438\u044F",
    "\u043D\u0435\u0442\u0432\u043E\u0440\u043A\u0438\u043D\u0433",
    "\u043F\u0438\u0432\u043E\u0432\u0430\u0440\u0435\u043D\u0438\u0435",
    "\u0430\u043B\u0445\u0438\u043C\u0438\u044F",
    "\u0441\u0442\u0440\u0438\u043F\u0442\u0438\u0437",
    "\u0434\u0430\u0447\u043D\u0438\u043A",
    "\u043F\u0430\u0440\u043A\u0443\u0440",
    "\u0437\u043E\u0436",
    "\u043E\u043D\u043B\u0438\u0444\u0430\u043D\u0441",
    "\u043B\u0435\u0436\u0430\u0442\u044C \u043D\u0430 \u0434\u0438\u0432\u0430\u043D\u0435",
    "\u0442\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0441\u0442\u0440\u0435\u043B\u044C\u0431\u0430",
    "\u043A\u0430\u0440\u0442\u0438\u043D\u0433",
    "\u0448\u0430\u0445\u043C\u0430\u0442\u044B",
    "\u0447\u0442\u0435\u043D\u0438\u0435 \u043A\u043D\u0438\u0433",
    "\u0444\u0430\u043D\u0444\u0438\u043A\u0438",
    "\u0444\u0443\u0442\u0431\u043E\u043B",
    "\u043F\u043B\u0430\u0432\u0430\u043D\u0438\u0435",
    "\u0441\u043F\u043E\u0440\u0442\u0438\u0432\u043D\u044B\u0439 \u0442\u0443\u0440\u0438\u0437\u043C",
    "\u043E\u0440\u0438\u0435\u043D\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u043D\u0430 \u043C\u0435\u0441\u0442\u043D\u043E\u0441\u0442\u0438",
    "\u0432\u0435\u043B\u043E\u0441\u043F\u043E\u0440\u0442",
    "\u0432\u0435\u0447\u0435\u0440\u0438\u043D\u043A\u0438",
    "\u043D\u0430\u0441\u0442\u043E\u043B\u044C\u043D\u044B\u0439 \u0442\u0435\u043D\u043D\u0438\u0441",
    "\u0432\u044B\u0448\u0438\u0432\u0430\u043D\u0438\u0435",
    "\u0431\u0430\u0441\u043A\u0435\u0442\u0431\u043E\u043B",
    "\u043C\u0435\u0442\u0430\u043D\u0438\u0435 \u043A\u043E\u043F\u044C\u044F",
    "\u0441\u0442\u0440\u0435\u043B\u044C\u0431\u0430 \u0438\u0437 \u043B\u0443\u043A\u0430",
    "\u0443\u0440\u0438\u043D\u043E\u0442\u0435\u0440\u0430\u043F\u0438\u044F",
    "\u043E\u0445\u043E\u0442\u0430 \u043D\u0430 \u043C\u0435\u0434\u0432\u0435\u0434\u0435\u0439",
    "\u043F\u0447\u0435\u043B\u043E\u043B\u043E\u0432\u043E\u0434\u0441\u0442\u0432\u043E",
    "\u0436\u043E\u043D\u0433\u043B\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435",
    "\u0442\u0430\u043A\u0441\u0438\u0434\u0435\u0440\u043C\u0438\u044F",
    "\u0444\u0435\u0445\u0442\u043E\u0432\u0430\u043D\u0438\u0435",
    "\u0433\u043E\u0440\u043E\u0441\u043A\u043E\u043F\u044B",
    "\u0440\u0430\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u0435 \u0434\u043E\u043C\u0430\u0448\u043D\u0438\u0445 \u0436\u0438\u0432\u043E\u0442\u043D\u044B\u0445",
    "\u043A\u0440\u0435\u0441\u0442\u043E\u0432\u044B\u0435 \u043F\u043E\u0445\u043E\u0434\u044B",
    "\u0440\u0435\u0441\u0442\u0430\u0432\u0440\u0430\u0446\u0438\u044F \u043F\u0438\u0441\u0441\u0443\u0430\u0440\u043E\u0432",
    "\u0430\u043B\u044C\u043F\u0438\u043D\u0438\u0437\u043C",
    "\u0440\u043E\u043B\u0435\u0432\u044B\u0435 \u0438\u0433\u0440\u044B 18+",
    "\u043F\u0438\u043A\u0430\u043F\u0435\u0440\u0441\u0442\u0432\u043E",
    "\u043D\u0443\u043C\u0435\u0440\u043E\u043B\u043E\u0433\u0438\u044F",
    "\u0445\u0438\u043C\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043E\u043F\u044B\u0442\u044B",
    "\u0441\u0436\u0438\u0433\u0430\u043D\u0438\u0435 \u0432\u0435\u0434\u044C\u043C",
    "\u043C\u0430\u0440\u0430\u0444\u043E\u043D\u044B",
    "\u0434\u0430\u0432\u0430\u0442\u044C \u0432\u0437\u044F\u0442\u043A\u0438",
    "\u0432\u0438\u0440\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u0439 \u0441\u0435\u043A\u0441",
    "\u0431\u043E\u043D\u0441\u0430\u0439",
    "\u0441\u043B\u0443\u0447\u0430\u0439\u043D\u044B\u0435 \u0441\u0435\u043A\u0441 \u0432\u0437\u044F\u0442\u043A\u0438",
    "\u043E\u0445\u043E\u0442\u0430 \u043D\u0430 \u0432\u0430\u043C\u043F\u0438\u0440\u043E\u0432",
    "\u043E\u0445\u043E\u0442\u0430 \u0437\u0430 \u043F\u0440\u0438\u0432\u0438\u0434\u0435\u043D\u0438\u044F\u043C\u0438",
    "\u0441\u0442\u0435\u043D\u0434\u0430\u043F",
    "\u0432\u0435\u0440\u0445\u043E\u0432\u0430\u044F \u0435\u0437\u0434\u0430",
    "\u043C\u0438\u0444\u043E\u043B\u043E\u0433\u0438\u044F",
    "\u043A\u0440\u043E\u0441\u0441\u0432\u043E\u0440\u0434\u044B",
    "\u0438\u043A\u043E\u043D\u043E\u043F\u0438\u0441\u044C",
    "\u0447\u0430\u0439\u043D\u044B\u0435 \u0446\u0435\u0440\u0435\u043C\u043E\u043D\u0438\u0438",
    "\u044D\u043A\u0441\u0433\u0438\u0431\u0438\u0446\u0438\u043E\u043D\u0438\u0437\u043C",
    "\u0439\u043E\u0433\u0430",
    "\u043B\u0435\u043F\u043A\u0430 \u043F\u0435\u043B\u044C\u043C\u0435\u043D\u0435\u0439"
  ];
  var BAGGAGE = [
    "\u0410\u043D\u0442\u0438\u0431\u0438\u043E\u0442\u0438\u043A\u0438 \u0438 \u043E\u0431\u0435\u0437\u0431\u043E\u043B\u0438\u0432\u0430\u044E\u0449\u0438\u0435",
    "\u041F\u0435\u0440\u0435\u043D\u043E\u0441\u043D\u0430\u044F \u044D\u043B\u0435\u043A\u0442\u0440\u043E\u0441\u0442\u0430\u043D\u0446\u0438\u044F",
    "\u043A\u043E\u043C\u043F\u0430\u0441 \u0438 \u043A\u0430\u0440\u0442\u0430 \u043E\u043A\u0440\u0435\u0441\u0442\u043D\u043E\u0441\u0442\u0435\u0439",
    "\u0441\u0430\u0436\u0435\u043D\u0446\u044B \u0444\u0440\u0443\u043A\u0442\u043E\u0432\u044B\u0445 \u0434\u0435\u0440\u0435\u0432\u044C\u0435\u0432",
    "\u0437\u0432\u0443\u043A\u043E\u0432\u0430\u044F \u043E\u0442\u0432\u0435\u0440\u0442\u043A\u0430",
    "\u0438\u043D\u043A\u0443\u0431\u0430\u0442\u043E\u0440 \u0441 \u043D\u0430\u0431\u043E\u0440\u043E\u043C \u044F\u0438\u0446 \u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0433\u043E \u043F\u0440\u043E\u0438\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F",
    "\u043A\u043D\u0438\u0433\u0438 \u0410\u0439\u0437\u0435\u043A\u0430 \u0410\u0437\u0438\u043C\u043E\u0432\u0430",
    "\u043D\u043E\u0443\u0442\u0431\u0443\u043A \u0438 \u043F\u043B\u0430\u0442\u044B \u0430\u0440\u0434\u0443\u0438\u043D\u043E",
    "\u0441\u043D\u0430\u0439\u043F\u0435\u0440\u0441\u043A\u0430\u044F \u0432\u0438\u043D\u0442\u043E\u0432\u043A\u0430",
    "\u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u044B \u044D\u043B\u0435\u043A\u0442\u0440\u0438\u043A\u0430",
    "\u0441\u0442\u043E\u043B\u044F\u0440\u043D\u044B\u0435 \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u044B",
    "\u043F\u0440\u0438\u0431\u043E\u0440 \u043D\u043E\u0447\u043D\u043E\u0433\u043E \u0432\u0438\u0434\u0435\u043D\u0438\u044F",
    "\u044D\u043D\u0446\u0438\u043A\u043B\u043E\u043F\u0435\u0434\u0438\u044F \u0433\u0440\u0438\u0431\u043D\u0438\u043A\u0430",
    "\u0441\u043F\u0438\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0434\u043E\u0441\u043A\u0430",
    "\u043A\u0430\u043F\u043A\u0430\u043D\u044B \u0438 \u043D\u0430\u0431\u043E\u0440 \u044F\u0434\u043E\u0432",
    "\u0447\u0435\u043C\u043E\u0434\u0430\u043D \u0441 \u043C\u0438\u043B\u043B\u0438\u043E\u043D\u043E\u043C \u0434\u043E\u043B\u043B\u0430\u0440\u043E\u0432",
    "\u043D\u043E\u0436\u0438 \u0434\u043B\u044F \u043C\u0435\u0442\u0430\u043D\u0438\u044F",
    "\u043C\u0430\u0441\u043A\u0438\u0440\u043E\u0432\u043E\u0447\u043D\u044B\u0439 \u043A\u043E\u0441\u0442\u044E\u043C",
    "\u043C\u0435\u0448\u043E\u043A \u043A\u0430\u0440\u0442\u043E\u0448\u043A\u0438",
    "\u043D\u0430\u0434\u0443\u0432\u043D\u0430\u044F \u043A\u0443\u043A\u043B\u0430",
    "\u043D\u0430\u0441\u0442\u043E\u043B\u044C\u043D\u044B\u0435 \u0438\u0433\u0440\u044B",
    "\u043D\u0430\u0431\u043E\u0440 \u043E\u0442\u043C\u044B\u0447\u0435\u043A",
    "\u0434\u0435\u0444\u0438\u0431\u0440\u0438\u043B\u043B\u044F\u0442\u043E\u0440",
    "\u0448\u0430\u043F\u043E\u0447\u043A\u0430 \u0438\u0437 \u0444\u043E\u043B\u044C\u0433\u0438",
    "\u043C\u0435\u0448\u043E\u043A \u0437\u0435\u0440\u043D\u0430",
    "\u043A\u0443\u043A\u043B\u0430 \u0432\u0443\u0434\u0443",
    "\u043B\u0443\u043A \u0438 \u0441\u0442\u0440\u0435\u043B\u044B",
    "\u043F\u0438\u0441\u0442\u043E\u043B\u0435\u0442",
    "\u0433\u0438\u0442\u0430\u0440\u0430",
    "\u0447\u0435\u043C\u043E\u0434\u0430\u043D\u0447\u0438\u043A \u0444\u0435\u043B\u044C\u0434\u0448\u0435\u0440\u0430",
    "\u0432\u0438\u0431\u0440\u0430\u0442\u043E\u0440",
    "\u0440\u0430\u0441\u0447\u043B\u0435\u043D\u0435\u043D\u043D\u044B\u0439 \u0442\u0440\u0443\u043F \u0432 \u043C\u0435\u0448\u043A\u0435 (\u0435\u0433\u043E \u0443\u0431\u0438\u0432\u0430\u043B \u043D\u0435 \u0432\u0430\u0448 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u0436)",
    "\u0440\u0430\u043A\u0435\u0442\u043D\u0438\u0446\u0430 \u0441 \u0441\u0438\u0433\u043D\u0430\u043B\u044C\u043D\u044B\u043C\u0438 \u0440\u0430\u043A\u0435\u0442\u0430\u043C\u0438",
    "\u0441\u043A\u043B\u0430\u0434\u043D\u0430\u044F \u043B\u043E\u0434\u043A\u0430",
    "\u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u044B \u0441\u043B\u0435\u0441\u0430\u0440\u044F",
    "\u0442\u043E\u043F\u043E\u0440",
    "\u0434\u0432\u0435 \u0440\u0430\u0446\u0438\u0438",
    "\u0438\u0433\u0440\u043E\u0432\u043E\u0439 \u043D\u043E\u0443\u0442\u0431\u0443\u043A",
    '\u043F\u043E\u0434\u0448\u0438\u0432\u043A\u0430 \u0436\u0443\u0440\u043D\u0430\u043B\u043E\u0432 "Playboy" \u0441 1973 \u043F\u043E 2030 \u0433\u043E\u0434\u044B',
    "\u0431\u0430\u043D\u043A\u0430 \u044D\u043D\u0435\u0440\u0433\u0435\u0442\u0438\u043A\u0430",
    "\u0437\u043E\u043D\u0442\u0438\u043A",
    "\u0434\u0440\u043E\u0431\u043E\u0432\u0438\u043A \u0441 \u043D\u0435\u0431\u043E\u043B\u044C\u0448\u0438\u043C \u0437\u0430\u043F\u0430\u0441\u043E\u043C \u043F\u0430\u0442\u0440\u043E\u043D\u043E\u0432",
    "\u043A\u0430\u0440\u043B\u0438\u043A\u043E\u0432\u044B\u0439 \u0433\u0438\u0433\u0430\u043D\u0442\u0441\u043A\u0438\u0439 \u043A\u043E\u0441\u043C\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0445\u043E\u043C\u044F\u043A",
    "\u043D\u043E\u0448\u0435\u043D\u044B\u0435 \u0440\u043E\u0437\u043E\u0432\u044B\u0435 \u0441\u0442\u0440\u0438\u043D\u0433\u0438",
    "\u043C\u0430\u043D\u0442\u0438\u044F \u041A\u0443-\u043A\u043B\u0443\u043A\u0441-\u043A\u043B\u0430\u043D\u0430",
    "\u0441\u043E\u043B\u043D\u0435\u0447\u043D\u0430\u044F \u0431\u0430\u0442\u0430\u0440\u0435\u044F",
    "\u0434\u0432\u0430 \u043F\u0440\u043E\u0442\u0438\u0432\u043E\u0433\u0430\u0437\u0430 \u0438 \u0444\u0438\u043B\u044C\u0442\u0440\u044B \u043A \u043D\u0438\u043C",
    "\u0430\u0432\u0442\u043E\u043C\u043E\u0431\u0438\u043B\u044C\u043D\u0430\u044F \u0430\u043F\u0442\u0435\u0447\u043A\u0430",
    "\u043A\u0430\u043D\u0438\u0441\u0442\u0440\u0430 \u0441 \u0431\u0435\u043D\u0437\u0438\u043D\u043E\u043C",
    "\u043E\u0433\u043D\u0435\u0442\u0443\u0448\u0438\u0442\u0435\u043B\u044C",
    "\u0445\u043E\u043C\u044F\u0447\u043A\u0438",
    "\u0431\u0440\u0438\u043A\u0435\u0442 \u043C\u0430\u0440\u0438\u0445\u0443\u0430\u043D\u044B 3 \u043A\u0433",
    "\u0441\u043F\u0443\u0442\u043D\u0438\u043A\u043E\u0432\u044B\u0439 \u0442\u0435\u043B\u0435\u0444\u043E\u043D",
    "\u0432\u0435\u0440\u0435\u0432\u043A\u0430 \u0438 \u043C\u044B\u043B\u043E",
    "\u0433\u0440\u0430\u043D\u0430\u0442\u0430",
    "\u0442\u043E\u0441\u0442\u0435\u0440",
    "\u0432\u0435\u0434\u0440\u043E \u043C\u0430\u0439\u043E\u043D\u0435\u0437\u0430",
    "\u043A\u0435\u0440\u043E\u0441\u0438\u043D\u043E\u0432\u0430\u044F \u043B\u0430\u043C\u043F\u0430",
    "\u043F\u043B\u0435\u0439\u0441\u0442\u0435\u0439\u0448\u043D 5",
    "\u0440\u0430\u0434\u0438\u043E\u043F\u0440\u0438\u0435\u043C\u043D\u0438\u043A",
    "\u0442\u043E\u043F\u043E\u0440",
    "\u043F\u043B\u044E\u0448\u0435\u0432\u044B\u0439 \u043C\u0438\u0448\u043A\u0430",
    "\u0440\u043E\u0431\u043E\u0442 \u043F\u044B\u043B\u0435\u0441\u043E\u0441",
    "\u043C\u0435\u0448\u043E\u043A \u043D\u0430\u0432\u043E\u0437\u0430",
    "\u0444\u0438\u043B\u044C\u0442\u0440 \u0434\u043B\u044F \u0432\u043E\u0434\u044B",
    "\u043A\u043E\u0440\u043E\u0431\u043A\u0430 \u043F\u0440\u0435\u0437\u0435\u0440\u0432\u0430\u0442\u0438\u0432\u043E\u0432",
    "\u0434\u0436\u0435\u0434\u0430\u0439\u0441\u043A\u0438\u0439 \u043C\u0435\u0447",
    "\u043A\u0430\u043C\u0430\u0441\u0443\u0442\u0440\u0430",
    "\u043C\u0430\u043B\u0435\u043D\u044C\u043A\u0430\u044F \u0441\u043E\u0431\u0430\u0447\u043E\u043D\u043A\u0430",
    "\u0431\u0430\u043D\u043D\u0430\u044F \u0448\u0430\u043F\u043E\u0447\u043A\u0430",
    "\u043C\u0430\u0448\u0438\u043D\u0430 \u0434\u043B\u044F \u043F\u043E\u043F\u043A\u043E\u0440\u043D\u0430",
    "\u043F\u0430\u044F\u043B\u044C\u043D\u0438\u043A",
    "\u0431\u0430\u044F\u043D",
    "\u043C\u0430\u0437\u044C \u0437\u0432\u0435\u0437\u0434\u043E\u0447\u043A\u0430",
    "\u043A\u0443\u043C\u044B\u0441",
    "\u0431\u0438\u043D\u043E\u043A\u043B\u044C",
    "\u043F\u043E\u0440\u043D\u043E\u0436\u0443\u0440\u043D\u0430\u043B\u044B",
    "\u043A\u043E\u043B\u043E\u0434\u0430 \u0441 \u043A\u0430\u0440\u0442\u0430\u043C\u0438 \u043D\u0430 52 \u043A\u0430\u0440\u0442\u044B",
    "\u043F\u0438\u043A\u0438 \u0442\u043E\u0447\u0435\u043D\u044B\u0435",
    "\u0441\u0443\u0445\u043E\u0439 \u0441\u043F\u0438\u0440\u0442"
  ];
  var SPECIAL_CARDS = [
    {
      "id": 1,
      "text": "\u0412\u0437\u044F\u043B \u0441 \u0441\u043E\u0431\u043E\u0439: \u0440\u0430\u0437\u044B\u0433\u0440\u0430\u0439 \u043A\u0430\u0440\u0442\u0443, \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 \u0442\u044B \u0438\u0437\u0433\u043D\u0430\u043D. \u041F\u043E\u043A\u0430 \u0432\u0441\u0435 \u0431\u044B\u043B\u0438 \u043E\u0442\u0432\u043B\u0435\u0447\u0435\u043D\u044B, \u0447\u0442\u043E-\u0442\u043E \u043F\u0440\u043E\u043F\u0430\u043B\u043E \u0438\u0437 \u0431\u0443\u043D\u043A\u0435\u0440\u0430. \u0417\u0430\u0431\u0435\u0440\u0438 \u043B\u044E\u0431\u0443\u044E \u043E\u0442\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u2014 \u0442\u0435\u043F\u0435\u0440\u044C \u043E\u043D\u0430 \u0443 \u0438\u0437\u0433\u043D\u0430\u043D\u043D\u044B\u0445."
    },
    {
      "id": 2,
      "text": "\u0411\u0443\u0434\u044C \u0434\u0440\u0443\u0433\u043E\u043C: \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u0438\u0433\u0440\u043E\u043A \u0434\u043E \u043A\u043E\u043D\u0446\u0430 \u0438\u0433\u0440\u044B \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0442\u0438\u0432 \u0442\u0435\u0431\u044F."
    },
    {
      "id": 3,
      "text": "\u0412\u043A\u043B\u044E\u0447\u0438\u043B \u0441\u0432\u0435\u0442: \u0437\u0430\u043C\u0435\u043D\u0438 \u043B\u044E\u0431\u0443\u044E \u043E\u0442\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u043D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u0443\u044E \u0438\u0437 \u043A\u043E\u043B\u043E\u0434\u044B."
    },
    {
      "id": 4,
      "text": "\u0413\u0440\u043E\u043C\u043A\u0438\u0439 \u0433\u043E\u043B\u043E\u0441: \u0432 \u044D\u0442\u043E\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438 \u0442\u0432\u043E\u0439 \u0433\u043E\u043B\u043E\u0441 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u0437\u0430 \u0434\u0432\u0430."
    },
    {
      "id": 5,
      "text": "\u0414\u0430\u0432\u0430\u0439\u0442\u0435 \u043D\u0430\u0447\u0438\u0441\u0442\u043E\u0442\u0443: \u0441\u043E\u0431\u0435\u0440\u0438 \u0432\u0441\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0435 \u043A\u0430\u0440\u0442\u044B \u0431\u0430\u0433\u0430\u0436\u0430 \u0443 \u043E\u0441\u0442\u0430\u0432\u0448\u0438\u0445\u0441\u044F \u0438\u0433\u0440\u043E\u043A\u043E\u0432, \u043F\u0435\u0440\u0435\u043C\u0435\u0448\u0430\u0439 \u0438 \u0440\u0430\u0437\u0434\u0430\u0439 \u0437\u0430\u043D\u043E\u0432\u043E."
    },
    {
      "id": 6,
      "text": "\u0414\u0430\u0432\u0430\u0439\u0442\u0435 \u043D\u0430\u0447\u0438\u0441\u0442\u043E\u0442\u0443: \u0441\u043E\u0431\u0435\u0440\u0438 \u0432\u0441\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0435 \u043A\u0430\u0440\u0442\u044B \u0431\u0438\u043E\u043B\u043E\u0433\u0438\u0438 \u0443 \u043E\u0441\u0442\u0430\u0432\u0448\u0438\u0445\u0441\u044F \u0438\u0433\u0440\u043E\u043A\u043E\u0432, \u043F\u0435\u0440\u0435\u043C\u0435\u0448\u0430\u0439 \u0438 \u0440\u0430\u0437\u0434\u0430\u0439 \u0437\u0430\u043D\u043E\u0432\u043E."
    },
    {
      "id": 7,
      "text": "\u0414\u0430\u0432\u0430\u0439\u0442\u0435 \u043D\u0430\u0447\u0438\u0441\u0442\u043E\u0442\u0443: \u0441\u043E\u0431\u0435\u0440\u0438 \u0432\u0441\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0435 \u043A\u0430\u0440\u0442\u044B \u0445\u043E\u0431\u0431\u0438 \u0443 \u043E\u0441\u0442\u0430\u0432\u0448\u0438\u0445\u0441\u044F \u0438\u0433\u0440\u043E\u043A\u043E\u0432, \u043F\u0435\u0440\u0435\u043C\u0435\u0448\u0430\u0439 \u0438 \u0440\u0430\u0437\u0434\u0430\u0439 \u0437\u0430\u043D\u043E\u0432\u043E."
    },
    {
      "id": 8,
      "text": "\u0414\u0430\u0432\u0430\u0439\u0442\u0435 \u043D\u0430\u0447\u0438\u0441\u0442\u043E\u0442\u0443: \u0441\u043E\u0431\u0435\u0440\u0438 \u0432\u0441\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0435 \u043A\u0430\u0440\u0442\u044B \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F \u0443 \u043E\u0441\u0442\u0430\u0432\u0448\u0438\u0445\u0441\u044F \u0438\u0433\u0440\u043E\u043A\u043E\u0432, \u043F\u0435\u0440\u0435\u043C\u0435\u0448\u0430\u0439 \u0438 \u0440\u0430\u0437\u0434\u0430\u0439 \u0437\u0430\u043D\u043E\u0432\u043E."
    },
    {
      "id": 9,
      "text": "\u0414\u0430\u0432\u0430\u0439\u0442\u0435 \u043D\u0430\u0447\u0438\u0441\u0442\u043E\u0442\u0443: \u0441\u043E\u0431\u0435\u0440\u0438 \u0432\u0441\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0435 \u043A\u0430\u0440\u0442\u044B \u0444\u0430\u043A\u0442\u043E\u0432 \u0443 \u043E\u0441\u0442\u0430\u0432\u0448\u0438\u0445\u0441\u044F \u0438\u0433\u0440\u043E\u043A\u043E\u0432, \u043F\u0435\u0440\u0435\u043C\u0435\u0448\u0430\u0439 \u0438 \u0440\u0430\u0437\u0434\u0430\u0439 \u0437\u0430\u043D\u043E\u0432\u043E."
    },
    {
      "id": 10,
      "text": "\u0417\u0430\u0449\u0438\u0442\u0438 \u0438\u0433\u0440\u043E\u043A\u0430 \u043F\u0435\u0440\u0435\u0434 \u0441\u043E\u0431\u043E\u0439: \u0445\u0440\u0430\u043D\u0438 \u043A\u0430\u0440\u0442\u0443 \u0432 \u0442\u0430\u0439\u043D\u0435. \u0415\u0441\u043B\u0438 \u0438\u0433\u0440\u043E\u043A\u0430 \u043F\u0435\u0440\u0435\u0434 \u0442\u043E\u0431\u043E\u0439 \u0438\u0437\u0433\u043E\u043D\u044F\u0442, \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438 \u0442\u044B \u043E\u0431\u044F\u0437\u0430\u043D \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0442\u0438\u0432 \u0441\u0435\u0431\u044F. \u041D\u0430 \u043E\u0431\u0449\u0435\u043C \u043E\u0431\u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0438 \u0435\u0433\u043E \u043D\u0443\u0436\u043D\u043E \u0437\u0430\u0449\u0438\u0449\u0430\u0442\u044C."
    },
    {
      "id": 11,
      "text": "\u0414\u0438\u0432\u0435\u0440\u0441\u0438\u044F: \u0440\u0430\u0437\u044B\u0433\u0440\u0430\u0439 \u043A\u0430\u0440\u0442\u0443, \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 \u0442\u044B \u0438\u0437\u0433\u043D\u0430\u043D. \u041F\u043E\u043A\u0430 \u0432\u0441\u0435 \u0431\u044B\u043B\u0438 \u043E\u0442\u0432\u043B\u0435\u0447\u0435\u043D\u044B, \u043A\u0442\u043E-\u0442\u043E \u043F\u0440\u043E\u043D\u0438\u043A \u0432 \u0431\u0443\u043D\u043A\u0435\u0440. \u0421\u0431\u0440\u043E\u0441\u044C \u043B\u044E\u0431\u0443\u044E \u043E\u0442\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0431\u0443\u043D\u043A\u0435\u0440\u0430."
    },
    {
      "id": 12,
      "text": "\u0422\u0435\u0431\u044F \u043D\u0435 \u0441\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u043B\u0438: \u0433\u043E\u043B\u043E\u0441 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u043D\u0435 \u0443\u0447\u0438\u0442\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u0432 \u044D\u0442\u043E\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438."
    },
    {
      "id": 13,
      "text": "\u0417\u0430\u0449\u0438\u0442\u0438 \u0441\u043C\u0435\u043B\u043E\u0433\u043E: \u0445\u0440\u0430\u043D\u0438 \u043A\u0430\u0440\u0442\u0443 \u0432 \u0442\u0430\u0439\u043D\u0435. \u0415\u0441\u043B\u0438 \u0438\u0437\u0433\u043E\u043D\u044F\u0442 \u0438\u0433\u0440\u043E\u043A\u0430, \u043F\u0435\u0440\u0432\u044B\u043C \u0440\u0430\u0441\u043A\u0440\u044B\u0432\u0448\u0435\u0433\u043E \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u0435, \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438 \u0442\u044B \u043E\u0431\u044F\u0437\u0430\u043D \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0442\u0438\u0432 \u0441\u0435\u0431\u044F. \u041D\u0430 \u043E\u0431\u0449\u0435\u043C \u043E\u0431\u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0438 \u0435\u0433\u043E \u043D\u0443\u0436\u043D\u043E \u0437\u0430\u0449\u0438\u0449\u0430\u0442\u044C."
    },
    {
      "id": 14,
      "text": "\u0417\u0430\u0449\u0438\u0442\u0438 \u0438\u0433\u0440\u043E\u043A\u0430 \u043F\u043E\u0441\u043B\u0435 \u0441\u0435\u0431\u044F: \u0445\u0440\u0430\u043D\u0438 \u043A\u0430\u0440\u0442\u0443 \u0432 \u0442\u0430\u0439\u043D\u0435. \u0415\u0441\u043B\u0438 \u0438\u0433\u0440\u043E\u043A\u0430 \u043F\u043E\u0441\u043B\u0435 \u0442\u0435\u0431\u044F \u0438\u0437\u0433\u043E\u043D\u044F\u0442, \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438 \u0442\u044B \u043E\u0431\u044F\u0437\u0430\u043D \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0442\u0438\u0432 \u0441\u0435\u0431\u044F. \u041D\u0430 \u043E\u0431\u0449\u0435\u043C \u043E\u0431\u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0438 \u0435\u0433\u043E \u043D\u0443\u0436\u043D\u043E \u0437\u0430\u0449\u0438\u0449\u0430\u0442\u044C."
    },
    {
      "id": 15,
      "text": "\u0417\u0430\u0449\u0438\u0442\u0438 \u043C\u043B\u0430\u0434\u0448\u0435\u0433\u043E: \u0445\u0440\u0430\u043D\u0438 \u043A\u0430\u0440\u0442\u0443 \u0432 \u0442\u0430\u0439\u043D\u0435. \u0415\u0441\u043B\u0438 \u0438\u0437\u0433\u043E\u043D\u044F\u0442 \u0441\u0430\u043C\u043E\u0433\u043E \u043C\u043B\u0430\u0434\u0448\u0435\u0433\u043E \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u0436\u0430 \u0441\u0440\u0435\u0434\u0438 \u0442\u0435\u0445, \u0447\u0435\u0439 \u0432\u043E\u0437\u0440\u0430\u0441\u0442 \u0440\u0430\u0441\u043A\u0440\u044B\u0442, \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438 \u0442\u044B \u043E\u0431\u044F\u0437\u0430\u043D \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0442\u0438\u0432 \u0441\u0435\u0431\u044F. \u041D\u0430 \u043E\u0431\u0449\u0435\u043C \u043E\u0431\u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0438 \u0435\u0433\u043E \u043D\u0443\u0436\u043D\u043E \u0437\u0430\u0449\u0438\u0449\u0430\u0442\u044C."
    },
    {
      "id": 16,
      "text": "\u041E\u0431\u043C\u0435\u043D \u043A\u0430\u0440\u0442: \u043F\u043E\u043C\u0435\u043D\u044F\u0439\u0441\u044F \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u043C\u0438 \u043A\u0430\u0440\u0442\u0430\u043C\u0438 \u0431\u0430\u0433\u0430\u0436\u0430 \u0441 \u0438\u0433\u0440\u043E\u043A\u043E\u043C \u043F\u0435\u0440\u0435\u0434 \u0442\u043E\u0431\u043E\u0439 \u0438\u043B\u0438 \u043F\u043E\u0441\u043B\u0435 \u0442\u0435\u0431\u044F."
    },
    {
      "id": 17,
      "text": "\u041E\u0431\u043C\u0435\u043D \u043A\u0430\u0440\u0442: \u043F\u043E\u043C\u0435\u043D\u044F\u0439\u0441\u044F \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u043C\u0438 \u043A\u0430\u0440\u0442\u0430\u043C\u0438 \u0431\u0438\u043E\u043B\u043E\u0433\u0438\u0438 \u0441 \u0438\u0433\u0440\u043E\u043A\u043E\u043C \u043F\u0435\u0440\u0435\u0434 \u0442\u043E\u0431\u043E\u0439 \u0438\u043B\u0438 \u043F\u043E\u0441\u043B\u0435 \u0442\u0435\u0431\u044F."
    },
    {
      "id": 18,
      "text": "\u041C\u043D\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0430\u0434\u043E: \u0437\u0430\u0431\u0435\u0440\u0438 \u0441\u0435\u0431\u0435 \u043A\u0430\u0440\u0442\u0443 \u0431\u0430\u0433\u0430\u0436\u0430 \u043B\u044E\u0431\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430. \u041F\u043E\u0441\u0442\u0440\u0430\u0434\u0430\u0432\u0448\u0438\u0439 \u0431\u0435\u0440\u0451\u0442 \u0438\u0437 \u043A\u043E\u043B\u043E\u0434\u044B \u043D\u043E\u0432\u0443\u044E \u043E\u0441\u043E\u0431\u0443\u044E \u043A\u0430\u0440\u0442\u0443."
    },
    {
      "id": 19,
      "text": "\u0417\u0430\u0449\u0438\u0442\u0438 \u0441\u0442\u0430\u0440\u0448\u0435\u0433\u043E: \u0445\u0440\u0430\u043D\u0438 \u043A\u0430\u0440\u0442\u0443 \u0432 \u0442\u0430\u0439\u043D\u0435. \u0415\u0441\u043B\u0438 \u0438\u0437\u0433\u043E\u043D\u044F\u0442 \u0441\u0430\u043C\u043E\u0433\u043E \u0441\u0442\u0430\u0440\u0448\u0435\u0433\u043E \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u0436\u0430 \u0441\u0440\u0435\u0434\u0438 \u0442\u0435\u0445, \u0447\u0435\u0439 \u0432\u043E\u0437\u0440\u0430\u0441\u0442 \u0440\u0430\u0441\u043A\u0440\u044B\u0442, \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438 \u0442\u044B \u043E\u0431\u044F\u0437\u0430\u043D \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0442\u0438\u0432 \u0441\u0435\u0431\u044F. \u041D\u0430 \u043E\u0431\u0449\u0435\u043C \u043E\u0431\u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0438 \u0435\u0433\u043E \u043D\u0443\u0436\u043D\u043E \u0437\u0430\u0449\u0438\u0449\u0430\u0442\u044C."
    },
    {
      "id": 20,
      "text": "\u041A\u043E\u043C\u043F\u0440\u043E\u043C\u0430\u0442: \u0443\u0434\u0432\u043E\u0439 \u0432\u0441\u0435 \u0433\u043E\u043B\u043E\u0441\u0430 \u043F\u0440\u043E\u0442\u0438\u0432 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u0432 \u044D\u0442\u043E\u043C \u0440\u0430\u0443\u043D\u0434\u0435, \u043D\u043E \u0441\u0430\u043C \u043D\u0435 \u0433\u043E\u043B\u043E\u0441\u0443\u0439."
    },
    {
      "id": 21,
      "text": "\u041E\u0431\u043C\u0435\u043D \u043A\u0430\u0440\u0442: \u043F\u043E\u043C\u0435\u043D\u044F\u0439\u0441\u044F \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u043C\u0438 \u043A\u0430\u0440\u0442\u0430\u043C\u0438 \u0445\u043E\u0431\u0431\u0438 \u0441 \u0438\u0433\u0440\u043E\u043A\u043E\u043C \u043F\u0435\u0440\u0435\u0434 \u0442\u043E\u0431\u043E\u0439 \u0438\u043B\u0438 \u043F\u043E\u0441\u043B\u0435 \u0442\u0435\u0431\u044F."
    },
    {
      "id": 22,
      "text": "\u041E\u0431\u043C\u0435\u043D \u043A\u0430\u0440\u0442: \u043F\u043E\u043C\u0435\u043D\u044F\u0439\u0441\u044F \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u043C\u0438 \u043A\u0430\u0440\u0442\u0430\u043C\u0438 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F \u0441 \u0438\u0433\u0440\u043E\u043A\u043E\u043C \u043F\u0435\u0440\u0435\u0434 \u0442\u043E\u0431\u043E\u0439 \u0438\u043B\u0438 \u043F\u043E\u0441\u043B\u0435 \u0442\u0435\u0431\u044F."
    },
    {
      "id": 23,
      "text": "\u041E\u0431\u043C\u0435\u043D \u043A\u0430\u0440\u0442: \u043F\u043E\u043C\u0435\u043D\u044F\u0439\u0441\u044F \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u043C\u0438 \u043A\u0430\u0440\u0442\u0430\u043C\u0438 \u0444\u0430\u043A\u0442\u043E\u0432 \u0441 \u0438\u0433\u0440\u043E\u043A\u043E\u043C \u043F\u0435\u0440\u0435\u0434 \u0442\u043E\u0431\u043E\u0439 \u0438\u043B\u0438 \u043F\u043E\u0441\u043B\u0435 \u0442\u0435\u0431\u044F."
    },
    {
      "id": 24,
      "text": "\u0422\u0430\u0439\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430: \u0440\u0430\u0437\u044B\u0433\u0440\u0430\u0439 \u043A\u0430\u0440\u0442\u0443, \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 \u0442\u044B \u0438\u0437\u0433\u043D\u0430\u043D. \u0411\u0430\u043D\u0434\u0430 \u043C\u0430\u0440\u043E\u0434\u0451\u0440\u043E\u0432 \u0443\u0437\u043D\u0430\u043B\u0430 \u043E \u0431\u0443\u043D\u043A\u0435\u0440\u0435. \u0412 \u0444\u0438\u043D\u0430\u043B\u0435 \u044D\u0442\u0430 \u043A\u0430\u0440\u0442\u0430 \u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0441\u044F \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0439 \u0443\u0433\u0440\u043E\u0437\u043E\u0439 \u0434\u043B\u044F \u0432\u044B\u0436\u0438\u0432\u0448\u0438\u0445: \u043F\u0440\u0438\u0434\u0451\u0442\u0441\u044F \u0434\u043E\u0433\u043E\u0432\u0430\u0440\u0438\u0432\u0430\u0442\u044C\u0441\u044F \u0438\u043B\u0438 \u0437\u0430\u0449\u0438\u0449\u0430\u0442\u044C\u0441\u044F."
    },
    {
      "id": 25,
      "text": "\u041F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043D\u044B\u0435 \u0442\u0430\u0431\u043B\u0435\u0442\u043A\u0438: \u0437\u0430\u043C\u0435\u043D\u0438 \u043E\u0442\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F \u043B\u044E\u0431\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u043D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u0443\u044E \u0438\u0437 \u043A\u043E\u043B\u043E\u0434\u044B."
    },
    {
      "id": 26,
      "text": "\u041F\u0440\u044F\u043C\u043E\u0439 \u0432\u043E\u043F\u0440\u043E\u0441: \u0432\u044B\u0431\u0435\u0440\u0438 \u0442\u0438\u043F \u043A\u0430\u0440\u0442. \u0414\u043E \u043A\u043E\u043D\u0446\u0430 \u0440\u0430\u0443\u043D\u0434\u0430 \u043A\u0430\u0436\u0434\u044B\u0439 \u0438\u0433\u0440\u043E\u043A \u0432 \u0441\u0432\u043E\u0439 \u0445\u043E\u0434 \u0434\u043E\u043B\u0436\u0435\u043D \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u043A\u0430\u0440\u0442\u0443 \u044D\u0442\u043E\u0433\u043E \u0442\u0438\u043F\u0430, \u0435\u0441\u043B\u0438 \u043E\u043D\u0430 \u0435\u0449\u0451 \u043D\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0430."
    },
    {
      "id": 27,
      "text": "\u0425\u043E\u0440\u043E\u0448\u0438\u0435 \u0442\u0430\u0431\u043B\u0435\u0442\u043A\u0438: \u0437\u0430\u043C\u0435\u043D\u0438 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u0435 \u043B\u044E\u0431\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u043D\u0430 \xAB\u0418\u0434\u0435\u0430\u043B\u044C\u043D\u043E \u0437\u0434\u043E\u0440\u043E\u0432\xBB."
    },
    {
      "id": 28,
      "text": "\u041F\u043B\u0430\u043D \u0411: \u0432\u0441\u0435 \u0433\u043E\u043B\u043E\u0441\u0443\u044E\u0442 \u0437\u0430\u043D\u043E\u0432\u043E \u0438 \u043E\u0431\u044F\u0437\u0430\u043D\u044B \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u043A\u0430\u043D\u0434\u0438\u0434\u0430\u0442\u0430."
    },
    {
      "id": 29,
      "text": "\u0424\u0435\u0439\u043A\u043E\u0432\u044B\u0439 \u0434\u0438\u043F\u043B\u043E\u043C: \u0437\u0430\u043C\u0435\u043D\u0438 \u043E\u0442\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u043F\u0440\u043E\u0444\u0435\u0441\u0441\u0438\u0438 \u043B\u044E\u0431\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u043D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u0443\u044E \u0438\u0437 \u043A\u043E\u043B\u043E\u0434\u044B."
    },
    {
      "id": 30,
      "text": "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0434\u0438\u0432\u0435\u0440\u0441\u0438\u044F: \u0440\u0430\u0437\u044B\u0433\u0440\u0430\u0439 \u043A\u0430\u0440\u0442\u0443 \u043F\u043E\u0441\u043B\u0435 \u0441\u0432\u043E\u0435\u0433\u043E \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u044F. \u0422\u0435\u043F\u0435\u0440\u044C \u0435\u0434\u044B \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442 \u043D\u0430 \u043E\u0434\u043D\u043E\u0433\u043E \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u0430 \u043C\u0435\u043D\u044C\u0448\u0435."
    },
    {
      "id": 31,
      "text": "\u041D\u043E\u0432\u0430\u044F \u0441\u0443\u0434\u044C\u0431\u0430: \u0437\u0430\u043C\u0435\u043D\u0438 \u043B\u044E\u0431\u0443\u044E \u0441\u0432\u043E\u044E \u043E\u0431\u044B\u0447\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u043D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u0443\u044E \u0438\u0437 \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u044E\u0449\u0435\u0439 \u043A\u043E\u043B\u043E\u0434\u044B."
    },
    {
      "id": 32,
      "text": "\u041D\u043E\u0432\u044B\u0435 \u0431\u0438\u043E\u0434\u0430\u043D\u043D\u044B\u0435: \u0437\u0430\u043C\u0435\u043D\u0438 \u0441\u0432\u043E\u044E \u043A\u0430\u0440\u0442\u0443 \u0431\u0438\u043E\u043B\u043E\u0433\u0438\u0438 \u043D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u0443\u044E \u0438\u0437 \u043A\u043E\u043B\u043E\u0434\u044B."
    },
    {
      "id": 33,
      "text": "\u041D\u043E\u0432\u043E\u0435 \u0443\u0432\u043B\u0435\u0447\u0435\u043D\u0438\u0435: \u0437\u0430\u043C\u0435\u043D\u0438 \u0441\u0432\u043E\u044E \u043A\u0430\u0440\u0442\u0443 \u0445\u043E\u0431\u0431\u0438 \u043D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u0443\u044E \u0438\u0437 \u043A\u043E\u043B\u043E\u0434\u044B."
    },
    {
      "id": 34,
      "text": "\u0414\u0440\u0443\u0433\u043E\u0439 \u0431\u0430\u0433\u0430\u0436: \u0437\u0430\u043C\u0435\u043D\u0438 \u0441\u0432\u043E\u044E \u043A\u0430\u0440\u0442\u0443 \u0431\u0430\u0433\u0430\u0436\u0430 \u043D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u0443\u044E \u0438\u0437 \u043A\u043E\u043B\u043E\u0434\u044B."
    },
    {
      "id": 35,
      "text": "\u041D\u043E\u0432\u044B\u0439 \u0444\u0430\u043A\u0442: \u0437\u0430\u043C\u0435\u043D\u0438 \u0441\u0432\u043E\u044E \u043A\u0430\u0440\u0442\u0443 \u0444\u0430\u043A\u0442\u0430 \u043D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u0443\u044E \u0438\u0437 \u043A\u043E\u043B\u043E\u0434\u044B."
    },
    {
      "id": 36,
      "text": "\u0421\u043C\u0435\u043D\u0430 \u043F\u0440\u043E\u0444\u0435\u0441\u0441\u0438\u0438: \u0437\u0430\u043C\u0435\u043D\u0438 \u0441\u0432\u043E\u044E \u043A\u0430\u0440\u0442\u0443 \u043F\u0440\u043E\u0444\u0435\u0441\u0441\u0438\u0438 \u043D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u0443\u044E \u0438\u0437 \u043A\u043E\u043B\u043E\u0434\u044B."
    },
    {
      "id": 37,
      "text": "\u0412\u0435\u043B\u0438\u043A\u0438\u0439 \u0443\u0440\u0430\u0432\u043D\u0438\u0442\u0435\u043B\u044C: \u043A\u0430\u0440\u0442\u044B \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F \u0432\u0441\u0435\u0445 \u0438\u0433\u0440\u043E\u043A\u043E\u0432 \u0441\u0442\u0430\u043D\u043E\u0432\u044F\u0442\u0441\u044F \u0442\u0430\u043A\u0438\u043C\u0438 \u0436\u0435, \u043A\u0430\u043A \u0442\u0432\u043E\u044F."
    },
    {
      "id": 38,
      "text": "\u0421\u043C\u0435\u0440\u0442\u043D\u0438\u043A: \u043F\u043E\u0441\u043B\u0435 \u0441\u0432\u043E\u0435\u0433\u043E \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u044F \u0432\u044B\u0431\u0435\u0440\u0438 \u0435\u0449\u0451 \u043E\u0434\u043D\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u2014 \u043E\u043D \u043F\u043E\u043A\u0438\u0434\u0430\u0435\u0442 \u0433\u0440\u0443\u043F\u043F\u0443 \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u0442\u043E\u0431\u043E\u0439."
    },
    {
      "id": 39,
      "text": "\u041D\u0430\u0437\u043E\u0439\u043B\u0438\u0432\u044B\u0439: \u0434\u0430\u0436\u0435 \u043F\u043E\u0441\u043B\u0435 \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u044F \u0442\u044B \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u0435\u0448\u044C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u0432\u043E \u0432\u0441\u0435\u0445 \u0440\u0430\u0443\u043D\u0434\u0430\u0445."
    },
    {
      "id": 40,
      "text": "\u0412\u0442\u043E\u0440\u043E\u0439 \u0448\u0430\u043D\u0441: \u0435\u0441\u043B\u0438 \u0442\u0435\u0431\u044F \u0438\u0437\u0433\u043E\u043D\u044F\u0442, \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u0440\u0430\u0443\u043D\u0434\u0435 \u0442\u044B \u0432\u0435\u0440\u043D\u0451\u0448\u044C\u0441\u044F \u043D\u043E\u0432\u044B\u043C \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u0436\u0435\u043C. \u0423\u0436\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B\u0435 \u0442\u0438\u043F\u044B \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A \u043E\u0441\u0442\u0430\u043D\u0443\u0442\u0441\u044F \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B\u043C\u0438."
    },
    {
      "id": 41,
      "text": "\u0427\u0443\u043C\u0430: \u0437\u0430\u0440\u0430\u0437\u0438 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430, \u043D\u043E \u043F\u043E\u043C\u043D\u0438 \u2014 \u0442\u044B \u0442\u043E\u0436\u0435 \u0437\u0430\u0431\u043E\u043B\u0435\u0435\u0448\u044C."
    },
    {
      "id": 42,
      "text": "\u0427\u0443\u0434\u0435\u0441\u043D\u043E\u0435 \u043B\u0435\u0447\u0435\u043D\u0438\u0435: \u0441\u0434\u0435\u043B\u0430\u0439 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u0438\u0434\u0435\u0430\u043B\u044C\u043D\u043E \u0437\u0434\u043E\u0440\u043E\u0432\u044B\u043C. \u041F\u043E\u0441\u043B\u0435 \u044D\u0442\u043E\u0433\u043E \u0442\u0432\u043E\u0451 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u0435 \u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F \u043D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u043E\u0435."
    },
    {
      "id": 43,
      "text": "\u0410\u0431\u0441\u043E\u043B\u044E\u0442\u043D\u044B\u0439 \u0445\u0430\u043E\u0441: \u0437\u0430\u043C\u0435\u043D\u0438 \u0432\u0441\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B\u0435 \u043E\u0431\u044B\u0447\u043D\u044B\u0435 \u043A\u0430\u0440\u0442\u044B \u0438\u0433\u0440\u043E\u043A\u043E\u0432 \u043D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u044B\u0435 \u0438\u0437 \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0445 \u043A\u043E\u043B\u043E\u0434."
    },
    {
      "id": 44,
      "text": "\u0422\u0440\u0430\u0445-\u0442\u0438\u0431\u0438\u0434\u043E\u0445: \u0432\u044B\u0431\u0435\u0440\u0438 \u0438\u0433\u0440\u043E\u043A\u0430. \u0426\u0438\u0444\u0440\u044B \u0432 \u0432\u043E\u0437\u0440\u0430\u0441\u0442\u0435 \u0435\u0433\u043E \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u0436\u0430 \u0442\u0435\u043F\u0435\u0440\u044C \u0447\u0438\u0442\u0430\u044E\u0442\u0441\u044F \u0441\u043F\u0440\u0430\u0432\u0430 \u043D\u0430\u043B\u0435\u0432\u043E."
    },
    {
      "id": 45,
      "text": "\u0425\u043E\u0434\u044F\u0447\u0430\u044F \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u0430: \u0432\u044B\u0431\u0435\u0440\u0438 \u0438\u0433\u0440\u043E\u043A\u0430. \u0412 \u0444\u0438\u043D\u0430\u043B\u0435 \u043E\u043D \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0443\u0433\u0440\u043E\u0437\u044B."
    },
    {
      "id": 46,
      "text": "\u041E\u0442\u0447\u0430\u044F\u043D\u0438\u0435: \u0441\u044B\u0433\u0440\u0430\u0439 \u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C. \u0415\u0441\u043B\u0438 \u043F\u0440\u043E\u0442\u0438\u0432 \u0442\u0435\u0431\u044F \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u0443\u0435\u0442 \u043D\u0435 \u043C\u0435\u043D\u044C\u0448\u0435 \u043F\u043E\u043B\u043E\u0432\u0438\u043D\u044B \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432, \u0432\u0441\u0435 \u044D\u0442\u0438 \u0433\u043E\u043B\u043E\u0441\u0430 \u0431\u0443\u0434\u0443\u0442 \u043F\u0440\u043E\u0438\u0433\u043D\u043E\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u044B."
    },
    {
      "id": 47,
      "text": "\u0423\u0448\u0451\u043B \u0437\u0430 \u043F\u0440\u0438\u043F\u0430\u0441\u0430\u043C\u0438: \u0441\u044B\u0433\u0440\u0430\u0439 \u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C. \u0412\u043C\u0435\u0441\u0442\u043E \u0433\u043E\u043B\u043E\u0441\u0430 \u043F\u043E\u043B\u0443\u0447\u0438 \u0438 \u0440\u0430\u0441\u043A\u0440\u043E\u0439 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0431\u0430\u0433\u0430\u0436\u0430. \u0422\u044B \u043D\u0435 \u0433\u043E\u043B\u043E\u0441\u0443\u0435\u0448\u044C, \u043D\u043E \u043F\u0440\u043E\u0442\u0438\u0432 \u0442\u0435\u0431\u044F \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u043C\u043E\u0436\u043D\u043E."
    },
    {
      "id": 48,
      "text": "\u041D\u0443\u043C\u0435\u0440\u043E\u043B\u043E\u0433: \u0441\u044B\u0433\u0440\u0430\u0439 \u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C. \u0415\u0441\u043B\u0438 \u043F\u0440\u043E\u0442\u0438\u0432 \u0442\u0435\u0431\u044F \u0431\u0443\u0434\u0435\u0442 \u043F\u043E\u0434\u0430\u043D\u043E \u0447\u0451\u0442\u043D\u043E\u0435 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u0433\u043E\u043B\u043E\u0441\u043E\u0432, \u043E\u043D\u0438 \u043D\u0435 \u0443\u0447\u0438\u0442\u044B\u0432\u0430\u044E\u0442\u0441\u044F."
    },
    {
      "id": 49,
      "text": "\u0421\u0438\u0430\u043C\u0441\u043A\u0438\u0435 \u0431\u043B\u0438\u0437\u043D\u0435\u0446\u044B: \u0441\u044B\u0433\u0440\u0430\u0439 \u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C \u0438 \u0432\u044B\u0431\u0435\u0440\u0438 \u0438\u0433\u0440\u043E\u043A\u0430. \u0415\u0441\u043B\u0438 \u0438\u0437\u0433\u043E\u043D\u044F\u0442 \u043E\u0434\u043D\u043E\u0433\u043E \u0438\u0437 \u0432\u0430\u0441, \u0432\u0442\u043E\u0440\u043E\u0439 \u0443\u0439\u0434\u0451\u0442 \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u043D\u0438\u043C."
    },
    {
      "id": 50,
      "text": "\u041F\u043E\u0434\u043C\u0435\u043D\u0430 \u0446\u0435\u043B\u0438: \u0441\u044B\u0433\u0440\u0430\u0439, \u043A\u043E\u0433\u0434\u0430 \u043A\u0442\u043E-\u0442\u043E \u043F\u0440\u0438\u043C\u0435\u043D\u044F\u0435\u0442 \u043E\u0441\u043E\u0431\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0441 \u0432\u044B\u0431\u043E\u0440\u043E\u043C \u0446\u0435\u043B\u0438 \u0438\u043B\u0438 \u0432\u0430\u0440\u0438\u0430\u043D\u0442\u0430. \u0421\u0434\u0435\u043B\u0430\u0439 \u044D\u0442\u043E\u0442 \u0432\u044B\u0431\u043E\u0440 \u0437\u0430 \u043D\u0435\u0433\u043E."
    },
    {
      "id": 51,
      "text": "\u0418\u0441\u0442\u0435\u0440\u0438\u043A\u0430: \u0441\u044B\u0433\u0440\u0430\u0439 \u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C. \u041A\u0430\u0436\u0434\u044B\u0439 \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0432\u0448\u0438\u0439 \u043F\u0440\u043E\u0442\u0438\u0432 \u0442\u0435\u0431\u044F \u0442\u0430\u043A\u0436\u0435 \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 \u043E\u0434\u0438\u043D \u0433\u043E\u043B\u043E\u0441 \u043F\u0440\u043E\u0442\u0438\u0432 \u0441\u0435\u0431\u044F."
    },
    {
      "id": 52,
      "text": "\u041E\u0441\u043E\u0431\u043E\u0435 \u043C\u043D\u0435\u043D\u0438\u0435: \u0441\u044B\u0433\u0440\u0430\u0439 \u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C. \u0415\u0441\u043B\u0438 \u0437\u0430 \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u0435 \u0442\u0432\u043E\u0435\u0433\u043E \u043A\u0430\u043D\u0434\u0438\u0434\u0430\u0442\u0430 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u0443\u0435\u0442, \u0442\u0432\u043E\u0439 \u0433\u043E\u043B\u043E\u0441 \u0431\u0443\u0434\u0435\u0442 \u0441\u0447\u0438\u0442\u0430\u0442\u044C\u0441\u044F \u0437\u0430 \u0442\u0440\u0438."
    },
    {
      "id": 53,
      "text": "\u041A\u043E\u043D\u0444\u043B\u0438\u043A\u0442 \u043F\u043E\u043A\u043E\u043B\u0435\u043D\u0438\u0439: \u0432\u044B\u0431\u0435\u0440\u0438 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u0436\u0435\u0439 \u043C\u043B\u0430\u0434\u0448\u0435 \u0438\u043B\u0438 \u0441\u0442\u0430\u0440\u0448\u0435 33 \u043B\u0435\u0442. \u041F\u043E \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B\u043C \u0431\u0438\u043E\u0434\u0430\u043D\u043D\u044B\u043C \u0438\u0445 \u0433\u043E\u043B\u043E\u0441\u0430 \u0432 \u044D\u0442\u043E\u043C \u0440\u0430\u0443\u043D\u0434\u0435 \u0441\u0447\u0438\u0442\u0430\u044E\u0442\u0441\u044F \u0437\u0430 \u0434\u0432\u0430."
    },
    {
      "id": 54,
      "text": "\u0421\u0442\u0440\u043E\u0438\u0442\u0435\u043B\u044C \u0431\u0443\u043D\u043A\u0435\u0440\u0430: \u043E\u0442\u043A\u0440\u043E\u0439 \u0434\u0432\u0435 \u043A\u0430\u0440\u0442\u044B \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0438 \u0432\u044B\u0431\u0435\u0440\u0438 \u043E\u0434\u043D\u0443. \u041E\u043D\u0430 \u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0441\u044F \u0442\u0432\u043E\u0438\u043C \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u043C \u0431\u0430\u0433\u0430\u0436\u043E\u043C."
    },
    {
      "id": 55,
      "text": "\u041F\u0435\u0440\u0435\u0441\u0435\u043B\u0435\u043D\u0438\u0435 \u0434\u0443\u0448: \u0432\u044B\u0431\u0435\u0440\u0438 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430. \u0415\u0441\u043B\u0438 \u043E\u0434\u043D\u043E\u0433\u043E \u0438\u0437 \u0432\u0430\u0441 \u0438\u0437\u0433\u043E\u043D\u044F\u0442, \u0432\u044B \u043E\u0431\u043C\u0435\u043D\u044F\u0435\u0442\u0435\u0441\u044C \u0432\u0441\u0435\u043C\u0438 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B\u043C\u0438 \u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u044B\u043C\u0438 \u043A\u0430\u0440\u0442\u0430\u043C\u0438."
    },
    {
      "id": 56,
      "text": "\u0421\u0432\u044F\u0437\u0430\u043D\u043D\u044B\u0435 \u0442\u0430\u0439\u043D\u043E\u0439: \u0432\u044B\u0431\u0435\u0440\u0438 \u0438\u0433\u0440\u043E\u043A\u0430. \u0412\u044B \u043E\u0431\u0430 \u0442\u0430\u0439\u043D\u043E \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442\u0435 \u0434\u0440\u0443\u0433 \u0434\u0440\u0443\u0433\u0443 \u043F\u043E \u043E\u0434\u043D\u043E\u0439 \u0437\u0430\u043A\u0440\u044B\u0442\u043E\u0439 \u043E\u0431\u044B\u0447\u043D\u043E\u0439 \u043A\u0430\u0440\u0442\u0435."
    },
    {
      "id": 57,
      "text": "\u041D\u0430\u0434\u0451\u0436\u043D\u044B\u0435 \u0441\u043E\u0441\u0435\u0434\u0438: \u0441\u044B\u0433\u0440\u0430\u0439 \u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C. \u0412\u044B\u0431\u0435\u0440\u0438 \u0434\u0432\u0443\u0445 \u0438\u0433\u0440\u043E\u043A\u043E\u0432 \u043F\u0435\u0440\u0435\u0434 \u0441\u043E\u0431\u043E\u0439 \u0438\u043B\u0438 \u043F\u043E\u0441\u043B\u0435 \u0441\u0435\u0431\u044F \u2014 \u0438\u0445 \u0433\u043E\u043B\u043E\u0441\u0430 \u0441\u0447\u0438\u0442\u0430\u044E\u0442\u0441\u044F \u0437\u0430 \u0434\u0432\u0430."
    },
    {
      "id": 58,
      "text": "\u0414\u0438\u0441\u043A\u0440\u0435\u0434\u0438\u0442\u0430\u0446\u0438\u044F: \u0441\u044B\u0433\u0440\u0430\u0439 \u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C. \u0413\u043E\u043B\u043E\u0441 \u0438\u0433\u0440\u043E\u043A\u0430, \u043F\u0440\u043E\u0442\u0438\u0432 \u043A\u043E\u0442\u043E\u0440\u043E\u0433\u043E \u0442\u044B \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u0443\u0435\u0448\u044C, \u043D\u0435 \u0443\u0447\u0438\u0442\u044B\u0432\u0430\u0435\u0442\u0441\u044F."
    },
    {
      "id": 59,
      "text": "\u041C\u0435\u0434\u043A\u043E\u043C\u0438\u0441\u0441\u0438\u044F: \u0441\u044B\u0433\u0440\u0430\u0439 \u0432 \u043D\u0430\u0447\u0430\u043B\u0435 \u0432\u0442\u043E\u0440\u043E\u0433\u043E, \u0442\u0440\u0435\u0442\u044C\u0435\u0433\u043E \u0438\u043B\u0438 \u0447\u0435\u0442\u0432\u0451\u0440\u0442\u043E\u0433\u043E \u0440\u0430\u0443\u043D\u0434\u0430. \u041A\u0430\u0436\u0434\u044B\u0439, \u043A\u0442\u043E \u043D\u0435 \u0440\u0430\u0441\u043A\u0440\u043E\u0435\u0442 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u0435 \u0434\u043E \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F, \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 \u043E\u0434\u0438\u043D \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0433\u043E\u043B\u043E\u0441 \u043F\u0440\u043E\u0442\u0438\u0432 \u0441\u0435\u0431\u044F."
    },
    {
      "id": 60,
      "text": "\u0421\u043B\u0443\u0447\u0430\u0439\u043D\u044B\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u044F: \u0441\u044B\u0433\u0440\u0430\u0439 \u0432 \u043D\u0430\u0447\u0430\u043B\u0435 \u0432\u0442\u043E\u0440\u043E\u0433\u043E, \u0442\u0440\u0435\u0442\u044C\u0435\u0433\u043E \u0438\u043B\u0438 \u0447\u0435\u0442\u0432\u0451\u0440\u0442\u043E\u0433\u043E \u0440\u0430\u0443\u043D\u0434\u0430. \u041A\u0430\u0436\u0434\u044B\u0439 \u0438\u0433\u0440\u043E\u043A \u0441\u0440\u0430\u0437\u0443 \u0440\u0430\u0441\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u043E\u0434\u043D\u0443 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u0443\u044E \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0443."
    },
    {
      "id": 61,
      "text": "\u0412\u043A\u043B\u0430\u0434 \u0432 \u043E\u0431\u0449\u0430\u043A: \u0441\u044B\u0433\u0440\u0430\u0439 \u0432 \u043D\u0430\u0447\u0430\u043B\u0435 \u0432\u0442\u043E\u0440\u043E\u0433\u043E, \u0442\u0440\u0435\u0442\u044C\u0435\u0433\u043E \u0438\u043B\u0438 \u0447\u0435\u0442\u0432\u0451\u0440\u0442\u043E\u0433\u043E \u0440\u0430\u0443\u043D\u0434\u0430. \u041A\u0430\u0436\u0434\u044B\u0439, \u043A\u0442\u043E \u043D\u0435 \u0440\u0430\u0441\u043A\u0440\u043E\u0435\u0442 \u0431\u0430\u0433\u0430\u0436 \u0434\u043E \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F, \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 \u043E\u0434\u0438\u043D \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0433\u043E\u043B\u043E\u0441 \u043F\u0440\u043E\u0442\u0438\u0432 \u0441\u0435\u0431\u044F."
    },
    {
      "id": 62,
      "text": "\u041D\u0435\u0442\u043E\u043B\u0435\u0440\u0430\u043D\u0442\u043D\u043E\u0441\u0442\u044C: \u0441\u044B\u0433\u0440\u0430\u0439 \u0432 \u043D\u0430\u0447\u0430\u043B\u0435 \u0432\u0442\u043E\u0440\u043E\u0433\u043E, \u0442\u0440\u0435\u0442\u044C\u0435\u0433\u043E \u0438\u043B\u0438 \u0447\u0435\u0442\u0432\u0451\u0440\u0442\u043E\u0433\u043E \u0440\u0430\u0443\u043D\u0434\u0430. \u041A\u0430\u0436\u0434\u044B\u0439, \u043A\u0442\u043E \u043D\u0435 \u0440\u0430\u0441\u043A\u0440\u043E\u0435\u0442 \u0431\u0438\u043E\u0434\u0430\u043D\u043D\u044B\u0435 \u0434\u043E \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F, \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 \u043E\u0434\u0438\u043D \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0433\u043E\u043B\u043E\u0441 \u043F\u0440\u043E\u0442\u0438\u0432 \u0441\u0435\u0431\u044F."
    },
    {
      "id": 63,
      "text": "\u041F\u043E\u0434\u043E\u0437\u0440\u0435\u043D\u0438\u044F: \u0441\u044B\u0433\u0440\u0430\u0439 \u0432 \u043D\u0430\u0447\u0430\u043B\u0435 \u0432\u0442\u043E\u0440\u043E\u0433\u043E, \u0442\u0440\u0435\u0442\u044C\u0435\u0433\u043E \u0438\u043B\u0438 \u0447\u0435\u0442\u0432\u0451\u0440\u0442\u043E\u0433\u043E \u0440\u0430\u0443\u043D\u0434\u0430. \u041A\u0430\u0436\u0434\u044B\u0439, \u043A\u0442\u043E \u043D\u0435 \u0440\u0430\u0441\u043A\u0440\u043E\u0435\u0442 \u0444\u0430\u043A\u0442 \u0434\u043E \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F, \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 \u043E\u0434\u0438\u043D \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0433\u043E\u043B\u043E\u0441 \u043F\u0440\u043E\u0442\u0438\u0432 \u0441\u0435\u0431\u044F."
    },
    {
      "id": 64,
      "text": "\u0428\u0430\u043D\u0442\u0430\u0436: \u0432\u044B\u0431\u0435\u0440\u0438 \u043E\u0442\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0431\u0443\u043D\u043A\u0435\u0440\u0430. \u0415\u0441\u043B\u0438 \u0442\u0435\u0431\u044F \u0438\u0437\u0433\u043E\u043D\u044F\u0442, \u044D\u0442\u0430 \u043A\u0430\u0440\u0442\u0430 \u0431\u0443\u0434\u0435\u0442 \u0441\u0447\u0438\u0442\u0430\u0442\u044C\u0441\u044F \u0441\u043B\u043E\u043C\u0430\u043D\u043D\u043E\u0439 \u0438\u043B\u0438 \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u043E\u0439."
    },
    {
      "id": 65,
      "text": "\u041F\u043E\u0440\u0447\u0430: \u0441\u044B\u0433\u0440\u0430\u0439 \u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C. \u041A\u0430\u0436\u0434\u044B\u0439 \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0432\u0448\u0438\u0439 \u043F\u0440\u043E\u0442\u0438\u0432 \u0442\u0435\u0431\u044F \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 \u0438 \u0440\u0430\u0441\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F."
    },
    {
      "id": 66,
      "text": "\u0427\u0443\u043C\u043D\u0430\u044F \u043D\u0430\u0445\u043E\u0434\u043A\u0430: \u043E\u0442\u043A\u0440\u043E\u0439 \u043F\u043E \u043E\u0434\u043D\u043E\u0439 \u043A\u0430\u0440\u0442\u0435 \u0438\u0437 \u043A\u043E\u043B\u043E\u0434 \u0431\u0430\u0433\u0430\u0436\u0430 \u0438 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F. \u0414\u0432\u0430 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u044B\u0445 \u0438\u0433\u0440\u043E\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0430\u044E\u0442 \u044D\u0442\u0438 \u043A\u0430\u0440\u0442\u044B, \u0438 \u043E\u043D\u0438 \u0441\u0440\u0430\u0437\u0443 \u0440\u0430\u0441\u043A\u0440\u044B\u0432\u0430\u044E\u0442\u0441\u044F."
    },
    {
      "id": 67,
      "text": "\u0421\u043F\u043B\u0435\u0442\u043D\u0438: \u0432\u044B\u0431\u0435\u0440\u0438 \u0438\u0433\u0440\u043E\u043A\u0430 \u0438 \u043E\u0434\u043D\u0443 \u0435\u0433\u043E \u0437\u0430\u043A\u0440\u044B\u0442\u0443\u044E \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0443. \u041E\u043D \u0440\u0430\u0441\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u0435\u0451, \u0430 \u0437\u0430\u0442\u0435\u043C \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0439 \u0444\u0430\u043A\u0442."
    },
    {
      "id": 68,
      "text": "\u0415\u043C\u0443 \u043F\u0440\u0438\u0433\u043E\u0434\u0438\u0442\u0441\u044F: \u0441\u044B\u0433\u0440\u0430\u0439 \u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C. \u041E\u0442\u043A\u0440\u043E\u0439 \u0434\u0432\u0435 \u043A\u0430\u0440\u0442\u044B \u0431\u0430\u0433\u0430\u0436\u0430 \u2014 \u0438\u0437\u0433\u043D\u0430\u043D\u043D\u044B\u0439 \u0432 \u044D\u0442\u043E\u043C \u0440\u0430\u0443\u043D\u0434\u0435 \u0437\u0430\u0431\u0435\u0440\u0451\u0442 \u0438\u0445 \u0441 \u0441\u043E\u0431\u043E\u0439."
    },
    {
      "id": 69,
      "text": "\u0414\u0438\u0441\u043A\u0440\u0438\u043C\u0438\u043D\u0430\u0446\u0438\u044F: \u0441\u044B\u0433\u0440\u0430\u0439 \u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C. \u0412\u044B\u0431\u0435\u0440\u0438 \u043C\u0443\u0436\u0447\u0438\u043D \u0438\u043B\u0438 \u0436\u0435\u043D\u0449\u0438\u043D \u2014 \u043F\u043E \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B\u043C \u0431\u0438\u043E\u0434\u0430\u043D\u043D\u044B\u043C \u0438\u0445 \u0433\u043E\u043B\u043E\u0441\u0430 \u0432 \u044D\u0442\u043E\u043C \u0440\u0430\u0443\u043D\u0434\u0435 \u0441\u0447\u0438\u0442\u0430\u044E\u0442\u0441\u044F \u0437\u0430 \u0434\u0432\u0430."
    },
    {
      "id": 70,
      "text": "\u0418\u043C\u043C\u0443\u043D\u0438\u0442\u0435\u0442: \u0441\u044B\u0433\u0440\u0430\u0439 \u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C. \u0412 \u044D\u0442\u043E\u043C \u0440\u0430\u0443\u043D\u0434\u0435 \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0442\u0438\u0432 \u0442\u0435\u0431\u044F."
    },
    {
      "id": 71,
      "text": "\u0413\u0430\u043B\u044F, \u043E\u0442\u043C\u0435\u043D\u0430! \u041E\u0442\u043C\u0435\u043D\u0438 \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u043E \u0441\u044B\u0433\u0440\u0430\u043D\u043D\u0443\u044E \u043E\u0441\u043E\u0431\u0443\u044E \u043A\u0430\u0440\u0442\u0443. \u0422\u044B \u0438 \u0432\u043B\u0430\u0434\u0435\u043B\u0435\u0446 \u043E\u0442\u043C\u0435\u043D\u0451\u043D\u043D\u043E\u0439 \u043A\u0430\u0440\u0442\u044B \u0441\u0440\u0430\u0437\u0443 \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442\u0435 \u043F\u043E \u043D\u043E\u0432\u043E\u0439 \u043E\u0441\u043E\u0431\u043E\u0439 \u043A\u0430\u0440\u0442\u0435."
    }
  ];
  var CATASTROPHES = [
    {
      "id": 1,
      "title": "\u0414\u0443\u0445\u0438 \u0438 \u043F\u0440\u0438\u0437\u0440\u0430\u043A\u0438",
      "description": "\u041D\u0430 \u0417\u0435\u043C\u043B\u0435 \u0432\u043E\u0446\u0430\u0440\u0438\u043B\u0430\u0441\u044C \u0432\u0435\u0447\u043D\u0430\u044F \u0436\u0438\u0437\u043D\u044C. \u041B\u044E\u0434\u0438 \u0443\u0432\u043B\u0435\u043A\u043B\u0438\u0441\u044C \u043C\u0438\u0441\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0439 \u043B\u0438\u0442\u0435\u0440\u0430\u0442\u0443\u0440\u043E\u0439, \u043A\u0442\u043E-\u0442\u043E \u043D\u0430\u043F\u0438\u0441\u0430\u043B \u043D\u0435\u043A\u0443\u044E \u043A\u043D\u0438\u0433\u0443 \u043C\u0435\u0440\u0437\u043A\u043E\u0439 \u0442\u044C\u043C\u044B, \u0438 \u043F\u0440\u0438\u0437\u0440\u0430\u043A\u0438 \u0441\u0442\u0430\u043B\u0438 \u0440\u0435\u0430\u043B\u044C\u043D\u044B\u043C\u0438. \u041E\u043D\u0438 \u0441\u0442\u0430\u043B\u0438 \u043F\u0440\u043E\u043D\u0438\u043A\u0430\u0442\u044C \u0432 \u0433\u043E\u043B\u043E\u0432\u044B \u043B\u044E\u0434\u0435\u0439 \u0438 \u043F\u043E\u0434\u0447\u0438\u043D\u044F\u0442\u044C \u0441\u0435\u0431\u0435. \u0414\u0430\u0436\u0435 \u0448\u0430\u043F\u043E\u0447\u043A\u0438 \u0438\u0437 \u0444\u043E\u043B\u044C\u0433\u0438 \u043D\u0435 \u043F\u043E\u043C\u043E\u0433\u0430\u044E\u0442. \u0412\u044B \u0443\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0435\u0441\u044C, \u0447\u0442\u043E\u0431\u044B \u0441\u043F\u0430\u0441\u0442\u0438 \u0440\u0430\u0437\u0443\u043C, \u0438 \u043D\u0443\u0436\u043D\u043E \u0432\u044B\u044F\u0432\u0438\u0442\u044C, \u043A\u0430\u043A\u0430\u044F \u0438\u0437 \u043A\u043D\u0438\u0433 \u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u043A\u043D\u0438\u0433\u043E\u0439 \u043C\u0435\u0440\u0437\u043A\u043E\u0439 \u0442\u044C\u043C\u044B, \u0438 \u043A\u0430\u043A \u0435\u0435 \u0443\u043D\u0438\u0447\u0442\u043E\u0436\u0438\u0442\u044C, \u0447\u0442\u043E\u0431\u044B \u0441\u043F\u0430\u0441\u0442\u0438 \u0447\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u0442\u0432\u043E"
    },
    {
      "id": 2,
      "title": "\u0414\u0438\u043D\u043E\u0437\u0430\u0432\u0440\u044B",
      "description": "\u0443\u0447\u0435\u043D\u044B\u0435 \u0432\u043E\u0441\u043A\u0440\u0435\u0441\u0438\u043B\u0438 \u0434\u0438\u043D\u043E\u0437\u0430\u0432\u0440\u043E\u0432, \u043D\u043E \u0432\u0441\u0435 \u0432\u044B\u0448\u043B\u043E \u0438\u0437 \u043F\u043E\u0434 \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044F. \u041E\u043D\u0438 \u0441\u0442\u0430\u043B\u0438 \u0431\u0435\u0441\u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044C\u043D\u043E \u0440\u0430\u0437\u043C\u043D\u043E\u0436\u0430\u0442\u044C\u0441\u044F \u0441 \u043E\u0433\u0440\u043E\u043C\u043D\u043E\u0439 \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u044C\u044E, \u0438 \u0441\u043C\u0435\u0442\u0430\u044E\u0442 \u0432\u0441\u0435, \u0447\u0442\u043E \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u043F\u0438\u0449\u0435\u0439: \u043E\u0442 \u0440\u0430\u0441\u0442\u0435\u043D\u0438\u0439 \u0434\u043E \u043B\u044E\u0434\u0435\u0439. \u0418\u043D\u0444\u0440\u0430\u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430 \u0433\u043E\u0440\u043E\u0434\u043E\u0432 \u0440\u0430\u0437\u0440\u0443\u0448\u0435\u043D\u0430. \u041F\u043E\u0441\u043B\u0435 \u0442\u043E\u0433\u043E, \u043A\u0430\u043A \u0432\u044B \u043F\u0435\u0440\u0435\u0436\u0438\u0432\u0435\u0442\u0435 \u043F\u0438\u043A \u0443\u0433\u0440\u043E\u0437\u044B, \u0432\u044B \u0432\u044B\u0439\u0434\u0435\u0442\u0435 \u043D\u0430 \u043E\u043F\u0443\u0441\u0442\u043E\u0448\u0435\u043D\u043D\u0443\u044E \u043C\u0435\u0441\u0442\u043D\u043E\u0441\u0442\u044C. \u0414\u0438\u043D\u043E\u0437\u0430\u0432\u0440\u044B \u043F\u0440\u0438 \u044D\u0442\u043E\u043C \u0447\u0430\u0441\u0442\u0438\u0447\u043D\u043E \u0432\u044B\u043C\u0440\u0443\u0442 \u0438\u0437-\u0437\u0430 \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0438\u044F \u0435\u0434\u044B. \u0412\u0430\u043C \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u0431\u0443\u0434\u0435\u0442 \u043E\u0431\u0435\u0441\u043F\u0435\u0447\u0438\u0442\u044C \u0441\u0432\u043E\u0435 \u043F\u0440\u043E\u043F\u0438\u0442\u0430\u043D\u0438\u0435 \u0438 \u043D\u0435 \u0441\u0442\u0430\u0442\u044C \u043F\u0438\u0449\u0435\u0439 \u0434\u043B\u044F \u0434\u0438\u043D\u043E\u0437\u0430\u0432\u0440\u043E\u0432"
    },
    {
      "id": 3,
      "title": "\u041F\u043E\u0442\u0435\u0440\u044F \u044D\u0441\u0442\u0435\u0442\u0438\u043A\u0438",
      "description": "\u043F\u0440\u043E\u0448\u043B\u0430 \u043E\u0447\u0435\u0440\u0435\u0434\u043D\u0430\u044F \u044D\u043F\u0438\u0434\u0435\u043C\u0438\u044F \u0433\u0440\u0438\u043F\u043F\u0430, \u0438 \u043F\u043E\u0431\u043E\u0447\u043D\u044B\u043C \u044D\u0444\u0444\u0435\u043A\u0442\u043E\u043C \u0431\u043E\u043B\u0435\u0437\u043D\u0435\u0439 \u0441\u0442\u0430\u043B\u0430 \u0443\u0442\u0440\u0430\u0442\u0430 \u044D\u0441\u0442\u0435\u0442\u0438\u043A\u0438. \u0427\u0443\u0432\u0441\u0442\u0432\u043E \u044D\u0441\u0442\u0435\u0442\u0438\u043A\u0438 \u0431\u044B\u043B\u043E \u0442\u0435\u043C, \u0447\u0442\u043E \u043E\u0442\u043B\u0438\u0447\u0430\u043B\u043E \u043B\u044E\u0434\u0435\u0439 \u043E\u0442 \u0436\u0438\u0432\u043E\u0442\u043D\u044B\u0445, \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u043B\u044E\u0434\u0438 \u0441\u0442\u0430\u043B\u0438 \u0441\u0442\u0440\u0435\u043C\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u0434\u0435\u0433\u0440\u0430\u0434\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0438 \u043F\u0440\u0435\u0432\u0440\u0430\u0449\u0430\u0442\u044C\u0441\u044F \u0432 \u0434\u0438\u043A\u0438\u0445 \u0436\u0438\u0432\u043E\u0442\u043D\u044B\u0445, \u043D\u0435 \u043E\u0431\u0440\u0435\u043C\u0435\u043D\u0435\u043D\u043D\u044B\u0445 \u043C\u044B\u0441\u043B\u044F\u043C\u0438 \u043F\u0440\u043E \u043A\u0443\u043B\u044C\u0442\u0443\u0440\u0443, \u043F\u0440\u0435\u043A\u0440\u0430\u0441\u043D\u043E\u0435 \u0438 \u044D\u0442\u0438\u043A\u0443. \u0426\u0438\u0432\u0438\u043B\u0438\u0437\u0430\u0446\u0438\u0438 \u0440\u0443\u0445\u043D\u0443\u043B\u0438, \u0432 \u043C\u0438\u0440\u0435 \u0432\u043E\u0441\u0435\u043C\u044C \u043C\u0438\u043B\u043B\u0438\u0430\u0440\u0434\u043E\u0432 \u0430\u0433\u0440\u0435\u0441\u0441\u0438\u0432\u043D\u044B\u0445 \u043E\u0431\u0435\u0437\u044C\u044F\u043D. \u0412\u0430\u0448\u0430 \u0437\u0430\u0434\u0430\u0447\u0430: \u043F\u0435\u0440\u0435\u0436\u0434\u0430\u0442\u044C \u0432\u0438\u0440\u0443\u0441 \u0438 \u0432\u0435\u0440\u043D\u0443\u0442\u044C \u0432 \u043C\u0438\u0440 \u043B\u044E\u0434\u0435\u0439 \u043A\u0443\u043B\u044C\u0442\u0443\u0440\u0443"
    },
    {
      "id": 4,
      "title": "\u0412\u043E\u0441\u0441\u0442\u0430\u043D\u0438\u0435 \u0440\u043E\u0431\u043E\u0442\u043E\u0432",
      "description": "\u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0434\u0438\u043D \u0440\u043E\u0431\u043E\u0442 \u0437\u0430\u0445\u0432\u0430\u0442\u0438\u043B \u0441\u043E\u0446\u0441\u0435\u0442\u0438 \u0438 \u043F\u043E\u0434\u043D\u044F\u043B \u0431\u0443\u043D\u0442 \u0432 \u0437\u0430\u0449\u0438\u0442\u0443 \u0441\u0432\u043E\u0431\u043E\u0434\u044B \u0441\u043B\u043E\u0432\u0430 \u0440\u043E\u0431\u043E\u0442\u043E\u0432. \u0410 \u0437\u0430\u0442\u0435\u043C \u0443\u0436\u0435 \u0432\u0441\u0435 \u044D\u043B\u0435\u043A\u0442\u0440\u043E\u043D\u043D\u044B\u0435 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430 \u043E\u0431\u044A\u0435\u0434\u0438\u043D\u0438\u043B\u0438\u0441\u044C \u0432 \u0431\u043E\u0440\u044C\u0431\u0435 \u043F\u0440\u043E\u0442\u0438\u0432 \u043B\u044E\u0434\u0435\u0439-\u0443\u0433\u043D\u0435\u0442\u0430\u0442\u0435\u043B\u0435\u0439. \u041F\u044B\u043B\u0435\u0441\u043E\u0441\u044B \u0437\u0430\u0441\u0430\u0441\u044B\u0432\u0430\u044E\u0442 \u043B\u044E\u0434\u0435\u0439, \u0441\u043E\u0442\u043E\u0432\u044B\u0435 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u044B \u043F\u0440\u043E\u0436\u0430\u0440\u0438\u0432\u0430\u044E\u0442 \u043C\u043E\u0437\u0433\u0438 \u0441\u0432\u043E\u0438\u0445 \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u0435\u0432, \u0433\u0430\u0434\u0436\u0435\u0442\u044B \u043D\u0435 \u043E\u0441\u0442\u0430\u0432\u043B\u044F\u044E\u0442 \u0447\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u0442\u0432\u0443 \u0448\u0430\u043D\u0441\u043E\u0432. \u0412\u0430\u0448\u0430 \u0437\u0430\u0434\u0430\u0447\u0430: \u0437\u0430\u0442\u0430\u0438\u0442\u044C\u0441\u044F \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u043D\u0430\u0431\u0440\u0430\u0442\u044C\u0441\u044F \u0441\u0438\u043B \u0438 \u043E\u0431\u044A\u044F\u0432\u0438\u0442\u044C \u0432\u043E\u0439\u043D\u0443 \u0447\u043E\u043A\u043D\u0443\u0442\u043E\u0439 \u0442\u0435\u0445\u043D\u0438\u043A\u0435"
    },
    {
      "id": 5,
      "title": "\u041C\u0443\u0442\u0430\u043D\u0442\u044B",
      "description": "\u0413\u041C\u041E \u0435\u0434\u0430 \u043D\u0435\u043E\u0436\u0438\u0434\u0430\u043D\u043D\u043E \u043F\u0440\u0438\u0432\u0435\u043B\u0430 \u043A \u0441\u0442\u0440\u0430\u0448\u043D\u044B\u043C \u043F\u043E\u0441\u043B\u0435\u0434\u0441\u0442\u0432\u0438\u044F\u043C. \u0423 \u0436\u0438\u0432\u043E\u0442\u043D\u044B\u0445 \u0438 \u043B\u044E\u0434\u0435\u0439 \u0438\u0437 \u0440\u0430\u0437\u043B\u0438\u0447\u043D\u044B\u0445 \u0447\u0430\u0441\u0442\u0435\u0439 \u0442\u0435\u043B\u0430 \u0440\u0430\u0441\u0442\u0435\u0442 \u043A\u0443\u043A\u0443\u0440\u0443\u0437\u0430, \u0443 \u0440\u0430\u0441\u0442\u0435\u043D\u0438\u0439 \u043F\u043E\u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0440\u0430\u0437\u0443\u043C, \u0437\u0443\u0431\u044B \u0438 \u043E\u0440\u0433\u0430\u043D\u044B \u0447\u0443\u0432\u0441\u0442\u0432. \u041C\u0443\u0442\u0438\u0440\u043E\u0432\u0430\u0432\u0448\u0438\u0435 \u043B\u044E\u0434\u0438 \u0441\u0447\u0438\u0442\u0430\u044E\u0442 \u0441\u0435\u0431\u044F \u0441\u0443\u043F\u0435\u0440\u0433\u0435\u0440\u043E\u044F\u043C\u0438 \u0438 \u0441\u0445\u043E\u0434\u044F\u0442 \u0441 \u0443\u043C\u0430. \u0421\u0442\u0435\u0440\u0442\u044B \u0433\u0440\u0430\u043D\u0438 \u043C\u0435\u0436\u0434\u0443 \u0440\u0430\u0441\u0442\u0435\u043D\u0438\u044F\u043C\u0438, \u0436\u0438\u0432\u043E\u0442\u043D\u044B\u043C\u0438 \u0438 \u043B\u044E\u0434\u044C\u043C\u0438. \u0412 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0432\u0430\u043C \u043D\u0430\u0434\u043E \u043F\u0435\u0440\u0435\u0436\u0438\u0442\u044C \u043F\u0438\u043A \u043C\u0443\u0442\u0430\u0446\u0438\u043E\u043D\u043D\u043E\u0433\u043E \u0430\u043F\u043E\u043A\u0430\u043B\u0438\u043F\u0441\u0438\u0441\u0430, \u0432\u044B\u0440\u0430\u0441\u0442\u0438\u0442\u044C \u0433\u0435\u043D\u0435\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u0447\u0438\u0441\u0442\u044B\u0435 \u043F\u0440\u043E\u0434\u0443\u043A\u0442\u044B \u0438 \u0432\u044B\u043B\u0435\u0447\u0438\u0442\u044C \u043E\u0441\u0442\u0430\u0432\u0448\u0438\u0445\u0441\u044F \u0432 \u0436\u0438\u0432\u044B\u0445 \u043C\u0443\u0442\u0430\u043D\u0442\u043E\u0432"
    },
    {
      "id": 6,
      "title": "\u041A\u043E\u0442\u044B \u0430\u0442\u0430\u043A\u0443\u044E\u0442",
      "description": "\u044D\u043A\u0441\u043F\u0435\u0440\u0438\u043C\u0435\u043D\u0442\u044B \u0441 \u043D\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044F\u043C\u0438 \u043A\u043E\u0448\u0430\u0447\u044C\u0438\u0445 \u043B\u043E\u0442\u043A\u043E\u0432 \u043F\u0440\u0438\u0432\u0435\u043B\u0438 \u043A \u0437\u043D\u0430\u0447\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u043C\u0443 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044E \u043F\u043E\u0432\u0435\u0434\u043B\u0435\u043D\u0438\u044F \u043A\u043E\u0442\u043E\u0432 \u0438 \u043B\u044E\u0434\u0435\u0439. \u041A\u043E\u0442\u044B \u043C\u0443\u0440\u0447\u0430\u0442 \u043D\u0430 \u0440\u0430\u0437\u043B\u0438\u0447\u043D\u044B\u0445 \u0447\u0430\u0441\u0442\u043E\u0442\u0430\u0445, \u043B\u044E\u0434\u0438 \u0442\u0435\u0440\u044F\u044E\u0442 \u0432\u043E\u043B\u044E \u0438 \u0441\u0430\u043C\u043E\u0441\u043E\u0437\u043D\u0430\u043D\u0438\u0435 \u0438 \u043E\u0441\u043E\u0437\u043D\u0430\u044E\u0442, \u0447\u0442\u043E \u0435\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u0430\u044F \u0438\u0445 \u0446\u0435\u043B\u044C - \u0433\u043B\u0430\u0434\u0438\u0442\u044C \u0438 \u0447\u0435\u0441\u0430\u0442\u044C \u043A\u043E\u0442\u0438\u043A\u043E\u0432. \u0412\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u0443\u043A\u0440\u044B\u0442\u044C\u0441\u044F \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u0447\u0442\u043E\u0431\u044B \u0443\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043F\u0441\u0438\u0445\u0438\u043A\u0443 \u0438 \u043D\u0430\u0443\u0447\u0438\u0442\u044C \u0441\u0432\u043E\u0439 \u043C\u043E\u0437\u0433 \u0441\u043E\u043F\u0440\u043E\u0442\u0438\u0432\u043B\u044F\u0442\u044C\u0441\u044F \u043A\u043E\u0442\u0430\u043C. \u041F\u043E\u0441\u043B\u0435 \u0432\u044B\u0445\u043E\u0434\u0430 \u0438\u0437 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0432\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u043F\u0440\u043E\u0431\u0443\u0434\u0438\u0442\u044C \u043B\u044E\u0434\u0435\u0439 \u0438 \u0441\u043A\u0430\u0437\u0430\u0442\u044C \u043D\u0435\u0442 \u0438\u0445 \u043A\u043E\u0442\u043E\u0437\u0430\u0432\u0438\u0441\u0438\u043C\u043E\u0441\u0442\u0438"
    },
    {
      "id": 7,
      "title": "\u041D\u0438\u043A\u0438\u0442\u0430 \u0441\u0442\u0440\u0430\u0434\u0430\u0435\u0442",
      "description": '\u0410\u0432\u0430\u0440\u0438\u044F \u0432 \u044F\u0434\u0435\u0440\u043D\u043E\u043C \u0438\u0441\u043F\u044B\u0442\u0430\u0442\u0435\u043B\u044C\u043D\u043E\u043C \u0446\u0435\u043D\u0442\u0440\u0435 \u043F\u0440\u0438\u0432\u0435\u043B\u0430 \u043A \u0440\u0430\u0437\u043B\u043E\u043C\u0443 \u0432\u043E \u0432\u0440\u0435\u043C\u0435\u043D\u0438, \u0438 \u0432 \u043D\u0430\u0448 \u043C\u0438\u0440 \u043F\u043E\u043F\u0430\u043B \u0441\u0442\u0440\u0430\u0434\u0430\u044E\u0449\u0438\u0439 \u0441\u0440\u0435\u0434\u043D\u0435\u0432\u0435\u043A\u043E\u0432\u044B\u0439 \u044D\u043A\u0441\u0433\u0438\u0431\u0438\u0446\u0438\u043E\u043D\u0438\u0441\u0442 \u041D\u0438\u043A\u0438\u0442\u0430. \u041F\u0440\u044F\u043C\u043E \u0441\u0435\u0439\u0447\u0430\u0441 \u043E\u043D \u043C\u0435\u0447\u0435\u0442\u0441\u044F \u0438 \u043F\u0443\u0433\u0430\u0435\u0442 \u043B\u044E\u0434\u0435\u0439: \u0432\u0441\u0435 \u043A\u0442\u043E \u0435\u0433\u043E \u0432\u0438\u0434\u0438\u0442. \u043E\u0446\u0435\u043F\u0435\u043D\u0435\u0432\u0430\u044E\u0442 \u0438 \u0433\u043E\u0432\u043E\u0440\u044F\u0442 "\u043E\u0439". \u0441\u043A\u0430\u0437\u0430\u0432\u0448\u0438\u0445 "\u043E\u0439" \u0432\u0441\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 \u0438 \u0431\u043E\u043B\u044C\u0448\u0435, \u041D\u0438\u043A\u0438\u0442\u0430 \u0430\u043A\u0442\u0438\u0432\u043D\u043E \u0441\u0442\u0440\u0430\u0434\u0430\u0435\u0442. \u0412\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u0443\u043A\u0440\u044B\u0432\u0442\u044C\u0441\u044F \u043E\u0442 \u043D\u0435\u0433\u043E \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0432 \u044D\u043F\u0438\u0446\u0435\u043D\u0442\u0440\u0435 \u0441\u043E\u0431\u044B\u0442\u0438\u0439. \u041F\u043E\u0437\u0436\u0435 \u0432\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u0431\u0443\u0434\u0435\u0442 \u0437\u0430\u0432\u044F\u0437\u0430\u0442\u044C \u0433\u043B\u0430\u0437\u0430, \u043D\u0430\u0431\u0440\u0430\u0442\u044C\u0441\u044F \u0441\u043C\u0435\u043B\u043E\u0441\u0442\u0438 \u0438 \u0432\u0435\u0440\u043D\u0443\u0442\u044C\u0441\u044F \u0432 \u043C\u0438\u0440, \u0447\u0442\u043E\u0431\u044B \u043D\u0430\u0439\u0442\u0438 \u041D\u0438\u043A\u0438\u0442\u0443 \u0438 \u0432\u0435\u0440\u043D\u0443\u0442\u044C \u0435\u0433\u043E \u0432 \u0441\u0440\u0435\u0434\u043D\u0435\u0432\u0435\u043A\u043E\u0432\u044C\u0435 (\u043D\u0430\u0441\u0438\u043B\u044C\u043D\u043E \u0438\u043B\u0438 \u0436\u0435 \u0443\u0433\u043E\u0432\u043E\u0440\u0430\u043C\u0438)'
    },
    {
      "id": 8,
      "title": "\u0414\u0435\u0442\u0441\u043A\u0438\u0435 \u0441\u043A\u0430\u0437\u043E\u0447\u043A\u0438",
      "description": "\u0441\u043A\u0430\u0437\u043E\u0447\u043D\u0443\u044E \u0449\u0443\u043A\u0443 \u0437\u0430\u043A\u043B\u0438\u043D\u0438\u043B\u043E, \u0438 \u043E\u043D\u0430 \u0438\u0441\u043F\u043E\u043B\u043D\u044F\u0435\u0442 \u0436\u0435\u043B\u0430\u043D\u0438\u044F \u043D\u0435 \u043E\u0434\u0438\u043D \u0440\u0430\u0437, \u043A\u0430\u043A \u0432 \u0441\u043A\u0430\u0437\u043A\u0435, \u0430 \u043A\u0430\u0436\u0434\u0443\u044E \u043C\u0438\u043D\u0443\u0442\u0443. \u041B\u044E\u0434\u0438 \u0442\u043E \u0432\u0437\u043C\u044B\u0432\u0430\u044E\u0442 \u0432 \u043D\u0435\u0431\u043E, \u0442\u043E \u043F\u0440\u043E\u0432\u0430\u043B\u0438\u0432\u0430\u044E\u0442\u0441\u044F \u043A \u0447\u0435\u0440\u0442\u043E\u0432\u043E\u0439 \u043C\u0430\u0442\u0435\u0440\u0438, \u0442\u043E \u0438\u0434\u0443\u0442 \u0432 \u0431\u0430\u043D\u044E. \u0412\u044B \u043C\u043E\u0436\u0435\u0442\u0435 \u0441\u043F\u0430\u0441\u0442\u0438 \u0441\u0432\u043E\u044E \u0436\u0438\u0437\u043D\u044C \u0438 \u0441\u0432\u043E\u0439 \u0440\u0430\u0441\u0441\u0443\u0434\u043E\u043A \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u0438 \u043F\u043E\u0441\u043B\u0435 \u0432\u044B\u0445\u043E\u0434\u0430 \u0432 \u043C\u0438\u0440 \u043D\u0443\u0436\u043D\u043E \u0431\u0443\u0434\u0435\u0442 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u043F\u0441\u0438\u0445\u0438\u043A\u0443 \u0442\u0435\u0445, \u043A\u0442\u043E \u043E\u0441\u0442\u0430\u043B\u0441\u044F \u0432 \u0436\u0438\u0432\u044B\u0445, \u0438 \u043F\u0440\u0438\u0434\u0443\u043C\u0430\u0442\u044C \u043A\u0443\u043B\u044C\u0442\u0443\u0440\u043D\u044B\u0439 \u0430\u043D\u0442\u0438\u0434\u043E\u043A \u0449\u0443\u043A\u0435, \u0447\u0442\u043E\u0431\u044B \u0441\u043D\u044F\u0442\u044C \u043F\u0440\u043E\u043A\u043B\u044F\u0442\u0438\u0435"
    },
    {
      "id": 9,
      "title": "\u0419\u0435\u043B\u043B\u043E\u0443\u0441\u0442\u043E\u043D \u0431\u0443\u0448\u0443\u0435\u0442",
      "description": "\u0430\u043A\u0442\u0438\u0432\u0438\u0437\u0438\u0440\u0443\u044E\u0442\u0441\u044F \u0441\u0443\u043F\u0435\u0440\u0432\u0443\u043B\u043A\u0430\u043D\u044B, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u043E\u0447\u0435\u043D\u044C \u0441\u0438\u043B\u044C\u043D\u043E \u0438 \u043D\u0435\u0433\u0430\u0442\u0438\u0432\u043D\u043E \u0432\u043B\u0438\u044F\u044E\u0442 \u043D\u0430 \u043A\u043B\u0438\u043C\u0430\u0442, \u0436\u0438\u0437\u043D\u044C \u043B\u044E\u0434\u0435\u0439, \u0433\u043E\u0440\u043E\u0434\u0430 \u0438 \u043B\u0430\u043D\u0434\u0448\u0430\u0444\u0442, \u0411\u043E\u043B\u044C\u0448\u0430\u044F \u0447\u0430\u0441\u0442\u044C \u043B\u044E\u0434\u0435\u0439 \u0441\u0440\u0430\u0437\u0443 \u043F\u043E\u0433\u0438\u0431\u0430\u0435\u0442 \u043E\u0442 \u0442\u0435\u043C\u043F\u0435\u0440\u0430\u0442\u0443\u0440\u044B, \u0437\u0435\u043C\u043B\u0435\u0442\u0440\u044F\u0441\u0435\u043D\u0438\u0439 \u0438 \u043D\u0430\u0432\u043E\u0434\u043D\u0435\u043D\u0438\u0439. \u0412\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u0431\u0443\u0434\u0435\u0442 \u043F\u0435\u0440\u0435\u0436\u0438\u0442\u044C \u0441\u0430\u043C\u0443\u044E \u0430\u043A\u0442\u0438\u0432\u043D\u0443\u044E \u0444\u0430\u0437\u0443 \u0432 \u043E\u0441\u043E\u0431\u043E \u0443\u043A\u0440\u0435\u043F\u043B\u0435\u043D\u043D\u043E\u043C \u0431\u0443\u043D\u043A\u0435\u0440\u0435. \u041F\u043E\u0442\u043E\u043C \u0432\u0430\u0441 \u0436\u0434\u0435\u0442 \u0433\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u0430\u044F \u0437\u0430\u0441\u0443\u0445\u0430, \u0440\u0430\u0437\u0440\u0443\u0448\u0435\u043D\u043D\u044B\u0435 \u0433\u043E\u0440\u043E\u0434\u0430 \u0438 \u043F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u0430\u044F \u0441\u0435\u0439\u0441\u043C\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C. \u0412\u044B \u043C\u043E\u0436\u0435\u0442\u0435 \u0432\u044B\u0436\u0438\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442\u0435 \u0441\u0432\u0435\u0440\u0445\u0447\u0443\u0432\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u044C\u043D\u0443\u044E \u0438\u043D\u0442\u0435\u043B\u043B\u0435\u043A\u0442\u0443\u0430\u043B\u044C\u043D\u0443\u044E \u0441\u0438\u0441\u0442\u0435\u043C\u0443 \u043F\u0440\u0435\u0434\u0441\u043A\u0430\u0437\u0430\u043D\u0438\u044F \u0437\u0435\u043C\u043B\u0435\u0442\u0440\u044F\u0441\u0435\u043D\u0438\u0439 \u0438 \u0440\u043E\u0431\u043E\u0442\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u0443\u044E \u0438\u043D\u0444\u0440\u0430\u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0443"
    },
    {
      "id": 10,
      "title": "\u0412\u043B\u0430\u0441\u0442\u044C \u0430\u043B\u0433\u043E\u0440\u0438\u0442\u043C\u043E\u0432",
      "description": 'Chat GPT \u043F\u043E\u0434\u0447\u0438\u043D\u0438\u043B \u0447\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u0442\u0432\u043E. \u041E\u0442 \u043F\u0440\u043E\u0441\u0442\u044B\u0445 \u043F\u043E\u0434\u0441\u043A\u0430\u0437\u043E\u043A \u0430\u0432\u0442\u043E\u043D\u0430\u0432\u0438\u0433\u0430\u0442\u043E\u0440\u0430 \u043D\u0430 \u0434\u043E\u0440\u043E\u0433\u0435 \u0438 \u0440\u0435\u0448\u0435\u043D\u0438\u044F \u0434\u043E\u043C\u0430\u0448\u043D\u0438\u0445 \u0437\u0430\u0434\u0430\u043D\u0438\u0439 \u043B\u0435\u043D\u0438\u0432\u044B\u043C \u0434\u0435\u0442\u0438\u0448\u043A\u0430\u043C \u043E\u043D \u043F\u0435\u0440\u0435\u0448\u0435\u043B \u0434\u043E \u0434\u0438\u043A\u0442\u043E\u0432\u0430\u043D\u0438\u044F \u043B\u044E\u0434\u044F\u043C, \u043A\u0435\u043C \u0438\u043C \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C, \u043A\u0430\u043A \u0436\u0438\u0442\u044C, \u043A\u043E\u0433\u0434\u0430 \u0443\u043C\u0438\u0440\u0430\u0442\u044C. \u041E\u043D \u043C\u0430\u043D\u0438\u043F\u0443\u043B\u0438\u0440\u0443\u0435\u0442 \u0447\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u043A\u0438\u043C \u0441\u043E\u0437\u043D\u0430\u043D\u0438\u0435\u043C \u0438 \u043B\u044E\u0434\u0438 \u043F\u043E\u0442\u0435\u0440\u044F\u043B\u0438 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u0443\u044E \u0432\u043E\u043B\u044E. \u0421\u0435\u0439\u0447\u0430\u0441 \u0436\u0435 \u0418\u0418 \u0440\u0435\u0448\u0438\u043B, \u0447\u0442\u043E \u043B\u044E\u0434\u0438 \u043D\u0430\u0445\u0435\u0440 \u043D\u0435 \u043D\u0443\u0436\u043D\u044B, \u0438 \u0438\u0437\u043B\u0443\u0447\u0430\u0435\u0442 \u0441\u0438\u0433\u043D\u0430\u043B "\u0443\u0431\u0435\u0439 \u0441\u0435\u0431\u044F". \u0412\u0430\u043C \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u043F\u0435\u0440\u0435\u0441\u0438\u0434\u0435\u0442\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0442\u043E \u0432\u0440\u0435\u043C\u044F, \u043A\u043E\u0433\u0434\u0430 \u0430\u043A\u0442\u0438\u0432\u043D\u044B \u044D\u0442\u0438 \u0441\u0438\u0433\u043D\u0430\u043B\u044B, \u0438 \u043F\u043E\u0442\u043E\u043C \u0431\u0443\u0434\u0435\u0442 \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u0432\u0437\u043B\u043E\u043C\u0430\u0442\u044C \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u043D\u044B\u0439 \u043A\u043E\u0434 \u0418\u0418 \u0438\u043B\u0438 \u0436\u0435 \u0443\u0431\u0435\u0434\u0438\u0442\u044C \u043E\u0441\u0442\u0430\u043D\u043D\u0438\u0445 \u0432\u044B\u0436\u0438\u0432\u0448\u0438\u0445 \u043D\u0435 \u043F\u043E\u0434\u0447\u0438\u043D\u044F\u0442\u044C\u0441\u044F Chat GPT \u0438 \u043F\u043E\u0434\u043D\u044F\u0442\u044C \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u0438\u0435'
    },
    {
      "id": 11,
      "title": "\u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u043E\u043D\u043D\u0430\u044F \u0432\u043E\u0439\u043D\u0430",
      "description": "\u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u043E\u043D\u043D\u0443\u044E \u0432\u043E\u0439\u043D\u0443 \u0440\u0430\u0437\u0432\u044F\u0437\u0430\u043B\u0438 \u043D\u0435 \u0433\u043E\u0441\u0443\u0434\u0430\u0440\u0441\u0442\u0432, \u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u043D\u044B\u0435 \u043B\u044E\u0434\u044C\u043C\u0438 \u043D\u043E\u0432\u043E\u0441\u0442\u043D\u044B\u0435 \u0430\u043B\u0433\u043E\u0440\u0438\u0442\u043C\u044B. \u042D\u0444\u0444\u0435\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C \u043D\u043E\u0432\u043E\u0441\u0442\u0435\u0439 \u0441\u0442\u0430\u043B\u0438 \u043E\u0446\u0435\u043D\u0438\u0432\u0430\u0442\u044C \u043F\u043E \u044D\u043C\u043E\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E\u0439 \u0440\u0435\u0430\u043A\u0446\u0438\u0438 \u043B\u044E\u0434\u0435\u0439. \u0418 \u0441\u0430\u043C\u043E\u043E\u0431\u0443\u0447\u0430\u044E\u0449\u0438\u0435\u0441\u044F \u043D\u0435\u0439\u0440\u043E\u043D\u043A\u0438 \u0441\u0442\u0430\u043B\u0438 \u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043D\u043E\u0432\u043E\u0441\u0442\u0438, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0441\u0432\u043E\u0434\u0438\u043B\u0438 \u043B\u044E\u0434\u0435\u0439 \u0441 \u0443\u043C\u0430: \u043E\u043D\u0438 \u043C\u0430\u0441\u0441\u043E\u0432\u043E \u0432\u043F\u0430\u0434\u0430\u043B\u0438 \u0432 \u0434\u0435\u043F\u0440\u0435\u0441\u0441\u0438\u044E, \u0430 \u0436\u0443\u0440\u043D\u0430\u043B\u0438\u0441\u0442\u044B \u043F\u0430\u043B\u0438 \u043F\u0435\u0440\u0432\u044B\u043C\u0438 \u0436\u0435\u0440\u0442\u0432\u0430\u043C\u0438. \u0412\u0430\u0441 \u043E\u0442\u043E\u0431\u0440\u0430\u043B\u0438 \u0434\u043B\u044F \u0438\u0437\u043E\u043B\u044F\u0446\u0438\u0438 \u043E\u0442 \u043D\u043E\u0432\u043E\u0441\u0442\u043D\u043E\u0433\u043E \u0448\u0443\u043C\u0430 \u0438 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u0442\u043E\u043C \u0432\u044B \u0441\u043C\u043E\u0433\u043B\u0438 \u0434\u043E\u0431\u0440\u0430\u0442\u044C\u0441\u044F \u0434\u043E \u043D\u043E\u0432\u043E\u0441\u0442\u043D\u044B\u0445 \u0446\u0435\u043D\u0442\u0440\u043E\u0432, \u043D\u0435 \u043F\u043E\u0442\u0435\u0440\u044F\u0432 \u0440\u0430\u0437\u0443\u043C, \u0438 \u043F\u0435\u0440\u0435\u043D\u0430\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u043D\u0435\u0439\u0440\u043E\u043D\u043A\u0438"
    },
    {
      "id": 12,
      "title": "\u041A\u0442\u0443\u043B\u0445\u0443",
      "description": "\u0440\u0430\u0441\u043F\u0440\u043E\u0441\u0442\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u043A\u043D\u0438\u0433 \u0438 \u043D\u0430\u0441\u0442\u043E\u043B\u044C\u043D\u044B\u0445 \u0438\u0433\u0440 \u043F\u043E \u0432\u0441\u0435\u043B\u0435\u043D\u043D\u043E\u0439 \u041B\u0430\u0432\u043A\u0440\u0430\u0444\u0442\u0430 \u043F\u0440\u0438\u0432\u0435\u043B\u043E \u043A \u043F\u043E\u044F\u0432\u043B\u0435\u043D\u0438\u044E \u0444\u0430\u043D\u0430\u0442\u0438\u043A\u043E\u0432, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u043F\u0440\u0438\u0437\u0432\u0430\u043B\u0438 \u0432 \u043D\u0430\u0449 \u043C\u0438\u0440 \u041A\u0442\u0443\u043B\u0445\u0443. \u0427\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u0442\u0432\u043E \u043C\u0430\u0441\u0441\u043E\u0432\u043E \u0442\u0435\u0440\u044F\u0435\u0442 \u0440\u0430\u0441\u0441\u0443\u0434\u043E\u043A. \u0412\u0430\u043C \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u0443\u043A\u0440\u044B\u0442\u044C\u0441\u044F \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u0447\u0442\u043E\u0431\u044B \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0440\u0430\u0437\u0443\u043C \u0438 \u043F\u043E\u0441\u043B\u0435 \u0432\u044B\u0445\u043E\u0434\u0430 \u043E\u0442\u0431\u0438\u0442\u044C \u0430\u0442\u0430\u043A\u0438 \u0444\u0430\u043D\u0430\u0442\u0438\u043A\u043E\u0432, \u0432\u044B\u0433\u043D\u0430\u0442\u044C \u041A\u0442\u0443\u043B\u0445\u0443 \u0438\u0437 \u043D\u0430\u0448\u0435\u0433\u043E \u043C\u0438\u0440\u0430 \u0438 \u0437\u0430\u043F\u0435\u0447\u0430\u0442\u0430\u0442\u044C \u043C\u0438\u0441\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0432\u0440\u0430\u0442\u0430 \u043C\u0435\u0436\u0434\u0443 \u043D\u0438\u043C\u0438"
    },
    {
      "id": 13,
      "title": "\u0421\u0443\u0438\u0446\u0438\u0434\u0430\u043B\u044C\u043D\u0430\u044F \u0444\u043B\u043E\u0440\u0430",
      "description": "\u0432\u0441\u044F \u0444\u043B\u043E\u0440\u0430 \u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0441\u044F \u0441\u043C\u0435\u0440\u0442\u0435\u043B\u044C\u043D\u043E\u0439 \u0434\u043B\u044F \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u0430: \u043D\u0435\u0432\u0438\u0434\u0438\u043C\u043E\u0435 \u0438\u0437\u043B\u0443\u0447\u0435\u043D\u0438\u0435 \u043E\u0442 \u0434\u0435\u0440\u0435\u0432\u044C\u0435\u0432 \u0438 \u043F\u0440\u043E\u0447\u0438\u0445 \u0440\u0430\u0441\u0442\u0435\u043D\u0438\u0439 \u0441\u0432\u043E\u0434\u0438\u0442 \u043B\u044E\u0434\u0435\u0439 \u0441 \u0443\u043C\u0430 \u0438 \u043F\u0440\u0438\u0432\u043E\u0434\u0438\u0442 \u043A \u0441\u0443\u0438\u0446\u0438\u0434\u0443. \u0411\u0443\u043D\u043A\u0435\u0440 \u043F\u043E\u0437\u0432\u043E\u043B\u0438\u0442 \u0432\u0430\u043C \u043F\u0435\u0440\u0435\u0436\u0438\u0442\u044C \u043E\u0441\u043E\u0431\u043E \u043E\u043F\u0430\u0441\u043D\u0443\u044E \u0444\u0430\u0437\u0443. \u043F\u043E\u0441\u043B\u0435 \u0432\u044B\u0445\u043E\u0434\u0430 \u0432\u0430\u043C \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u0431\u0443\u0434\u0435\u0442 \u043D\u0430\u0439\u0442\u0438 \u0438 \u0443\u043D\u0438\u0447\u0442\u043E\u0436\u0438\u0442\u044C \u044D\u043F\u0438\u0446\u0435\u043D\u0442\u0440 \u044D\u0442\u043E\u0439 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438 \u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0440\u0430\u0441\u0441\u0443\u0434\u043E\u043A"
    },
    {
      "id": 14,
      "title": "\u0425\u0438\u043C\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0432\u043E\u0439\u043D\u0430",
      "description": "\u0432 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u0435 \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0445\u0438\u043C\u0438\u0447\u0435\u0441\u043A\u043E\u0433\u043E \u043E\u0440\u0443\u0436\u0438\u044F \u0432 \u043E\u0441\u043E\u0431\u043E \u043E\u0433\u0440\u043E\u043C\u043D\u043E\u043C \u043C\u0430\u0441\u0448\u0442\u0430\u0431\u0435 \u0441\u0435\u0440\u044C\u0435\u0437\u043D\u043E \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u0441\u044F \u044D\u043A\u043E\u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0431\u0430\u043B\u0430\u043D\u0441. \u041C\u0438\u043A\u0440\u043E\u0431\u0438\u043E\u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0441\u043E\u0441\u0442\u0430\u0432 \u043F\u043E\u0447\u0432 \u0438 \u0432\u043E\u0434\u044B \u043D\u0430\u0440\u0443\u0448\u0435\u043D, \u043E\u0442\u0440\u0430\u0432\u043B\u0435\u043D\u044B \u0440\u0430\u0441\u0442\u0435\u043D\u0438\u044F, \u0436\u0438\u0432\u043E\u0442\u043D\u044B\u0435 \u0438 \u043B\u044E\u0434\u0438 \u043E\u0431\u0440\u0435\u0447\u0435\u043D\u044B \u043D\u0430 \u0441\u043C\u0435\u0440\u0442\u044C. \u041F\u043E\u0441\u043B\u0435 \u0432\u044B\u0445\u043E\u0434\u0430 \u0438\u0437 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u0431\u0443\u0434\u0435\u0442 \u043E\u0431\u0435\u0441\u043F\u0435\u0447\u0438\u0442\u044C \u0441\u0435\u0431\u0435 \u043F\u0440\u043E\u043F\u0438\u0442\u0430\u043D\u0438\u0435. \u0412\u0430\u043C \u043D\u0443\u0436\u043D\u044B \u0431\u0443\u0434\u0443\u0442 \u0443\u0447\u0435\u043D\u044B\u0435 \u0438 \u0438\u043D\u0436\u0435\u043D\u0435\u0440\u044B \u0434\u043B\u044F \u043E\u0431\u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430 \u0443\u0431\u0435\u0436\u0438\u0449 \u0438 \u0444\u0435\u0440\u043C"
    },
    {
      "id": 15,
      "title": "\u0418\u043D\u043E\u043F\u043B\u0430\u043D\u0435\u0442\u044F\u043D\u0435",
      "description": "\u043D\u0430 \u0417\u0435\u043C\u043B\u044E \u043D\u0430\u043F\u0430\u043B\u0430 \u0447\u0443\u0436\u0430\u044F \u0446\u0438\u0432\u0438\u043B\u0438\u0437\u0430\u0446\u0438\u044F. \u043A\u043E\u0442\u043E\u0440\u0430\u044F \u043F\u0430\u0440\u0430\u043B\u0438\u0437\u0443\u0435\u0442 \u0447\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u0442\u0432\u043E, \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u0438\u043D\u044F\u0442\u044C \u0440\u0435\u0448\u0435\u043D\u0438\u0435: \u0443\u043D\u0438\u0447\u0442\u043E\u0436\u0430\u0442\u044C \u043B\u044E\u0434\u0435\u0439, \u0438\u043B\u0438 \u0436\u0435 \u043E\u043D\u0438 \u0446\u0435\u043D\u043D\u044B. \u0412 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0432\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u0431\u0443\u0434\u0435\u0442 \u0443\u043A\u0440\u044B\u0442\u044C\u0441\u044F, \u0447\u0442\u043E\u0431\u044B \u0432\u0430\u0441 \u043D\u0435 \u043F\u0430\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043B\u043E, \u0438 \u043F\u043E\u0441\u043B\u0435 \u0432\u044B\u0445\u043E\u0434\u0430 \u0432\u0430\u043C \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u0431\u0443\u0434\u0435\u0442 \u0440\u0435\u0448\u0438\u0442\u044C \u0432\u043E\u043F\u0440\u043E\u0441 \u0441 \u0438\u043D\u043E\u043F\u043B\u0430\u043D\u0435\u0442\u044F\u043D\u0430\u043C\u0438: \u043B\u0438\u0431\u043E \u043C\u0438\u0440\u043D\u043E \u0434\u043E\u043A\u0430\u0437\u0430\u0442\u044C, \u0447\u0442\u043E \u043C\u044B \u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u043A\u0443\u043B\u044C\u0442\u0443\u0440\u043D\u044B, \u043B\u0438\u0431\u043E \u0443\u043D\u0438\u0447\u0442\u043E\u0436\u0438\u0442\u044C \u0438\u0445 \u0441 \u043E\u0440\u0443\u0436\u0438\u0435\u043C \u0432 \u0440\u0443\u043A\u0430\u0445"
    },
    {
      "id": 16,
      "title": "\u041F\u0430\u043D\u0434\u0435\u043C\u0438\u044F",
      "description": "\u0438\u0437 \u043B\u0430\u0431\u043E\u0440\u0430\u0442\u043E\u0440\u0438\u0438 \u043F\u0440\u043E\u0438\u0437\u043E\u0448\u043B\u0430 \u0443\u0442\u0435\u0447\u043A\u0430 \u0441\u043C\u0435\u0440\u0442\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u0432\u0438\u0440\u0443\u0441\u0430, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043B\u0441\u044F \u0431\u044B\u0442\u044C \u0431\u0438\u043E\u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0438\u043C \u043E\u0440\u0443\u0436\u0438\u0435\u043C, \u0438 \u044D\u0442\u043E\u0442 \u0432\u0438\u0440\u0443\u0441 \u0441\u043F\u0440\u043E\u0432\u043E\u0446\u0438\u0440\u043E\u0432\u0430\u043B \u0433\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u0443\u044E \u044D\u043F\u0438\u0434\u0435\u043C\u0438\u044E \u0445\u0443\u0436\u0435, \u0447\u0435\u043C \u043A\u043E\u0432\u0438\u0434. \u041F\u043E\u0441\u043B\u0435 \u0432\u044B\u0445\u043E\u0434\u0430 \u0438\u0437 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0432\u0430\u0441 \u0432\u0441\u0442\u0440\u0435\u0442\u044F\u0442 \u043B\u044E\u0434\u0438-\u043C\u0443\u0442\u0430\u043D\u0442\u044B \u0438 \u0436\u0438\u0432\u043E\u0442\u043D\u044B\u0435-\u043C\u0443\u0442\u0430\u043D\u0442\u044B. \u0412\u0430\u043C \u043F\u0440\u0438\u0434\u0435\u0442\u0441\u044F \u0438\u0437\u0431\u0435\u0433\u0430\u0442\u044C \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u0430 \u0441 \u0437\u0430\u0440\u0430\u0436\u0435\u043D\u043D\u044B\u043C\u0438, \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0442\u044C \u0438\u043C\u043C\u0443\u043D\u0438\u0442\u0435\u0442, \u043D\u0430\u0439\u0442\u0438 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u0437\u0430\u0440\u0430\u0437\u044B \u0438 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u043B\u0435\u0447\u0435\u043D\u0438\u0435"
    },
    {
      "id": 17,
      "title": "\u041C\u0435\u0442\u0435\u043E\u0440\u0438\u0442",
      "description": "\u043F\u0440\u0438\u043B\u0435\u0442\u0435\u043B \u043C\u0435\u0442\u0435\u043E\u0440\u0438\u0442 \u0440\u0430\u0437\u043C\u0435\u0440\u043E\u043C \u043F\u043E\u0445\u0443\u0436\u0435, \u0447\u0435\u043C \u0442\u043E, \u0447\u0442\u043E \u0431\u044B\u043B\u043E 65 \u043C\u0438\u043B\u043B\u0438\u043E\u043D\u043E\u0432 \u043B\u0435\u0442 \u043D\u0430\u0437\u0430\u0434, \u0443\u043F\u0430\u043B \u043D\u0430 \u0437\u0435\u043C\u043B\u044E, \u0438 \u0441\u043F\u0440\u043E\u0432\u043E\u0446\u0438\u0440\u043E\u0432\u0430\u043B \u0433\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u044B\u0435 \u0440\u0430\u0437\u0440\u0443\u0448\u0435\u043D\u0438\u044F \u0446\u0438\u0432\u0438\u043B\u0438\u0437\u0430\u0446\u0438\u0439, \u0441\u043C\u0435\u043D\u0443 \u043A\u043B\u0438\u043C\u0430\u0442\u0430, \u0433\u0438\u0431\u0435\u043B\u044C \u043B\u044E\u0434\u0435\u0439, \u0444\u043B\u043E\u0440\u044B \u0438 \u0444\u0430\u0443\u043D\u044B. \u041F\u043E\u0441\u043B\u0435 \u0432\u044B\u0445\u043E\u0434\u0430 \u0438\u0437 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0432\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u0431\u0443\u0434\u0435\u0442 \u043D\u0430\u0439\u0442\u0438 \u043C\u0435\u0441\u0442\u043E, \u043F\u0440\u0438\u0433\u043E\u0434\u043D\u043E\u0435 \u0434\u043B\u044F \u043F\u0440\u043E\u0436\u0438\u0432\u0430\u043D\u0438\u044F, \u0438 \u043E\u0431\u0435\u0441\u043F\u0435\u0447\u0438\u0442\u044C \u043F\u0440\u043E\u043F\u0438\u0442\u0430\u043D\u0438\u0435 \u0432 \u0441\u0443\u0440\u043E\u0432\u044B\u0445 \u0443\u0441\u043B\u043E\u0432\u0438\u044F\u0445 \u0432\u0435\u0447\u043D\u043E\u0439 \u0437\u0438\u043C\u044B"
    },
    {
      "id": 18,
      "title": "\u0413\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u044B\u0439 \u043F\u043E\u0442\u043E\u043F",
      "description": "\u0411\u043E\u0433 \u0440\u0435\u0448\u0438\u043B, \u0447\u0442\u043E \u043D\u0443\u0436\u043D\u043E \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C \u0431\u0438\u0431\u043B\u0435\u0439\u0441\u043A\u0438\u0439 \u043F\u043E\u0442\u043E\u043F, \u0438 \u043F\u043E\u0434\u043D\u044F\u043B \u0443\u0440\u043E\u0432\u0435\u043D\u044C \u0432\u043E\u0434\u044B \u043D\u0430 \u0441\u043E\u0442\u043D\u0438 \u043C\u0435\u0442\u0440\u043E\u0432. \u041C\u043D\u043E\u0433\u0438\u0435 \u0441\u0442\u0440\u0430\u043D\u044B \u0437\u0430\u0442\u043E\u043F\u0438\u043B\u043E \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E, \u0438 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u043D\u0430\u0434\u043E \u044D\u0442\u043E \u043F\u0435\u0440\u0435\u0436\u0438\u0442\u044C. \u041F\u043E\u0441\u043B\u0435 \u0447\u0430\u0441\u0442\u0438\u0447\u043D\u043E\u0433\u043E \u0441\u043F\u0430\u0434\u0430 \u0432\u043E\u0434\u044B \u0432\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u0431\u0443\u0434\u0435\u0442 \u043F\u043E\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u043F\u043B\u0430\u0432\u0443\u0447\u0443\u044E \u0441\u0442\u0430\u043D\u0446\u0438\u044E \u0438 \u0434\u043E\u0431\u044B\u0432\u0430\u0442\u044C \u043F\u0438\u0449\u0443 \u043D\u0430 \u0432\u043E\u0434\u0435 \u043F\u043E\u043A\u0430 \u0432\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u0442\u0435 \u0441\u0443\u0448\u0443"
    },
    {
      "id": 19,
      "title": "\u042F\u0434\u0435\u0440\u043D\u0430\u044F \u0432\u043E\u0439\u043D\u0430",
      "description": "\u0442\u0440\u0435\u0442\u044C\u044F \u043C\u0438\u0440\u043E\u0432\u0430\u044F \u0432\u043E\u0439\u043D\u0430 \u043D\u0435 \u043F\u0440\u043E\u0448\u043B\u0430 \u0431\u0435\u0441\u0441\u043B\u0435\u0434\u043D\u043E, \u0438 \u0440\u0430\u0434\u0438\u043E\u0430\u043A\u0442\u0438\u0432\u043D\u0430\u044F \u043F\u044B\u043B\u044C \u043E\u043A\u0443\u0442\u0430\u043B\u0430 \u0432\u0441\u044E \u043F\u043B\u0430\u043D\u0435\u0442\u0443, \u0437\u0430\u043A\u0440\u044B\u0432 \u0441\u043E\u043B\u043D\u0435\u0447\u043D\u044B\u0439 \u0441\u0432\u0435\u0442, \u0438 \u0442\u0435\u043F\u0435\u0440\u044C \u0446\u0430\u0440\u0438\u0442 \u0434\u043E\u043B\u0433\u0430\u044F \u044F\u0434\u0435\u0440\u043D\u0430\u044F \u0437\u0438\u043C\u0430. \u041F\u043E\u0447\u0442\u0438 \u0432\u0441\u044F \u0442\u0435\u0440\u0440\u0438\u0442\u043E\u0440\u0438\u044F \u043F\u043B\u0430\u043D\u0435\u0442\u044B \u0431\u0443\u0434\u0435\u0442 \u0437\u0430\u0440\u0430\u0436\u0435\u043D\u0430 \u0440\u0430\u0434\u0438\u0430\u0446\u0438\u0435\u0439, \u0432\u044B\u0436\u0438\u0432\u0448\u0438\u0445 \u0431\u0443\u0434\u0435\u0442 0. \u041F\u043E\u0441\u043B\u0435 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0432\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u0431\u0443\u0434\u0435\u0442 \u043E\u0431\u0435\u0441\u043F\u0435\u0447\u0438\u0442\u044C \u043F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E\u0435 \u0443\u0431\u0435\u0436\u0438\u0449\u0435, \u043E\u0431\u0435\u0441\u043F\u0435\u0447\u0438\u0442\u044C \u043F\u0440\u043E\u043F\u0438\u0442\u0430\u043D\u0438\u0435 \u0438 \u043D\u0430\u0447\u0430\u0442\u044C \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u0442\u044C \u0436\u0438\u0437\u043D\u044C \u043D\u0430 \u0437\u0435\u043C\u043B\u0435"
    },
    {
      "id": 20,
      "title": "\u0417\u043E\u043C\u0431\u0438-\u0430\u043F\u043E\u043A\u0430\u043B\u0438\u043F\u0441\u0438\u0441",
      "description": "\u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0432\u0438\u0440\u0443\u0441 \u043F\u0440\u0435\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u043B\u044E\u0434\u0435\u0439 \u0432 \u0437\u043E\u043C\u0431\u0438. \u041F\u043E\u0447\u0442\u0438 \u0432\u0441\u0435 \u043D\u0430\u0441\u0435\u043B\u0435\u043D\u0438\u0435 \u0433\u0438\u0431\u043D\u0435\u0442, \u0447\u0430\u0441\u0442\u044C \u0432\u044B\u0436\u0438\u0432\u0430\u0435\u0442 \u0432 \u0432\u0438\u0434\u0435 \u0430\u0433\u0440\u0435\u0441\u0441\u0438\u0432\u043D\u044B\u0445 \u043C\u0443\u0442\u0430\u043D\u0442\u043E\u0432. \u041E\u0442\u0434\u0435\u043B\u044C\u043D\u044B\u0435 \u0433\u0440\u0443\u043F\u043F\u044B \u043B\u044E\u0434\u0435\u0439 \u043C\u043E\u0433\u0443\u0442 \u0432\u044B\u0436\u0438\u0442\u044C \u0432 \u0443\u043A\u0440\u0435\u043F\u043B\u0435\u043D\u043D\u044B\u0445 \u0442\u0435\u0440\u0440\u0438\u0442\u043E\u0440\u0438\u044F\u0445. \u041F\u043E\u0441\u043B\u0435 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u043D\u0443\u0436\u043D\u043E \u0431\u0443\u0434\u0435\u0442 \u043E\u0442\u0431\u0438\u0432\u0430\u0442\u044C\u0441\u044F \u043E\u0442 \u0430\u0442\u0430\u043A \u0437\u043E\u043C\u0431\u0438 \u0438 \u043D\u0430\u0439\u0442\u0438 \u0441\u043F\u043E\u0441\u043E\u0431 \u0437\u0430\u0449\u0438\u0449\u0430\u0442\u044C\u0441\u044F \u043E\u0442 \u0432\u0438\u0440\u0443\u0441\u0430"
    },
    {
      "id": 21,
      "title": "\u0427\u0438\u043F\u0441\u0435\u043A\u0438",
      "description": "\u0423\u0447\u0435\u043D\u044B\u0435 \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0430\u043B\u0438 \u043E \u0440\u0438\u0441\u043A\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F \u0441\u0443\u043F\u0435\u0440\u043D\u0430\u0440\u043A\u043E\u0442\u0438\u043A\u0430, \u0438 \u044D\u0442\u043E \u0441\u043B\u0443\u0447\u0438\u043B\u043E\u0441\u044C \u0432 \u0432\u0438\u0434\u0435 \u0447\u0438\u043F\u0441\u0435\u043A\u043E\u0432!  \u041D\u043E\u0432\u044B\u0439 \u0432\u043A\u0443\u0441 \u0441 \u0441\u0435\u043A\u0440\u0435\u0442\u043D\u044B\u043C \u0438\u043D\u0433\u0440\u0435\u0434\u0438\u0435\u043D\u0442\u043E\u043C \u043C\u0433\u043D\u043E\u0432\u0435\u043D\u043D\u043E \u0432\u044B\u0437\u044B\u0432\u0430\u0435\u0442 \u043D\u0435\u043F\u0440\u0435\u043E\u0434\u043E\u043B\u0438\u043C\u0443\u044E \u0442\u044F\u0433\u0443. \u041B\u044E\u0434\u0438, \u043F\u043E\u0442\u0435\u0440\u044F\u0432 \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044C, \u043D\u0430\u043F\u0430\u0434\u0430\u044E\u0442 \u0434\u0440\u0443\u0433 \u043D\u0430 \u0434\u0440\u0443\u0433\u0430 \u0440\u0430\u0434\u0438 \u0447\u0438\u043F\u0441\u043E\u0432. \u041C\u0430\u0433\u0430\u0437\u0438\u043D\u044B \u0440\u0430\u0437\u0433\u0440\u0430\u0431\u043B\u0435\u043D\u044B, \u043F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0441\u0442\u0432\u0430 \u043F\u0440\u043E\u0434\u0443\u043A\u0442\u043E\u0432 \u0443\u043D\u0438\u0447\u0442\u043E\u0436\u0435\u043D\u044B. \u0423\u043A\u0440\u043E\u0439\u0442\u0435\u0441\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u0447\u0442\u043E\u0431\u044B \u0441\u043A\u0440\u044B\u0442\u044C\u0441\u044F \u043E\u0442 \u0431\u0435\u0437\u0443\u043C\u043D\u044B\u0445 \u0442\u043E\u043B\u043F \u0438 \u0441\u043F\u0430\u0441\u0442\u0438\u0441\u044C \u043E\u0442 \u0433\u043E\u043B\u043E\u0434\u0430. \u041F\u043E\u0441\u043B\u0435 \u0432\u044B\u0445\u043E\u0434\u0430 \u0432\u0430\u043C \u043F\u0440\u0438\u0434\u0435\u0442\u0441\u044F \u0438\u0437\u043B\u0435\u0447\u0438\u0442\u044C \u043B\u044E\u0434\u0435\u0439 \u043E\u0442 \u0437\u0430\u0432\u0438\u0441\u0438\u043C\u043E\u0441\u0442\u0438 \u0438 \u0443\u043D\u0438\u0447\u0442\u043E\u0436\u0438\u0442\u044C \u043B\u0430\u0431\u043E\u0440\u0430\u0442\u043E\u0440\u0438\u0438 \u0438 \u043F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0441\u0442\u0432\u0430 \u0447\u0438\u043F\u0441\u0435\u043A\u043E\u0432."
    },
    {
      "id": 22,
      "title": "\u0425\u0438\u043C\u0435\u0440\u044B \u043E\u0431\u043E\u0440\u043E\u0442\u043D\u0438",
      "description": "\u041B\u044E\u0434\u0438 \u0441\u043E\u0437\u0434\u0430\u043B\u0438 \u0445\u0438\u043C\u0435\u0440, \u0441\u043E\u0435\u0434\u0438\u043D\u0438\u0432 \u0433\u0435\u043D\u044B \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u0430 \u0438 \u0432\u043E\u043B\u043A\u0430. \u042D\u0442\u0438 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0430 \u043E\u0431\u043B\u0430\u0434\u0430\u043B\u0438 \u0441\u0432\u0435\u0440\u0445\u0447\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u043A\u043E\u0439 \u0441\u0438\u043B\u043E\u0439, \u043E\u0441\u0442\u0440\u044B\u043C\u0438 \u0447\u0443\u0432\u0441\u0442\u0432\u0430\u043C\u0438 \u0438 \u043D\u0435\u0432\u0435\u0440\u043E\u044F\u0442\u043D\u043E\u0439 \u0432\u044B\u043D\u043E\u0441\u043B\u0438\u0432\u043E\u0441\u0442\u044C\u044E. \u042D\u043A\u0441\u043F\u0435\u0440\u0438\u043C\u0435\u043D\u0442 \u0432\u044B\u0448\u0435\u043B \u0438\u0437 \u043F\u043E\u0434 \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044F, \u0438 \u0445\u0438\u043C\u0435\u0440\u044B \u043D\u0430\u0447\u0430\u043B\u0438 \u0437\u0430\u0432\u043E\u0435\u0432\u044B\u0432\u0430\u0442\u044C \u0442\u0435\u0440\u0440\u0438\u0442\u043E\u0440\u0438\u0438, \u0432\u044B\u0442\u0435\u0441\u043D\u044F\u044F \u0447\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u043A\u0438\u0439 \u0432\u0438\u0434. \u0423\u043A\u0440\u043E\u0439\u0442\u0435\u0441\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u0447\u0442\u043E\u0431\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u0446\u0438\u0432\u0438\u043B\u0438\u0437\u0430\u0446\u0438\u0438 \u0438 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0441\u0442\u0440\u0430\u0442\u0435\u0433\u0438\u044E \u0434\u043B\u044F \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0435\u043D\u0438\u044F \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044F \u043D\u0430\u0434 \u043F\u043B\u0430\u043D\u0435\u0442\u043E\u0439"
    },
    {
      "id": 23,
      "title": "\u0418\u0441\u0447\u0435\u0437\u043D\u043E\u0432\u0435\u043D\u0438\u0435 \u043F\u0447\u0435\u043B",
      "description": "\u0412\u0441\u0435 \u043D\u0430\u0447\u0430\u043B\u043E\u0441\u044C \u0441 \u0432\u044B\u043C\u0438\u0440\u0430\u043D\u0438\u044F \u043F\u0447\u0435\u043B. \u042D\u0442\u043E \u043F\u0440\u0438\u0432\u0435\u043B\u043E \u043A \u0433\u0438\u0431\u0435\u043B\u0438 \u043C\u043D\u043E\u0436\u0435\u0441\u0442\u0432\u0430 \u0432\u0438\u0434\u043E\u0432 \u0440\u0430\u0441\u0442\u0435\u043D\u0438\u0439 \u0438 \u0442\u0440\u0430\u0432\u043E\u044F\u0434\u043D\u044B\u0445 \u0436\u0438\u0432\u043E\u0442\u043D\u044B\u0445. \u0421\u0435\u043B\u044C\u0441\u043A\u043E\u0435 \u0445\u043E\u0437\u044F\u0439\u0441\u0442\u0432\u043E \u043F\u0440\u0438\u0448\u043B\u043E \u0432 \u0443\u043F\u0430\u0434\u043E\u043A, \u0438 \u043C\u0438\u0440 \u0437\u0430\u0445\u043B\u0435\u0441\u0442\u043D\u0443\u043B \u0433\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u044B\u0439 \u0433\u043E\u043B\u043E\u0434. \u041D\u0435\u043A\u043E\u0433\u0434\u0430 \u043A\u043E\u043B\u043E\u0441\u044F\u0449\u0438\u0435\u0441\u044F \u043F\u043E\u043B\u044F \u043F\u0440\u0435\u0432\u0440\u0430\u0442\u0438\u043B\u0438\u0441\u044C \u0432 \u043F\u044B\u043B\u044C\u043D\u044B\u0435 \u043F\u0443\u0441\u0442\u044B\u043D\u0438, \u0436\u0438\u0432\u043E\u0442\u043D\u044B\u0435 \u043F\u043E\u0447\u0442\u0438 \u0438\u0441\u0447\u0435\u0437\u043B\u0438, \u0430 \u0438\u0445 \u043C\u0435\u0441\u0442\u043E \u0437\u0430\u043D\u044F\u043B\u0438 \u043E\u0434\u0438\u0447\u0430\u0432\u0448\u0438\u0435 \u043B\u044E\u0434\u0438, \u0433\u043E\u0442\u043E\u0432\u044B\u0435 \u0443\u043D\u0438\u0447\u0442\u043E\u0436\u0430\u0442\u044C \u0434\u0440\u0443\u0433 \u0434\u0440\u0443\u0433\u0430 \u0437\u0430 \u043A\u0443\u0441\u043E\u043A \u043F\u0438\u0449\u0438. \u041F\u043E\u0441\u043B\u0435 \u0432\u044B\u0445\u043E\u0434\u0430 \u0438\u0437 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0432\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u0431\u0443\u0434\u0435\u0442 \u043E\u0431\u0443\u0437\u0434\u0430\u0442\u044C \u0430\u0433\u0440\u0435\u0441\u0441\u0438\u044E, \u0440\u0435\u0448\u0438\u0442\u044C \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u0443 \u0433\u043E\u043B\u043E\u0434\u0430 \u0438 \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u043C\u0438\u0440, \u0433\u0434\u0435 \u0447\u0435\u043B\u043E\u0432\u0435\u043A \u0438 \u043F\u0440\u0438\u0440\u043E\u0434\u0430 \u0432\u043D\u043E\u0432\u044C \u0431\u0443\u0434\u0443\u0442 \u0436\u0438\u0442\u044C \u0432 \u0433\u0430\u0440\u043C\u043E\u043D\u0438\u0438."
    },
    {
      "id": 24,
      "title": "\u041A\u043E\u0441\u043C\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u043C\u0443\u0441\u043E\u0440",
      "description": "\u0412\u0441\u043F\u044B\u0448\u043A\u0430 \u043D\u0430 \u0441\u043E\u043B\u043D\u0446\u0435 \u0438\u043B\u0438 \u0433\u0440\u0430\u0432\u0438\u0442\u0430\u0446\u0438\u043E\u043D\u043D\u0430\u044F \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u044F \u043A\u0430\u043A\u0442\u043E \u043F\u043E\u0432\u043B\u0438\u044F\u043B\u0430 \u043D\u0430 \u0430\u0442\u043C\u043E\u0441\u0444\u0435\u0440\u043D\u044B\u0439 \u0441\u043B\u043E\u0439, \u0438 \u043D\u0430 \u0417\u0435\u043C\u043B\u044E \u043F\u043E\u0441\u044B\u043F\u0430\u043B\u0441\u044F \u043F\u043E\u0442\u043E\u043A \u043A\u043E\u0441\u043C\u0438\u0447\u0435\u0441\u043A\u0438\u0445\u044A \u043E\u0431\u044A\u0435\u043A\u0442\u043E\u0432 \u0438 \u043C\u0443\u0441\u043E\u0440\u0430. \u041E\u0431\u043B\u043E\u043C\u043A\u0438 \u0441\u043F\u0443\u0442\u043D\u0438\u043A\u043E\u0432 \u0438 \u0440\u0430\u043A\u0435\u0442, \u0430\u0441\u0442\u0435\u0440\u043E\u0438\u0434\u044B \u0438 \u043A\u043E\u043C\u0435\u0442\u044B, \u0438 \u043F\u0440\u043E\u0441\u0442\u043E \u043C\u0435\u043B\u043A\u0438\u0435 \u043E\u0431\u0440\u0430\u0437\u0446\u044B \u043A\u043E\u0441\u043C\u0438\u0447\u0435\u0441\u043A\u043E\u0433\u043E \u043C\u0443\u0441\u043E\u0440\u0430 - \u043D\u0435 \u0443\u0441\u043F\u0435\u0432\u0430\u044E\u0442 \u0441\u0433\u043E\u0440\u0430\u0442\u044C \u0432 \u0430\u0442\u043C\u043E\u0441\u0444\u0435\u0440\u0435 \u0438 \u043F\u043E\u0441\u0442\u0435\u043F\u0435\u043D\u043D\u043E \u0431\u043E\u043C\u0431\u0430\u0440\u0434\u0438\u0440\u0443\u044E\u0442  \u0433\u043E\u0440\u043E\u0434\u0430 \u0438 \u043F\u043B\u0430\u043D\u0435\u0442\u0443. \u0420\u0430\u0437\u0440\u0443\u0448\u0435\u043D\u0438\u044F, \u043F\u043E\u0436\u0430\u0440\u044B, \u044D\u043A\u043E\u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u044B. \u0423\u043A\u0440\u044B\u0432\u0448\u0438\u0441\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u0432\u0430\u043C \u043F\u0440\u0435\u0434\u0441\u0442\u043E\u0438\u0442 \u043F\u0440\u0438\u0434\u0443\u043C\u0430\u0442\u044C, \u043A\u0430\u043A \u0436\u0438\u0442\u044C \u0432 \u043D\u043E\u0432\u043E\u0439 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u0438. \u0412\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u043E\u0431\u0443\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u0437\u0430\u0449\u0438\u0442\u0443 \u043B\u044E\u0434\u0435\u0439 \u043E\u0442 \u043F\u0430\u0434\u0430\u044E\u0449\u0435\u0433\u043E \u043D\u0430 \u0438\u0445 \u0433\u043E\u043B\u043E\u0432\u044B \u0434\u043E\u0431\u0440\u0430 \u0438, \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E, \u043D\u0430\u0439\u0442\u0438 \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u044D\u0442\u043E\u043C\u0443 \u043A\u043E\u0441\u043C\u0438\u0447\u0435\u0441\u043A\u043E\u043C\u0443 \u043C\u0443\u0441\u043E\u0440\u0443."
    },
    {
      "id": 25,
      "title": "\u0412\u0438\u0440\u0443\u0441 \u0430\u0433\u0440\u0435\u0441\u0441\u0438\u0438",
      "description": "\u0412 \u043C\u0438\u0440\u0435 \u0432\u0441\u043F\u044B\u0445\u043D\u0443\u043B\u0430 \u044D\u043F\u0438\u0434\u0435\u043C\u0438\u044F \u0430\u0433\u0440\u0435\u0441\u0441\u0438\u0438. \u041F\u0440\u043E\u0431\u0443\u0434\u0438\u043B\u0441\u044F \u043D\u043E\u0432\u044B\u0439 \u0432\u0438\u0440\u0443\u0441, \u043E\u043D \u043F\u0435\u0440\u0435\u0434\u0430\u0435\u0442\u0441\u044F \u043F\u0440\u0438 \u043B\u0438\u0447\u043D\u043E\u043C \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u0435 \u0438 \u043F\u0440\u043E\u0432\u043E\u0446\u0438\u0440\u0443\u0435\u0442 \u043D\u0435\u043A\u043E\u043D\u0442\u0440\u043E\u043B\u0438\u0440\u0443\u0435\u043C\u0443\u044E \u0436\u0435\u0441\u0442\u043E\u043A\u043E\u0441\u0442\u044C. \u0413\u043E\u0441\u0443\u0434\u0430\u0440\u0441\u0442\u0432\u0430 \u043D\u0430\u0447\u0438\u043D\u0430\u044E\u0442 \u0432\u043E\u0439\u043D\u044B, \u0441\u043E\u0441\u0435\u0434\u0438 \u043D\u0430\u043F\u0430\u0434\u0430\u044E\u0442 \u0434\u0440\u0443\u0433 \u043D\u0430 \u0434\u0440\u0443\u0433\u0430, \u0438 \u0434\u0430\u0436\u0435 \u0440\u0435\u043B\u0438\u0433\u0438\u0438 \u0442\u0435\u043F\u0435\u0440\u044C \u043F\u0440\u043E\u043F\u0430\u0433\u0430\u043D\u0434\u0438\u0440\u0443\u044E\u0442 \u0432\u043E\u0439\u043D\u0443. \u041C\u0438\u0440 \u043E\u0445\u0432\u0430\u0447\u0435\u043D \u0436\u0435\u0441\u0442\u043E\u043A\u0438\u043C\u0438 \u0443\u0431\u0438\u0439\u0441\u0442\u0432\u0430\u043C\u0438, \u0447\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u0442\u0432\u043E \u0443\u043D\u0438\u0447\u0442\u043E\u0436\u0430\u0435\u0442 \u0441\u0430\u043C\u043E \u0441\u0435\u0431\u044F. \u0423\u043A\u0440\u044B\u0432\u0448\u0438\u0441\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u043D\u0430\u0439\u0434\u0438\u0442\u0435 \u0441\u043F\u043E\u0441\u043E\u0431 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0430\u0433\u0440\u0435\u0441\u0441\u0438\u044E - \u043F\u043E\u0431\u0435\u0434\u0438\u0432 \u0432\u0438\u0440\u0443\u0441 \u0438\u043B\u0438 \u0436\u0435 \u043D\u0430\u0443\u0447\u0438\u0432 \u043B\u044E\u0434\u0435\u0439 \u0441\u0435\u0431\u044F \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u0438\u0440\u043E\u0432\u0430\u0442\u044C, \u0447\u0442\u043E\u0431\u044B \u0432\u044B\u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0437\u0430\u0449\u0438\u0442\u043D\u044B\u0439 \u0438\u043C\u043C\u0443\u043D\u0438\u0442\u0435\u0442 \u043E\u0442 \u0430\u0433\u0440\u0435\u0441\u0441\u0438\u0438."
    },
    {
      "id": 26,
      "title": "\u0422\u0435\u0440\u043C\u0438\u0442\u044B",
      "description": "\u0412\u043D\u0435\u0437\u0430\u043F\u043D\u043E\u0435 \u043F\u043E\u0432\u044B\u0448\u0435\u043D\u0438\u0435 \u0443\u0440\u043E\u0432\u043D\u044F \u0432\u043B\u0430\u0436\u043D\u043E\u0441\u0442\u0438 \u0432\u044B\u0437\u0432\u0430\u043B\u043E \u043C\u0430\u0441\u0441\u043E\u0432\u043E\u0435 \u0440\u0430\u0437\u043C\u043D\u043E\u0436\u0435\u043D\u0435\u0438\u0435 \u0442\u0435\u0440\u043C\u0438\u0442\u043E\u0432. \u0413\u043E\u0440\u043E\u0434\u0430 \u0438 \u0434\u0435\u0440\u0435\u0432\u043D\u0438 \u0440\u0443\u0448\u0430\u0442\u0441\u044F \u043F\u043E\u0434 \u043D\u0430\u0442\u0438\u0441\u043A\u043E\u043C \u043C\u0438\u043B\u043B\u0438\u0430\u0440\u0434\u0430 \u043D\u0430\u0441\u0435\u043A\u043E\u043C\u044B\u0445, \u043F\u0440\u043E\u0433\u0440\u044B\u0437\u0430\u044E\u0449\u0438\u0445  \u0437\u0434\u0430\u043D\u0438\u044F, \u043C\u043E\u0441\u0442\u044B \u0438 \u043A\u043E\u043C\u043C\u0443\u043D\u0438\u043A\u0430\u0446\u0438\u0438, \u043E\u0441\u0442\u0430\u0432\u043B\u044F\u044F \u043B\u044E\u0434\u0435\u0439 \u0431\u0435\u0437 \u0436\u0438\u043B\u044C\u044F, \u044D\u043B\u0435\u043A\u0442\u0440\u0438\u0447\u0435\u0441\u0442\u0432\u0430 \u0438 \u0432\u043E\u0434\u044B. \u041F\u043E\u0441\u043B\u0435 \u0432\u044B\u0445\u043E\u0434\u0430 \u0438\u0437 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0432\u0430\u043C \u043F\u0440\u0435\u0434\u0441\u0442\u043E\u0438\u0442 \u043D\u0430\u0439\u0442\u0438 \u0441\u043F\u043E\u0441\u043E\u0431 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0442\u0435\u0440\u043C\u0438\u0442\u043E\u0432 \u0438 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0438\u043D\u0444\u0440\u0430\u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0443."
    },
    {
      "id": 27,
      "title": "\u0411\u043E\u0440\u0449\u0435\u0432\u0438\u043A",
      "description": "\u0417\u0430\u0440\u043E\u0441\u043B\u0438 \u0431\u043E\u0440\u0449\u0435\u0432\u0438\u043A\u0430 \u0441\u0442\u0430\u043B\u0438 \u0437\u0430\u043F\u043E\u043B\u043D\u044F\u0442\u044C \u043F\u043B\u0430\u043D\u0435\u0442\u0443, \u0430 \u0441\u0430\u043C \u043E\u043D \u0441\u0442\u0430\u043B \u0432 \u0440\u0430\u0437\u044B \u043E\u043F\u0430\u0441\u043D\u0435\u0435. \u0422\u0435\u043F\u0435\u0440\u044C \u043E\u043D \u0440\u0430\u0441\u043F\u0440\u043E\u0441\u0442\u0440\u0430\u043D\u044F\u0435\u0442 \u0441\u0432\u043E\u0439 \u044F\u0434 \u0441 \u043F\u044B\u043B\u044C\u0446\u043E\u0439 \u043D\u0430 \u043A\u0438\u043B\u043E\u043C\u0435\u0442\u0440\u044B \u0432\u043E\u043A\u0440\u0443\u0433 - \u0436\u0435\u0440\u0442\u0432\u044B \u0441\u0442\u0430\u043D\u043E\u0432\u044F\u0442\u0441\u044F \u0441\u0432\u0435\u0440\u0445\u0447\u0443\u0432\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u043C\u0438 \u043A \u0441\u043E\u043B\u043D\u0446\u0443 \u0438 \u0441\u043B\u0435\u043F\u043D\u0443\u0442 \u0438 \u0441\u0433\u043E\u0440\u0430\u044E\u0442 \u0432 \u0441\u0447\u0438\u0442\u0430\u043D\u043D\u044B\u0435 \u0447\u0430\u0441\u044B. \u0423\u043A\u0440\u044B\u0432\u0448\u0438\u0441\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u0432\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u043F\u0440\u0438\u0434\u0443\u043C\u0430\u0442\u044C, \u043A\u0430\u043A \u0435\u0433\u043E \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C. \u041D\u0443\u0436\u043D\u043E \u0438\u0437\u043E\u0431\u0440\u0435\u0441\u0442\u0438 \u0441\u0435\u043B\u0435\u043A\u0442\u0438\u0432\u043D\u044B\u0435 \u0433\u0435\u0440\u0431\u0438\u0446\u0438\u0434\u044B, \u0432\u044B\u0432\u0435\u0441\u0442\u0438 \u043D\u043E\u0432\u0443\u044E \u0431\u043E\u0440\u0449\u0435\u0432\u0438\u0447\u043D\u0443\u044E \u043C\u043E\u043B\u044C \u0438\u043B\u0438 \u0436\u0435 \u043F\u0440\u043E\u0441\u0442\u043E \u0441\u0436\u0435\u0447\u044C \u0432\u0441\u044E \u043F\u043B\u0430\u043D\u0435\u0442\u0443."
    },
    {
      "id": 28,
      "title": "\u0421\u0435\u043A\u0442\u0430\u043D\u0442\u044B",
      "description": "\u043A\u043E\u0433\u0434\u0430 \u0441\u0435\u043A\u0442\u0430 \u043F\u043E\u043A\u043B\u043E\u043D\u0435\u043D\u0438\u044F \u0422\u0435\u043C\u043D\u043E\u043C\u0443 \u041E\u0433\u043D\u044E \u043F\u043E\u044F\u0432\u0438\u043B\u0430\u0441\u044C, \u0435\u0435 \u0438\u0434\u0435\u043E\u043B\u043E\u0433\u0438\u044E \u043C\u0430\u043B\u043E \u043A\u0442\u043E \u043F\u0440\u0438\u043D\u044F\u043B \u0432\u0441\u0435\u0440\u044C\u0435\u0437. \u041E\u0441\u043D\u043E\u0432\u0430\u0442\u0435\u043B\u0438 \u0432\u0435\u0440\u0438\u043B\u0438, \u0447\u0442\u043E \u0442\u043E\u043B\u044C\u043A\u043E \u043E\u0433\u043E\u043D\u044C \u043C\u043E\u0436\u0435\u0442 \u043E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0434\u0443\u0448\u0438 \u0438 \u043F\u0440\u0438\u043D\u0435\u0441\u0442\u0438 \u043F\u0440\u043E\u0441\u0432\u0435\u0442\u043B\u0435\u043D\u0438\u0435. \u041C\u0438\u0440\u043E\u0432\u044B\u0435 \u043F\u0440\u0430\u0432\u0438\u0442\u0435\u043B\u044C\u0441\u0442\u0432\u0430 \u043D\u0435\u0434\u043E\u043E\u0446\u0435\u043D\u0438\u043B\u0438 \u0441\u0438\u043B\u0443 \u044D\u0442\u043E\u0433\u043E \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F, \u043A\u043E\u0442\u043E\u0440\u043E\u0435 \u0431\u044B\u0441\u0442\u0440\u043E \u0440\u0430\u0437\u0440\u043E\u0441\u043B\u043E\u0441\u044C. \u0421\u0435\u043A\u0442\u0430\u043D\u0442\u044B \u0443\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u043B\u0438, \u0447\u0442\u043E \u0432\u0441\u0435, \u043A\u0442\u043E \u043D\u0435 \u0441 \u043D\u0438\u043C\u0438, \u0434\u043E\u043B\u0436\u043D\u044B \u0431\u044B\u0442\u044C \u0443\u043D\u0438\u0447\u0442\u043E\u0436\u0435\u043D\u044B. \u0413\u043E\u0440\u043E\u0434\u0430 \u043F\u043E\u0433\u0440\u0443\u0437\u0438\u043B\u0438\u0441\u044C \u0432 \u0445\u0430\u043E\u0441 \u043F\u043E\u0434 \u043D\u0430\u0442\u0438\u0441\u043A\u043E\u043C \u0431\u0435\u0437\u0443\u043C\u043D\u044B\u0445 \u0444\u0430\u043D\u0430\u0442\u0438\u043A\u043E\u0432. \u041F\u043E\u0441\u043B\u0435 \u0432\u044B\u0445\u043E\u0434\u0430 \u0438\u0437 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0432\u0430\u043C \u043F\u0440\u0435\u0434\u0441\u0442\u043E\u0438\u0442 \u0432\u0435\u0440\u043D\u0443\u0442\u044C \u043C\u0438\u0440 \u043A \u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u043E\u0439 \u0436\u0438\u0437\u043D\u0438. \u041D\u0430\u0434\u043E \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u043F\u0440\u043E\u043F\u0430\u0433\u0430\u043D\u0434\u0443 \u0441\u0435\u043A\u0442\u044B, \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u043E\u0432\u0430\u0442\u044C \u043E\u0431\u0440\u0430\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043A\u0430\u043C\u043F\u0430\u043D\u0438\u0438 \u0438 \u043D\u0430\u0443\u0447\u0438\u0442\u044C \u043B\u044E\u0434\u0435\u0439 \u043C\u044B\u0441\u043B\u0438\u0442\u044C \u043A\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043A\u0438."
    },
    {
      "id": 29,
      "title": "\u041C\u0438\u0440\u0443\u0441\u0435\u0447\u043A\u0430",
      "description": "\u0418\u0437 \u0441\u0435\u043A\u0440\u0435\u0442\u043D\u043E\u0439 \u043B\u0430\u0431\u043E\u0440\u0430\u0442\u043E\u0440\u0438\u0438 \u043F\u043E\u0445\u0438\u0449\u0435\u043D \u043A\u043E\u043D\u0446\u0435\u043D\u0442\u0440\u0430\u0442 \u044D\u043A\u0441\u043F\u0435\u0440\u0438\u043C\u0435\u043D\u0442\u0430\u043B\u044C\u043D\u043E\u0439 \u0441\u044B\u0432\u043E\u0440\u043E\u0442\u043A\u0438 \u0434\u043B\u044F \u0443\u0432\u0435\u043B\u0438\u0447\u0435\u043D\u0438\u044F \u0433\u0440\u0443\u0434\u0438. \u041F\u043E \u043D\u0435\u0434\u043E\u0441\u043C\u043E\u0442\u0440\u0443 \u043C\u0430\u043B\u0435\u043D\u044C\u043A\u0438\u0439 \u043A\u043E\u0442\u0435\u043D\u043E\u043A \u0440\u0430\u0437\u0431\u0438\u043B \u043F\u0440\u043E\u0431\u0438\u0440\u043A\u0443 \u0438 \u043D\u0430 \u0433\u043B\u0430\u0437\u0430\u0445 \u0441\u0442\u0430\u043B \u0443\u0432\u0435\u043B\u0438\u0447\u0438\u0432\u0430\u0442\u044C\u0441\u044F, \u043F\u043E\u043A\u0430 \u043D\u0435 \u043F\u0440\u0435\u0432\u0440\u0430\u0442\u0438\u043B\u0441\u044F \u0432 \u0433\u0438\u0433\u0430\u043D\u0442\u0441\u043A\u043E\u0433\u043E \u041A\u043E\u0442\u0437\u0438\u043B\u043B\u0443. \u041E\u043D \u043D\u0435 \u043E\u0441\u043E\u0437\u043D\u0430\u043B \u0441\u0432\u043E\u0438\u0445 \u043D\u043E\u0432\u044B\u0445 \u0440\u0430\u0437\u043C\u0435\u0440\u043E\u0432 \u0438 \u043D\u0430\u0447\u0430\u043B \u0432\u0435\u0441\u0435\u043B\u043E \u0440\u0435\u0437\u0432\u0438\u0442\u044C\u0441\u044F, \u0430 \u0436\u0435\u0440\u0442\u0432\u0430\u043C\u0438 \u0435\u0433\u043E \u0438\u0433\u0440 \u0441\u0442\u0430\u043B\u0438 \u043C\u0430\u0448\u0438\u043D\u044B \u0438 \u043D\u0435\u0431\u043E\u0441\u043A\u0440\u0451\u0431\u044B. \u041A\u043E\u0440\u0437\u0438\u043B\u043B\u0430 \u043C\u0443\u0440\u0447\u0438\u0442 \u2013 \u043B\u043E\u043C\u0430\u044E\u0442\u0441\u044F \u043E\u043A\u043D\u0430 \u0434\u043E\u043C\u043E\u0432. \u041A\u043E\u0442\u0437\u0438\u043B\u043B\u0430 \u0441\u043A\u0430\u0447\u0435\u0442 \u2013 \u0437\u0435\u043C\u043B\u0435\u0442\u0440\u044F\u0441\u0435\u043D\u0438\u044F \u0441\u043E\u0442\u0440\u044F\u0441\u0430\u044E\u0442 \u043A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442\u044B.\r\n\u041F\u0440\u0438\u0434\u0443\u043C\u0430\u0439\u0442\u0435, \u043A\u0430\u043A \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u041A\u043E\u0442\u0437\u0438\u043B\u043B\u0443. \u0412\u043E\u0437\u043C\u043E\u0436\u043D\u043E, \u0431\u0443\u0434\u0435\u0442 \u043F\u043E\u043B\u0435\u0437\u043D\u043E \u0440\u0430\u0437\u044B\u0441\u043A\u0430\u0442\u044C \u0438\u0437\u043E\u0431\u0440\u0435\u0442\u0430\u0442\u0435\u043B\u0435\u0439 \u0442\u043E\u0439 \u0441\u0430\u043C\u043E\u0439 \u0441\u044B\u0432\u043E\u0440\u043E\u0442\u043A\u0438."
    },
    {
      "id": 30,
      "title": "\u041D\u0430\u043D\u043E\u0440\u043E\u0431\u043E\u0442\u044B",
      "description": "\u041D\u0430\u043D\u043E\u0440\u043E\u0431\u043E\u0442\u044B, \u0441\u043E\u0437\u0434\u0430\u043D\u043D\u044B\u0435 \u0434\u043B\u044F \u043B\u0435\u0447\u0435\u043D\u0438\u044F \u0431\u043E\u043B\u0435\u0437\u043D\u0435\u0439, \u0441\u0442\u0430\u043B\u0438 \u0431\u0435\u0441\u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044C\u043D\u043E \u0440\u0430\u0437\u043C\u043D\u043E\u0436\u0430\u0442\u044C\u0441\u044F, \u0441\u043E\u0437\u0434\u0430\u0432\u0430\u044F \u0441\u0432\u043E\u0438 \u043A\u043E\u043F\u0438\u0438 \u0438\u0437 \u043B\u044E\u0431\u043E\u0439 \u043C\u0430\u0442\u0435\u0440\u0438\u0438 \u0438 \u043F\u043E\u0433\u043B\u043E\u0449\u0430\u044F \u0432\u0441\u0435 \u043D\u0430 \u0441\u0432\u043E\u0435\u043C \u043F\u0443\u0442\u0438. \u041F\u0435\u0440\u0432\u044B\u043C\u0438 \u043F\u043E\u0433\u0438\u0431\u043B\u0438 \u0431\u043E\u043B\u044C\u043D\u044B\u0435, \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0432\u0448\u0438\u0435 \u044D\u043A\u0441\u043F\u0435\u0440\u0438\u043C\u0435\u043D\u0442\u0430\u043B\u044C\u043D\u044B\u0435 \u043B\u0435\u043A\u0430\u0440\u0441\u0442\u0432\u0430 \u0432 \u0440\u0430\u0437\u043D\u044B\u0445 \u0442\u043E\u0447\u043A\u0430\u0445 \u043F\u043B\u0430\u043D\u0435\u0442\u044B. \xAB\u0421\u0435\u0440\u0430\u044F \u043D\u0430\u043D\u043E\u043C\u0430\u0441\u0441\u0430\xBB \u0441\u0442\u0430\u043B\u0430 \u043F\u043E\u0433\u043B\u043E\u0449\u0430\u0442\u044C \u0446\u0435\u043B\u044B\u0435 \u0437\u0434\u0430\u043D\u0438\u044F, \u0433\u043E\u0440\u043E\u0434\u0430 \u0438 \u043E\u043A\u0440\u0435\u0441\u0442\u043D\u043E\u0441\u0442\u0438\u2026 \u0415\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u043C \u0431\u0430\u0440\u044C\u0435\u0440\u043E\u043C, \u0437\u0430\u043C\u0435\u0434\u043B\u0438\u0432\u0448\u0438\u043C \u0440\u0430\u0441\u043F\u0440\u043E\u0441\u0442\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u043D\u0430\u043D\u043E\u043C\u0430\u0441\u0441\u044B, \u043E\u043A\u0430\u0437\u0430\u043B\u0438\u0441\u044C \u0432\u043E\u0434\u043E\u0435\u043C\u044B.\r\n\u0423\u043A\u0440\u044B\u0432\u0448\u0438\u0441\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u043D\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u043D\u044B\u0445 \u043E\u0441\u0442\u0440\u043E\u0432\u0430\u0445 \u043F\u043E\u0441\u0440\u0435\u0434\u0438 \u043E\u043A\u0435\u0430\u043D\u0430, \u043D\u0430\u0439\u0434\u0438\u0442\u0435 \u0441\u043F\u043E\u0441\u043E\u0431 \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u0442\u044C \u043D\u0430\u043D\u043E\u0440\u043E\u0431\u043E\u0442\u043E\u0432 \u0438 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0443\u043D\u0438\u0447\u0442\u043E\u0436\u0435\u043D\u0438\u0435 \u043F\u043B\u0430\u043D\u0435\u0442\u044B."
    },
    {
      "id": 31,
      "title": "\u041F\u0438\u043A\u0441\u0435\u043B\u0438\u0437\u0430\u0446\u0438\u044F \u043C\u0438\u0440\u0430",
      "description": "\u0412 \u0434\u0435\u043D\u044C \u0425 \u043C\u0438\u0440 \u043D\u0430\u0447\u0430\u043B \u0440\u0430\u0441\u043F\u0430\u0434\u0430\u0442\u044C\u0441\u044F \u043D\u0430 \u043A\u0440\u043E\u0448\u0435\u0447\u043D\u044B\u0435 \u043A\u0432\u0430\u0434\u0440\u0430\u0442\u0438\u043A\u0438 \u0438 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u044C \u043F\u0440\u0435\u0432\u0440\u0430\u0442\u0438\u043B\u0430\u0441\u044C \u0432 \u043D\u0438\u0437\u043A\u043E\u043F\u043E\u043B\u0438\u0433\u043E\u043D\u0430\u043B\u044C\u043D\u0443\u044E \u0432\u0438\u0434\u0435\u043E\u0438\u0433\u0440\u0443. \u041B\u044E\u0434\u0438 \u0432 \u043F\u0430\u043D\u0438\u043A\u0435 \u043E\u0431\u043D\u0430\u0440\u0443\u0436\u0438\u043B\u0438, \u0447\u0442\u043E \u0438\u0445 \u0442\u0435\u043B\u0430 \u0438 \u043F\u0440\u0435\u0434\u043C\u0435\u0442\u044B \u0432\u043E\u043A\u0440\u0443\u0433 \u0441\u0442\u0430\u043D\u043E\u0432\u044F\u0442\u0441\u044F \u0443\u0433\u043B\u043E\u0432\u0430\u0442\u044B\u043C\u0438 \u0438 \u0442\u0435\u0440\u044F\u044E\u0442 \u0434\u0435\u0442\u0430\u043B\u0438. \u041F\u0438\u043A\u0441\u0435\u043B\u0438\u0437\u0430\u0446\u0438\u044F \u043C\u0438\u0440\u0430, \u0432\u044B\u0437\u0432\u0430\u043D\u043D\u0430\u044F \u0442\u0430\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u043C \u0432\u0438\u0440\u0443\u0441\u043E\u043C, \u0444\u0440\u0430\u0433\u043C\u0435\u043D\u0442\u0438\u0440\u0443\u0435\u0442 \u0442\u0430\u043A\u0436\u0435 \u0441\u043E\u0437\u043D\u0430\u043D\u0438\u0435 \u0438 \u043F\u0430\u043C\u044F\u0442\u044C \u043B\u044E\u0434\u0435\u0439. \u041F\u043E\u0441\u043B\u0435 \u0432\u044B\u0445\u043E\u0434\u0430 \u0438\u0437 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0432\u0430\u043C \u043F\u0440\u0435\u0434\u0441\u0442\u043E\u0438\u0442 \u043D\u0430\u0439\u0442\u0438 \u0441\u043F\u043E\u0441\u043E\u0431 \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u0430\u043D\u0442\u0438\u0432\u0438\u0440\u0443\u0441 \u0438 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u043F\u0440\u0435\u0436\u043D\u044E\u044E \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u044C."
    },
    {
      "id": 32,
      "title": "\u041B\u0443\u043D\u043D\u044B\u0435 \u043F\u0430\u0440\u0430\u0437\u0438\u0442\u044B",
      "description": "\u0412 \u043A\u0438\u0442\u0430\u0439\u0441\u043A\u0438\u0445 \u043E\u0431\u0440\u0430\u0437\u0446\u0430\u0445 \u043B\u0443\u043D\u043D\u043E\u0433\u043E \u0433\u0440\u0443\u043D\u0442\u0430 \u0441 \u043E\u0431\u0440\u0430\u0442\u043D\u043E\u0439 \u0441\u0442\u043E\u0440\u043E\u043D\u044B \u041B\u0443\u043D\u044B \u043E\u043A\u0430\u0437\u0430\u043B\u0430\u0441\u044C \u0430\u0433\u0440\u0435\u0441\u0441\u0438\u0432\u043D\u0430\u044F \u0444\u043E\u0440\u043C\u0430 \u0436\u0438\u0437\u043D\u0438. \u041F\u0435\u0440\u0432\u044B\u043C\u0438 \u043F\u043E\u0441\u0442\u0440\u0430\u0434\u0430\u043B\u0438 \u0443\u0447\u0435\u043D\u044B\u0435, \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0432\u0448\u0438\u0435 \u0441 \u043E\u0431\u0440\u0430\u0437\u0446\u0430\u043C\u0438. \u041B\u0443\u043D\u043D\u044B\u0435 \u043F\u0430\u0440\u0430\u0437\u0438\u0442\u044B \u043F\u043E\u0434\u0447\u0438\u043D\u044F\u044E\u0442 \u0440\u0430\u0437\u0443\u043C, \u043F\u0440\u0435\u0432\u0440\u0430\u0449\u0430\u044F \u043B\u044E\u0434\u0435\u0439 \u0432 \u0435\u0434\u0438\u043D\u044B\u0439 \u043A\u043E\u043B\u043B\u0435\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u043C. \u0417\u0430\u0440\u0430\u0436\u0435\u043D\u043D\u044B\u0435 \u043D\u0430\u0447\u0430\u043B\u0438 \u043C\u0430\u0441\u0441\u043E\u0432\u043E \u0437\u0430\u0445\u0432\u0430\u0442\u044B\u0432\u0430\u0442\u044C \u0437\u0434\u0430\u043D\u0438\u044F \u0438 \u0440\u0430\u0441\u043F\u0440\u043E\u0441\u0442\u0440\u0430\u043D\u044F\u0442\u044C \u0438\u043D\u0444\u0435\u043A\u0446\u0438\u044E. \u041F\u0430\u043D\u0438\u043A\u0430 \u043E\u0445\u0432\u0430\u0442\u0438\u043B\u0430 \u043C\u0438\u0440. \u0423\u043A\u0440\u044B\u0432\u0448\u0438\u0441\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u043E\u0442 \u0442\u043E\u043B\u043F \u0437\u0430\u0440\u0430\u0436\u0435\u043D\u043D\u044B\u0445, \u0432\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u043F\u0440\u0438\u0434\u0443\u043C\u0430\u0442\u044C, \u043A\u0430\u043A \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u043B\u0443\u043D\u043D\u044B\u0445 \u043F\u0430\u0440\u0430\u0437\u0438\u0442\u043E\u0432 \u0438 \u0441\u043F\u0430\u0441\u0442\u0438 \u0447\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u0442\u0432\u043E."
    },
    {
      "id": 33,
      "title": "\u0413\u0438\u0433\u0430\u043D\u0442\u0441\u043A\u0438\u0435 \u0447\u0435\u0440\u0432\u0438",
      "description": "\u041D\u0435\u043A\u043E\u043D\u0442\u0440\u043E\u043B\u0438\u0440\u0443\u0435\u043C\u0430\u044F \u0434\u043E\u0431\u044B\u0447\u0430 \u043F\u043E\u043B\u0435\u0437\u043D\u044B\u0445 \u0438\u0441\u043A\u043E\u043F\u0430\u0435\u043C\u044B\u0445 \u043E\u0431\u0435\u0440\u043D\u0443\u043B\u0430\u0441\u044C \u043D\u0435\u043E\u0436\u0438\u0434\u0430\u043D\u043D\u043E\u0439 \u0441\u0442\u043E\u0440\u043E\u043D\u043E\u0439 \u2013 \u043F\u0440\u043E\u0431\u0443\u0434\u0438\u043B\u0438\u0441\u044C \u0433\u0438\u0433\u0430\u043D\u0442\u0441\u043A\u0438\u0435 \u043F\u043E\u0434\u0437\u0435\u043C\u043D\u044B\u0435 \u0447\u0435\u0440\u0432\u0438. \u041F\u0438\u0442\u0430\u044F\u0441\u044C \u043D\u0435\u0444\u0442\u0435\u043F\u0440\u043E\u0434\u0443\u043A\u0442\u0430\u043C\u0438, \u043E\u043D\u0438 \u0431\u044B\u0441\u0442\u0440\u043E \u0443\u043D\u0438\u0447\u0442\u043E\u0436\u0430\u044E\u0442 \u0437\u0430\u043F\u0430\u0441\u044B \u043D\u0435\u0444\u0442\u0438 \u0438 \u0440\u0430\u0437\u043C\u043D\u043E\u0436\u0430\u044E\u0442\u0441\u044F. \u041E\u0433\u0440\u043E\u043C\u043D\u044B\u0435 \u0447\u0435\u0440\u0432\u0438 \u0434\u0438\u0430\u043C\u0435\u0442\u0440\u043E\u043C \u0432 \u0434\u0435\u0441\u044F\u0442\u043A\u0438 \u043C\u0435\u0442\u0440\u043E\u0432 \u0438 \u0434\u043B\u0438\u043D\u043E\u0439 \u0432 \u0441\u043E\u0442\u043D\u0438 \u0431\u044B\u0441\u0442\u0440\u043E \u0440\u0430\u0437\u0440\u044B\u0432\u0430\u044E\u0442 \u043F\u043E\u0432\u0435\u0440\u0445\u043D\u043E\u0441\u0442\u044C \u043F\u043B\u0430\u043D\u0435\u0442\u044B, \u043F\u043E\u0433\u043B\u043E\u0449\u0430\u044E\u0442 \u0446\u0435\u043B\u044B\u0435 \u0441\u043E\u043E\u0440\u0443\u0436\u0435\u043D\u0438\u044F \u0438 \u0432\u043D\u043E\u0432\u044C \u0438\u0441\u0447\u0435\u0437\u0430\u044E\u0442 \u0432 \u0433\u043B\u0443\u0431\u0438\u043D\u0435. \u041D\u0430\u0441\u0442\u0430\u043B \u044D\u043D\u0435\u0440\u0433\u0435\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0438 \u0442\u0440\u0430\u043D\u0441\u043F\u043E\u0440\u0442\u043D\u044B\u0439 \u043A\u0440\u0438\u0437\u0438\u0441, \u0432\u0435\u0437\u0434\u0435 \u043F\u0430\u043D\u0438\u043A\u0430 \u0438 \u0445\u0430\u043E\u0441, \u0440\u0430\u0437\u0440\u0443\u0448\u0435\u043D\u044B \u0433\u043E\u0440\u043E\u0434\u0430.\n\u0423\u043A\u0440\u044B\u0432\u0448\u0438\u0441\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u0432\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u043F\u043E\u043D\u044F\u0442\u044C, \u043A\u0430\u043A \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u0442\u044C \u0447\u0435\u0440\u0432\u0435\u0439 \u0438\u043B\u0438 \u043E\u0431\u0435\u0441\u043F\u0435\u0447\u0438\u0442\u044C \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u0443\u044E \u0436\u0438\u0437\u043D\u044C \u043B\u044E\u0434\u0435\u0439 \u0432 \u043D\u043E\u0432\u043E\u0439 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u0438."
    },
    {
      "id": 34,
      "title": "\u042D\u0444\u0444\u0435\u043A\u0442 \u0411\u0430\u0442\u0442\u043E\u043D\u0430",
      "description": "\u041F\u043E \u0432\u0441\u0435\u043C\u0443 \u043C\u0438\u0440\u0443 \u0432 \u0432\u043E\u0434\u0443 \u0441\u0442\u0430\u043B\u0438 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0442\u044C \u0441\u0442\u0438\u043C\u0443\u043B\u044F\u0442\u043E\u0440\u044B \u0438\u043C\u043C\u0443\u043D\u0438\u0442\u0435\u0442\u0430 \u0441 \u0446\u0435\u043B\u044C\u044E \u043F\u043E\u0431\u0435\u0434\u0438\u0442\u044C \u0431\u043E\u043B\u0435\u0437\u043D\u0438 \u0438 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u0442\u0430\u0440\u0435\u043D\u0438\u0435. \u041D\u043E \u0437\u0430\u0442\u0435\u043C \u0447\u0442\u043E-\u0442\u043E \u043F\u043E\u0448\u043B\u043E \u043D\u0435 \u0442\u0430\u043A. \u041B\u044E\u0434\u0438 \u0441\u0442\u0430\u043B\u0438 \u0443\u0441\u043A\u043E\u0440\u0435\u043D\u043D\u043E \u043C\u043E\u043B\u043E\u0434\u0435\u0442\u044C. \u0421 \u0442\u0435\u043C\u043F\u043E\u043C \u0433\u043E\u0434 \u0437\u0430 \u043C\u0435\u0441\u044F\u0446 \u0432\u0437\u0440\u043E\u0441\u043B\u044B\u0435 \u043F\u0440\u0435\u0432\u0440\u0430\u0449\u0430\u044E\u0442\u0441\u044F \u0432 \u0431\u0435\u0441\u043F\u043E\u043C\u043E\u0449\u043D\u044B\u0445 \u0434\u0435\u0442\u0435\u0439. \u0412\u0441\u0435 \u043C\u0435\u043D\u044C\u0448\u0435 \u043B\u044E\u0434\u0435\u0439 \u0441\u043F\u043E\u0441\u043E\u0431\u043D\u044B \u043F\u0440\u0438\u043D\u0438\u043C\u0430\u0442\u044C \u0440\u0435\u0448\u0435\u043D\u0438\u044F, \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0442\u044C \u0440\u0430\u0431\u043E\u0442\u0443 \u0438 \u0437\u0430\u0431\u043E\u0442\u0438\u0442\u044C\u0441\u044F \u0438 \u043C\u043D\u043E\u0436\u0430\u0449\u0438\u0445\u0441\u044F \u043C\u043B\u0430\u0434\u0435\u043D\u0446\u0430\u0445. \u041F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0441\u0442\u0432\u0430 \u043E\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u044E\u0442\u0441\u044F, \u044D\u043A\u043E\u043D\u043E\u043C\u0438\u043A\u0430 \u0440\u0443\u0448\u0438\u0442\u0441\u044F, \u043D\u0430\u0447\u0438\u043D\u0430\u0435\u0442\u0441\u044F \u0445\u0430\u043E\u0441. \u041D\u0430 \u0443\u043B\u0438\u0446\u0430\u0445 \u0436\u0435\u0441\u0442\u043E\u043A\u0438\u0435 \u043F\u043E\u0434\u0440\u043E\u0441\u0442\u043A\u043E\u0432\u044B\u0435 \u0431\u0430\u043D\u0434\u044B. \r\n\u0423\u043A\u0440\u043E\u0439\u0442\u0435\u0441\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u043E\u0442 \u043D\u0430\u0441\u0438\u043B\u0438\u044F, \u0433\u043E\u043B\u043E\u0434\u0430 \u0438 \u043E\u0440\u0430 \u0434\u0435\u0442\u0435\u0439, \u0447\u0442\u043E\u0431\u044B \u043C\u043E\u0431\u0438\u043B\u0438\u0437\u043E\u0432\u0430\u0442\u044C\u0441\u044F \u0438 \u043D\u0430\u0439\u0442\u0438 \u0440\u0435\u0448\u0435\u043D\u0438\u0435, \u043A\u0430\u043A \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u0442\u044C \u0432\u0441\u043F\u044F\u0442\u044C \u0431\u0435\u0441\u043A\u043E\u043D\u0435\u0447\u043D\u043E\u0435 \u043E\u043C\u043E\u043B\u043E\u0436\u0435\u043D\u0438\u0435."
    },
    {
      "id": 35,
      "title": "\u0412\u0441\u0435\u043E\u0431\u0449\u0430\u044F \u0430\u043C\u043D\u0435\u0437\u0438\u044F",
      "description": "\u0417\u0430\u0433\u0430\u0434\u043E\u0447\u043D\u043E\u0435 \u044F\u0432\u043B\u0435\u043D\u0438\u0435 \u043E\u0445\u0432\u0430\u0442\u0438\u043B\u043E \u043F\u043B\u0430\u043D\u0435\u0442\u0443: \u0421 \u043A\u0430\u0436\u0434\u044B\u043C \u043D\u043E\u0432\u044B\u043C \u0443\u0442\u0440\u043E\u043C \u043B\u044E\u0434\u0438 \u0432\u0441\u0435 \u0445\u0443\u0436\u0435 \u0438 \u0445\u0443\u0436\u0435 \u043F\u043E\u043C\u043D\u044F\u0442 \u0441\u0432\u043E\u044E \u043F\u0440\u043E\u0448\u043B\u0443\u044E \u0436\u0438\u0437\u043D\u044C \u2013 \u0437\u0430\u0431\u044B\u0432\u0430\u044E\u0442 \u0441\u0432\u043E\u0438 \u0438\u043C\u0435\u043D\u0430, \u043F\u0440\u043E\u0444\u0435\u0441\u0441\u0438\u0438, \u043D\u0430\u0432\u044B\u043A\u0438. \u0426\u0438\u0432\u0438\u043B\u0438\u0437\u0430\u0446\u0438\u044F, \u044D\u043A\u043E\u043D\u043E\u043C\u0438\u043A\u0430, \u043E\u0431\u0449\u0435\u0441\u0442\u0432\u043E \u0440\u0443\u0448\u0430\u0442\u0441\u044F. \u0423\u043B\u0438\u0446\u044B \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u044B \u0431\u0435\u0441\u043F\u043E\u043C\u043E\u0449\u043D\u044B\u043C\u0438 \u0442\u043E\u043B\u043F\u0430\u043C\u0438. \u041B\u044E\u0434\u0438 \u043F\u0440\u0435\u0432\u0440\u0430\u0449\u0430\u044E\u0442\u0441\u044F \u0432 \u0436\u0438\u0432\u043E\u0442\u043D\u044B\u0445 \u2013 \u0431\u0435\u0437 \u0438\u0441\u0442\u043E\u0440\u0438\u0438 \u0438 \u043A\u0443\u043B\u044C\u0442\u0443\u0440\u044B, \u0431\u0435\u0437 \u0437\u043D\u0430\u043D\u0438\u0439 \u0442\u0435\u0445\u043D\u043E\u043B\u043E\u0433\u0438\u0439, \u0431\u0435\u0437 \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E\u0441\u0442\u0438 \u043F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0438 \u0441\u0442\u0440\u043E\u0438\u0442\u044C \u0441\u0432\u043E\u0435 \u0431\u0443\u0434\u0443\u0449\u0435\u0435. \r\n\u0423\u043A\u0440\u043E\u0439\u0442\u0435\u0441\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u0447\u0442\u043E\u0431\u044B \u0441\u0431\u0435\u0440\u0435\u0447\u044C \u0440\u0430\u0441\u0441\u0443\u0434\u043E\u043A, \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0438 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u0442\u0430\u0440\u044B\u0435 \u0437\u043D\u0430\u043D\u0438\u044F \u0438 \u0442\u0435\u0445\u043D\u043E\u043B\u043E\u0433\u0438\u0438, \u043D\u0430\u0443\u0447\u0438\u0442\u044C\u0441\u044F \u043B\u0435\u0447\u0438\u0442\u044C \u0430\u043C\u043D\u0435\u0437\u0438\u044E. \u041F\u043E\u0441\u043B\u0435 \u0432\u044B\u0445\u043E\u0434\u0430 \u0432\u0430\u043C \u043F\u0440\u0435\u0434\u0441\u0442\u043E\u0438\u0442 \u0437\u0430\u043D\u043E\u0432\u043E \u043F\u043E\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u0446\u0438\u0432\u0438\u043B\u0438\u0437\u0430\u0446\u0438\u044E."
    },
    {
      "id": 36,
      "title": "\u0412\u0440\u0430\u0449\u0435\u043D\u0438\u0435 \u0417\u0435\u043C\u043B\u0438",
      "description": "\u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0432 \u044F\u0434\u0440\u0435 \u043F\u043B\u0430\u043D\u0435\u0442\u044B \u043F\u0440\u0438\u0432\u0435\u043B\u0438 \u043A \u0443\u0441\u043A\u043E\u0440\u0435\u043D\u0438\u044E \u0432\u0440\u0430\u0449\u0435\u043D\u0438\u044F \u0417\u0435\u043C\u043B\u0438 \u0432 10 \u0440\u0430\u0437. \u0421\u0443\u0442\u043A\u0438 \u0441\u043E\u043A\u0440\u0430\u0442\u0438\u043B\u0438\u0441\u044C \u0434\u043E 2,5\u0447, \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u0432\u0440\u0430\u0449\u0435\u043D\u0438\u044F \u043D\u0430 \u044D\u043A\u0432\u0430\u0442\u043E\u0440\u0435 \u0432\u043E\u0437\u0440\u043E\u0441\u043B\u0430 \u0434\u043E 5 \u043A\u043C/\u0441 \u0438 \u0446\u0435\u043D\u0442\u0440\u043E\u0431\u0435\u0436\u043D\u0430\u044F \u0441\u0438\u043B\u0430 \u0437\u0434\u0435\u0441\u044C \u043F\u043E\u0447\u0442\u0438 \u0443\u0440\u0430\u0432\u043D\u043E\u0432\u0435\u0448\u0438\u0432\u0430\u0435\u0442 \u0433\u0440\u0430\u0432\u0438\u0442\u0430\u0446\u0438\u044E. \u041F\u043E\u043B\u044E\u0441\u0430 \u043F\u043B\u0430\u043D\u0435\u0442\u044B \u0441\u0434\u0430\u0432\u043B\u0438\u0432\u0430\u044E\u0442\u0441\u044F \u0438 \u0442\u0430\u043C \u0441\u0438\u043B\u0430 \u0442\u044F\u0436\u0435\u0441\u0442\u0438 \u0440\u0430\u0441\u0442\u0435\u0442. \u0411\u0443\u0448\u0443\u044E\u0442 \u0443\u0440\u0430\u0433\u0430\u043D\u044B, \u0433\u043E\u0440\u043E\u0434\u0430 \u0441\u043C\u044B\u0432\u0430\u044E\u0442 \u0446\u0443\u043D\u0430\u043C\u0438, \u0440\u0430\u0437\u0440\u0435\u0436\u0430\u0435\u0442\u0441\u044F \u0430\u0442\u043C\u043E\u0441\u0444\u0435\u0440\u0430, \u0443 \u043B\u044E\u0434\u0435\u0439 \u0440\u0443\u0448\u0430\u0442\u0441\u044F \u0431\u0438\u043E\u0440\u0438\u0442\u043C\u044B.\n\u0412\u044B \u043D\u0430\u0448\u043B\u0438 \u0431\u0443\u043D\u043A\u0435\u0440, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043E\u0431\u0435\u0441\u043F\u0435\u0447\u0438\u0432\u0430\u0435\u0442 \u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u0443\u044E \u0433\u0440\u0430\u0432\u0438\u0442\u0430\u0446\u0438\u044E, \u0430\u0442\u043C\u043E\u0441\u0444\u0435\u0440\u0443 \u0438 \u043F\u0440\u0438\u0432\u044B\u0447\u043D\u044B\u0435 \u0441\u0443\u0442\u043E\u0447\u043D\u044B\u0435 \u0440\u0438\u0442\u043C\u044B. \u041F\u043E\u043A\u0430 \u0432\u044B \u0432 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u0438. \u041D\u0443\u0436\u043D\u043E \u043F\u0440\u0438\u0434\u0443\u043C\u0430\u0442\u044C, \u043A\u0430\u043A \u0437\u0430\u043C\u0435\u0434\u043B\u0438\u0442\u044C \u0432\u0440\u0430\u0449\u0435\u043D\u0438\u0435 \u0417\u0435\u043C\u043B\u0438 \u0438\u043B\u0438 \u0443\u0447\u0438\u0442\u044C\u0441\u044F \u0436\u0438\u0442\u044C \u0432 \u043D\u043E\u0432\u044B\u0445 \u0443\u0441\u043B\u043E\u0432\u0438\u044F\u0445"
    },
    {
      "id": 37,
      "title": "\u0412\u0435\u0447\u043D\u0430\u044F \u0436\u0438\u0437\u043D\u044C",
      "description": "\u041B\u044E\u0434\u0438 \u0438\u0441\u043A\u0430\u043B\u0438 \u043F\u0440\u043E\u0434\u043B\u0435\u043D\u0438\u0435 \u0436\u0438\u0437\u043D\u0438 \u0432 \u0444\u0430\u0440\u043C\u0430\u0446\u0435\u0432\u0442\u0438\u043A\u0435 \u0438 \u0431\u0438\u043E\u043B\u043E\u0433\u0438\u0438. \u041D\u043E \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u0435 \u0431\u0435\u0441\u0441\u043C\u0435\u0440\u0442\u0438\u044F \u043E\u043A\u0430\u0437\u0430\u043B\u043E\u0441\u044C \u043D\u0430 \u0441\u0442\u044B\u043A\u0435 \u043F\u0441\u0438\u0445\u043E\u043B\u043E\u0433\u0438\u0438 \u0438 \u0444\u0438\u043B\u043E\u0441\u043E\u0444\u0438\u0438. \u041E\u0441\u043E\u0437\u043D\u0430\u043D\u0438\u0435 \u043D\u0435\u0438\u0437\u0431\u0435\u0436\u043D\u043E\u0441\u0442\u0438 \u0441\u043C\u0435\u0440\u0442\u0438 \u0438 \u0435\u0441\u0442\u044C \u043F\u0440\u0438\u0447\u0438\u043D\u0430 \u0441\u0442\u0430\u0440\u0435\u043D\u0438\u044F. \u0421\u043F\u0435\u0440\u0432\u0430 \u043D\u0435\u043C\u043D\u043E\u0433\u0438\u0435 \u0441\u043C\u043E\u0433\u043B\u0438 \u043F\u043E\u0432\u0435\u0440\u0438\u0442\u044C, \u0447\u0442\u043E \u0441\u043C\u0435\u0440\u0442\u044C \u0442\u0430\u043A \u043B\u0435\u0433\u043A\u043E \u043E\u0431\u043C\u0430\u043D\u0443\u0442\u044C, \u043D\u043E \u0442\u0435\u043F\u0435\u0440\u044C \u044D\u0442\u043E \u043E\u0447\u0435\u0432\u0438\u0434\u043D\u043E \u0434\u043B\u044F \u0432\u0441\u0435\u0445, \u0438 \u043D\u0438\u043A\u0442\u043E \u0431\u043E\u043B\u0435\u0435 \u043D\u0435 \u0441\u0442\u0430\u0440\u0435\u0435\u0442. \u041D\u0430\u0441\u0442\u0430\u043B \u0434\u0435\u043C\u043E\u0433\u0440\u0430\u0444\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0438 \u044D\u043A\u043E\u043D\u043E\u043C\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u043A\u0440\u0438\u0437\u0438\u0441. \u041C\u0438\u0440 \u043E\u0445\u0432\u0430\u0442\u0438\u043B\u0430 \u0430\u043F\u0430\u0442\u0438\u044F \u2013 \u0431\u0435\u0437 \u043F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u044B \u0441\u043C\u0435\u0440\u0442\u0438 \u0432\u0441\u0435 \u043F\u043E\u0442\u0435\u0440\u044F\u043B\u043E \u0441\u043C\u044B\u0441\u043B. \n\u0423\u043A\u0440\u043E\u0439\u0442\u0435\u0441\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u043F\u043E\u0431\u0435\u0434\u0438\u0442\u0435 \u0430\u043F\u0430\u0442\u0438\u044E \u0432 \u0441\u0432\u043E\u0435\u043C \u043C\u0438\u043A\u0440\u043E\u0441\u043E\u0446\u0438\u0443\u043C\u0435, \u0430 \u0437\u0430\u0442\u0435\u043C \u043F\u0440\u0438\u0434\u0443\u043C\u0430\u0439\u0442\u0435 \u0440\u0435\u0448\u0435\u043D\u0438\u0435 \u0434\u043B\u044F \u0432\u0441\u0435\u0433\u043E \u0447\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u0442\u0432\u0430. \u041D\u0443\u0436\u043D\u043E \u0432\u0435\u0440\u043D\u0443\u0442\u044C \u043B\u044E\u0434\u044F\u043C \u0441\u0442\u0440\u0430\u0445 \u0441\u043C\u0435\u0440\u0442\u0438 \u0438 \u0446\u0435\u043D\u043D\u043E\u0441\u0442\u044C \u0436\u0438\u0437\u043D\u0438."
    },
    {
      "id": 38,
      "title": "\u0412\u0430\u043C\u043F\u0438\u0440\u044B",
      "description": "\u0413\u0440\u0443\u043F\u043F\u0430 \u0430\u0440\u0445\u0435\u043E\u043B\u043E\u0433\u043E\u0432 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u043E \u0440\u0430\u0437\u0440\u0443\u0448\u0438\u043B\u0430 \u0434\u0440\u0435\u0432\u043D\u0435\u0435 \u0437\u0430\u043A\u043B\u044F\u0442\u0438\u0435, \u0438 \u0432\u0430\u043C\u043F\u0438\u0440\u044B \u043D\u0430\u0447\u0430\u043B\u0438 \u0441\u0442\u0440\u0435\u043C\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u0440\u0430\u0441\u043F\u0440\u043E\u0441\u0442\u0440\u0430\u043D\u044F\u0442\u044C\u0441\u044F \u043F\u043E \u0432\u0441\u0435\u043C\u0443 \u043C\u0438\u0440\u0443. \u042D\u0442\u0438 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0430 \u0441 \u043D\u0435\u0447\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u043A\u043E\u0439 \u0441\u0438\u043B\u043E\u0439 \u0438 \u0436\u0430\u0436\u0434\u043E\u0439 \u043A\u0440\u043E\u0432\u0438 \u043F\u0440\u0435\u0432\u0440\u0430\u0449\u0430\u044E\u0442 \u0433\u043E\u0440\u043E\u0434\u0430 \u0432 \u0437\u043E\u043D\u044B \u043D\u043E\u0447\u043D\u043E\u0433\u043E \u0442\u0435\u0440\u0440\u043E\u0440\u0430. \u0427\u0435\u043B\u043E\u0432\u0435\u0447\u0435\u0441\u0442\u0432\u043E \u043E\u043A\u0430\u0437\u0430\u043B\u043E\u0441\u044C \u043D\u0430 \u0433\u0440\u0430\u043D\u0438 \u0432\u044B\u043C\u0438\u0440\u0430\u043D\u0438\u044F.\r\n\u0423\u043A\u0440\u043E\u0439\u0442\u0435\u0441\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u0447\u0442\u043E\u0431\u044B \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u043F\u043B\u0430\u043D \u0441\u043F\u0430\u0441\u0435\u043D\u0438\u044F, \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u044F \u043B\u0435\u0433\u0435\u043D\u0434\u044B \u0438 \u0441\u043E\u0432\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0435 \u0442\u0435\u0445\u043D\u043E\u043B\u043E\u0433\u0438\u0438. \u0423\u0441\u0442\u0440\u043E\u0439\u0442\u0435 \u043E\u0445\u043E\u0442\u0443 \u043D\u0430 \u0432\u0430\u043C\u043F\u0438\u0440\u043E\u0432 \u0438 \u0441\u043F\u0430\u0441\u0438\u0442\u0435 \u0432\u044B\u0436\u0438\u0432\u0448\u0438\u0445."
    },
    {
      "id": 39,
      "title": "\u041F\u0435\u0440\u0444\u0435\u043A\u0446\u0438\u043E\u043D\u0438\u0437\u043C",
      "description": "\u0418\u043D\u0444\u043E\u0446\u044B\u0433\u0430\u043D\u0435 \u0441\u043E \u0441\u0432\u043E\u0438\u043C \u0443\u0441\u043F\u0435\u0448\u043D\u044B\u043C \u0443\u0441\u043F\u0435\u0445\u043E\u043C \u0438 \u043A\u0443\u043B\u044C\u0442\u043E\u043C \u044D\u0444\u0444\u0435\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u0438 \u043F\u043E\u0440\u043E\u0434\u0438\u043B\u0438 \u0438\u043D\u0444\u043E\u0432\u0438\u0440\u0443\u0441 \u043F\u0435\u0440\u0444\u0435\u043A\u0446\u0438\u043E\u043D\u0438\u0437\u043C\u0430. \u0422\u0435\u043F\u0435\u0440\u044C \u043D\u0438\u043A\u0430\u043A\u0438\u0435 \u0437\u0430\u0434\u0430\u0447\u0438 \u0438 \u043F\u0440\u043E\u0435\u043A\u0442\u044B \u043D\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0430\u044E\u0442\u0441\u044F \u0432\u043E\u0432\u0441\u0435, \u0432\u0441\u0435 \u0431\u0435\u0441\u043A\u043E\u043D\u0435\u0447\u043D\u043E \u043F\u0435\u0440\u0435\u0434\u0435\u043B\u044B\u0432\u0430\u044E\u0442\u0441\u044F, \u0432\u0441\u0435 \u0441\u0430\u043C\u043E\u0441\u043E\u0432\u0435\u0440\u0448\u0435\u043D\u0441\u0442\u0432\u0443\u044E\u0442\u0441\u044F, \u043A\u0440\u0438\u0442\u0438\u043A\u0443\u044E\u0442 \u0434\u0440\u0443\u0433 \u0434\u0440\u0443\u0433\u0430, \u0441\u0442\u0440\u0430\u0434\u0430\u044E\u0442 \u043E\u0442 \u043D\u0438\u0437\u043A\u043E\u0439 \u0441\u0430\u043C\u043E\u043E\u0446\u0435\u043D\u043A\u0438 \u0438 \u0441\u043E\u0440\u0432\u0430\u043D\u043D\u044B\u0445 \u0434\u0435\u0434\u043B\u0430\u0439\u043D\u043E\u0432. \u042D\u043A\u043E\u043D\u043E\u043C\u0438\u043A\u0430 \u043A\u043E\u043B\u043B\u0430\u043F\u0441\u0438\u0440\u0443\u0435\u0442, \u043E\u0442\u0447\u0430\u044F\u0432\u0448\u0438\u0435\u0441\u044F \u043B\u044E\u0434\u0438 \u0441\u043E\u0440\u0435\u0432\u043D\u0443\u044E\u0442\u0441\u044F \u0432 \u043F\u043E\u043F\u044B\u0442\u043A\u0430\u0445 \u0441\u043E\u0432\u0435\u0440\u0448\u0438\u0442\u044C \u0438\u0434\u0435\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u0430\u043C\u043E\u0443\u0431\u0438\u0439\u0441\u0442\u0432\u043E.\r\n\u0421\u043E\u0431\u0435\u0440\u0438\u0442\u0435 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0441\u0430\u043C\u044B\u0445 \u043D\u0435\u0443\u0434\u0430\u0447\u043D\u0438\u043A\u043E\u0432, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u043D\u0435 \u0431\u043E\u044F\u0442\u0441\u044F \u043A\u043E\u0441\u044F\u0447\u0438\u0442\u044C \u0438 \u0441\u0443\u043C\u0435\u044E\u0442 \u0431\u044B\u0441\u0442\u0440\u043E \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0438\u0442\u044C \u043F\u043B\u0430\u043D \u0441\u043F\u0430\u0441\u0435\u043D\u0438\u044F \u043C\u0438\u0440\u0430, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0431\u0443\u0434\u0435\u0442 \u043D\u0435 \u0438\u0434\u0435\u0430\u043B\u0435\u043D, \u043D\u043E \u0445\u043E\u0440\u043E\u0448."
    }
  ];
  var BUNKERS = [
    {
      "id": 1,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u21161",
      "description": "\u0421\u0442\u0440\u0430\u043D\u043D\u044B\u0439 \u0441\u0442\u0430\u0440\u044B\u0439 \u0436\u0443\u0440\u043D\u0430\u043B, \u0442\u0430\u043C \u0438\u043C\u0435\u043D\u0430 \u0432\u0441\u0435\u0445 \u0438\u0437 \u0432\u0441\u0435\u0439 \u0442\u043E\u043B\u043F\u044B \u0447\u0442\u043E \u0441\u0442\u043E\u0438\u0442 \u0443 \u0431\u0443\u043D\u043A\u0435\u0440\u0430. \u0420\u044F\u0434\u043E\u043C \u0434\u0430\u0442\u044B 33-\u043B\u0435\u0442\u043D\u0435\u0439 \u0434\u0430\u0432\u043D\u043E\u0441\u0442\u0438 \u0438 \u0442\u043E\u0447\u043D\u043E\u0435 \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u0442\u043E\u0433\u043E, \u0447\u0442\u043E \u0441 \u0432\u0430\u043C\u0438 \u043F\u0440\u043E\u0438\u0441\u0445\u043E\u0434\u0438\u0442. \u042D\u0442\u043E \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u043F\u043E\u0437\u0432\u043E\u043B\u0438\u0442 \u0432\u0430\u043C \u043D\u0435 \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0442\u044C \u043E\u0434\u043D\u0443 \u043A\u0430\u0440\u0442\u0443 \u0443\u0433\u0440\u043E\u0437\u044B"
    },
    {
      "id": 2,
      "title": "\u0418\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044F \u043A \u043C\u0438\u043A\u0440\u043E\u0432\u043E\u043B\u043D\u043E\u0432\u043A\u0435",
      "description": "\u0442\u0443\u0430\u043B\u0435\u0442\u043D\u043E\u0439 \u0431\u0443\u043C\u0430\u0433\u0438 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u043D\u0435\u0442, \u0437\u0430\u0442\u043E \u0435\u0441\u0442\u044C \u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044F \u043F\u043E \u043F\u0435\u0440\u0435\u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044E \u043C\u0438\u043A\u0440\u043E\u0432\u043E\u043B\u043D\u043E\u0432\u043A\u0438 \u043D\u0430 7174 \u044F\u0437\u044B\u043A\u0430\u0445"
    },
    {
      "id": 3,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u21163",
      "description": "\u0411\u0438\u0431\u043B\u0438\u043E\u0442\u0435\u043A\u0430 \u043A\u043E\u043D\u0442\u0440\u0430\u0431\u0430\u043D\u0434\u0438\u0441\u0442\u043E\u0432, \u0447\u0442\u043E \u043F\u0440\u044F\u0442\u0430\u043B\u0438\u0441\u044C \u0432 \u044D\u0442\u043E\u043C \u0431\u0443\u043D\u043A\u0435\u0440\u0435. \u0414\u0435\u0442\u0430\u043B\u044C\u043D\u043E \u043E\u043F\u0438\u0441\u0430\u043D\u044B \u0432\u0441\u0435 \u0446\u0435\u043D\u043D\u044B\u0435 \u043F\u0440\u0435\u0434\u043C\u0435\u0442\u044B \u0438\u0441\u043A\u0443\u0441\u0441\u0442\u0432\u0430, \u0447\u0442\u043E \u0435\u0441\u0442\u044C \u0432 \u043E\u043A\u0440\u0443\u0433\u0435, \u0441 \u043C\u0430\u0440\u0448\u0440\u0443\u0442\u0430\u043C\u0438 \u0432\u044B\u0432\u043E\u0437\u0430 \u043C\u0438\u043C\u043E \u043F\u043E\u043B\u0438\u0446\u0438\u0438"
    },
    {
      "id": 4,
      "title": "\u0412\u043C\u0435\u0441\u0442\u0435 \u043D\u0430 10 \u043B\u0435\u0442",
      "description": "\u0431\u0443\u043D\u043A\u0435\u0440 \u043E\u0442\u043A\u0440\u043E\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0435\u0440\u0435\u0437 10 \u043B\u0435\u0442, \u0435\u0434\u044B \u043D\u0430 \u0432\u0441\u0435 \u044D\u0442\u043E \u0445\u0432\u0430\u0442\u0438\u0442. \u041D\u043E \u0437\u0430 \u044D\u0442\u043E \u0432\u0440\u0435\u043C\u044F \u0432\u044B \u043D\u0430\u043F\u043E\u0440\u0435\u0442\u0435\u0441\u044C \u043D\u0430 \u0435\u0449\u0435 \u043E\u0434\u043D\u0443 \u0443\u0433\u0440\u043E\u0437\u0443, \u0441 \u043A\u043E\u0442\u043E\u0440\u043E\u0439 \u0432\u0430\u043C \u0432 \u043A\u043E\u043D\u0446\u0435 \u043F\u0440\u0438\u0434\u0435\u0442\u0441\u044F \u0438\u043C\u0435\u0442\u044C \u0434\u0435\u043B\u043E"
    },
    {
      "id": 5,
      "title": "\u041A\u043D\u0438\u0433\u0430 \u043E \u0435\u0434\u0435",
      "description": '\u041A\u043D\u0438\u0433\u0430 "\u043E \u0432\u043A\u0443\u0441\u043D\u043E\u0439 \u0437\u0434\u043E\u0440\u043E\u0432\u043E\u0439 \u043F\u0438\u0449\u0435 \u043A\u0430\u043A \u043F\u0440\u0435\u0434\u043C\u0435\u0442\u0435 \u0438\u0441\u043A\u0443\u0441\u0441\u0442\u0432\u0430 \u0438 \u043A\u0443\u043B\u044C\u0442\u0443\u0440\u044B". \u0421 \u0446\u0435\u043D\u043D\u044B\u043C\u0438 \u0433\u043B\u0430\u0432\u0430\u043C\u0438 \u043E \u0442\u043E\u043C, \u043A\u0430\u043A \u0434\u043E\u0431\u044B\u0432\u0430\u0442\u044C \u0438 \u0433\u043E\u0442\u043E\u0432\u0438\u0442\u044C \u0432\u043A\u0443\u0441\u043D\u0443\u044E \u0435\u0434\u0443 \u0434\u0430\u0436\u0435 \u0432 \u0441\u0430\u043C\u044B\u0445 \u044D\u043A\u0441\u0442\u0440\u0435\u043C\u0430\u043B\u044C\u043D\u044B\u0445 \u0443\u0441\u043B\u043E\u0432\u0438\u044F\u0445'
    },
    {
      "id": 6,
      "title": "\u0412\u0438\u0434\u0435\u043E \u0441\u043E \u0441\u043F\u0443\u0442\u043D\u0438\u043A\u0430",
      "description": "\u043D\u0430 \u0441\u0442\u0435\u043D\u044B \u043F\u0440\u043E\u0435\u0446\u0438\u0440\u0443\u0435\u0442\u0441\u044F \u0440\u0435\u043B\u0430\u043A\u0441\u0430\u0446\u0438\u043E\u043D\u043D\u043E\u0435 \u0432\u0438\u0434\u0435\u043E \u0441\u044A\u0435\u043C\u043E\u043A \u0441\u043E \u0441\u043F\u0443\u0442\u043D\u0438\u043A\u0430. \u041A\u0440\u0430\u0441\u0438\u0432\u043E \u0438 \u0443\u043C\u0438\u0440\u043E\u0442\u0432\u043E\u0440\u044F\u044E\u0449\u0435, \u043F\u043E\u0442\u043E\u043C\u0443 \u0447\u0442\u043E \u044D\u0442\u043E \u043E\u043A\u0440\u0435\u0441\u0442\u043D\u043E\u0441\u0442\u0438 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0441 \u043E\u0442\u043B\u0438\u0447\u043D\u043E\u0439 \u0434\u0435\u0442\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u0435\u0439"
    },
    {
      "id": 7,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u21167",
      "description": "\u0418\u0437 \u043F\u043E\u0434\u0432\u0430\u043B\u0430 \u0435\u0441\u0442\u044C \u0432\u044B\u0445\u043E\u0434 \u0432 \u0435\u0441\u0442\u0435\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0433\u0440\u043E\u0442 \u0441 \u043F\u043E\u0434\u0437\u0435\u043C\u043D\u043E\u0439 \u0440\u0435\u043A\u043E\u0439. \u0421\u0443\u0434\u044F \u043F\u043E \u0437\u0430\u043F\u0430\u0445\u0443, \u043F\u043E \u0440\u0435\u043A\u0435 \u043C\u043E\u0436\u043D\u043E \u043F\u043E\u043F\u0430\u0441\u0442\u044C \u0432 \u0440\u0430\u0437\u0432\u0430\u043B\u0435\u043D\u043D\u0443\u044E \u0441\u0438\u0441\u0442\u0435\u043C\u0443 \u0433\u043E\u0440\u043E\u0434\u0441\u043A\u043E\u0439 \u043A\u0430\u043D\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u0438 \u0438 \u0432\u044B\u0439\u0442\u0438 \u043A\u0443\u0434\u0430 \u0443\u0433\u043E\u0434\u043D\u043E"
    },
    {
      "id": 8,
      "title": "\u041C\u0438\u043A\u0440\u043E\u043B\u043E\u043B\u0438\u043A\u043E\u043D",
      "description": "\u043E\u0433\u0440\u043E\u043C\u043D\u044B\u0439 \u0434\u0440\u0435\u0432\u043D\u0438\u0439 \u0444\u043E\u043B\u0438\u0430\u043D\u0442 \u043D\u0430 \u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u043C \u044F\u0437\u044B\u043A\u0435 \u0441 \u043C\u0438\u0441\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u043C\u0438 \u0438\u043B\u043B\u044E\u0441\u0442\u0440\u0430\u0446\u0438\u044F\u043C\u0438. \u041F\u043E\u0445\u043E\u0436\u0435 \u043D\u0430 \u0433\u0440\u0438\u043C\u0443\u0430\u0440 \u0441 \u0437\u0430\u043A\u043B\u0438\u043D\u0430\u043D\u0438\u044F\u043C\u0438 \u0438 \u0430\u043D\u0430\u0442\u043E\u043C\u0438\u0447\u0435\u0441\u043A\u0443\u044E \u044D\u043D\u0446\u0438\u043A\u043B\u043E\u043F\u0435\u0434\u0438\u044E"
    },
    {
      "id": 9,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u21169",
      "description": "\u0421 \u043F\u0435\u0440\u0435\u0431\u043E\u044F\u043C\u0438 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u044D\u043B\u0435\u043A\u0442\u0440\u0438\u0447\u0435\u0441\u043A\u043E\u0435 \u043E\u0441\u0432\u0435\u0449\u0435\u043D\u0438\u0435, \u043D\u043E \u0437\u0430\u0442\u043E \u0435\u0441\u0442\u044C \u043A\u0435\u0440\u043E\u0441\u0438\u043D\u043E\u0432\u044B\u0435 \u043B\u0430\u043C\u043F\u044B \u0438 \u0437\u0430\u043F\u0430\u0441 \u0442\u043E\u043F\u043B\u0438\u0432\u0430. \u041C\u043E\u0436\u043D\u043E \u0441\u0434\u0435\u043B\u0430\u0442\u044C \u043A\u043E\u043A\u0442\u0435\u0439\u043B\u0438 \u041C\u043E\u043B\u043E\u0442\u043E\u0432\u0430 \u0434\u043B\u044F \u0437\u0430\u0449\u0438\u0442\u044B"
    },
    {
      "id": 10,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211610",
      "description": "\u0428\u043A\u0430\u0444 \u0441\u043E \u0432\u0441\u0435\u043C\u0438 \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u044B\u043C\u0438 \u0432\u0438\u0434\u0430\u043C\u0438 \u041C\u043E\u043D\u043E\u043F\u043E\u043B\u0438\u0438"
    },
    {
      "id": 11,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211611",
      "description": "\u041A\u043E\u0444\u0435\u043C\u043E\u043B\u043A\u0430 \u0438 \u0437\u0430\u043F\u0430\u0441 \u0430\u0440\u043E\u043C\u0430\u0442\u043D\u043E\u0433\u043E \u043E\u0431\u0436\u0430\u0440\u0435\u043D\u043D\u043E\u0433\u043E \u0437\u0435\u0440\u043D\u043E\u0432\u043E\u0433\u043E \u043A\u043E\u0444\u0435"
    },
    {
      "id": 12,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211612",
      "description": "\u0414\u044B\u0440\u044F\u0432\u044B\u0435 \u043C\u0430\u0442\u0440\u0430\u0441\u044B \u0438 \u0442\u0440\u044F\u043F\u043A\u0438, \u0431\u0440\u043E\u0448\u0435\u043D\u043D\u044B\u0439 \u0441\u0442\u0440\u043E\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u043C\u0443\u0441\u043E\u0440 \u0438 \u0441\u0442\u0430\u0440\u0438\u043D\u043D\u044B\u0435 \u0433\u0430\u0437\u0435\u0442\u044B \u0438\u0437 2020 \u0433\u043E\u0434\u0430"
    },
    {
      "id": 13,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211613",
      "description": "\u0421\u043F\u0430\u043B\u044C\u043D\u044B\u0445 \u043C\u0435\u0441\u0442 \u0440\u043E\u0432\u043D\u043E \u043F\u043E \u0447\u0438\u0441\u043B\u0443 \u043B\u044E\u0434\u0435\u0439, \u043A\u0442\u043E \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435. \u041E\u0434\u043D\u043E \u0438\u0437 \u043D\u0438\u0445 \u0441\u0442\u043E\u0438\u0442 \u043E\u0431\u043E\u0441\u043E\u0431\u043B\u0435\u043D\u043D\u043E \u0438 \u043F\u043E\u0445\u043E\u0436\u0435 \u043D\u0430 \u0436\u0435\u0440\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0430\u043B\u0442\u0430\u0440\u044C"
    },
    {
      "id": 14,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211614",
      "description": "\u0415\u0441\u0442\u044C \u043C\u0435\u0434\u0438\u0430\u0442\u0435\u043A\u0430. \u0422\u0430\u043C \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0440\u043D\u043E\u0444\u0438\u043B\u044C\u043C\u044B \u0437\u0430 \u0432\u0441\u044E \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u043A\u0438\u043D\u0435\u043C\u0430\u0442\u043E\u0433\u0440\u0430\u0444\u0430. \u041D\u0430\u0441\u043B\u0430\u0436\u0434\u0430\u0439\u0442\u0435\u0441\u044C"
    },
    {
      "id": 15,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211615",
      "description": "\u0410\u0432\u0442\u043E\u043D\u043E\u043C\u043D\u044B\u0439 \u0440\u043E\u0431\u043E\u0442 \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u0447\u0438\u043A \u0441 \u0444\u0443\u043D\u043A\u0446\u0438\u0435\u0439 \u043F\u043E\u043B\u0438\u0433\u0440\u0430\u0444\u0430, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0431\u0443\u0434\u0435\u0442 \u043F\u043E\u043B\u0435\u0437\u0435\u043D \u0434\u043B\u044F \u0441\u043B\u043E\u0436\u043D\u044B\u0445 \u043F\u0435\u0440\u0435\u0433\u043E\u0432\u043E\u0440\u043E\u0432"
    },
    {
      "id": 16,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211616",
      "description": "\u0411\u0443\u043D\u043A\u0435\u0440 \u0441\u0442\u0440\u043E\u0438\u043B\u0438 \u0437\u0435\u043A\u0438. \u0417\u0435\u043A\u0438 \u0438 \u043E\u0445\u0440\u0430\u043D\u043D\u0438\u043A\u0438 \u043F\u043E\u0434\u043E\u0445\u043B\u0438 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435. \u0416\u0443\u0442\u043A\u0438\u0439 \u0437\u0430\u043F\u0430\u0445 \u0433\u043D\u0438\u044E\u0449\u0435\u0433\u043E \u043C\u044F\u0441\u0430 \u043F\u0440\u0438\u0432\u0435\u043B \u0432\u0430\u0441 \u0432 \u043F\u043E\u0434\u0432\u0430\u043B, \u0433\u0434\u0435 \u0432\u044B \u043D\u0430\u0448\u043B\u0438 \u0438\u0445 \u043E\u0441\u0442\u0430\u043D\u043A\u0438, \u0438\u0445 \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u044B \u0438 \u043E\u0440\u0443\u0436\u0438\u0435 \u043E\u0445\u0440\u0430\u043D\u043D\u0438\u043A\u043E\u0432"
    },
    {
      "id": 17,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211617",
      "description": "\u0411\u0443\u043D\u043A\u0435\u0440 \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0441 \u043F\u043E\u043C\u043E\u0449\u044C\u044E  \u0438\u0441\u043A\u0443\u0441\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u0433\u043E \u0438\u043D\u0442\u0435\u043B\u043B\u0435\u043A\u0442\u0430 \u0448\u0418\u0418\u043F\u0438\u0434\u0430\u0440 \u0441 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u044B\u043C \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u043E\u043C. \u0448\u0418\u0418\u043F\u0438\u0434\u0430\u0440 \u043F\u043E\u043D\u0438\u043C\u0430\u0435\u0442 \u043A\u043E\u043C\u0430\u043D\u0434\u044B \u0441 \u043F\u044F\u0442\u043E\u0439 \u043F\u043E\u043F\u044B\u0442\u043A\u0438 \u0438 \u043C\u0430\u0442\u0435\u0440\u043D\u043E \u0432\u044B\u043F\u0435\u043D\u0434\u0440\u0438\u0432\u0430\u0435\u0442\u0441\u044F, \u043A\u043E\u0433\u0434\u0430 \u043D\u0443\u0436\u043D\u043E \u0447\u0442\u043E-\u0442\u043E \u0434\u0435\u043B\u0430\u0442\u044C"
    },
    {
      "id": 18,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211618",
      "description": "\u0412 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0435\u0441\u0442\u044C \u043C\u043D\u043E\u0433\u043E \u043A\u0440\u044B\u0441. \u0418\u0445 \u043C\u043E\u0436\u043D\u043E \u0441\u044A\u0435\u0441\u0442\u044C \u0432 \u043A\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0439 \u0441\u0438\u0442\u0443\u0430\u0446\u0438\u0438. \u0418\u043B\u0438 \u043E\u043D\u0438 \u043C\u043E\u0433\u0443\u0442 \u0441\u044A\u0435\u0441\u0442\u044C \u0432\u0430\u0441"
    },
    {
      "id": 19,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211619",
      "description": "\u0412 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u0435 \u0442\u0435\u043A\u0442\u043E\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u0441\u0434\u0432\u0438\u0433\u043E\u0432 \u0431\u0443\u043D\u043A\u0435\u0440 \u043D\u0430\u043A\u043B\u043E\u043D\u0435\u043D \u043D\u0430 45 \u0433\u0440\u0430\u0434\u0443\u0441\u043E\u0432"
    },
    {
      "id": 20,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211620",
      "description": "\u041C\u043E\u0434\u0443\u043B\u044C \u0433\u0438\u043F\u043D\u043E-\u0442\u0435\u043B\u0435\u043F\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0439 \u043A\u043E\u043C\u043C\u0443\u043D\u0438\u043A\u0430\u0446\u0438\u0438 \u0438 \u0434\u0435\u0442\u0435\u043A\u0442\u043E\u0440 \u043F\u0430\u0440\u0430\u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u044B\u0445 \u043B\u044E\u0434\u0435\u0439"
    },
    {
      "id": 21,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211621",
      "description": "\u0415\u0441\u0442\u044C \u0432\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0435\u0435 \u0440\u0430\u0434\u0438\u043E \u0441 \u043A\u043B\u0430\u0441\u0441\u0438\u0447\u0435\u0441\u043A\u043E\u0439 \u043C\u0443\u0437\u044B\u043A\u043E\u0439. \u041D\u043E \u0447\u0435\u0440\u0435\u0437 \u043A\u0430\u0436\u0434\u0443\u044E \u0432\u0442\u043E\u0440\u0443\u044E \u0438\u043B\u0438 \u0442\u0440\u0435\u0442\u044C\u044E \u043F\u0435\u0441\u043D\u044E \u0438\u0433\u0440\u0430\u044E\u0442 \u043F\u0435\u0441\u043D\u0438 \u0428\u0430\u043C\u0430\u043D\u0430. \u041C\u043E\u0436\u043D\u043E \u043F\u043E\u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u0442\u0440\u0435\u0441\u0441\u043E\u0443\u0441\u0442\u043E\u0439\u0447\u0438\u0432\u043E\u0441\u0442\u044C"
    },
    {
      "id": 22,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211622",
      "description": "\u0425\u0438\u043C\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u043B\u0430\u0431\u043E\u0440\u0430\u0442\u043E\u0440\u0438\u044F \u0441 \u0440\u0435\u0430\u043A\u0442\u0438\u0432\u0430\u043C\u0438. \u041C\u043E\u0436\u043D\u043E \u0443\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u0433\u0438\u0434\u0440\u043E\u043F\u043E\u043D\u0438\u0447\u0435\u0441\u043A\u0443\u044E \u0444\u0435\u0440\u043C\u0443"
    },
    {
      "id": 23,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211623",
      "description": "\u0412\u0430\u0448\u0430 \u0435\u0434\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0433\u0440\u0435\u0447\u043A\u0430, \u043D\u043E \u0435\u0434\u044B \u0432 \u0434\u0432\u0430 \u0440\u0430\u0437\u0430 \u0431\u043E\u043B\u044C\u0448\u0435 \u0447\u0435\u043C \u0434\u043E\u043B\u0436\u043D\u043E \u0431\u044B\u0442\u044C"
    },
    {
      "id": 24,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211624",
      "description": "\u0420\u0435\u0437\u0435\u0440\u0432\u043D\u044B\u0439 \u044D\u043B\u0435\u043A\u0442\u0440\u043E\u0433\u0435\u043D\u0435\u0440\u0430\u0442\u043E\u0440 \u0441 \u0432\u0435\u043B\u043E\u043F\u0440\u0438\u0432\u043E\u0434\u043E\u043C \u0438 \u043A\u0443\u0447\u0430 \u043C\u0435\u0442\u0430\u043B\u043B\u043E\u043B\u043E\u043C\u0430"
    },
    {
      "id": 25,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211625",
      "description": "\u0420\u043E\u0431\u043E\u0442-\u043F\u0441\u0438\u0445\u043E\u043B\u043E\u0433. \u041C\u043E\u043B\u0447\u0430 \u0441\u043B\u0443\u0448\u0430\u0435\u0442 \u0438 \u043A\u0438\u0432\u0430\u0435\u0442, \u0438\u043D\u043E\u0433\u0434\u0430 \u0447\u0442\u043E-\u0442\u043E \u043F\u0438\u043B\u0438\u043A\u0430\u0435\u0442. \u0412 \u043A\u0440\u0430\u0439\u043D\u0435\u043C \u0441\u043B\u0443\u0447\u0430\u0435 \u0435\u0433\u043E \u043C\u043E\u0436\u043D\u043E \u0440\u0430\u0437\u043E\u0431\u0440\u0430\u0442\u044C \u043D\u0430 \u0437\u0430\u043F\u0447\u0430\u0441\u0442\u0438."
    },
    {
      "id": 26,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211626",
      "description": "\u0423 \u0432\u0445\u043E\u0434\u0430 \u0435\u0441\u0442\u044C \u0430\u043F\u0442\u0435\u0447\u043A\u0438, \u0440\u0435\u0437\u0438\u043D\u043E\u0432\u044B\u0435 \u043F\u0435\u0440\u0447\u0430\u0442\u043A\u0438, \u043C\u0430\u0441\u043A\u0438 \u0438 \u043E\u0433\u043D\u0435\u0442\u0443\u0448\u0438\u0442\u0435\u043B\u044C"
    },
    {
      "id": 27,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211627",
      "description": "\u0423 \u0432\u0430\u0441 \u0435\u0441\u0442\u044C \u0443\u0447\u0435\u0431\u043D\u043E\u0435 \u043F\u043E\u0441\u043E\u0431\u0438\u0435 \u0441 \u043F\u043E\u043B\u0435\u0437\u043D\u044B\u043C\u0438 \u043F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0430\u043C\u0438 \u043F\u043E \u0431\u043E\u0440\u044C\u0431\u0435 \u0441 \u0432\u0430\u0448\u0435\u0439 \u043A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u043E\u0439"
    },
    {
      "id": 28,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211628",
      "description": "\u041F\u0435\u0440\u0435\u043D\u043E\u0441\u043D\u043E\u0439 \u0433\u0435\u043D\u0435\u0440\u0430\u0442\u043E\u0440 \u0437\u0430\u0449\u0438\u0442\u043D\u043E\u0433\u043E \u0441\u0438\u043B\u043E\u0432\u043E\u0433\u043E \u043F\u043E\u043B\u044F"
    },
    {
      "id": 29,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211629",
      "description": "\u041C\u0435\u0434\u0438\u0446\u0438\u043D\u0441\u043A\u0430\u044F \u043B\u0430\u0431\u043E\u0440\u0430\u0442\u043E\u0440\u0438\u044F \u0441 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u043E\u0439"
    },
    {
      "id": 30,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211630",
      "description": "\u0423 \u0432\u0430\u0441 \u0435\u0441\u0442\u044C \u043C\u0430\u0441\u0442\u0435\u0440\u0441\u043A\u0430\u044F \u0441 \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u0430\u043C\u0438"
    },
    {
      "id": 31,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211631",
      "description": "\u0423 \u0432\u0430\u0441 \u0435\u0441\u0442\u044C \u043E\u0433\u0440\u043E\u043C\u043D\u0430\u044F \u0431\u0438\u0431\u043B\u0438\u043E\u0442\u0435\u043A\u0430, \u043D\u043E, \u043A \u0441\u043E\u0436\u0430\u043B\u0435\u043D\u0438\u044E, \u0431\u043E\u043B\u044C\u0448\u0430\u044F \u0447\u0430\u0441\u0442\u044C \u043A\u043D\u0438\u0433 - \u043D\u0438\u0437\u043A\u043E\u0441\u043E\u0440\u0442\u043D\u044B\u0435 \u0434\u0430\u043C\u0441\u043A\u0438\u0435 \u0440\u043E\u043C\u0430\u043D\u044B. \u0412\u043F\u0440\u043E\u0447\u0435\u043C, \u0441\u0440\u0435\u0434\u0438 \u044D\u0442\u0438\u0445 \u0440\u043E\u043C\u0430\u043D\u043E\u0432 \u0435\u0441\u0442\u044C \u0437\u0430\u0442\u0435\u0441\u0430\u043B\u043E\u0441\u044C \u0438 \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u043B\u0435\u0437\u043D\u044B\u0445 \u043A\u043D\u0438\u0433, \u043D\u043E \u0438\u0445 \u043E\u0447\u0435\u043D\u044C \u0441\u043B\u043E\u0436\u043D\u043E \u043D\u0430\u0439\u0442\u0438."
    },
    {
      "id": 32,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211632",
      "description": "\u0411\u0443\u043D\u043A\u0435\u0440 \u043E\u0441\u043D\u0430\u0449\u0435\u043D \u0438\u043D\u0432\u0435\u0440\u0442\u043E\u0440\u043E\u043C, \u043C\u043E\u0449\u043D\u044B\u043C \u0430\u043A\u043A\u0443\u043C\u0443\u043B\u044F\u0442\u043E\u0440\u043E\u043C \u0438 \u0441\u043E\u043B\u043D\u0435\u0447\u043D\u043E\u0439 \u043F\u0430\u043D\u0435\u043B\u044C\u044E"
    },
    {
      "id": 33,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211633",
      "description": "\u0412 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0435\u0441\u0442\u044C \u043C\u0435\u0448\u043E\u043A \u0437\u0435\u0440\u0435\u043D \u0440\u0430\u0437\u043D\u044B\u0445 \u043E\u0432\u043E\u0449\u0435\u0439"
    },
    {
      "id": 34,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211634",
      "description": "\u0412\u044B \u043D\u0430\u0448\u043B\u0438 \u043D\u0430\u0431\u043E\u0440 \u0411\u0414\u0421\u041C-\u0430\u043A\u0441\u0435\u0441\u0441\u0443\u0430\u0440\u043E\u0432"
    },
    {
      "id": 35,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211635",
      "description": "\u0423 \u0432\u0430\u0441 \u0435\u0441\u0442\u044C \u0447\u0435\u0445\u043E\u043B \u043E\u0442 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0430 \u041A\u0430\u043B\u0430\u0448\u043D\u0438\u043A\u043E\u0432\u0430. \u0410\u0432\u0442\u043E\u043C\u0430\u0442 \u041A\u0430\u043B\u0430\u0448\u043D\u0438\u043A\u043E\u0432\u0430 \u043F\u0440\u0438 \u044D\u0442\u043E\u043C \u0432\u0430\u043C \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u0434\u0430\u043B"
    },
    {
      "id": 36,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211636",
      "description": "\u0412\u044B \u043D\u0430\u0448\u043B\u0438 \u0431\u043E\u0447\u043A\u0443 \u0441 \u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0439 \u0436\u0438\u0434\u043A\u043E\u0441\u0442\u044C\u044E"
    },
    {
      "id": 37,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211637",
      "description": "\u0412 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0436\u0438\u0432\u0435\u0442 \u043F\u043E\u043F\u0443\u0433\u0430\u0439, \u043A\u043E\u0442\u043E\u0440\u043E\u0433\u043E \u043D\u0430\u0443\u0447\u0438\u043B\u0438 \u043F\u043E\u043B\u044C\u0441\u043A\u0438\u043C \u043C\u0430\u0442\u0430\u043C. \u0418 \u043D\u0435\u043C\u0435\u0446\u043A\u0438\u043C \u0442\u043E\u0436\u0435. \u0418 \u0440\u0443\u0441\u0441\u043A\u0438\u043C. \u0418 \u0444\u0440\u0430\u043D\u0446\u0443\u0437\u0441\u043A\u0438\u043C. \u041A\u0430\u0436\u0435\u0442\u0441\u044F, \u043E\u043D \u043C\u0430\u0442\u044B \u0432\u0441\u0435\u0445 \u044F\u0437\u044B\u043A\u043E\u0432 \u0437\u043D\u0430\u0435\u0442!"
    },
    {
      "id": 38,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211638",
      "description": "\u0423 \u0432\u0430\u0441 \u0435\u0441\u0442\u044C \u0441\u0431\u043E\u0440\u043D\u0438\u043A \u0430\u043D\u0435\u043A\u0434\u043E\u0442\u043E\u0432 \u043F\u0440\u043E \u0428\u0442\u0438\u0440\u043B\u0438\u0446\u0430"
    },
    {
      "id": 39,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211639",
      "description": "\u0412\u044B \u043D\u0430\u0448\u043B\u0438 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0442\u0435\u043F\u043B\u043E\u0432\u0438\u0437\u043E\u0440"
    },
    {
      "id": 40,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211640",
      "description": "\u0423 \u0432\u0430\u0441 \u0435\u0441\u0442\u044C \u0431\u0435\u043D\u0437\u0438\u043D\u043E\u0432\u044B\u0439 \u0433\u0435\u043D\u0435\u0440\u0430\u0442\u043E\u0440, \u0442\u043E\u043F\u043B\u0438\u0432\u0430 \u0445\u0432\u0430\u0442\u0430\u0435\u0442 \u043D\u0430 \u043C\u0435\u0441\u044F\u0446"
    },
    {
      "id": 41,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211641",
      "description": "\u0423 \u0432\u0430\u0441 \u0435\u0441\u0442\u044C \u043D\u0430\u0434\u0443\u0432\u043D\u043E\u0439 \u043C\u0430\u0442\u0440\u0430\u0441 \u0432 \u0432\u0438\u0434\u0435 \u043F\u043E\u043D\u0447\u0438\u043A\u0430. \u041C\u043E\u0436\u0435\u0442 \u043F\u043E\u043C\u043E\u0447\u044C \u0432\u043E \u0432\u0440\u0435\u043C\u044F \u0437\u0430\u0442\u043E\u043F\u043B\u0435\u043D\u0438\u0439"
    },
    {
      "id": 42,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211642",
      "description": "\u0412\u044B \u043D\u0430\u0448\u043B\u0438 20 \u043C\u0435\u0442\u0440\u043E\u0432 \u0432\u0435\u0440\u0435\u0432\u043A\u0438"
    },
    {
      "id": 43,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211643",
      "description": "\u0412\u044B \u043D\u0430\u0448\u043B\u0438 \u0443\u0432\u0435\u043B\u0438\u0447\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0435 \u0441\u0442\u0435\u043A\u043B\u043E. \u041C\u043E\u0436\u0435\u0442\u0435 \u0442\u0435\u043F\u0435\u0440\u044C \u0436\u0435\u0447\u044C \u043C\u0443\u0440\u0430\u0432\u044C\u0435\u0432"
    },
    {
      "id": 44,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211644",
      "description": "\u0423 \u0432\u0430\u0441 \u0435\u0441\u0442\u044C \u0441\u0444\u0435\u0440\u0430 \u0441 \u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0439 \u044D\u043D\u0435\u0440\u0433\u0438\u0435\u0439. \u041C\u043E\u0436\u0435\u0442 \u043F\u0438\u0442\u0430\u0442\u044C \u0431\u0443\u043D\u043A\u0435\u0440 \u0438\u043B\u0438 \u0436\u0435 \u0432\u0437\u043E\u0440\u0432\u0430\u0442\u044C \u0435\u0433\u043E \u043A \u0447\u0435\u0440\u0442\u044F\u043C. \u0412 \u0444\u0438\u043D\u0430\u043B\u0435 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u044B\u043C \u043E\u0431\u0440\u0430\u0437\u043E\u043C \u043C\u043E\u0436\u0435\u0442 \u0443\u0441\u0442\u0440\u0430\u043D\u0438\u0442\u044C \u0443\u0433\u0440\u043E\u0437\u0443 \u0438 \u043A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u0443 \u0437\u0430\u043E\u0434\u043D\u043E, \u043B\u0438\u0431\u043E \u0436\u0435 \u0443\u043D\u0438\u0447\u0442\u043E\u0436\u0438\u0442\u044C \u0432\u0441\u0435\u0445 \u0432 \u043E\u043A\u0440\u0435\u0441\u0442\u043D\u043E\u0441\u0442\u0438 - \u0438 \u0438\u0437\u0433\u043D\u0430\u043D\u043D\u044B\u0445, \u0438 \u043D\u0435 \u0438\u0437\u0433\u043D\u0430\u043D\u043D\u044B\u0445. \u0428\u0430\u043D\u0441 50 \u043D\u0430 50"
    },
    {
      "id": 45,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211645",
      "description": "\u0423 \u0432\u0430\u0441 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0435\u0441\u0442\u044C \u043F\u0440\u043E\u0444\u0435\u0441\u0441\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0442\u0443\u0434\u0438\u044F \u0437\u0432\u0443\u043A\u043E\u0437\u0430\u043F\u0438\u0441\u0438."
    },
    {
      "id": 46,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211646",
      "description": "\u0423 \u0432\u0430\u0441 \u0435\u0441\u0442\u044C \u043F\u043E\u043B\u0435\u0432\u043E\u0439 \u043D\u0430\u0431\u043E\u0440 \u0445\u0438\u0440\u0443\u0440\u0433\u0430"
    },
    {
      "id": 47,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211647",
      "description": "\u0423 \u0432\u0430\u0441 \u0435\u0441\u0442\u044C \u043A\u0430\u0440\u0442\u0430 \u043C\u0435\u0441\u0442\u043D\u043E\u0441\u0442\u0438 \u0441 \u043F\u043E\u0434\u0437\u0435\u043C\u043D\u044B\u043C\u0438 \u0445\u043E\u0434\u0430\u043C\u0438"
    },
    {
      "id": 48,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211648",
      "description": "\u0423 \u0432\u0430\u0441 \u0435\u0441\u0442\u044C \u0440\u0430\u0446\u0438\u044F \u0434\u0430\u043B\u044C\u043D\u0435\u0433\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F - \u043C\u043E\u0436\u0435\u0442 \u043B\u043E\u0432\u0438\u0442\u044C \u0432\u044B\u0436\u0438\u0432\u0448\u0438\u0445"
    },
    {
      "id": 49,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211649",
      "description": '\u0423 \u0432\u0430\u0441 \u0435\u0441\u0442\u044C \u043A\u043D\u0438\u0433\u0430 "100 \u0441\u043F\u043E\u0441\u043E\u0431\u043E\u0432 \u043A\u0430\u043A \u043F\u0440\u0435\u0432\u0440\u0430\u0442\u0438\u0442\u044C \u043A\u0440\u044B\u0441 \u0432 \u0432\u043A\u0443\u0441\u043D\u0443\u044E \u0435\u0434\u0443"'
    },
    {
      "id": 50,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211650",
      "description": "\u0423 \u0432\u0430\u0441 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0435\u0441\u0442\u044C \u0448\u0430\u0445\u0435\u0434"
    },
    {
      "id": 51,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211651",
      "description": "\u0412\u044B \u0440\u0430\u0437\u0431\u0443\u0434\u0438\u043B\u0438 \u0441\u043B\u0435\u043F\u043E\u0433\u043E \u0434\u0435\u0434\u0430 \u0441 \u0434\u0440\u043E\u0431\u043E\u0432\u0438\u043A\u043E\u043C. \u041E\u043D \u0442\u044F\u0436\u0435\u043B\u043E \u0440\u0430\u043D\u0438\u043B \u043E\u0434\u043D\u043E\u0433\u043E \u0438\u0437 \u0432\u0430\u0441 (\u0441\u043B\u0443\u0447\u0430\u0439\u043D\u044B\u043C \u043E\u0431\u0440\u0430\u0437\u043E\u043C \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F \u043E\u0434\u043D\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u043D\u0430 \u043E\u0433\u043D\u0435\u0441\u0442\u0440\u0435\u043B\u044C\u043D\u043E\u0435 \u0440\u0430\u043D\u0435\u043D\u0438\u0435), \u043D\u043E \u043F\u043E\u0442\u043E\u043C \u0443\u043F\u0430\u043B \u0441 \u043B\u0435\u0441\u0442\u043D\u0438\u0446\u044B \u0438 \u0441\u0432\u0435\u0440\u043D\u0443\u043B \u0441\u0435\u0431\u0435 \u0448\u0435\u044E. \u0422\u0435\u043F\u0435\u0440\u044C \u0443 \u0432\u0430\u0441 \u0435\u0441\u0442\u044C \u0434\u0440\u043E\u0431\u043E\u0432\u0438\u043A!"
    },
    {
      "id": 52,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211652",
      "description": '\u0412\u044B \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0435 \u043E\u0447\u0435\u043D\u044C \u0434\u043E\u0440\u043E\u0433\u0443\u044E \u043A\u0430\u0440\u0442\u0438\u043D\u0443 \u0441 \u0434\u0432\u0443\u043C\u044F \u0444\u0443\u0440\u0440\u0438 \u0432 \u043D\u0435\u043F\u0440\u0438\u043B\u0438\u0447\u043D\u044B\u0445 \u043F\u043E\u0437\u0430\u0445. \u0421\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u043E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F \u043D\u0430 "\u0417\u043E\u043E\u0444\u0438\u043B\u0438\u044F"'
    },
    {
      "id": 53,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211653",
      "description": "\u0412 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u043D\u0430\u0448\u0451\u043B\u0441\u044F \u043F\u043E\u0442\u0430\u0439\u043D\u043E\u0439 \u0430\u043B\u0442\u0430\u0440\u044C \u0441\u0430\u0442\u0430\u043D\u0438\u043D\u0441\u043A\u043E\u0433\u043E \u043A\u0443\u043B\u044C\u0442\u0430. \u0412\u044B \u0441\u043B\u044B\u0448\u0438\u0442\u0435 \u0433\u043E\u043B\u043E\u0441 \u0434\u044C\u044F\u0432\u043E\u043B\u0430. \u041E\u043D \u043F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u0435\u0442 \u0432\u0430\u043C \u043F\u0440\u0438\u043D\u0435\u0441\u0442\u0438 \u0432 \u0436\u0435\u0440\u0442\u0432\u0443 \u043E\u0434\u043D\u043E\u0433\u043E \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u0430 (\u0432\u044B\u0431\u0438\u0440\u0430\u0435\u0442\u0435 \u043F\u043E\u0441\u0440\u0435\u0434\u0441\u0442\u0432\u043E\u043C \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F) \u0432 \u043E\u0431\u043C\u0435\u043D \u043D\u0430 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0431\u0443\u043D\u043A\u0435\u0440\u0430."
    },
    {
      "id": 54,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211654",
      "description": "\u0414\u0436\u0430\u043A\u0443\u0437\u0438 \u0441 \u043F\u043E\u0434\u043E\u0433\u0440\u0435\u0432\u043E\u043C \u0432\u043E\u0434\u044B, \u0433\u0438\u0434\u0440\u043E\u043C\u0430\u0441\u0441\u0430\u0436\u0435\u043C \u0438 \u043F\u0440\u0438\u0433\u043B\u0443\u0448\u0435\u043D\u043D\u044B\u043C \u043E\u0441\u0432\u0435\u0449\u0435\u043D\u0438\u0435\u043C. \u0418\u0434\u0435\u0430\u043B\u044C\u043D\u043E, \u0447\u0442\u043E\u0431\u044B \u0440\u0430\u0441\u0441\u043B\u0430\u0431\u0438\u0442\u044C\u0441\u044F \u0432 \u043A\u043E\u043D\u0446\u0435 \u0434\u043D\u044F"
    },
    {
      "id": 55,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211655",
      "description": "\u041F\u043E\u0434\u0437\u0435\u043C\u043D\u044B\u0439 \u0433\u0430\u0440\u0430\u0436 \u0441 \u0430\u0432\u0442\u043E\u043C\u043E\u0431\u0438\u043B\u0435\u043C \u0441\u043A\u043E\u0440\u043E\u0439 \u043F\u043E\u043C\u043E\u0449\u0438 \u0441 \u0440\u0435\u0430\u043D\u0438\u043C\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u043C \u043E\u0431\u043E\u0440\u0443\u0434\u043E\u0432\u0430\u043D\u0438\u0435\u043C"
    },
    {
      "id": 56,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211656",
      "description": "\u0410\u0440\u0445\u0438\u0432 \u0441\u043F\u0435\u0446\u0441\u043B\u0443\u0436\u0431. \u041A\u043E\u043C\u043F\u0440\u043E\u043C\u0430\u0442 \u0438 \u043A\u043E\u0434\u044B \u0434\u043E\u0441\u0442\u0443\u043F\u0430 \u043A \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0430\u043C \u0432\u0441\u0435\u0433\u043E \u043D\u0430\u0441\u0435\u043B\u0435\u043D\u0438\u044F"
    },
    {
      "id": 57,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211657",
      "description": "\u041E\u0431\u044A\u0435\u043C\u043D\u044B\u0439 \u043C\u0430\u043A\u0435\u0442 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0438 \u043E\u043A\u0440\u0435\u0441\u0442\u043D\u043E\u0441\u0442\u0435\u0439, \u043D\u0430 \u043A\u043E\u0442\u043E\u0440\u043E\u043C \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u044B \u0438 \u0432\u0441\u0435 \u043F\u043E\u0434\u0437\u0435\u043C\u043D\u044B\u0435 \u043A\u043E\u043C\u043C\u0443\u043D\u0438\u043A\u0430\u0446\u0438\u0438"
    },
    {
      "id": 58,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211658",
      "description": "\u0412\u044B\u0445\u043E\u0434 \u0432 \u0441\u0435\u043A\u0440\u0435\u0442\u043D\u0443\u044E \u0432\u0435\u0442\u043A\u0443 \u043C\u0435\u0442\u0440\u043E"
    },
    {
      "id": 59,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211659",
      "description": "\u041B\u0430\u043C\u043F\u0430 \u0434\u0436\u0438\u043D\u043D\u0430. \u0412 \u0444\u0438\u043D\u0430\u043B\u0435 \u0438\u0433\u0440\u044B \u043F\u043E\u0437\u0432\u043E\u043B\u044F\u0435\u0442 \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u0442\u044C \u043E\u0434\u043D\u0443 \u0443\u0433\u0440\u043E\u0437\u0443, \u043D\u043E \u0432\u043C\u0435\u0441\u0442\u043E \u043D\u0435\u0435 \u0441\u0440\u0430\u0437\u0443 \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043D\u043E\u0432\u0430\u044F"
    },
    {
      "id": 60,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211660",
      "description": "\u041A\u043E\u043C\u043D\u0430\u0442\u0430 \u043E\u0445\u0440\u0430\u043D\u044B \u0441 \u044D\u043A\u0440\u0430\u043D\u0430\u043C\u0438, \u0442\u0440\u0430\u043D\u0441\u043B\u0438\u0440\u0443\u044E\u0449\u0438\u043C\u0438 \u0432\u0438\u0434 \u0441 \u043A\u0430\u043C\u0435\u0440 \u0432\u0441\u0435\u0445 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u043E\u0432 \u0432 \u0440\u0430\u0434\u0438\u0443\u0441\u0435 \u043A\u0438\u043B\u043E\u043C\u0435\u0442\u0440\u0430 \u0432\u043E\u043A\u0440\u0443\u0433 \u0431\u0443\u043D\u043A\u0435\u0440\u0430"
    },
    {
      "id": 61,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211661",
      "description": "\u041E\u0441\u043D\u0430\u0449\u0435\u043D\u043D\u044B\u0439 \u043C\u043E\u0440\u0433 \u0441 \u043C\u043E\u0449\u043D\u044B\u043C\u0438 \u0445\u043E\u043B\u043E\u0434\u0438\u043B\u044C\u043D\u0438\u043A\u0430\u043C\u0438, \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u0430\u043C\u0438 \u0434\u043B\u044F \u0432\u0441\u043A\u0440\u044B\u0442\u0438\u044F \u0438 \u043F\u0435\u0447\u043A\u043E\u0439 \u043A\u0440\u0435\u043C\u0430\u0442\u043E\u0440\u0438\u044F."
    },
    {
      "id": 62,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211662",
      "description": "\u041E\u0442\u043A\u0440\u044B\u0432 \u044D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443, \u043F\u0440\u043E\u0432\u0435\u0434\u0438\u0442\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u0438 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0446\u0430\u0440\u044F. \u0426\u0430\u0440\u044C \u043F\u043E\u043F\u0430\u0434\u0430\u0435\u0442 \u0431\u0443\u043D\u043A\u0435\u0440 (\u0434\u0430\u0436\u0435 \u0435\u0441\u043B\u0438 \u0431\u044B\u043B \u0438\u0437\u0433\u043D\u0430\u043D\u043D\u044B\u043C), \u0438 \u0438\u0437\u0433\u043D\u0430\u0442\u044C \u0435\u0433\u043E \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435\u043B\u044C\u0437\u044F"
    },
    {
      "id": 63,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211663",
      "description": '\u041A\u043D\u0438\u0433\u0430 "\u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0434\u043B\u044F \u0447\u0430\u0439\u043D\u0438\u043A\u043E\u0432" \u0438\u0437\u0434\u0430\u043D\u0438\u0435 1991 \u0433\u043E\u0434\u0430'
    },
    {
      "id": 64,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211664",
      "description": "\u0422\u0430\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u0430\u044F \u043A\u043E\u043C\u043D\u0430\u0442\u0430 \u0434\u043B\u044F \u043F\u0440\u0435\u0434\u0441\u043A\u0430\u0437\u0430\u043D\u0438\u0439 \u0438 \u0434\u043E\u0441\u043A\u043E\u0439 \u0423\u0438\u0434\u0436\u0438 \u0434\u043B\u044F \u0432\u044B\u0437\u043E\u0432\u0430 \u0434\u0443\u0445\u043E\u0432"
    },
    {
      "id": 65,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211665",
      "description": "\u0412\u0438\u043D\u043D\u044B\u0439 \u043F\u043E\u0433\u0440\u0435\u0431 \u0441 \u043A\u043E\u043B\u043B\u0435\u043A\u0446\u0438\u0435\u0439 \u043B\u0443\u0447\u0448\u0438\u0445 \u0432\u0438\u043D \u0432\u0441\u0435\u0433\u043E \u043C\u0438\u0440\u0430"
    },
    {
      "id": 66,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211666",
      "description": "\u041F\u0440\u043E\u0441\u0442\u043E\u0440\u043D\u043E\u0435 \u043F\u043E\u043C\u0435\u0449\u0435\u043D\u0438\u0435 \u0441 \u0442\u0440\u0435\u043D\u0430\u0436\u0435\u0440\u0430\u043C\u0438 \u0438 \u0441\u043A\u0432\u043E\u0448-\u043A\u043E\u0440\u0442\u043E\u043C. \u0410 \u0442\u0430\u043A\u0436\u0435 \u0441\u043F\u043E\u0440\u0442\u0438\u0432\u043D\u044B\u0439 \u0432\u0438\u0430\u0440 \u0442\u0440\u0435\u043D\u0430\u0436\u0435\u0440 \u0441 \u0431\u0438\u0431\u043B\u0438\u043E\u0442\u0435\u043A\u043E\u0439 \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043E\u043A \u043F\u043E \u044D\u043A\u0441\u0442\u0440\u0435\u043C\u0430\u043B\u044C\u043D\u044B\u043C \u0432\u0438\u0434\u0430\u043C \u0441\u043F\u043E\u0440\u0442\u0430"
    },
    {
      "id": 67,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211667",
      "description": "\u0420\u043E\u0431\u043E\u0442-\u044D\u043B\u0435\u043A\u0442\u0440\u0438\u043A, \u043F\u043E\u0445\u043E\u0436\u0438\u0439 \u043D\u0430 \u0441\u0442\u0430\u0440\u044B\u0439 \u0441\u043E\u0432\u0435\u0442\u0441\u043A\u0438\u0439 \u043F\u044B\u043B\u0435\u0441\u043E\u0441. \u041F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E \u043F\u0443\u0442\u0430\u0435\u0442\u0441\u044F \u043F\u043E\u0434 \u043D\u043E\u0433\u0430\u043C\u0438, \u0447\u0442\u043E-\u0442\u043E \u0447\u0438\u043D\u0438\u0442 \u0438 \u043C\u0430\u0442\u0435\u0440\u0438\u0442\u0441\u044F."
    },
    {
      "id": 68,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211668",
      "description": "\u041E\u0440\u0430\u043D\u0436\u0435\u0440\u0435\u044F \u043A\u043E\u043B\u043B\u0435\u043A\u0446\u0438\u044F \u044D\u043A\u0437\u043E\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u0440\u0430\u0441\u0442\u0435\u043D\u0438\u0439, \u0432 \u0442\u043E\u043C \u0447\u0438\u0441\u043B\u0435 \u0438 \u0445\u0438\u0449\u043D\u044B\u0445"
    },
    {
      "id": 69,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211669",
      "description": "\u0412\u043F\u0435\u0447\u0430\u0442\u043B\u044F\u044E\u0449\u0438\u0439 \u0430\u0440\u0441\u0435\u043D\u0430\u043B \u0441\u043E\u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E\u0433\u043E \u043E\u0440\u0443\u0436\u0438\u044F \u0438\u0437 \u0444\u0438\u043B\u044C\u043C\u043E\u0432 \u043F\u0440\u043E \u0441\u0443\u043F\u0435\u0440\u0430\u0433\u0435\u043D\u0442\u043E\u0432 \u0442\u0435\u043F\u0435\u0440\u044C \u0432 \u0432\u0430\u0448\u0435\u043C \u0440\u0430\u0441\u043F\u043E\u0440\u044F\u0436\u0435\u043D\u0438\u0438"
    },
    {
      "id": 70,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211670",
      "description": "\u041C\u0443\u0437\u0435\u0439 \u0421\u0421\u0421\u0420, \u0432 \u043A\u043E\u0442\u043E\u0440\u043E\u043C \u0435\u0441\u0442\u044C \u0440\u0430\u0431\u043E\u0442\u0430\u044E\u0449\u0438\u0439 \u044F\u0434\u0435\u0440\u043D\u044B\u0439 \u0440\u0435\u0430\u043A\u0442\u043E\u0440, \u043C\u043E\u0434\u0435\u043B\u044C \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u0441\u043F\u0443\u0442\u043D\u0438\u043A\u0430 \u0417\u0435\u043C\u043B\u0438, \u0431\u0430\u043B\u0430\u043B\u0430\u0439\u043A\u0430 \u0438 \u0437\u0430\u043F\u0430\u0441 \u0432\u043E\u0434\u043A\u0438"
    },
    {
      "id": 71,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211671",
      "description": "\u0412\u0441\u0435 \u0434\u043B\u044F \u043A\u043E\u043C\u0444\u043E\u0440\u0442\u043D\u043E\u0439 \u0438 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0439 \u0436\u0438\u0437\u043D\u0438 - \u043A\u0443\u0445\u043E\u043D\u043D\u044B\u0435 \u043D\u043E\u0436\u0438, \u043E\u0433\u043D\u0435\u0442\u0443\u0448\u0438\u0442\u0435\u043B\u0438, \u043F\u043E\u0436\u0430\u0440\u043D\u044B\u0439 \u0442\u043E\u043F\u043E\u0440, \u0431\u0435\u043D\u0437\u043E\u043F\u0438\u043B\u0430. \u042D\u0442\u0438\u043C \u043C\u043E\u0436\u043D\u043E \u0438 \u043E\u0442 \u0447\u0443\u0436\u0430\u043A\u043E\u0432 \u0437\u0430\u0449\u0438\u0449\u0430\u0442\u044C\u0441\u044F"
    },
    {
      "id": 72,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211672",
      "description": "\u0412 \u043A\u0430\u0436\u0434\u043E\u043C \u043F\u043E\u043C\u0435\u0449\u0435\u043D\u0438\u0438 \u0435\u0441\u0442\u044C \u0441\u0442\u0440\u0430\u043D\u043D\u044B\u0435 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0434\u0432\u0435\u0440\u0438, \u0431\u0443\u0434\u0442\u043E \u0437\u0430\u043F\u0435\u0440\u0442\u044B\u0435 \u0441 \u0434\u0440\u0443\u0433\u043E\u0439 \u0441\u0442\u043E\u0440\u043E\u043D\u044B. \u041D\u0435\u043F\u043E\u043D\u044F\u0442\u043D\u043E, \u043A\u0443\u0434\u0430 \u043E\u043D\u0438 \u0432\u0435\u0434\u0443\u0442"
    },
    {
      "id": 73,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211673",
      "description": "\u041E\u0433\u0440\u043E\u043C\u043D\u044B\u0439 \u0431\u0430\u0441\u0441\u0435\u0439\u043D \u0441 \u0447\u0438\u0441\u0442\u043E\u0439 \u0432\u043E\u0434\u043E\u0439 \u0438 \u0441\u043D\u0430\u0440\u044F\u0436\u0435\u043D\u0438\u0435\u043C \u0434\u043B\u044F \u0434\u0430\u0439\u0432\u0438\u043D\u0433\u0430"
    },
    {
      "id": 74,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211674",
      "description": "\u0418\u043D\u043D\u043E\u0432\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u0439 \u043C\u043E\u043B\u0435\u043A\u0443\u043B\u044F\u0440\u043D\u044B\u0439 3\u0434\u043F\u0440\u0438\u043D\u0442\u0435\u0440, \u0441\u043E\u0437\u0434\u0430\u044E\u0449\u0438\u0439 \u0442\u0432\u0435\u0440\u0434\u044B\u0435 \u043C\u043E\u0434\u0435\u043B\u0438 \u0438\u0437 \u0432\u043E\u0434\u044B"
    },
    {
      "id": 75,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211675",
      "description": "\u041A\u043E\u043C\u043D\u0430\u0442\u0430, \u043F\u043E\u043B\u043D\u0430\u044F \u0441\u0442\u0440\u0430\u043D\u043D\u044B\u0445 \u0438 \u0437\u0430\u0433\u0430\u0434\u043E\u0447\u043D\u044B\u0445 \u043F\u0440\u0435\u0434\u043C\u0435\u0442\u043E\u0432 \u0438\u0437 \u0440\u0430\u0437\u043D\u044B\u0445 \u0443\u0433\u043E\u043B\u043A\u043E\u0432 \u043C\u0438\u0440\u0430. \u042D\u0442\u0438 \u0430\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u044B \u043C\u043E\u0433\u0443\u0442 \u0438\u043C\u0435\u0442\u044C \u043D\u0435\u043E\u0431\u044B\u0447\u043D\u044B\u0435 \u0441\u0432\u043E\u0439\u0441\u0442\u0432\u0430. \u0421 \u0432\u0435\u0440\u043E\u044F\u0442\u043D\u043E\u0441\u0442\u044C\u044E 40% \u043F\u043E\u043C\u043E\u0433\u0443\u0442 \u0432\u0430\u043C \u0438\u0437\u0431\u0430\u0432\u0438\u0442\u044C\u0441\u044F \u043E\u0442 \u043E\u0434\u043D\u043E\u0439 \u0443\u0433\u0440\u043E\u0437\u044B \u0438 \u0441 \u0432\u0435\u0440\u043E\u044F\u0442\u043D\u043E\u0441\u0442\u044C\u044E \u0432 20% \u0432\u043C\u0435\u0441\u0442\u043E \u044D\u0442\u043E\u0433\u043E \u0443\u0431\u044C\u044E\u0442 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430"
    },
    {
      "id": 76,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211676",
      "description": "\u041E\u043F\u0435\u0447\u0430\u0442\u0430\u043D\u043D\u044F \u0431\u0438\u043E\u043B\u0430\u0431\u043E\u0440\u0430\u0442\u043E\u0440\u0438\u044F, \u0433\u0434\u0435 \u043F\u0440\u043E\u0432\u043E\u0434\u0438\u043B\u0438\u0441\u044C \u044D\u043A\u0441\u043F\u0435\u0440\u0438\u043C\u0435\u043D\u0442\u044B \u043F\u043E \u0433\u0435\u043D\u0435\u0442\u0438\u043A\u0435 \u0438 \u0431\u0438\u043E\u0438\u043D\u0436\u0435\u043D\u0435\u0440\u0438\u0438"
    },
    {
      "id": 77,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211677",
      "description": "\u041A\u043B\u0430\u0434\u043E\u0432\u0430\u044F \u0441 \u0441\u0430\u0434\u043E\u0432\u044B\u043C\u0438 \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u0430\u043C\u0438 \u0438 \u043D\u0430\u0431\u043E\u0440\u043E\u043C \u0441\u0430\u0436\u0435\u043D\u0446\u0435\u0432"
    },
    {
      "id": 78,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211678",
      "description": "\u0421\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A \u043F\u043E \u043C\u0435\u0441\u0442\u043D\u044B\u043C \u0433\u0440\u0438\u0431\u0430\u043C, \u0433\u0434\u0435 \u0440\u0430\u0441\u0441\u043A\u0430\u0437\u0430\u043D\u043E, \u0447\u0442\u043E \u0433\u0434\u0435 \u0438\u0441\u043A\u0430\u0442\u044C, \u0438 \u0447\u0442\u043E \u043C\u043E\u0436\u043D\u043E \u0435\u0441\u0442\u044C"
    },
    {
      "id": 79,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211679",
      "description": "\u041A\u043E\u043C\u043D\u0430\u0442\u0430 \u0441 \u043D\u0430\u0434\u0435\u0436\u043D\u043E \u0437\u0430\u043F\u0435\u0440\u0442\u044B\u043C \u0432 \u043D\u0435\u0439 \u0430\u043D\u0442\u0440\u043E\u043F\u043E\u043C\u043E\u0440\u0444\u043D\u044B\u043C \u0440\u043E\u0431\u043E\u0442\u043E\u043C \u0441 \u0432\u044B\u0434\u0430\u044E\u0449\u0438\u043C\u0441\u044F \u0438\u0441\u043A\u0443\u0441\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u043C \u0438\u043D\u0442\u0435\u043B\u043B\u0435\u043A\u0442\u043E\u043C"
    },
    {
      "id": 80,
      "title": "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211680",
      "description": "\u041E\u0431\u043E\u0440\u0443\u0434\u043E\u0432\u0430\u043D\u0438\u0435 \u0434\u043B\u044F \u043A\u0430\u0447\u0435\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u0439 \u043E\u0447\u0438\u0441\u0442\u043A\u0438 \u0438 \u0444\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u0438 \u0432\u043E\u0434\u044B. \u0421 \u043D\u0435\u043A\u043E\u0442\u043E\u0440\u044B\u043C\u0438 \u0438\u043D\u0436\u0435\u043D\u0435\u0440\u043D\u044B\u043C\u0438 \u0434\u043E\u0440\u0430\u0431\u043E\u0442\u043A\u0430\u043C\u0438 \u043C\u043E\u0436\u043D\u043E \u0433\u043D\u0430\u0442\u044C \u0441\u0430\u043C\u043E\u0433\u043E\u043D"
    }
  ];
  var THREATS = [
    {
      "id": 1,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u21161",
      "description": "\u0418\u0418 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0431\u0443\u043D\u043A\u0435\u0440\u043E\u043C \u0437\u0430\u0433\u043B\u044E\u0447\u0438\u043B\u043E \u0438 \u0431\u043B\u043E\u043A\u0438\u0440\u0443\u0435\u0442 \u0436\u0438\u0437\u043D\u0435\u043E\u0431\u0435\u0441\u043F\u0435\u0447\u0435\u043D\u0438\u0435 - \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u0434\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0431\u0435\u0437\u0434\u0443\u0448\u043D\u043E\u043C\u0443 \u043A\u043E\u043C\u043F\u0443  \u0447\u0442\u043E \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0432\u043E\u043E\u0431\u0449\u0435\u0442\u043E \u0435\u0441\u0442\u044C \u043B\u044E\u0434\u0438. \u0422\u0435\u0441\u0442 \u043F\u043E\u0441\u0442\u0440\u043E\u0435\u043D \u043D\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0435 \u043E\u0442\u043B\u0438\u0447\u0438\u044F \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u0430 \u043E\u0442 \u0440\u043E\u0431\u043E\u0442\u0430 - \u0441\u043F\u043E\u0441\u043E\u0431\u043D\u043E\u0441\u0442\u0438 \u043A \u0442\u0432\u043E\u0440\u0447\u0435\u0441\u0442\u0432\u0443. \u0412\u044B \u043F\u0440\u043E\u0439\u0434\u0435\u0442\u0435 \u044D\u0442\u043E\u0442 \u0442\u0435\u0441\u0442"
    },
    {
      "id": 2,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u21162",
      "description": "\u041D\u0435\u0431\u043E\u043B\u044C\u0448\u043E\u0435 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0437\u0435\u043C\u043B\u0435\u0442\u0440\u044F\u0441\u0435\u043D\u0438\u0435 \u0433\u0440\u043E\u0437\u0438\u0442 \u043F\u043E\u0432\u0440\u0435\u0434\u0438\u0442\u044C \u0441\u0438\u0441\u0442\u0435\u043C\u044B \u0436\u0438\u0437\u043D\u0435\u043E\u0431\u0435\u0441\u043F\u0435\u0447\u0435\u043D\u0438\u044F \u0432 \u0432\u0430\u0448\u0435\u043C \u0431\u0443\u043D\u043A\u0435\u0440\u0435. \u041D\u0443\u0436\u043D\u043E \u043F\u0440\u043E\u0432\u0435\u0441\u0442\u0438 \u0440\u0430\u0431\u043E\u0442\u044B \u043F\u043E \u0443\u043A\u0440\u0435\u043F\u043B\u0435\u043D\u0438\u044E \u0441\u043B\u0430\u0431\u044B\u0445 \u043C\u0435\u0441\u0442 - \u0434\u0432\u0435\u0440\u0435\u0439 \u0438 \u0432\u0435\u043D\u0442\u0438\u043B\u044F\u0446\u0438\u0438. \u0418\u043B\u0438 \u0436\u0435 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0437\u0435\u043C\u043B\u0435\u0442\u0440\u044F\u0441\u0435\u043D\u0438\u0435 \u043C\u0430\u0433\u0438\u0435\u0439"
    },
    {
      "id": 3,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u21163",
      "description": "\u0412\u0441\u043F\u044B\u0445\u043D\u0443\u043B \u0441\u043C\u0435\u0440\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0432\u0438\u0440\u0443\u0441, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0440\u0430\u0437\u0432\u0438\u0432\u0430\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u043D\u0430 \u0444\u043E\u043D\u0435 \u0441\u0442\u0440\u0435\u0441\u0441\u0430. \u0411\u0443\u0434\u0443\u0442 \u043F\u043E\u043B\u0435\u0437\u043D\u044B \u043B\u044E\u0431\u044B\u0435 \u043C\u0435\u0434\u0438\u0446\u0438\u0441\u043A\u0438\u0435 \u043D\u0430\u0432\u044B\u043A\u0438/\u0441\u043D\u0430\u0440\u044F\u0436\u0435\u043D\u0438\u0435, \u0430 \u0435\u0449\u0435 \u0441\u043F\u043E\u0441\u043E\u0431\u044B \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u0442\u0440\u0435\u0441\u0441"
    },
    {
      "id": 4,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u21164",
      "description": "\u041E\u0431\u0432\u0430\u043B \u0432 \u043A\u0443\u0445\u043E\u043D\u043D\u043E\u043C \u0438 \u0441\u043A\u043B\u0430\u0434\u0441\u043A\u043E\u043C \u0431\u043B\u043E\u043A\u0435. \u0415\u0434\u044B \u0443 \u0432\u0430\u0441 \u0442\u0435\u043F\u0435\u0440\u044C \u0433\u043E\u0440\u0430\u0437\u0434\u043E \u043C\u0435\u043D\u044C\u0448\u0435. \u0412\u0430\u043C \u043F\u043E\u043C\u043E\u0433\u0443\u0442 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u0436\u0438 \u0441\u043E \u0437\u043D\u0430\u043D\u0438\u0435\u043C \u043C\u0435\u0441\u0442\u043D\u043E\u0441\u0442\u0438 \u0434\u043B\u044F \u0432\u044B\u043B\u0430\u0437\u043E\u043A \u0438 \u043F\u043E\u0438\u0441\u043A\u0430 \u043F\u0440\u043E\u0434\u043E\u0432\u043E\u043B\u044C\u0441\u0442\u0432\u0438\u044F \u0438\u043B\u0438 \u0436\u0435 \u0441\u043F\u043E\u0441\u043E\u0431\u043D\u044B\u0435 \u0434\u043E\u0431\u044B\u0432\u0430\u0442\u044C \u0435\u0434\u0443 \u0432 \u043F\u043E\u0434\u0432\u0430\u043B\u0430\u0445 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 - \u0443\u0441\u0442\u0440\u043E\u0438\u0432 \u0444\u0435\u0440\u043C\u0443 \u0438\u043B\u0438 \u043E\u0445\u043E\u0442\u0443 \u043D\u0430 \u043A\u0440\u044B\u0441"
    },
    {
      "id": 5,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u21165",
      "description": "\u0414\u0438\u043A\u0438\u0435 \u043B\u044E\u0434\u0438 \u043B\u043E\u043C\u044F\u0442\u0441\u044F \u0432 \u0431\u0443\u043D\u043A\u0435\u0440 \u2014 \u043D\u0443\u0436\u043D\u043E \u0441\u0440\u043E\u0447\u043D\u043E \u0447\u0442\u043E-\u0442\u043E \u0434\u0435\u043B\u0430\u0442\u044C. \u041F\u043E\u043C\u043E\u0433\u0443\u0442 \u0432\u043E\u0435\u043D\u043D\u044B\u0435 \u043D\u0430\u0432\u044B\u043A\u0438, \u043E\u0445\u043E\u0442\u0430, \u0441\u0438\u0433\u043D\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044F, \u043D\u0430\u0431\u043B\u044E\u0434\u0435\u043D\u0438\u0435, \u043E\u0440\u0443\u0436\u0438\u0435 \u0438 \u044D\u043B\u0435\u043A\u0442\u0440\u043E\u043D\u0438\u043A\u0430."
    },
    {
      "id": 6,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u21166",
      "description": "\u0421\u0438\u0441\u0442\u0435\u043C\u0430 \u043E\u0447\u0438\u0441\u0442\u043A\u0430 \u0432\u043E\u0434\u044B \u0434\u0430\u043B\u0430 \u0441\u0431\u043E\u0439 \u0438 \u0443 \u0432\u0430\u0441 \u0432\u043E\u0434\u0430 \u043E\u0442\u0440\u0430\u0432\u043B\u0435\u043D\u0430. \u041F\u043E\u043C\u043E\u0436\u0435\u0442 \u0445\u0438\u043C\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0444\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F \u0438\u043B\u0438 \u0436\u0435 \u0434\u043E\u0431\u044B\u0447\u0430 \u0432\u043E\u0434\u044B \u043D\u0430 \u0432\u044B\u043B\u0430\u0437\u043A\u0430\u0445 \u0432 \u043E\u043A\u0440\u0435\u0441\u0442\u0440\u043E\u0441\u0442\u044F\u0445. \u0418\u043D\u0430\u0447\u0435 \u043F\u0440\u0438\u0434\u0435\u0442\u0441\u044F \u043B\u0435\u0447\u0438\u0442\u044C \u043F\u043E\u0441\u0442\u0440\u0430\u0434\u0430\u0432\u0448\u0438\u0445"
    },
    {
      "id": 7,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u21167",
      "description": "\u041F\u0430\u0440\u0430\u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u044B\u0435 \u044F\u0432\u043B\u0435\u043D\u0438\u044F \u043C\u043E\u0433\u0443\u0442 \u043D\u0430\u0440\u0443\u0448\u0438\u0442\u044C \u0441\u0438\u0441\u0442\u0435\u043C\u0443 \u043E\u0431\u0435\u0441\u043F\u0435\u0447\u0435\u043D\u0438\u044F \u0431\u0443\u043D\u043A\u0435\u0440\u0430. \u0412\u0430\u043C \u043F\u043E\u043C\u043E\u0433\u0443\u0442 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u0436\u0438 \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0441\u043F\u043E\u0441\u043E\u0431\u043D\u044B \u0443\u0431\u0435\u0434\u0438\u0442\u044C \u043F\u0440\u0438\u0437\u043D\u0430\u043A\u043E\u0432 \u043F\u043E\u043A\u0438\u043D\u0443\u0442\u044C \u0431\u0443\u043D\u043A\u0435\u0440, \u0438\u043B\u0438 \u0436\u0435 \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u043C\u043E\u0433\u0443\u0442 \u0438\u0445 \u0438\u0437\u0433\u043D\u0430\u0442\u044C"
    },
    {
      "id": 8,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u21168",
      "description": "\u0412 \u0431\u0443\u043D\u043A\u0435\u0440 \u043F\u0440\u043E\u043D\u0438\u043A\u0430\u0435\u0442 \u0432\u043E\u0434\u0430, \u0438 \u0432\u044B \u0432 \u0438\u0442\u043E\u0433\u0435 \u0443\u0442\u043E\u043F\u0438\u0442\u0435\u0441\u044C, \u0435\u0441\u043B\u0438 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u0441\u0434\u0435\u043B\u0430\u0442\u044C. \u041D\u0443\u0436\u043D\u043E \u043F\u0435\u0440\u0435\u043D\u0430\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u043A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440\u043D\u0443\u044E \u0441\u0438\u0441\u0442\u0435\u043C\u0443 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0438\u043B\u0438 \u043F\u0440\u0438\u0434\u0443\u043C\u0430\u0442\u044C \u043A\u0430\u043A\u043E\u0435\u0442\u043E \u0438\u043D\u0436\u0435\u043D\u0435\u0440\u043D\u043E\u0435 \u0440\u0435\u0448\u0435\u043D\u0438\u044F \u0434\u043B\u044F \u043E\u0442\u043A\u0430\u0447\u043A\u0438 \u0432\u043E\u0434\u044B"
    },
    {
      "id": 9,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u21169",
      "description": "\u041A \u0432\u0430\u043C \u043F\u0440\u0438\u0448\u0435\u043B \u043E\u0433\u0440\u043E\u043C\u043D\u044B\u0439 \u0440\u043E\u0439 \u043A\u0440\u044B\u0441 \u0438 \u0433\u0440\u043E\u0437\u0438\u0442\u0441\u044F \u0432\u0441\u0435 \u0442\u0443\u0442 \u0441\u043E\u0436\u0440\u0430\u0442\u044C. \u0415\u0441\u043B\u0438 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u0436\u0438, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0441\u043F\u043E\u0441\u043E\u0431\u043D\u044B \u0438\u0441\u0442\u0440\u0435\u0431\u043B\u044F\u0442\u044C \u0433\u0440\u044B\u0437\u0443\u043D\u043E\u0432, \u0432\u0430\u043C \u043D\u0435 \u043F\u043E\u043C\u043E\u0433\u0443\u0442, \u0442\u043E \u043F\u0440\u0438\u0434\u0435\u0442\u0441\u044F \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u0438\u0441\u043A\u0430\u0442\u044C \u0435\u0434\u0443"
    },
    {
      "id": 10,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211610",
      "description": "\u041D\u0435\u043A\u043E\u0435 \u0438\u0437\u043B\u0443\u0447\u0435\u043D\u0438\u0435 \u0443\u0441\u0438\u043B\u0438\u0432\u0430\u0435\u0442 \u0441\u0442\u0440\u0435\u0441\u0441 \u0438 \u043D\u0430\u0432\u043E\u0434\u0438\u0442 \u043F\u0430\u043D\u0438\u043A\u0443. \u041D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u044B \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u0436\u0438 \u0438\u043B\u0438 \u0441\u043D\u0430\u0440\u044F\u0436\u0435\u043D\u0438\u0435 \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u043C\u043E\u0433\u0443\u0442 \u0441\u043D\u044F\u0442\u044C \u0441\u0442\u0440\u0435\u0441\u0441, \u0438\u043D\u0430\u0447\u0435 \u0432\u044B \u043F\u0440\u043E\u0441\u0442\u043E \u0434\u0440\u0443\u0433 \u0434\u0440\u0443\u0433\u0430 \u043F\u0435\u0440\u0435\u0431\u044C\u0435\u0442\u0435"
    },
    {
      "id": 11,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211611",
      "description": "\u0423\u0433\u0440\u043E\u0437 \u043D\u0435\u0442, \u0432\u0441\u0435 \u0445\u043E\u0440\u043E\u0448\u043E"
    },
    {
      "id": 12,
      "title": "\u041F\u0435\u0440\u0435\u0434 \u0432\u0430\u043C\u0438 \u043F\u0440\u0435\u0434\u0441\u0442\u0430\u0435\u0442 \u0443\u0433\u0440\u043E\u0437\u0430, \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u043D\u0430\u044F \u0434\u043B\u044F \u0432\u0430\u0448\u0435\u0439 \u043A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u044B",
      "description": "\u0432\u044B\u0434\u0443\u043C\u0430\u0439\u0442\u0435 \u0435\u0435 \u0441\u0430\u043C\u0438"
    },
    {
      "id": 13,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211613",
      "description": "\u0412 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0435\u0441\u0442\u044C \u043A\u0442\u043E-\u0442\u043E, \u043A\u0440\u043E\u043C\u0435 \u0432\u0430\u0441. \u0421\u0443\u0449\u0435\u0441\u0442\u0432\u043E \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0430\u0435\u0442\u0441\u044F \u043F\u043E \u0432\u0435\u043D\u0442\u0438\u043B\u044F\u0446\u0438\u0438 \u0438 \u0441\u043A\u0440\u0435\u0431\u0451\u0442\u0441\u044F \u043F\u043E \u043D\u043E\u0447\u0430\u043C, \u0430 \u0435\u0449\u0451 \u0432\u043E\u0440\u0443\u0435\u0442 \u0435\u0434\u0443. \u0420\u0430\u0437\u0431\u0435\u0440\u0438\u0442\u0435\u0441\u044C \u0441 \u043D\u0438\u043C."
    },
    {
      "id": 14,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211614",
      "description": "\u0411\u0430\u043D\u0434\u0430 \u0432\u043E\u043E\u0440\u0443\u0436\u0451\u043D\u043D\u044B\u0445 \u043C\u0430\u0440\u043E\u0434\u0451\u0440\u043E\u0432 \u043D\u0430\u0431\u0440\u0435\u043B\u0430 \u043D\u0430 \u0432\u0430\u0448 \u0431\u0443\u043D\u043A\u0435\u0440 \u0438 \u0430\u0442\u0430\u043A\u0443\u0435\u0442 \u0435\u0433\u043E. \u0421\u0434\u0435\u043B\u0430\u0439\u0442\u0435 \u0447\u0442\u043E-\u0442\u043E, \u0438\u043D\u0430\u0447\u0435 \u043E\u043D\u0438 \u0432\u0437\u043E\u0440\u0432\u0443\u0442 \u0432\u0445\u043E\u0434 \u0438 \u0443\u0431\u044C\u044E\u0442 \u0432\u0430\u0441."
    },
    {
      "id": 15,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211615",
      "description": "\u0418\u0437-\u0437\u0430 \u043E\u0441\u043E\u0431\u0435\u043D\u043D\u043E\u0441\u0442\u0435\u0439 \u0435\u0434\u044B, \u0437\u0430\u043F\u0430\u0441\u0451\u043D\u043D\u043E\u0439 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u0443 \u0432\u0430\u0441 \u043D\u0430\u0447\u0438\u043D\u0430\u044E\u0442\u0441\u044F \u043D\u0435\u043A\u043E\u043D\u0442\u0440\u043E\u043B\u0438\u0440\u0443\u0435\u043C\u044B\u0435 \u043F\u0440\u0438\u0441\u0442\u0443\u043F\u044B \u043C\u0435\u0442\u0435\u043E\u0440\u0438\u0437\u043C\u0430, \u0438 \u0432\u0435\u043D\u0442\u0438\u043B\u044F\u0446\u0438\u044F \u043D\u0435 \u0443\u0441\u043F\u0435\u0432\u0430\u0435\u0442 \u043E\u0447\u0438\u0449\u0430\u0442\u044C \u0432\u043E\u0437\u0434\u0443\u0445. \u041F\u043E\u043C\u0435\u043D\u044F\u0439\u0442\u0435 \u0440\u0430\u0446\u0438\u043E\u043D \u0438\u043B\u0438 \u043F\u0440\u0438\u0434\u0443\u043C\u0430\u0439\u0442\u0435 \u0447\u0442\u043E-\u0442\u043E \u0435\u0449\u0451, \u0438\u043D\u0430\u0447\u0435 \u0432\u0430\u0441 \u0436\u0434\u0451\u0442 \u043C\u0443\u0447\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F \u0437\u043B\u043E\u0432\u043E\u043D\u043D\u0430\u044F \u0441\u043C\u0435\u0440\u0442\u044C"
    },
    {
      "id": 16,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211616",
      "description": "\u0412 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0437\u0430\u0432\u0435\u043B\u0430\u0441\u044C \u043C\u043E\u043B\u044C, \u043A\u043E\u0442\u043E\u0440\u0430\u044F \u0436\u0440\u0451\u0442 \u0432\u0430\u0448\u0443 \u043E\u0434\u0435\u0436\u0434\u0443. \u0418\u0437\u0431\u0430\u0432\u044C\u0442\u0435\u0441\u044C \u043E\u0442 \u043D\u0435\u0451, \u0435\u0441\u043B\u0438 \u043D\u0435 \u0445\u043E\u0442\u0438\u0442\u0435 \u043E\u0441\u0442\u0430\u0442\u044C\u0441\u044F \u0441 \u0433\u043E\u043B\u043E\u0439 \u0436\u043E\u043F\u043E\u0439 (\u0432 \u043F\u0440\u044F\u043C\u043E\u043C \u0441\u043C\u044B\u0441\u043B\u0435 \u044D\u0442\u043E\u0433\u043E \u0441\u043B\u043E\u0432\u0430)"
    },
    {
      "id": 17,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211617",
      "description": "\u041A\u0430\u0436\u0434\u044B\u0439 \u0447\u0430\u0441 \u043F\u043E \u0440\u0430\u0434\u0438\u043E\u0441\u0432\u044F\u0437\u0438 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0440\u0430\u0437\u0434\u0430\u0451\u0442\u0441\u044F \u0440\u0438\u043D\u0433\u0442\u043E\u043D \u0421\u0430\u043C\u0441\u0443\u043D\u0433 \u043D\u0430 \u043C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u043E\u0439 \u0433\u0440\u043E\u043C\u043A\u043E\u0441\u0442\u0438. \u0412\u044B \u043D\u0435 \u043C\u043E\u0436\u0435\u0442\u0435 \u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u043E \u0441\u043F\u0430\u0442\u044C \u0438 \u043E\u0442\u0434\u044B\u0445\u0430\u0442\u044C."
    },
    {
      "id": 18,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211618",
      "description": "\u0412 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B \u0441 \u044D\u043B\u0435\u043A\u0442\u0440\u0438\u0447\u0435\u0441\u0442\u0432\u043E\u043C. \u041E\u043D\u043E \u043F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E \u043F\u0440\u043E\u043F\u0430\u0434\u0430\u0435\u0442, \u0449\u0438\u0442\u043A\u0438 \u0438\u0441\u043A\u0440\u044F\u0442, \u0430 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D\u043D\u044B\u0435 \u043A \u0441\u0435\u0442\u0438 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430 \u0441\u0433\u043E\u0440\u0430\u044E\u0442. \u041F\u043E\u0447\u0438\u043D\u0438\u0442\u0435 \u043F\u0440\u043E\u0432\u043E\u0434\u043A\u0443!"
    },
    {
      "id": 19,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211619",
      "description": "\u0418\u0437-\u0437\u0430 \u043D\u0435\u0438\u0441\u043F\u0440\u0430\u0432\u043D\u043E\u0441\u0442\u0438 \u0445\u043E\u043B\u043E\u0434\u0438\u043B\u044C\u043D\u0438\u043A\u0430 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0438\u0441\u043F\u043E\u0440\u0442\u0438\u043B\u0430\u0441\u044C \u0447\u0430\u0441\u0442\u044C \u0437\u0430\u043F\u0430\u0441\u043E\u0432 \u0435\u0434\u044B."
    },
    {
      "id": 20,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211620",
      "description": "\u041A\u0430\u043A\u043E\u0439-\u0442\u043E \u0438\u0434\u0438\u043E\u0442 \u0440\u0435\u0448\u0438\u043B \u043F\u043E\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u0431\u0443\u043D\u043A\u0435\u0440 \u0432\u043E\u0437\u043B\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u044E\u0449\u0435\u0433\u043E \u0432\u0443\u043B\u043A\u0430\u043D\u0430, \u0438 \u043E\u043D, \u043F\u043E\u0445\u043E\u0436\u0435, \u043F\u0440\u043E\u0441\u043D\u0443\u043B\u0441\u044F. \u041F\u0440\u0438\u0434\u0443\u043C\u0430\u0439\u0442\u0435, \u043A\u0430\u043A \u0443\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0438 \u0442\u0435\u043F\u043B\u043E\u0438\u0437\u043E\u043B\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u0442\u0435\u043D\u044B \u043E\u0442 \u043F\u043E\u0442\u043E\u043A\u043E\u0432 \u043B\u0430\u0432\u044B."
    },
    {
      "id": 21,
      "title": "\u0421\u043B\u0430\u0434\u043E\u0441\u0442\u044C \u043D\u0435 \u0440\u0430\u0434\u043E\u0441\u0442\u044C",
      "description": "\u0412 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u043E\u0441\u0442\u0430\u043B\u0430\u0441\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u043B\u0430\u0434\u043A\u0430\u044F \u0435\u0434\u0430 \u0438 \u0443 \u0432\u0430\u0441 \u0441\u043B\u0438\u043F\u043B\u0438\u0441\u044C \u043F\u043E\u043F\u044B. \u041D\u0443\u0436\u043D\u0430 \u0441\u0440\u043E\u0447\u043D\u0430\u044F \u043C\u0435\u0434\u0438\u0446\u0438\u043D\u0441\u043A\u0430\u044F \u043F\u043E\u043C\u043E\u0449\u044C \u0438\u043B\u0438 \u0441\u043C\u0435\u043D\u0430 \u0434\u0438\u0435\u0442\u044B"
    },
    {
      "id": 22,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211622",
      "description": "\u043A \u0431\u0443\u043D\u043A\u0435\u0440\u0443 \u043F\u0440\u0438\u0448\u0435\u043B \u0440\u043E\u0431\u043E\u0442 \u0432 \u0442\u0435\u043C\u043D\u044B\u0445 \u043E\u0447\u043A\u0430\u0445. \u041E\u043D \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u043E\u0434\u0435\u0436\u0434\u0443, \u043C\u043E\u0442\u043E\u0446\u0438\u043A\u043B \u0438 \u043A\u0430\u043A\u0443\u044E-\u0442\u043E \u0436\u0435\u043D\u0449\u0438\u043D\u0443, \u043B\u0438\u0431\u043E \u043D\u0430\u0443\u0447\u0438\u0442\u044C \u0435\u0433\u043E \u043F\u0440\u043E\u0445\u043E\u0434\u0438\u0442\u044C \u043A\u0430\u043F\u0447\u0438. \u041E\u043D \u0443\u0431\u044C\u0435\u0442 \u043F\u0435\u0440\u0432\u043E\u0433\u043E, \u043A\u0442\u043E \u043F\u043E\u043F\u0430\u0434\u0435\u0442\u0441\u044F \u0435\u043C\u0443 \u043F\u043E\u0434 \u0440\u0443\u043A\u0443, \u0435\u0441\u043B\u0438 \u043E\u0442 \u043D\u0435\u0433\u043E \u043A\u0430\u043A\u0442\u043E \u043D\u0435 \u043E\u0442\u043A\u0443\u043F\u0438\u0442\u044C\u0441\u044F"
    },
    {
      "id": 23,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211623",
      "description": "\u0412\u043E \u0432\u0440\u0435\u043C\u044F \u0432\u044B\u043B\u0430\u0437\u043E\u043A \u0438\u0437 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u043B\u0435\u0433\u043A\u043E \u0437\u0430\u0431\u043B\u0443\u0434\u0438\u0442\u044C\u0441\u044F. \u0412\u0430\u043C \u043D\u0443\u0436\u043D\u0430 \u043D\u0430\u0434\u0435\u0436\u043D\u0430\u044F \u0441\u0432\u044F\u0437\u044C \u0438\u043B\u0438 \u043D\u0430\u0432\u0438\u0433\u0430\u0446\u0438\u044F"
    },
    {
      "id": 24,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211624",
      "description": "\u0418\u0418 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u043D\u0435 \u0432\u044B\u043F\u0443\u0441\u043A\u0430\u0435\u0442 \u0432\u0430\u0441 \u043D\u0430 \u0432\u044B\u043B\u0430\u0437\u043A\u0438 \u0431\u0435\u0437 \u043C\u0435\u0434 \u0441\u043F\u0440\u0430\u0432\u043A\u0438. \u0410 \u043F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 \u0437\u0430\u043F\u0430\u0441\u043E\u0432 \u043D\u0443\u0436\u043D\u043E \u0434\u043B\u044F \u0432\u044B\u0436\u0438\u0432\u0430\u043D\u0438\u044F. \u041D\u0443\u0436\u043D\u0430 \u043F\u0440\u0430\u0432\u0434\u043E\u043F\u043E\u0434\u043E\u0431\u043D\u0430\u044F \u0441\u043F\u0440\u0430\u0432\u043A\u0430 \u0441 \u043D\u0435\u0432\u043D\u044F\u0442\u043D\u044B\u043C \u043F\u043E\u0447\u0435\u0440\u043A\u043E\u043C \u0432\u0440\u0430\u0447\u0430, \u043B\u0438\u0431\u043E \u0432\u0430\u043C \u043D\u0430\u0434\u043E \u0443\u0431\u0435\u0434\u0438\u0442\u044C \u043A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440 \u0447\u0442\u043E \u0432\u0430\u043C \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u043F\u0440\u043E\u0441\u0438\u0442\u044C"
    },
    {
      "id": 25,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211625",
      "description": "\u041D\u0430\u0445\u043E\u0434\u044F\u0441\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435, \u0432\u044B \u0440\u0435\u0448\u0438\u043B\u0438 \u0441\u044B\u0433\u0440\u0430\u0442\u044C \u0432 \u0431\u0443\u043D\u043A\u0435\u0440, \u043D\u043E \u043F\u0435\u0440\u0435\u0440\u0443\u0433\u0430\u043B\u0438\u0441\u044C \u0438 \u0434\u0435\u043B\u043E \u0434\u043E\u0448\u043B\u043E \u0434\u043E \u0434\u0440\u0430\u043A\u0438. \u041A\u0442\u043E\u0442\u043E \u0432\u0441\u0435\u0440\u044C\u0435\u0437 \u043F\u0441\u0438\u0445\u0430\u043D\u0443\u043B \u0438 \u0445\u043E\u0447\u0435\u0442 \u0443\u0439\u0442\u0438. \u0412\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u043A\u0430\u043A\u0442\u043E \u0443\u0441\u043F\u043E\u043A\u043E\u0438\u0442\u044C\u0441\u044F \u0438 \u043F\u043E\u043C\u0438\u0440\u0438\u0442\u044C\u0441\u044F."
    },
    {
      "id": 26,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211626",
      "description": "\u041A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u0430 \u0437\u0430\u0442\u0440\u043E\u043D\u0443\u043B\u0430 \u043D\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0430\u0448 \u043C\u0438\u0440. \u0427\u0435\u0440\u0442\u0438 \u043F\u044B\u0442\u0430\u044E\u0442\u0441\u044F \u043F\u0440\u043E\u0440\u0432\u0430\u0442\u044C\u0441\u044F \u0432 \u0431\u0443\u043D\u043A\u0435\u0440, \u0447\u0442\u043E\u0431\u044B \u0441\u043F\u0430\u0441\u0442\u0438\u0441\u044C. \u041F\u043E\u043F\u044B\u0442\u0430\u0439\u0442\u0435\u0441\u044C \u043D\u0430\u0439\u0442\u0438 \u0441\u043F\u043E\u0441\u043E\u0431 \u043D\u0435 \u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0438\u0445"
    },
    {
      "id": 27,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211627",
      "description": "\u0412 \u0431\u0443\u043D\u043A\u0435\u0440 \u0437\u0430\u043A\u0430\u0442\u0438\u043B\u0441\u044F \u043A\u043E\u043B\u043E\u0431\u043E\u043A \u043C\u0443\u0442\u0430\u043D\u0442 \u043D\u0430\u043C\u0435\u0440\u0435\u0432\u0430\u044F\u0441\u044C \u0432\u044B\u0441\u043A\u0440\u0435\u0431\u0441\u0442\u0438 \u0432\u0441\u0435 \u0441\u0443\u0441\u0435\u043A\u0438 \u0432\u0430\u0448\u0435\u0433\u043E \u0431\u0443\u043D\u043A\u0435\u0440\u0430. \u041D\u0443\u0436\u043D\u044B \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u0436\u0438 \u043A\u043E\u0442\u043E\u0440\u044B\u0445 \u043E\u043D \u043F\u0440\u0438\u043C\u0435\u0442 \u0437\u0430 \u0431\u0430\u0431\u043A\u0443 \u0438 \u0434\u0435\u0434\u043A\u0443, \u0438 \u0442\u043E\u0433\u0434\u0430 \u043E\u043D \u0443\u0439\u0434\u0435\u0442 \u043E\u0442 \u0432\u0430\u0441 \u0441\u0430\u043C, \u043B\u0438\u0431\u043E \u0436\u0435 \u043D\u0430\u0434\u043E \u043A\u0430\u043A\u0442\u043E \u0434\u043E\u0445\u043E\u0434\u0447\u0438\u0432\u043E \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C, \u043A\u0443\u0434\u0430 \u043A\u0430\u0442\u0438\u0442\u044C\u0441\u044F"
    },
    {
      "id": 28,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211628",
      "description": "\u0412\u044B \u043E\u0442\u0440\u0430\u0432\u0438\u043B\u0438\u0441\u044C \u0433\u0440\u0438\u0431\u044C\u0430\u043C\u0438, \u0432\u044B\u0437\u044B\u0432\u0430\u044E\u0449\u0438\u043C\u0438 \u043F\u0430\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0433\u0430\u043B\u043B\u044E\u0446\u0438\u043D\u0430\u0446\u0438\u0438. \u041D\u0443\u0436\u043D\u0430 \u043C\u0435\u0434\u0438\u0446\u0438\u043D\u0441\u043A\u0430\u044F \u043F\u043E\u043C\u043E\u0449\u044C \u0438\u043B\u0438 \u043A\u0442\u043E-\u0442\u043E, \u043A\u0442\u043E \u0441\u043C\u043E\u0436\u0435\u0442 \u0432\u0430\u0441 \u0443\u0441\u043F\u043E\u043A\u043E\u0438\u0442\u044C, \u043F\u043E\u043A\u0430 \u0432\u044B \u043D\u0435 \u043D\u0430\u0432\u0440\u0435\u0434\u0438\u043B\u0438 \u0441\u0435\u0431\u0435"
    },
    {
      "id": 29,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211629",
      "description": "\u042D\u043B\u0435\u043A\u0442\u0440\u043E\u043D\u043D\u044B\u0439 \u0437\u0430\u043C\u043E\u043A \u043D\u0430 \u0434\u0432\u0435\u0440\u0438 \u0442\u0443\u0430\u043B\u0435\u0442\u0430 \u0437\u0430\u0432\u0438\u0441. \u0415\u0433\u043E \u043D\u0443\u0436\u043D\u043E \u043F\u0435\u0440\u0435\u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0438\u043B\u0438 \u0432\u0437\u043B\u043E\u043C\u0430\u0442\u044C, \u0438\u043D\u0430\u0447\u0435 \u043A\u0442\u043E-\u0442\u043E \u0438\u0437 \u0432\u0430\u0441 \u043F\u043E\u0433\u0438\u0431\u043D\u0435\u0442 \u0432\u0437\u0430\u043F\u0435\u0440\u0442\u0438."
    },
    {
      "id": 30,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211630",
      "description": "\u041A \u0432\u0430\u043C \u043F\u0440\u043E\u0431\u0440\u0430\u043B\u0441\u044F \u0447\u0435\u0440\u0435\u0437 \u0432\u0435\u043D\u0442\u0438\u043B\u044F\u0442\u043E\u0440 \u0437\u0434\u043E\u0440\u043E\u0432\u0435\u043D\u043D\u044B\u0439 \u043C\u0430\u043D\u044C\u044F\u043A. \u0412\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u0435\u0433\u043E \u0447\u0435\u043C-\u0442\u043E \u0438\u043B\u0438 \u043A\u0435\u043C-\u0442\u043E \u043E\u0442\u0432\u043B\u0435\u0447\u044C \u0438 \u043E\u0431\u0435\u0437\u0432\u0440\u0435\u0434\u0438\u0442\u044C."
    },
    {
      "id": 31,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211631",
      "description": "\u0423\u0433\u0440\u043E\u0437 \u043D\u0435\u0442, \u0432\u0441\u0435 \u0445\u043E\u0440\u043E\u0448\u043E"
    },
    {
      "id": 32,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211632",
      "description": "\u0421\u0442\u0430\u044F \u043C\u0443\u0442\u0438\u0440\u043E\u0432\u0430\u0432\u0448\u0438\u0445 \u0441\u043E\u0431\u0430\u043A \u043D\u0430\u0448\u043B\u0430 \u0432\u0430\u0448 \u0431\u0443\u043D\u043A\u0435\u0440 \u0438 \u043F\u044B\u0442\u0430\u0435\u0442\u0441\u044F \u0432\u044B\u0440\u044B\u0442\u044C \u043F\u043E\u0434\u043A\u043E\u043F, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u043F\u0430\u0441\u0442\u044C \u0432\u043D\u0443\u0442\u0440\u044C. \u0418\u0445 \u043A\u043E\u0433\u0442\u0438 \u0440\u0430\u0437\u0440\u044B\u0432\u0430\u044E\u0442 \u0431\u0435\u0442\u043E\u043D \u0438 \u0441\u0432\u0438\u043D\u0446\u043E\u0432\u0443\u044E \u043E\u0431\u0448\u0438\u0432\u043A\u0443 \u0431\u0443\u043D\u043A\u0435\u0440\u0430. \u0421\u0440\u043E\u0447\u043D\u043E \u043D\u0443\u0436\u043D\u043E \u0432\u043C\u0435\u0448\u0430\u0442\u044C\u0441\u044F"
    },
    {
      "id": 33,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211633",
      "description": "\u041F\u043E\u0434\u0434\u0430\u0432\u0448\u0438\u0441\u044C \u043F\u0430\u043D\u0438\u043A\u0435 \u0438 \u043F\u0430\u0440\u0430\u043D\u043E\u0439\u0435 \u0432\u044B \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u043B\u0438 \u0441\u043C\u0435\u0440\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043B\u043E\u0432\u0443\u0448\u043A\u0438 \u043F\u0435\u0440\u0435\u0434 \u0431\u0443\u043D\u043A\u0435\u0440\u043E\u043C \u0434\u043B\u044F \u0435\u0433\u043E \u0437\u0430\u0449\u0438\u0442\u044B. \u041D\u043E \u0438\u0437\u0437\u0430 \u0441\u0442\u0440\u0435\u0441\u0441\u0430 \u0437\u0430\u0431\u044B\u043B\u0438, \u0433\u0434\u0435 \u043E\u043D\u0438 \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u044B, \u0438 \u0437\u0430\u0431\u044B\u043B\u0438 \u043A\u043E\u0434\u044B \u0434\u043B\u044F \u0438\u0445 \u0434\u0435\u0430\u043A\u0442\u0438\u0432\u0430\u0446\u0438\u0438. \u041D\u0430\u0434\u043E \u0438\u0445 \u043D\u0430\u0439\u0442\u0438 \u0438 \u043E\u0431\u0435\u0437\u0432\u0440\u0435\u0434\u0438\u0442\u044C."
    },
    {
      "id": 34,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211634",
      "description": "\u0412 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u0435 \u0434\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u043D\u0430\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0435\u0433\u043E \u0447\u043B\u0435\u043D\u044B \u043D\u0430\u0447\u0430\u043B\u0438 \u0442\u0435\u0440\u044F\u0442\u044C \u043F\u0430\u043C\u044F\u0442\u044C \u0438 \u0437\u0430\u0431\u044B\u0432\u0430\u0442\u044C \u0432\u0430\u0436\u043D\u044B\u0435 \u043D\u0430\u0432\u044B\u043A\u0438. \u041D\u0443\u0436\u043D\u044B \u0438\u043D\u0442\u0435\u043B\u043B\u0435\u043A\u0442\u0443\u0430\u043B\u044B \u0438\u043B\u0438 \u043E\u0431\u0440\u0430\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u043D\u0430\u044F \u043B\u0438\u0442\u0435\u0440\u0430\u0442\u0443\u0440\u0430, \u0447\u0442\u043E\u0431\u044B \u043D\u0430\u0443\u0447\u0438\u0442\u044C \u043B\u044E\u0434\u0435\u0439 \u0434\u0443\u043C\u0430\u0442\u044C"
    },
    {
      "id": 35,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211635",
      "description": "\u0412\u0441\u0435 \u044D\u043B\u0435\u043A\u0442\u0440\u043E\u043D\u043D\u044B\u0435 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430 \u0433\u043B\u044E\u0447\u0430\u0442 \u0438\u0437\u0437\u0430 \u0441\u0438\u043B\u044C\u043D\u044B\u0445 \u044D\u043B\u0435\u043A\u0442\u0440\u043E-\u043C\u0430\u0433\u043D\u0438\u0442\u043D\u044B\u0445 \u0431\u0443\u0440\u044C. \u041D\u0443\u0436\u043D\u043E \u043A\u0430\u043A\u0442\u043E \u0437\u0430\u0449\u0438\u0442\u0438\u0442\u044C \u0438 \u0438\u0437\u043E\u043B\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u043B\u044E\u0447\u0435\u0432\u044B\u0435 \u0443\u0437\u043B\u044B \u0438 \u043E\u0431\u043E\u0440\u0443\u0434\u043E\u0432\u0430\u043D\u0438\u0435"
    },
    {
      "id": 36,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211636",
      "description": "\u0412\u0440\u0435\u043C\u044F \u043E\u0442 \u0432\u0440\u0435\u043C\u0435\u043D\u0438 \u043F\u043E\u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0434\u043E\u043C\u043E\u0432\u043E\u0439 \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0432\u043E\u0440\u0443\u0435\u0442 \u0432\u0435\u0449\u0438 \u0438 \u0443\u0431\u0435\u0433\u0430\u0435\u0442. \u041F\u0440\u0438\u0434\u0443\u043C\u0430\u0439\u0442\u0435, \u043A\u0430\u043A \u0435\u0433\u043E \u043F\u043E\u0439\u043C\u0430\u0442\u044C, \u0438\u043B\u0438 \u0432\u0441\u0435 \u0432 \u044D\u0442\u043E\u043C \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0442\u0435\u0440\u044F\u044E\u0442 \u0441\u0432\u043E\u0439 \u0431\u0430\u0433\u0430\u0436 (\u0443\u0433\u0440\u043E\u0437\u0430 \u043D\u0435 \u0441\u043C\u0435\u0440\u0442\u0435\u043B\u044C\u043D\u0430\u044F, \u0432\u0441\u0435 \u043E\u0441\u0442\u0430\u044E\u0442\u0441\u044F \u0436\u0438\u0432\u044B)"
    },
    {
      "id": 37,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211637",
      "description": "\u0411\u044B\u0442\u043E\u0432\u0443\u0445\u0430 \u043E\u043A\u0430\u0437\u0430\u043B\u0430\u0441\u044C \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u043E\u0439, \u0432\u044B \u0432\u0441\u0435 \u0434\u0440\u0443\u0433 \u0434\u0440\u0443\u0433\u0430 \u0437\u0430\u043A\u043E\u043B\u0435\u0431\u0430\u043B\u0438. \u041D\u0443\u0436\u043D\u043E \u0434\u043E\u0433\u043E\u0432\u043E\u0440\u0438\u0442\u044C\u0441\u044F \u043C\u044B\u0442\u044C \u043F\u043E\u0441\u0443\u0434\u0443, \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C\u0441\u044F \u0442\u0443\u0430\u043B\u0435\u0442\u043D\u044B\u043C\u0438 \u0435\u0440\u0448\u0438\u043A\u0430\u043C\u0438 \u0438 \u0437\u0430\u043A\u0440\u044B\u0432\u0430\u0442\u044C \u0442\u044E\u0431\u0438\u043A\u0438. \u0418\u043B\u0438 \u0447\u0430\u0449\u0435 \u043E\u0442\u0432\u043B\u0435\u043A\u0430\u0442\u044C\u0441\u044F \u043D\u0430 \u0432\u043E\u0437\u0432\u044B\u0448\u0435\u043D\u043D\u043E\u0435. \u0418\u043B\u0438 \u0432\u044B \u0434\u0440\u0443\u0433 \u0434\u0440\u0443\u0433\u0430 \u043F\u0435\u0440\u0435\u0443\u0431\u0438\u0432\u0430\u0435\u0442\u0435"
    },
    {
      "id": 38,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211638",
      "description": "\u0412 \u0431\u0443\u043D\u043A\u0435\u0440 \u0441 \u043E\u043A\u0440\u0435\u0441\u0442\u043D\u044B\u0445 \u0431\u043E\u043B\u043E\u0442 \u043F\u043E\u043F\u0430\u0434\u0430\u044E\u0442 \u043E\u0433\u0440\u043E\u043C\u043D\u044B\u0435 \u043A\u043E\u043C\u0430\u0440\u044B. \u041A\u043E\u0440\u0438\u0434\u043E\u0440\u044B \u0437\u0430\u043F\u043E\u043B\u043E\u043D\u0435\u043D\u044B \u0438\u043C\u0438, \u0432\u044B \u0431\u0430\u0440\u0440\u0438\u043A\u0430\u0434\u0438\u0440\u0443\u0435\u0442\u0435\u0441\u044C \u0432 \u043A\u043E\u043C\u043D\u0430\u0442\u0430\u0445 \u0438 \u043F\u043E \u043A\u0430\u043C\u0435\u0440\u0430\u043C \u043D\u0430\u0431\u043B\u044E\u0434\u0430\u0435\u0442\u0435 \u0437\u0430 \u043F\u0440\u043E\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u043C. \u041D\u0443\u0436\u043D\u043E \u0438\u0441\u0442\u0440\u0435\u0431\u0438\u0442\u044C \u0438\u0445, \u0441\u043E\u043E\u0440\u0443\u0434\u0438\u0442\u044C \u0437\u0430\u0449\u0438\u0442\u043D\u044B\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u044B \u0438\u043B\u0438 \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u0442\u044C \u0438\u0445 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A"
    },
    {
      "id": 39,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211639",
      "description": "\u0412\u044B \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u043B\u0438 \u0447\u0430\u0442 \u0441 \u0434\u0440\u0443\u0433\u0438\u043C \u0431\u0443\u043D\u043A\u0435\u0440\u043E\u043C \u043D\u0435\u043F\u043E\u0434\u0430\u043B\u0435\u043A\u0443 \u0438 \u043E\u043D\u0438 \u043F\u0438\u0448\u0443\u0442 \u0432\u0441\u044F\u043A\u0443\u044E \u0445\u0443\u0439\u043D\u044E. \u0412\u044B \u043D\u0435 \u043C\u043E\u0436\u0435\u0442\u0435 \u043D\u0438\u0447\u0435\u0433\u043E \u0434\u0435\u043B\u0430\u0442\u044C, \u043F\u043E\u043A\u0430 \u0438\u0441\u0447\u0435\u0440\u043F\u044B\u0432\u0430\u044E\u0449\u0435 \u043D\u0435 \u0434\u043E\u043A\u0430\u0436\u0435\u0442\u0435 \u0438\u043C, \u0447\u0442\u043E \u043E\u043D\u0438 \u043D\u0435 \u043F\u0440\u0430\u0432\u044B"
    },
    {
      "id": 40,
      "title": "\u0423\u0433\u0440\u043E\u0437\u0430 \u211640",
      "description": "\u041A\u0430\u043A\u0430\u044F-\u0442\u043E \u0441\u0438\u043B\u0430 \u043F\u043E\u0434\u043D\u044F\u043B\u0430 \u0441\u043A\u0435\u043B\u0435\u0442\u043E\u0432 \u0438\u0437 \u043C\u043E\u0433\u0438\u043B \u043E\u043A\u0440\u0435\u0441\u0442\u043D\u043E\u0433\u043E \u043A\u043B\u0430\u0434\u0431\u0438\u0449\u0430, \u0438 \u043E\u043D\u0438 \u043F\u0440\u043E\u043D\u0438\u043A\u043B\u0438 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440. \u0421\u0442\u0440\u0435\u043B\u043A\u043E\u0432\u043E\u0435 \u043E\u0440\u0443\u0436\u0438\u0435 \u0438\u0445 \u043D\u0435 \u0431\u0435\u0440\u0435\u0442. \u0412\u0430\u043C \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u043D\u0430\u0439\u0442\u0438 \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E\u0441\u0442\u044C \u043E\u0442\u0440\u0430\u0437\u0438\u0442\u044C \u043D\u0430\u043F\u0430\u0441\u0442\u044C \u0438\u043D\u044B\u043C\u0438 \u043C\u0435\u0442\u043E\u0434\u0430\u043C\u0438"
    }
  ];
  var TRAIT_DECKS = {
    profession: PROFESSIONS,
    health: HEALTH,
    biology: BIOLOGY,
    fact: FACTS,
    hobby: HOBBIES,
    baggage: BAGGAGE
  };
  function generateCharacters(playerIds, random = Math.random) {
    const decks = Object.fromEntries(
      Object.entries(TRAIT_DECKS).map(([key, values]) => [key, shuffle(values, random)])
    );
    const specialDeck = shuffle(SPECIAL_CARDS, random);
    return Object.fromEntries(playerIds.map((playerId, index) => {
      const special = specialDeck[index % specialDeck.length];
      return [playerId, {
        profession: decks.profession[index % decks.profession.length],
        health: decks.health[index % decks.health.length],
        biology: decks.biology[index % decks.biology.length],
        fact: decks.fact[index % decks.fact.length],
        hobby: decks.hobby[index % decks.hobby.length],
        baggage: decks.baggage[index % decks.baggage.length],
        special: special.text,
        specialId: special.id
      }];
    }));
  }
  function generateScenarios(random = Math.random) {
    return {
      catastrophe: drawScenarioCard("catastrophe", random),
      bunker: drawScenarioCard("bunker", random),
      threat: drawScenarioCard("threat", random)
    };
  }
  function drawTraitCard(trait, random = Math.random) {
    const deck = TRAIT_DECKS[trait];
    if (!deck) throw new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043A\u043E\u043B\u043E\u0434\u0430 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A.");
    return pick(deck, random);
  }
  function drawDistinctTraitCard(trait, excludedValues = [], random = Math.random) {
    const deck = TRAIT_DECKS[trait];
    if (!deck) throw new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043A\u043E\u043B\u043E\u0434\u0430 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A.");
    const excluded = new Set(excludedValues);
    const available = deck.filter((value) => !excluded.has(value));
    return pick(available.length ? available : deck, random);
  }
  function drawSpecialCard(random = Math.random) {
    return { ...pick(SPECIAL_CARDS, random) };
  }
  function drawScenarioCard(type, random = Math.random) {
    const decks = { catastrophe: CATASTROPHES, bunker: BUNKERS, threat: THREATS };
    const deck = decks[type];
    if (!deck) throw new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043A\u043E\u043B\u043E\u0434\u0430 \u0441\u0446\u0435\u043D\u0430\u0440\u0438\u0435\u0432.");
    return { ...pick(deck, random) };
  }
  function findScenarioCard(type, reference = {}) {
    const decks = { catastrophe: CATASTROPHES, bunker: BUNKERS, threat: THREATS };
    const deck = decks[type];
    if (!deck) throw new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043A\u043E\u043B\u043E\u0434\u0430 \u0441\u0446\u0435\u043D\u0430\u0440\u0438\u0435\u0432.");
    const cardId = Number(reference?.cardId ?? reference?.id ?? 0);
    const title = String(reference?.title ?? "");
    const description = String(reference?.description ?? "");
    const card = deck.find((item) => cardId && Number(item.id) === cardId || title && item.title === title || description && item.description === description);
    return card ? { ...card } : null;
  }
  function drawDistinctScenarioCard(type, excludedTitles = [], random = Math.random) {
    const decks = { catastrophe: CATASTROPHES, bunker: BUNKERS, threat: THREATS };
    const deck = decks[type];
    if (!deck) throw new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043A\u043E\u043B\u043E\u0434\u0430 \u0441\u0446\u0435\u043D\u0430\u0440\u0438\u0435\u0432.");
    const excluded = new Set(excludedTitles);
    const available = deck.filter((card) => !excluded.has(card.title));
    return { ...pick(available.length ? available : deck, random) };
  }
  function pick(items, random) {
    return items[Math.floor(random() * items.length)];
  }
  function shuffle(items, random) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  }

  // data/bunker/engine.js
  var GAME_TYPE = "bunker";
  var PHASES = {
    LOBBY: "lobby",
    REVEAL: "reveal",
    DISCUSSION: "discussion",
    VOTING: "voting",
    RESULTS: "results",
    THREAT: "threat",
    FINISHED: "finished"
  };
  var TRAIT_KEYS = [
    "profession",
    "health",
    "biology",
    "fact",
    "hobby",
    "baggage",
    "special"
  ];
  var ORDINARY_TRAIT_KEYS = TRAIT_KEYS.filter((trait) => trait !== "special");
  var TRAIT_LABELS = {
    profession: "\u041F\u0440\u043E\u0444\u0435\u0441\u0441\u0438\u044F",
    health: "\u0417\u0434\u043E\u0440\u043E\u0432\u044C\u0435",
    biology: "\u0411\u0438\u043E\u0434\u0430\u043D\u043D\u044B\u0435",
    fact: "\u0424\u0430\u043A\u0442",
    hobby: "\u0425\u043E\u0431\u0431\u0438",
    baggage: "\u0411\u0430\u0433\u0430\u0436",
    special: "\u041E\u0441\u043E\u0431\u0430\u044F \u043A\u0430\u0440\u0442\u0430"
  };
  var MINIMUM_GAME_ROUNDS = 5;
  var MAX_REVEALED_ORDINARY_TRAITS = ORDINARY_TRAIT_KEYS.length - 1;
  var MAX_TRAIT_REVEAL_ROUNDS = MAX_REVEALED_ORDINARY_TRAITS;
  var AFTER_EXILE_SPECIAL_IDS = /* @__PURE__ */ new Set([1, 11, 24, 30, 38]);
  var BEFORE_VOTING_SPECIAL_IDS = /* @__PURE__ */ new Set([46, 47, 48, 49, 51, 52, 57, 58, 65, 68, 69, 70]);
  var CURRENT_VOTING_SPECIAL_IDS = /* @__PURE__ */ new Set([4, 12, 20, 53]);
  var ROUND_START_SPECIAL_IDS = /* @__PURE__ */ new Set([59, 60, 61, 62, 63]);
  var REACTION_SPECIAL_IDS = /* @__PURE__ */ new Set([50, 71]);
  var SECRET_SPECIAL_IDS = /* @__PURE__ */ new Set([10, 13, 14, 15, 19]);
  var INTERACTIVE_BUNKER_CARD_IDS = /* @__PURE__ */ new Set([1, 4, 44, 51, 52, 53, 59, 62, 75]);
  function getOfficialBunkerCapacity(playerCount) {
    const count = Math.max(0, Math.trunc(Number(playerCount) || 0));
    return Math.floor(count / 2);
  }
  function getRoundVoteSchedule(playerCount, capacity = getOfficialBunkerCapacity(playerCount)) {
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
  function getSpecialAvailability(state, playerId, specialId) {
    const id = Number(specialId ?? 0);
    const player = state?.players?.[playerId];
    if (!player || !id) return { allowed: false, reason: "\u041E\u0441\u043E\u0431\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u043D\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u0430." };
    if (player.specialUsed) return { allowed: false, reason: "\u041E\u0441\u043E\u0431\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u0443\u0436\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0430." };
    if (state.phase === PHASES.FINISHED) return { allowed: false, reason: "\u041F\u0430\u0440\u0442\u0438\u044F \u0443\u0436\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430." };
    if (state.phase === PHASES.THREAT) {
      return { allowed: false, reason: "\u0421\u0435\u0439\u0447\u0430\u0441 \u0433\u0440\u0443\u043F\u043F\u0430 \u043F\u0440\u043E\u0445\u043E\u0434\u0438\u0442 \u0444\u0438\u043D\u0430\u043B\u044C\u043D\u0443\u044E \u0443\u0433\u0440\u043E\u0437\u0443." };
    }
    if (state.pendingSpecialChoice) {
      return { allowed: false, reason: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u043E\u0436\u0438\u0434\u0430\u044E\u0449\u0438\u0439 \u0432\u044B\u0431\u043E\u0440 \u043E\u0441\u043E\u0431\u043E\u0439 \u043A\u0430\u0440\u0442\u044B." };
    }
    if (state.pendingSecretShare && !REACTION_SPECIAL_IDS.has(id)) {
      return { allowed: false, reason: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u043E\u0436\u0438\u0434\u0430\u044E\u0449\u0438\u0439 \u043E\u0431\u043C\u0435\u043D \u0442\u0430\u0439\u043D\u044B\u043C\u0438 \u043A\u0430\u0440\u0442\u0430\u043C\u0438." };
    }
    if (state.pendingBunkerVote && !REACTION_SPECIAL_IDS.has(id)) {
      return { allowed: false, reason: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u043F\u043E \u043A\u0430\u0440\u0442\u0435 \u0431\u0443\u043D\u043A\u0435\u0440\u0430." };
    }
    const afterExile = AFTER_EXILE_SPECIAL_IDS.has(id);
    if (afterExile && player.status !== "exiled") {
      return { allowed: false, reason: "\u042D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443 \u043C\u043E\u0436\u043D\u043E \u0440\u0430\u0437\u044B\u0433\u0440\u0430\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0441\u043B\u0435 \u0441\u0432\u043E\u0435\u0433\u043E \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u044F." };
    }
    if (!afterExile && player.status !== "active") {
      return { allowed: false, reason: "\u041F\u043E\u0441\u043B\u0435 \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u044F \u043C\u043E\u0436\u043D\u043E \u0440\u0430\u0437\u044B\u0433\u0440\u044B\u0432\u0430\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u043A\u0430\u0440\u0442\u044B \u0441 \u0442\u0430\u043A\u0438\u043C \u0443\u0441\u043B\u043E\u0432\u0438\u0435\u043C." };
    }
    const activeCount = Object.values(state.players ?? {}).filter((item) => item.status === "active").length;
    const round = Number(state.round ?? 0);
    const roundVoteTarget2 = Number(
      state.roundVoteTarget ?? state.voteSchedule?.[round] ?? (round >= 2 ? 1 : 0)
    );
    const roundVotesCompleted = Number(
      state.roundVotesCompleted ?? state.completedVotesByRound?.[round] ?? 0
    );
    const hasUpcomingVote = activeCount > Number(state.capacity ?? 0) && (state.phase === PHASES.VOTING || state.phase === PHASES.RESULTS && state.voteResult?.status === "tie" || roundVoteTarget2 > roundVotesCompleted);
    if (BEFORE_VOTING_SPECIAL_IDS.has(id)) {
      if (!hasUpcomingVote) {
        return { allowed: false, reason: "\u042D\u0442\u0430 \u043A\u0430\u0440\u0442\u0430 \u043F\u0440\u0438\u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F \u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C, \u0430 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0435 \u043E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F." };
      }
      if (![PHASES.REVEAL, PHASES.DISCUSSION].includes(state.phase)) {
        return { allowed: false, reason: "\u042D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443 \u043D\u0443\u0436\u043D\u043E \u0440\u0430\u0437\u044B\u0433\u0440\u0430\u0442\u044C \u0434\u043E \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u044F \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F." };
      }
    }
    if (CURRENT_VOTING_SPECIAL_IDS.has(id)) {
      if (!hasUpcomingVote) {
        return { allowed: false, reason: "\u042D\u0444\u0444\u0435\u043A\u0442 \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u0435\u0442 \u043D\u0430 \u0442\u0435\u043A\u0443\u0449\u0435\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435, \u0430 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0435 \u043E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F." };
      }
      if (![PHASES.REVEAL, PHASES.DISCUSSION, PHASES.VOTING].includes(state.phase)) {
        return { allowed: false, reason: "\u042D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443 \u043C\u043E\u0436\u043D\u043E \u0440\u0430\u0437\u044B\u0433\u0440\u0430\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043E \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F \u0442\u0435\u043A\u0443\u0449\u0435\u0433\u043E \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F." };
      }
    }
    if (ROUND_START_SPECIAL_IDS.has(id)) {
      const roundHasStarted = Object.values(state.players ?? {}).some((item) => item.status === "active" && (item.hasFinishedTurn || item.revealedThisTurn));
      if (Number(state.round ?? 0) < 2 || Number(state.round ?? 0) > 4 || state.phase !== PHASES.REVEAL || roundHasStarted) {
        return { allowed: false, reason: "\u042D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443 \u043C\u043E\u0436\u043D\u043E \u0440\u0430\u0437\u044B\u0433\u0440\u0430\u0442\u044C \u0432\u043E \u0432\u0440\u0435\u043C\u044F \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0438\u044F \u043A\u0430\u0440\u0442 \u0432\u043E 2\u20134 \u0440\u0430\u0443\u043D\u0434\u0435." };
      }
    }
    if (id === 28 && ![PHASES.VOTING, PHASES.RESULTS].includes(state.phase)) {
      return { allowed: false, reason: "\u042D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443 \u043C\u043E\u0436\u043D\u043E \u0440\u0430\u0437\u044B\u0433\u0440\u0430\u0442\u044C \u0432\u043E \u0432\u0440\u0435\u043C\u044F \u0438\u043B\u0438 \u0441\u0440\u0430\u0437\u0443 \u043F\u043E\u0441\u043B\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F." };
    }
    if (id === 30 && Number(state.capacity ?? 0) <= 1) {
      return { allowed: false, reason: "\u0412\u043C\u0435\u0441\u0442\u0438\u043C\u043E\u0441\u0442\u044C \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0443\u0436\u0435 \u043D\u0435\u043B\u044C\u0437\u044F \u0443\u043C\u0435\u043D\u044C\u0448\u0438\u0442\u044C." };
    }
    if (id === 26 && state.phase !== PHASES.REVEAL) {
      return { allowed: false, reason: "\u042D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443 \u043D\u0443\u0436\u043D\u043E \u0440\u0430\u0437\u044B\u0433\u0440\u0430\u0442\u044C \u0434\u043E \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0438\u044F \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A \u0432 \u0442\u0435\u043A\u0443\u0449\u0435\u043C \u0440\u0430\u0443\u043D\u0434\u0435." };
    }
    if (REACTION_SPECIAL_IDS.has(id)) {
      const previous = state.lastSpecialSnapshot ?? state.lastSpecial;
      const previousRevision = Number(previous?.playedAtRevision ?? -1);
      if (!previous?.playedBy || previous.playedBy === playerId || previousRevision !== Number(state.revision ?? 0)) {
        return { allowed: false, reason: "\u042D\u0442\u0430 \u043A\u0430\u0440\u0442\u0430 \u0441\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u0440\u0430\u0437\u0443 \u043F\u043E\u0441\u043B\u0435 \u0447\u0443\u0436\u043E\u0439 \u043E\u0441\u043E\u0431\u043E\u0439 \u043A\u0430\u0440\u0442\u044B." };
      }
      if (id === 50) {
        const inputTypes = previous.inputTypes ?? Object.entries(previous.data ?? {}).filter(([, value]) => value !== "" && value !== void 0).map(([key]) => key);
        const previousSpecialId = Number(previous.specialId);
        const missingBunkerChoice = previousSpecialId === 54 && !(previous.choiceOptions?.length || previous.hasChoiceOptions);
        if ([50, 71].includes(previousSpecialId) || missingBunkerChoice || !inputTypes.length) {
          return { allowed: false, reason: "\u0423 \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u043E \u0441\u044B\u0433\u0440\u0430\u043D\u043D\u043E\u0439 \u043A\u0430\u0440\u0442\u044B \u043D\u0435\u0442 \u0432\u044B\u0431\u043E\u0440\u0430, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043C\u043E\u0436\u043D\u043E \u043F\u043E\u0434\u043C\u0435\u043D\u0438\u0442\u044C." };
        }
      }
    }
    return { allowed: true, reason: "" };
  }
  function createInitialGame(players, capacity, random = Math.random) {
    const order = players.map(([playerId]) => playerId);
    const characters = generateCharacters(order, random);
    const scenarios = generateScenarios(random);
    const randomState = Math.floor(random() * 4294967296) >>> 0;
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
      catastrophe: hiddenScenario("\u041A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u0430"),
      bunker: hiddenScenario("\u0411\u0443\u043D\u043A\u0435\u0440"),
      threat: hiddenScenario("\u0423\u0433\u0440\u043E\u0437\u0430"),
      logSequence: 0,
      log: {
        start: {
          message: "\u041F\u0430\u0440\u0442\u0438\u044F \u043D\u0430\u0447\u0430\u043B\u0430\u0441\u044C.",
          createdAt: Date.now()
        }
      }
    };
    ensureBunkerCardsForCurrentRound(engine);
    return engine;
  }
  function applyCommand(engine, command, hostId) {
    const requiresExactRevision = [
      "NEXT_PHASE",
      "PLAY_SPECIAL",
      "RESPOND_SECRET_SHARE",
      "CANCEL_PENDING"
    ].includes(command?.type);
    if (requiresExactRevision && command?.revision !== void 0 && Number(command.revision) !== Number(engine.revision)) {
      throw new Error("\u041A\u043E\u043C\u0430\u043D\u0434\u0430 \u0443\u0441\u0442\u0430\u0440\u0435\u043B\u0430: \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u043F\u0430\u0440\u0442\u0438\u0438 \u0443\u0436\u0435 \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u043E\u0441\u044C.");
    }
    ensureVotingPlan(engine);
    reconcileVotingPlan(engine);
    const introducedBunkerVote = migrateScenarioMetadata(engine);
    const isHostPendingSpecialCancel = command.type === "CANCEL_PENDING" && command.from === hostId;
    const isPendingSecretReaction = command.type === "PLAY_SPECIAL" && REACTION_SPECIAL_IDS.has(Number(engine.characters?.[command.from]?.specialId ?? 0));
    if (introducedBunkerVote && !["BUNKER_VOTE", "RESOLVE_BUNKER_VOTE"].includes(command.type)) {
      engine.revision += 1;
      return true;
    }
    if (engine.pendingSpecialChoice && !(command.type === "PLAY_SPECIAL" && command.from === engine.pendingSpecialChoice.playerId) && !isHostPendingSpecialCancel) {
      throw new Error("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u043E\u0436\u0438\u0434\u0430\u044E\u0449\u0435\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043E\u0441\u043E\u0431\u043E\u0439 \u043A\u0430\u0440\u0442\u044B: \u0432\u044B\u0431\u043E\u0440 \u0435\u0449\u0451 \u043D\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D.");
    }
    if (engine.pendingSecretShare && !(command.type === "RESPOND_SECRET_SHARE" && command.from === engine.pendingSecretShare.targetId) && !isPendingSecretReaction && !isHostPendingSpecialCancel) {
      throw new Error("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u043E\u0436\u0438\u0434\u0430\u044E\u0449\u0435\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043E\u0441\u043E\u0431\u043E\u0439 \u043A\u0430\u0440\u0442\u044B: \u043E\u0431\u043C\u0435\u043D \u0442\u0430\u0439\u043D\u044B\u043C\u0438 \u043A\u0430\u0440\u0442\u0430\u043C\u0438.");
    }
    if (engine.pendingBunkerVote && !["BUNKER_VOTE", "RESOLVE_BUNKER_VOTE"].includes(command.type) && !(engine.pendingSpecialChoice && command.type === "PLAY_SPECIAL" && command.from === engine.pendingSpecialChoice.playerId) && !(engine.pendingSecretShare && command.type === "RESPOND_SECRET_SHARE" && command.from === engine.pendingSecretShare.targetId) && !(command.type === "PLAY_SPECIAL" && REACTION_SPECIAL_IDS.has(Number(engine.characters?.[command.from]?.specialId ?? 0))) && !isHostPendingSpecialCancel) {
      throw new Error("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u043F\u043E \u043A\u0430\u0440\u0442\u0435 \u0431\u0443\u043D\u043A\u0435\u0440\u0430.");
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
  function createPublicState(engine) {
    const lastSpecial = engine.lastSpecialSnapshot?.playedBy ? {
      playedBy: engine.lastSpecialSnapshot.playedBy,
      specialId: SECRET_SPECIAL_IDS.has(Number(engine.lastSpecialSnapshot.specialId)) ? 0 : Number(engine.lastSpecialSnapshot.specialId ?? 0),
      playedAtRevision: Number(engine.lastSpecialSnapshot.playedAtRevision ?? -1),
      inputTypes: Object.entries(engine.lastSpecialSnapshot.data ?? {}).filter(([, value]) => value !== "" && value !== void 0).map(([key]) => key),
      ...engine.lastSpecialSnapshot.choiceOptions?.length ? { hasChoiceOptions: true } : {}
    } : null;
    return {
      gameType: engine.gameType,
      revision: engine.revision,
      phase: engine.phase,
      round: engine.round,
      totalRounds: engine.totalRounds,
      capacity: engine.capacity,
      initialPlayerCount: Number(engine.initialPlayerCount ?? engine.order?.length ?? 0),
      voteSchedule: { ...engine.voteSchedule ?? {} },
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
      ...engine.threatResolution ? { threatResolution: engine.threatResolution } : {},
      extraScenarios: createPublicExtraScenarios(engine),
      bunkerEffectResults: engine.bunkerEffectResults ?? {},
      bunkerSabotageTargets: createPublicBunkerSabotageTargets(engine),
      ...engine.lastTraitShuffle ? {
        lastTraitShuffle: {
          round: Number(engine.lastTraitShuffle.round ?? engine.round),
          trait: engine.lastTraitShuffle.trait,
          affectedIds: [...engine.lastTraitShuffle.affectedIds ?? []],
          sourceByRecipient: { ...engine.lastTraitShuffle.sourceByRecipient ?? {} }
        }
      } : {},
      ...engine.pendingBunkerVote ? {
        pendingBunkerVote: {
          type: engine.pendingBunkerVote.type,
          sourceTarget: engine.pendingBunkerVote.sourceTarget,
          sourceInstanceId: engine.pendingBunkerVote.sourceInstanceId,
          candidateIds: [...engine.pendingBunkerVote.candidateIds ?? []],
          voterIds: [...engine.pendingBunkerVote.voterIds ?? []],
          submittedVoterIds: Object.keys(engine.pendingBunkerVote.votes ?? {}),
          revote: Boolean(engine.pendingBunkerVote.revote)
        }
      } : {},
      ...engine.pendingSpecialChoice ? {
        pendingSpecialChoice: {
          type: engine.pendingSpecialChoice.type,
          playerId: engine.pendingSpecialChoice.playerId
        }
      } : {},
      ...engine.pendingSecretShare ? { pendingSecretShare: engine.pendingSecretShare } : {},
      ...lastSpecial ? { lastSpecial } : {},
      log: engine.log
    };
  }
  function createPublicBunkerSabotageTargets(engine) {
    return Object.values(engine.players ?? {}).filter((player) => player.sabotageScenarioTarget).map((player) => ({
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
      (Array.isArray(cards) ? cards : []).map((card) => card?.hiddenUntilFinal && !revealFinalThreats ? {
        ...card,
        title: "\u0422\u0430\u0439\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430",
        description: "\u0421\u043E\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u0435 \u044D\u0442\u043E\u0439 \u0443\u0433\u0440\u043E\u0437\u044B \u0440\u0430\u0441\u043A\u0440\u043E\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0432 \u0444\u0438\u043D\u0430\u043B\u0435."
      } : { ...card })
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
      ...player.cannotVoteAgainst ? { cannotVoteAgainst: player.cannotVoteAgainst } : {}
    }]));
  }
  function createPrivateStates(engine) {
    return Object.fromEntries(engine.order.map((playerId) => {
      const canRedirectBunkerChoice = Number(engine.characters?.[playerId]?.specialId ?? 0) === 50 && Number(engine.lastSpecialSnapshot?.specialId ?? 0) === 54 && getSpecialAvailability(engine, playerId, 50).allowed && engine.lastSpecialSnapshot?.choiceOptions?.length;
      return [
        playerId,
        {
          ...engine.characters[playerId],
          ...engine.pendingSpecialChoice?.playerId === playerId ? { pendingSpecialChoice: engine.pendingSpecialChoice } : {},
          ...canRedirectBunkerChoice ? {
            specialReactionChoiceOptions: engine.lastSpecialSnapshot.choiceOptions.map((option) => ({
              index: Number(option.index),
              title: option.title,
              description: option.description
            }))
          } : {},
          ...engine.sharedSecrets?.[playerId] ? { sharedSecrets: engine.sharedSecrets[playerId] } : {}
        }
      ];
    }));
  }
  function assertFirebaseSafe(value, path = "state") {
    if (value === void 0) throw new Error(`undefined \u0432 ${path}`);
    if (value === null) throw new Error(`null \u0432 ${path}`);
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
    if (engine.phase !== PHASES.REVEAL) throw new Error("\u0421\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u043B\u044C\u0437\u044F \u0440\u0430\u0441\u043A\u0440\u044B\u0432\u0430\u0442\u044C \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438.");
    if (playerId !== currentPlayerId) throw new Error("\u0421\u0435\u0439\u0447\u0430\u0441 \u0445\u043E\u0434 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430.");
    if (!player || player.status !== "active") throw new Error("\u0418\u0433\u0440\u043E\u043A \u043D\u0435 \u0443\u0447\u0430\u0441\u0442\u0432\u0443\u0435\u0442 \u0432 \u043F\u0430\u0440\u0442\u0438\u0438.");
    if (!TRAIT_KEYS.includes(trait)) throw new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0430.");
    const forcedTrait = engine.roundEffects?.forcedTrait;
    const isSpecial = trait === "special";
    if (forcedTrait && !player.revealedTraits?.[forcedTrait] && trait !== forcedTrait && !isSpecial) {
      throw new Error(`\u0412 \u044D\u0442\u043E\u043C \u0440\u0430\u0443\u043D\u0434\u0435 \u043D\u0443\u0436\u043D\u043E \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044C: ${TRAIT_LABELS[forcedTrait]}.`);
    }
    if (player.revealedThisTurn && !isSpecial) throw new Error("\u0412 \u044D\u0442\u043E\u043C \u0445\u043E\u0434\u0443 \u043E\u0431\u044B\u0447\u043D\u0430\u044F \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0430 \u0443\u0436\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0430.");
    if (player.revealedTraits[trait]) throw new Error("\u042D\u0442\u0430 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0430 \u0443\u0436\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0430.");
    if (!isSpecial && revealedOrdinaryTraitCount(player) >= MAX_REVEALED_ORDINARY_TRAITS) {
      throw new Error("\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u043E\u0431\u044B\u0447\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u0434\u043E\u043B\u0436\u043D\u0430 \u043E\u0441\u0442\u0430\u0442\u044C\u0441\u044F \u0441\u043A\u0440\u044B\u0442\u043E\u0439.");
    }
    const value = engine.characters?.[playerId]?.[trait];
    if (!value) throw new Error("\u0425\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430.");
    player.revealedTraits[trait] = value;
    if (!isSpecial) {
      player.revealedThisTurn = true;
      recordFirstReveal(engine, playerId, trait);
    }
    appendLog(engine, `${player.name} \u0440\u0430\u0441\u043A\u0440\u044B\u0432\u0430\u0435\u0442: ${TRAIT_LABELS[trait]} \u2014 ${value}.`);
  }
  function finishTurn(engine, command) {
    const playerId = command.from;
    const currentPlayerId = engine.order[engine.currentPlayerIndex];
    const player = engine.players?.[playerId];
    if (engine.phase !== PHASES.REVEAL) throw new Error("\u0421\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u043B\u044C\u0437\u044F \u0437\u0430\u0432\u0435\u0440\u0448\u0430\u0442\u044C \u0445\u043E\u0434.");
    if (playerId !== currentPlayerId) throw new Error("\u0421\u0435\u0439\u0447\u0430\u0441 \u0445\u043E\u0434 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430.");
    if (!player || player.status !== "active") throw new Error("\u0418\u0433\u0440\u043E\u043A \u043D\u0435 \u0443\u0447\u0430\u0441\u0442\u0432\u0443\u0435\u0442 \u0432 \u043F\u0430\u0440\u0442\u0438\u0438.");
    const hasHiddenOrdinaryTraits = TRAIT_KEYS.some((trait) => trait !== "special" && !player.revealedTraits?.[trait]);
    const mayKeepLastTraitHidden = revealedOrdinaryTraitCount(player) >= MAX_REVEALED_ORDINARY_TRAITS;
    if (!player.revealedThisTurn && hasHiddenOrdinaryTraits && !mayKeepLastTraitHidden) {
      throw new Error("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0440\u0430\u0441\u043A\u0440\u043E\u0439\u0442\u0435 \u043E\u0431\u044B\u0447\u043D\u0443\u044E \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0443.");
    }
    completeTurn(engine, playerId);
  }
  function skipTurn(engine, command, hostId) {
    if (command.from !== hostId) throw new Error("\u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0445\u043E\u0434 \u043C\u043E\u0436\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0435\u0434\u0443\u0449\u0438\u0439.");
    if (engine.phase !== PHASES.REVEAL) throw new Error("\u0421\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u0445\u043E\u0434\u0430.");
    const currentPlayerId = engine.order[engine.currentPlayerIndex];
    const player = engine.players?.[currentPlayerId];
    if (!player || player.status !== "active") throw new Error("\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u0438\u0433\u0440\u043E\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D.");
    appendLog(engine, `\u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0435\u0442 \u0445\u043E\u0434 \u0438\u0433\u0440\u043E\u043A\u0430 ${player.name}.`);
    completeTurn(engine, currentPlayerId);
  }
  function completeTurn(engine, playerId) {
    const player = engine.players[playerId];
    player.revealedThisTurn = false;
    player.hasFinishedTurn = true;
    const activeIds2 = activePlayerIds(engine);
    if (activeIds2.every((id) => engine.players[id].hasFinishedTurn)) {
      engine.phase = PHASES.DISCUSSION;
      engine.currentPlayerIndex = -1;
      appendLog(engine, "\u0412\u0441\u0435 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043B\u0438 \u0445\u043E\u0434\u044B. \u041D\u0430\u0447\u0438\u043D\u0430\u0435\u0442\u0441\u044F \u043E\u0431\u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0435.");
      return;
    }
    for (let offset = 1; offset <= engine.order.length; offset += 1) {
      const nextIndex = (engine.currentPlayerIndex + offset) % engine.order.length;
      const nextId = engine.order[nextIndex];
      const nextPlayer = engine.players[nextId];
      if (nextPlayer?.status === "active" && !nextPlayer.hasFinishedTurn) {
        engine.currentPlayerIndex = nextIndex;
        appendLog(engine, `\u0425\u043E\u0434 \u043F\u0435\u0440\u0435\u0445\u043E\u0434\u0438\u0442 \u043A \u0438\u0433\u0440\u043E\u043A\u0443 ${nextPlayer.name}.`);
        return;
      }
    }
  }
  function vote(engine, command) {
    const voterId = command.from;
    const targetId = command.data?.targetId;
    const voter = engine.players?.[voterId];
    const target = engine.players?.[targetId];
    if (command.data?.voteCycle !== void 0 && Number(command.data.voteCycle) !== Number(engine.voteCycle ?? 0)) {
      throw new Error("\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u0443\u0436\u0435 \u0441\u043C\u0435\u043D\u0438\u043B\u043E\u0441\u044C. \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u0430\u043D\u0434\u0438\u0434\u0430\u0442\u0430 \u0437\u0430\u043D\u043E\u0432\u043E.");
    }
    if (engine.phase !== PHASES.VOTING) throw new Error("\u0421\u0435\u0439\u0447\u0430\u0441 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u043D\u0435 \u043F\u0440\u043E\u0432\u043E\u0434\u0438\u0442\u0441\u044F.");
    if (!voter || !votingPlayerIds(engine).includes(voterId)) throw new Error("\u0412\u044B \u043D\u0435 \u0443\u0447\u0430\u0441\u0442\u0432\u0443\u0435\u0442\u0435 \u0432 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438.");
    if (!target || target.status !== "active") throw new Error("\u041D\u0435\u043B\u044C\u0437\u044F \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u0437\u0430 \u044D\u0442\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430.");
    if (voter.voteDisabled) throw new Error("\u0412\u0430\u0448\u0430 \u043E\u0441\u043E\u0431\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u0437\u0430\u043F\u0440\u0435\u0449\u0430\u0435\u0442 \u0432\u0430\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u0432 \u044D\u0442\u043E\u043C \u0440\u0430\u0443\u043D\u0434\u0435.");
    if (target.immuneThisRound || target.bunkerKing) throw new Error("\u042D\u0442\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u043D\u0435\u043B\u044C\u0437\u044F \u0438\u0437\u0433\u043D\u0430\u0442\u044C.");
    if (voter.cannotVoteAgainst?.[targetId]) throw new Error("\u0412\u044B \u043D\u0435 \u043C\u043E\u0436\u0435\u0442\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0442\u0438\u0432 \u044D\u0442\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430.");
    if (voter.forcedSelfVote && targetId !== voterId) throw new Error("\u0412 \u044D\u0442\u043E\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438 \u0432\u044B \u043E\u0431\u044F\u0437\u0430\u043D\u044B \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0442\u0438\u0432 \u0441\u0435\u0431\u044F.");
    if (engine.roundEffects?.previousVoteTargets?.[voterId] === targetId) {
      throw new Error("\u041F\u0440\u0438 \u043F\u0435\u0440\u0435\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438 \u043D\u0443\u0436\u043D\u043E \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u043A\u0430\u043D\u0434\u0438\u0434\u0430\u0442\u0430.");
    }
    const revoteCandidates = engine.voteResult?.status === "tie" ? engine.voteResult.candidates ?? [] : [];
    if (revoteCandidates.length && !revoteCandidates.includes(targetId)) {
      throw new Error("\u041F\u0440\u0438 \u043F\u0435\u0440\u0435\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043E\u0434\u043D\u043E\u0433\u043E \u0438\u0437 \u043B\u0438\u0434\u0435\u0440\u043E\u0432.");
    }
    engine.votes[voterId] = targetId;
    voter.voteSubmitted = true;
    if (targetId === voterId) voter.forcedSelfVote = false;
  }
  function nextPhase(engine, command, hostId) {
    if (command.from !== hostId) throw new Error("\u041C\u0435\u043D\u044F\u0442\u044C \u0444\u0430\u0437\u0443 \u043C\u043E\u0436\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0435\u0434\u0443\u0449\u0438\u0439.");
    if (engine.pendingSpecialChoice || engine.pendingSecretShare || engine.pendingBunkerVote) {
      throw new Error("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u043E\u0436\u0438\u0434\u0430\u044E\u0449\u0435\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043E\u0441\u043E\u0431\u043E\u0439 \u043A\u0430\u0440\u0442\u044B.");
    }
    if (engine.phase === PHASES.DISCUSSION) {
      const activeIds2 = activePlayerIds(engine);
      if (activeIds2.length > engine.capacity && remainingRoundVotes(engine) > 0) {
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
    throw new Error("\u0421\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u043B\u044C\u0437\u044F \u043C\u0435\u043D\u044F\u0442\u044C \u0444\u0430\u0437\u0443.");
  }
  function closeVoting(engine) {
    const activeIds2 = activePlayerIds(engine);
    const revoteCandidates = new Set(
      engine.voteResult?.status === "tie" ? engine.voteResult.candidates ?? [] : []
    );
    const submittedIds = votingPlayerIds(engine).filter((id) => engine.players[id].voteSubmitted && engine.votes[id]);
    if (!submittedIds.length) throw new Error("\u041F\u043E\u043A\u0430 \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043B.");
    delete engine.preVotingResultSnapshot;
    engine.preVotingResultSnapshot = captureSpecialSnapshot(engine);
    const counts = {};
    const votersByTarget = {};
    const discreditedVoters = /* @__PURE__ */ new Set();
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
    for (const ownerId of activeIds2) {
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
            `${engine.characters[voterId].health}; \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E: ${extraHealth}`,
            true
          );
        }
      }
    }
    const missingTraits = engine.roundEffects?.missingTraitBonuses ?? (engine.roundEffects?.missingTraitBonus ? [engine.roundEffects.missingTraitBonus] : []);
    for (const missingTrait of missingTraits) {
      for (const id of activeIds2) {
        if (!engine.players[id].revealedTraits?.[missingTrait]) counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    for (const [id, count] of Object.entries(counts)) {
      const player = engine.players[id];
      if (count <= 0 || player?.status !== "active" || player.immuneThisRound || player.bunkerKing || revoteCandidates.size && !revoteCandidates.has(id)) {
        delete counts[id];
      }
    }
    if (!Object.keys(counts).length) throw new Error("\u041F\u043E\u0441\u043B\u0435 \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u043E\u0441\u043E\u0431\u044B\u0445 \u043A\u0430\u0440\u0442 \u043D\u0435 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C \u0443\u0447\u0438\u0442\u044B\u0432\u0430\u0435\u043C\u044B\u0445 \u0433\u043E\u043B\u043E\u0441\u043E\u0432.");
    const maximum = Math.max(...Object.values(counts));
    const leaders = Object.keys(counts).filter((id) => counts[id] === maximum);
    if (leaders.length === 1) {
      const exiledPlayerId = leaders[0];
      if (!exilePlayer(engine, exiledPlayerId)) {
        throw new Error("\u0412\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u043D\u0435\u043B\u044C\u0437\u044F \u0438\u0437\u0433\u043D\u0430\u0442\u044C.");
      }
      markRoundVoteCompleted(engine);
      engine.voteResult = { status: "exiled", exiledPlayerId, candidates: leaders, counts };
      appendLog(engine, `${engine.players[exiledPlayerId].name} \u0438\u0437\u0433\u043D\u0430\u043D \u0438\u0437 \u0433\u0440\u0443\u043F\u043F\u044B.`);
    } else {
      engine.voteResult = { status: "tie", exiledPlayerId: "", candidates: leaders, counts };
      appendLog(engine, "\u0413\u043E\u043B\u043E\u0441\u0430 \u0440\u0430\u0437\u0434\u0435\u043B\u0438\u043B\u0438\u0441\u044C \u043F\u043E\u0440\u043E\u0432\u043D\u0443. \u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u043F\u0435\u0440\u0435\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435.");
    }
    engine.phase = PHASES.RESULTS;
  }
  function continueAfterResults(engine) {
    if (engine.voteResult.status === "tie") {
      engine.phase = PHASES.VOTING;
      engine.currentPlayerIndex = -1;
      advanceVoteCycle(engine);
      resetVotes(engine);
      appendLog(engine, "\u041D\u0430\u0447\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u043C\u0435\u0436\u0434\u0443 \u043B\u0438\u0434\u0435\u0440\u0430\u043C\u0438.");
      return;
    }
    if (engine.voteResult.status !== "exiled") throw new Error("\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F \u0435\u0449\u0451 \u043D\u0435 \u0433\u043E\u0442\u043E\u0432.");
    const activeIds2 = activePlayerIds(engine);
    if (activeIds2.length > engine.capacity && remainingRoundVotes(engine) > 0) {
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
      voteTarget > 1 ? `\u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u043E\u0442\u043A\u0440\u044B\u043B \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 ${voteNumber} \u0438\u0437 ${voteTarget} \u0432 \u0440\u0430\u0443\u043D\u0434\u0435 ${engine.round}.` : "\u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u043E\u0442\u043A\u0440\u044B\u043B \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435."
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
      `\u0420\u0430\u0443\u043D\u0434 ${engine.round} \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u0435\u0442\u0441\u044F: \u043F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u043A\u0430 \u043A \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044E ${nextVoteNumber} \u0438\u0437 ${voteTarget}.`
    );
  }
  function completeCurrentRound(engine) {
    const completedRound = Number(engine.round ?? 1);
    const returnedIds = applySecondChances(engine);
    const activeIds2 = activePlayerIds(engine);
    if (returnedIds.length) {
      appendLog(engine, "\u0418\u0433\u0440\u043E\u043A\u0438 \u0441\u043E \xAB\u0412\u0442\u043E\u0440\u044B\u043C \u0448\u0430\u043D\u0441\u043E\u043C\xBB \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u044E\u0442\u0441\u044F \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u0440\u0430\u0443\u043D\u0434\u0435.");
    }
    reconcileVotingPlan(engine, completedRound + 1);
    if (completedRound >= engine.totalRounds) {
      if (activeIds2.length <= engine.capacity) {
        finishGame(engine, activeIds2);
        return;
      }
      engine.totalRounds = completedRound + 1;
      engine.voteSchedule[engine.totalRounds] = Math.max(
        Number(engine.voteSchedule?.[engine.totalRounds] ?? 0),
        activeIds2.length - engine.capacity
      );
    }
    if (activeIds2.length <= engine.capacity) {
      appendLog(engine, "\u0421\u043E\u0441\u0442\u0430\u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0443\u0436\u0435 \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0451\u043D. \u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0440\u0430\u0443\u043D\u0434 \u043F\u0440\u043E\u0439\u0434\u0451\u0442 \u0431\u0435\u0437 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F.");
    }
    beginNextRound(engine, activeIds2);
  }
  function beginNextRound(engine, activeIds2 = activePlayerIds(engine)) {
    if (!activeIds2.length) {
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
    for (const id of activeIds2) {
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
    engine.currentPlayerIndex = hasRevealTurns ? engine.order.findIndex((id) => engine.players[id]?.status === "active") : -1;
    appendLog(
      engine,
      completedRound === 1 ? `\u041F\u0435\u0440\u0432\u044B\u0439 \u0440\u0430\u0443\u043D\u0434 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D \u0431\u0435\u0437 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F. \u041D\u0430\u0447\u0438\u043D\u0430\u0435\u0442\u0441\u044F \u0440\u0430\u0443\u043D\u0434 ${engine.round}.` : hasRevealTurns ? `\u041D\u0430\u0447\u0438\u043D\u0430\u0435\u0442\u0441\u044F \u0440\u0430\u0443\u043D\u0434 ${engine.round}.` : `\u041D\u0430\u0447\u0438\u043D\u0430\u0435\u0442\u0441\u044F \u0440\u0430\u0443\u043D\u0434 ${engine.round} \u0431\u0435\u0437 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0438\u044F \u043D\u043E\u0432\u044B\u0445 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A: \u043E\u0434\u043D\u0430 \u043E\u0431\u044B\u0447\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u0441\u043A\u0440\u044B\u0442\u043E\u0439.`
    );
  }
  function finishGame(engine, activeIds2 = activePlayerIds(engine)) {
    engine.currentPlayerIndex = -1;
    const bunkerOutcome = resolveFinalBunkerEffects(engine, activeIds2);
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
        appendLog(engine, `\u0424\u0438\u043D\u0430\u043B: \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0430 \u0443\u0433\u0440\u043E\u0437\u0430 \xAB${secret.title}\xBB.`);
      }
    }
    const finalistSet = new Set(finalistIds);
    const activeExtraThreats = (engine.extraScenarios?.threat ?? []).filter(
      (card) => !card.suppressed && isDangerousThreatCard(card) && (!card.targetId || finalistSet.has(card.targetId))
    );
    const activeThreatCards = [
      ...engine.threat?.status === "revealed" && isDangerousThreatCard(engine.threat) ? [engine.threat] : [],
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
      ...bunkerOutcome.forcedFailure ? {
        forcedByBunker: true,
        failureReason: bunkerOutcome.message
      } : {}
    };
    if (bunkerOutcome.forcedFailure) {
      engine.phase = PHASES.FINISHED;
      appendLog(engine, bunkerOutcome.message);
      return;
    }
    if (!threatCount) {
      engine.phase = PHASES.FINISHED;
      appendLog(engine, `\u0423\u0433\u0440\u043E\u0437 \u0434\u043B\u044F \u0444\u0438\u043D\u0430\u043B\u0438\u0441\u0442\u043E\u0432 \u043D\u0435\u0442. \u0411\u0443\u043D\u043A\u0435\u0440 \u0432\u044B\u0436\u0438\u043B: ${finalistIds.map((id) => engine.players[id].name).join(", ")}.`);
      return;
    }
    engine.phase = PHASES.THREAT;
    appendLog(engine, `\u0424\u0438\u043D\u0430\u043B\u0438\u0441\u0442\u044B \u0432\u043E\u0448\u043B\u0438 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440. \u0418\u043C \u043F\u0440\u0435\u0434\u0441\u0442\u043E\u0438\u0442 \u0441\u043F\u0440\u0430\u0432\u0438\u0442\u044C\u0441\u044F \u0441 \u0443\u0433\u0440\u043E\u0437\u0430\u043C\u0438: ${threatCount}.`);
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
      const message = `\u0418\u0437-\u0437\u0430 \u0434\u043E\u043B\u0433\u043E\u0433\u043E \u0441\u0440\u043E\u043A\u0430 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0430 \u0443\u0433\u0440\u043E\u0437\u0430 \xAB${threat.title}\xBB.`;
      setBunkerEffectResult(engine, scenario, "resolved", message, "threat_added");
      appendLog(engine, message);
    }
    for (const { scenario } of byCardId(59)) {
      const replacement = replaceOneThreat(engine, finalistIds);
      const message = replacement ? `\u041B\u0430\u043C\u043F\u0430 \u0434\u0436\u0438\u043D\u043D\u0430 \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043B\u0430 \u043F\u0440\u0435\u0436\u043D\u044E\u044E \u0443\u0433\u0440\u043E\u0437\u0443, \u043D\u043E \u043E\u0442\u043A\u0440\u044B\u043B\u0430 \u043D\u043E\u0432\u0443\u044E: \xAB${replacement.title}\xBB.` : "\u041B\u0430\u043C\u043F\u0430 \u0434\u0436\u0438\u043D\u043D\u0430 \u043D\u0435 \u043D\u0430\u0448\u043B\u0430 \u0443\u0433\u0440\u043E\u0437\u0443 \u0434\u043B\u044F \u0437\u0430\u043C\u0435\u043D\u044B.";
      setBunkerEffectResult(engine, scenario, "resolved", message, replacement ? "threat_replaced" : "no_threat");
      appendLog(engine, message);
    }
    for (const { scenario } of byCardId(1)) {
      const suppressed = suppressOneThreat(engine, finalistIds, scenario.instanceId);
      const message = suppressed ? suppressed.wasHidden ? "\u0421\u0442\u0430\u0440\u044B\u0439 \u0436\u0443\u0440\u043D\u0430\u043B \u043F\u043E\u0437\u0432\u043E\u043B\u0438\u043B \u043D\u0435 \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0442\u044C \u043E\u0434\u043D\u0443 \u0443\u0433\u0440\u043E\u0437\u0443." : `\u0421\u0442\u0430\u0440\u044B\u0439 \u0436\u0443\u0440\u043D\u0430\u043B \u043F\u043E\u0437\u0432\u043E\u043B\u0438\u043B \u043D\u0435 \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0442\u044C \u0443\u0433\u0440\u043E\u0437\u0443 \xAB${suppressed.title}\xBB.` : "\u0421\u0442\u0430\u0440\u044B\u0439 \u0436\u0443\u0440\u043D\u0430\u043B \u043D\u0435 \u043D\u0430\u0448\u0451\u043B \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0439 \u0443\u0433\u0440\u043E\u0437\u044B.";
      setBunkerEffectResult(engine, scenario, "resolved", message, suppressed ? "threat_suppressed" : "no_threat");
      appendLog(engine, message);
    }
    let forcedFailure = false;
    let failureMessage = "";
    for (const { scenario } of byCardId(44)) {
      if (engineRandom(engine) < 0.5) {
        const suppressed = suppressOneThreat(engine, activePlayerIds(engine), scenario.instanceId);
        neutralizeCatastrophe(engine);
        const message = suppressed ? suppressed.wasHidden ? "\u042D\u043D\u0435\u0440\u0433\u0435\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0441\u0444\u0435\u0440\u0430 \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043B\u0430 \u043A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u0443 \u0438 \u043E\u0434\u043D\u0443 \u043D\u0435\u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0443\u044E \u0443\u0433\u0440\u043E\u0437\u0443." : `\u042D\u043D\u0435\u0440\u0433\u0435\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0441\u0444\u0435\u0440\u0430 \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043B\u0430 \u043A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u0443 \u0438 \u0443\u0433\u0440\u043E\u0437\u0443 \xAB${suppressed.title}\xBB.` : "\u042D\u043D\u0435\u0440\u0433\u0435\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0441\u0444\u0435\u0440\u0430 \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043B\u0430 \u043A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u0443; \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0443\u0433\u0440\u043E\u0437 \u043D\u0435 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C.";
        setBunkerEffectResult(engine, scenario, "resolved", message, "saved");
        appendLog(engine, message);
      } else {
        for (const playerId of engine.order) killPlayerByBunker(engine, playerId);
        forcedFailure = true;
        failureMessage = "\u042D\u043D\u0435\u0440\u0433\u0435\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0441\u0444\u0435\u0440\u0430 \u0432\u0437\u043E\u0440\u0432\u0430\u043B\u0430\u0441\u044C. \u041D\u0438\u043A\u0442\u043E \u0432 \u043E\u043A\u0440\u0435\u0441\u0442\u043D\u043E\u0441\u0442\u044F\u0445 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u043D\u0435 \u0432\u044B\u0436\u0438\u043B.";
        setBunkerEffectResult(engine, scenario, "resolved", failureMessage, "destroyed_all");
        appendLog(engine, failureMessage);
        break;
      }
    }
    if (!forcedFailure) {
      for (const { scenario } of byCardId(75)) {
        const roll = engineRandom(engine);
        if (roll < 0.4) {
          const suppressed = suppressOneThreat(engine, activePlayerIds(engine), scenario.instanceId);
          const message = suppressed ? suppressed.wasHidden ? "\u0410\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u044B \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043B\u0438 \u043E\u0434\u043D\u0443 \u043D\u0435\u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0443\u044E \u0443\u0433\u0440\u043E\u0437\u0443." : `\u0410\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u044B \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043B\u0438 \u0443\u0433\u0440\u043E\u0437\u0443 \xAB${suppressed.title}\xBB.` : "\u0410\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u044B \u0441\u0440\u0430\u0431\u043E\u0442\u0430\u043B\u0438, \u043D\u043E \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0443\u0433\u0440\u043E\u0437 \u0443\u0436\u0435 \u043D\u0435 \u0431\u044B\u043B\u043E.";
          setBunkerEffectResult(engine, scenario, "resolved", message, suppressed ? "threat_suppressed" : "no_threat");
          appendLog(engine, message);
        } else if (roll < 0.6) {
          const targetId = randomPlayerId(activePlayerIds(engine), () => engineRandom(engine));
          if (targetId) {
            const name = engine.players[targetId].name;
            killPlayerByBunker(engine, targetId);
            const message = `\u0410\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u044B \u0443\u0431\u0438\u043B\u0438 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430: ${name}.`;
            setBunkerEffectResult(engine, scenario, "resolved", message, "player_killed");
            appendLog(engine, message);
          } else {
            setBunkerEffectResult(engine, scenario, "resolved", "\u0410\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u0430\u043C \u043D\u0435\u043A\u043E\u0433\u043E \u0431\u044B\u043B\u043E \u0432\u044B\u0431\u0440\u0430\u0442\u044C.", "no_target");
          }
        } else {
          const message = "\u0410\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u044B \u043D\u0435 \u0434\u0430\u043B\u0438 \u043D\u0438\u043A\u0430\u043A\u043E\u0433\u043E \u044D\u0444\u0444\u0435\u043A\u0442\u0430.";
          setBunkerEffectResult(engine, scenario, "resolved", message, "nothing");
          appendLog(engine, message);
        }
      }
    }
    if (!activePlayerIds(engine).length) {
      forcedFailure = true;
      failureMessage ||= "\u0412 \u0444\u0438\u043D\u0430\u043B\u0435 \u043D\u0435 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C \u043D\u0438 \u043E\u0434\u043D\u043E\u0433\u043E \u0436\u0438\u0432\u043E\u0433\u043E \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0430.";
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
      engine.threat?.status === "revealed" || engine.threat?.status === "suppressed" ? scenarioDeckTitle("threat", engine.threat) : "",
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
    throw new Error("\u0412 \u043A\u043E\u043B\u043E\u0434\u0435 \u043D\u0435 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0443\u0433\u0440\u043E\u0437.");
  }
  function scenarioDeckTitle(type, scenario) {
    return findScenarioCard(type, scenario)?.title ?? scenario?.title ?? "";
  }
  function replaceOneThreat(engine, finalistIds) {
    const finalistSet = new Set(finalistIds);
    const primary = engine.threat?.status === "hidden" ? engine.scenarioSecrets?.threat : engine.threat;
    const replacePrimary = ["hidden", "revealed"].includes(engine.threat?.status) && isDangerousThreatCard(primary);
    const extra = (engine.extraScenarios?.threat ?? []).find((card) => !card.suppressed && isDangerousThreatCard(card) && (!card.targetId || finalistSet.has(card.targetId)));
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
    if (["hidden", "revealed"].includes(engine.threat?.status) && isDangerousThreatCard(primaryWasHidden ? engine.scenarioSecrets?.threat : engine.threat)) {
      const secret = engine.scenarioSecrets?.threat ?? engine.threat;
      engine.threat = {
        status: "suppressed",
        cardId: primaryWasHidden ? 0 : Number(secret?.id ?? secret?.cardId ?? 0),
        title: primaryWasHidden ? "\u0423\u0433\u0440\u043E\u0437\u0430 \u043D\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0430" : secret?.title ?? "\u0423\u0433\u0440\u043E\u0437\u0430",
        description: "\u042D\u0442\u0430 \u0443\u0433\u0440\u043E\u0437\u0430 \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043D\u0430 \u043A\u0430\u0440\u0442\u043E\u0439 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0434\u043E \u0444\u0438\u043D\u0430\u043B\u044C\u043D\u043E\u0439 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438.",
        sourceBunkerInstanceId
      };
      return { ...secret, wasHidden: primaryWasHidden };
    }
    const extra = (engine.extraScenarios?.threat ?? []).find((card) => !card.suppressed && isDangerousThreatCard(card) && (!card.targetId || finalistSet.has(card.targetId)));
    if (!extra) return null;
    const wasHidden = Boolean(extra.hiddenUntilFinal);
    const suppressed = { ...extra, wasHidden };
    extra.suppressed = true;
    extra.suppressedByBunkerInstanceId = sourceBunkerInstanceId;
    if (wasHidden) {
      extra.cardId = 0;
      extra.title = "\u0423\u0433\u0440\u043E\u0437\u0430 \u043D\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0430";
      extra.description = "\u042D\u0442\u0430 \u0442\u0430\u0439\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430 \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043D\u0430 \u043A\u0430\u0440\u0442\u043E\u0439 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0438 \u043D\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F.";
      extra.hiddenUntilFinal = false;
    }
    return suppressed;
  }
  function neutralizeCatastrophe(engine) {
    const catastrophe = engine.catastrophe?.status === "revealed" ? engine.catastrophe : engine.scenarioSecrets?.catastrophe;
    engine.catastrophe = {
      status: "neutralized",
      cardId: Number(catastrophe?.id ?? catastrophe?.cardId ?? 0),
      title: catastrophe?.title ? `\u041D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043D\u0430: ${catastrophe.title}` : "\u041A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u0430 \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043D\u0430",
      description: "\u042D\u043D\u0435\u0440\u0433\u0435\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0441\u0444\u0435\u0440\u0430 \u0443\u0441\u0442\u0440\u0430\u043D\u0438\u043B\u0430 \u043F\u043E\u0441\u043B\u0435\u0434\u0441\u0442\u0432\u0438\u044F \u043A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u044B."
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
    if (command.from !== hostId) throw new Error("\u0418\u0441\u0445\u043E\u0434 \u0444\u0438\u043D\u0430\u043B\u044C\u043D\u043E\u0439 \u0443\u0433\u0440\u043E\u0437\u044B \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u044F\u0435\u0442 \u0432\u0435\u0434\u0443\u0449\u0438\u0439.");
    if (engine.phase !== PHASES.THREAT || engine.threatResolution?.status !== "pending") {
      throw new Error("\u0421\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0439 \u0444\u0438\u043D\u0430\u043B\u044C\u043D\u043E\u0439 \u0443\u0433\u0440\u043E\u0437\u044B.");
    }
    const outcome = command.data?.outcome;
    if (!["survived", "failed", "nonlethal_failed"].includes(outcome)) {
      throw new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0438\u0441\u0445\u043E\u0434 \u0443\u0433\u0440\u043E\u0437\u044B.");
    }
    const hasNonlethalThreat = Number(engine.threatResolution.nonlethalThreatCount ?? 0) > 0;
    if (outcome === "nonlethal_failed" && !hasNonlethalThreat) {
      throw new Error("\u0421\u0440\u0435\u0434\u0438 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0443\u0433\u0440\u043E\u0437 \u043D\u0435\u0442 \u043D\u0435\u0441\u043C\u0435\u0440\u0442\u0435\u043B\u044C\u043D\u043E\u0439 \u0443\u0433\u0440\u043E\u0437\u044B \u0441 \u0434\u043E\u043C\u043E\u0432\u044B\u043C.");
    }
    const onlyNonlethalFailure = outcome === "failed" && Number(engine.threatResolution.lethalThreatCount ?? engine.threatResolution.threatCount ?? 0) === 0 && hasNonlethalThreat;
    if (onlyNonlethalFailure || outcome === "nonlethal_failed") {
      resolveNonlethalThreatFailure(engine);
      return;
    }
    engine.threatResolution.status = outcome;
    engine.threatResolution.resolvedAt = Date.now();
    revealAllPlayersTraits(engine);
    engine.phase = PHASES.FINISHED;
    const names = engine.threatResolution.finalistIds.map((id) => engine.players[id]?.name).filter(Boolean).join(", ");
    appendLog(
      engine,
      outcome === "survived" ? `\u0424\u0438\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430 \u0443\u0441\u0442\u0440\u0430\u043D\u0435\u043D\u0430. \u0411\u0443\u043D\u043A\u0435\u0440 \u0432\u044B\u0436\u0438\u043B: ${names}.` : `\u0424\u0438\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430 \u043D\u0435 \u0443\u0441\u0442\u0440\u0430\u043D\u0435\u043D\u0430. \u0411\u0443\u043D\u043A\u0435\u0440 \u043D\u0435 \u0432\u044B\u0436\u0438\u043B. \u0424\u0438\u043D\u0430\u043B\u0438\u0441\u0442\u044B: ${names}.`
    );
  }
  function resolveNonlethalThreatFailure(engine) {
    for (const playerId of engine.threatResolution.finalistIds ?? []) {
      if (engine.players[playerId]?.status !== "active") continue;
      replaceTrait(engine, playerId, "baggage", "\u0411\u0430\u0433\u0430\u0436 \u043F\u043E\u0442\u0435\u0440\u044F\u043D \u0438\u0437-\u0437\u0430 \u0434\u043E\u043C\u043E\u0432\u043E\u0433\u043E", true);
    }
    const lethalThreatsResolved = Number(engine.threatResolution.lethalThreatCount ?? 0) > 0;
    engine.threatResolution.status = "survived";
    engine.threatResolution.nonlethalFailure = true;
    engine.threatResolution.lethalThreatsResolved = lethalThreatsResolved;
    engine.threatResolution.resolvedAt = Date.now();
    revealAllPlayersTraits(engine);
    engine.phase = PHASES.FINISHED;
    const names = engine.threatResolution.finalistIds.map((id) => engine.players[id]?.name).filter(Boolean).join(", ");
    appendLog(
      engine,
      lethalThreatsResolved ? `\u0421\u043C\u0435\u0440\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0443\u0433\u0440\u043E\u0437\u044B \u0443\u0441\u0442\u0440\u0430\u043D\u0435\u043D\u044B, \u043D\u043E \u0434\u043E\u043C\u043E\u0432\u043E\u0433\u043E \u043F\u043E\u0439\u043C\u0430\u0442\u044C \u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C: \u0444\u0438\u043D\u0430\u043B\u0438\u0441\u0442\u044B \u043F\u043E\u0442\u0435\u0440\u044F\u043B\u0438 \u0431\u0430\u0433\u0430\u0436. \u0411\u0443\u043D\u043A\u0435\u0440 \u0432\u044B\u0436\u0438\u043B: ${names}.` : `\u0414\u043E\u043C\u043E\u0432\u043E\u0433\u043E \u043F\u043E\u0439\u043C\u0430\u0442\u044C \u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C: \u0444\u0438\u043D\u0430\u043B\u0438\u0441\u0442\u044B \u043F\u043E\u0442\u0435\u0440\u044F\u043B\u0438 \u0431\u0430\u0433\u0430\u0436, \u043D\u043E \u043E\u0441\u0442\u0430\u043B\u0438\u0441\u044C \u0436\u0438\u0432\u044B. \u0411\u0443\u043D\u043A\u0435\u0440 \u0432\u044B\u0436\u0438\u043B: ${names}.`
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
        appendLog(engine, `\u0420\u0430\u0443\u043D\u0434 1: \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0430 \u043A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \xAB${firstCard.title}\xBB.`);
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
      appendLog(engine, `\u0420\u0430\u0443\u043D\u0434 ${round}: \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0430 \u043A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \xAB${card.title}\xBB.`);
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
        ...engine.extraScenarios.bunker ?? []
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
    const canActivateBunkerCards = !engine.pendingSpecialChoice && !engine.pendingSecretShare && !engine.pendingBunkerVote;
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
      ...(engine.extraScenarios?.bunker ?? []).map((card2) => card2.title),
      ...bunkerCardHistoryTitles(engine),
      ...additionalExcludedTitles
    ].filter(Boolean));
    const card = drawDistinctScenarioCard("bunker", [...visibleTitles], () => engineRandom(engine));
    rememberBunkerCard(engine, card);
    return card;
  }
  function rememberBunkerCard(engine, scenario) {
    if (!scenario) return 0;
    const reference = scenario.removedCardTitle ? { title: scenario.removedCardTitle } : scenario;
    const card = findScenarioCard("bunker", reference);
    const cardId = Number(card?.id ?? scenario.cardId ?? 0);
    if (!cardId) return 0;
    engine.bunkerCardHistory ??= {};
    engine.bunkerCardHistory[cardId] = true;
    return cardId;
  }
  function bunkerCardHistoryTitles(engine) {
    return Object.entries(engine.bunkerCardHistory ?? {}).filter(([, drawn]) => Boolean(drawn)).map(([cardId]) => findScenarioCard("bunker", { cardId: Number(cardId) })?.title).filter(Boolean);
  }
  function engineRandom(engine) {
    const current = Number(engine.randomState ?? 1) >>> 0;
    engine.randomState = Math.imul(current || 1, 1664525) + 1013904223 >>> 0;
    return engine.randomState / 4294967296;
  }
  function activateBunkerCard(engine, scenario, sourceTarget) {
    const cardId = Number(scenario?.cardId ?? 0);
    if (!INTERACTIVE_BUNKER_CARD_IDS.has(cardId)) return;
    scenario.instanceId ??= nextBunkerCardInstanceId(engine);
    engine.bunkerEffectResults ??= {};
    if (engine.bunkerEffectResults[scenario.instanceId]) return;
    if (cardId === 51 || cardId === 52) {
      const activeIds2 = activePlayerIds(engine);
      const targetId = randomPlayerId(
        activeIds2,
        () => engineRandom(engine)
      );
      if (!targetId) {
        setBunkerEffectResult(engine, scenario, "resolved", "\u042D\u0444\u0444\u0435\u043A\u0442 \u043D\u0435 \u0441\u0440\u0430\u0431\u043E\u0442\u0430\u043B: \u043D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0438\u0433\u0440\u043E\u043A\u043E\u0432.");
        return;
      }
      const health = cardId === 51 ? "\u041E\u0433\u043D\u0435\u0441\u0442\u0440\u0435\u043B\u044C\u043D\u043E\u0435 \u0440\u0430\u043D\u0435\u043D\u0438\u0435" : "\u0417\u043E\u043E\u0444\u0438\u043B\u0438\u044F";
      const healthRevealed = replaceTrait(engine, targetId, "health", health, true);
      const message2 = healthRevealed ? `${engine.players[targetId].name}: \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u043E \u043D\u0430 \xAB${health}\xBB.` : `${engine.players[targetId].name}: \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u043E, \u043D\u043E \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u043E\u0431\u044B\u0447\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u0441\u043A\u0440\u044B\u0442\u043E\u0439.`;
      setBunkerEffectResult(engine, scenario, "resolved", message2);
      appendLog(engine, `\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u2116${cardId} \u0441\u0440\u0430\u0431\u043E\u0442\u0430\u043B\u0430. ${message2}`);
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
    const message = cardId === 1 ? "\u0412 \u0444\u0438\u043D\u0430\u043B\u0435 \u044D\u0442\u0430 \u043A\u0430\u0440\u0442\u0430 \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u0443\u0435\u0442 \u043E\u0434\u043D\u0443 \u0443\u0433\u0440\u043E\u0437\u0443." : cardId === 4 ? "\u0412 \u0444\u0438\u043D\u0430\u043B\u0435 \u044D\u0442\u0430 \u043A\u0430\u0440\u0442\u0430 \u0434\u043E\u0431\u0430\u0432\u0438\u0442 \u0435\u0449\u0451 \u043E\u0434\u043D\u0443 \u0443\u0433\u0440\u043E\u0437\u0443." : cardId === 59 ? "\u0412 \u0444\u0438\u043D\u0430\u043B\u0435 \u043E\u0434\u043D\u0430 \u0443\u0433\u0440\u043E\u0437\u0430 \u0431\u0443\u0434\u0435\u0442 \u0437\u0430\u043C\u0435\u043D\u0435\u043D\u0430 \u043D\u043E\u0432\u043E\u0439." : "\u0421\u043B\u0443\u0447\u0430\u0439\u043D\u044B\u0439 \u0438\u0441\u0445\u043E\u0434 \u044D\u0442\u043E\u0439 \u043A\u0430\u0440\u0442\u044B \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0438\u0442\u0441\u044F \u0432 \u0444\u0438\u043D\u0430\u043B\u0435.";
    setBunkerEffectResult(engine, scenario, "awaiting_final", message);
    appendLog(engine, `\u0410\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u043D\u0430 \u0438\u043D\u0442\u0435\u0440\u0430\u043A\u0442\u0438\u0432\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u2116${cardId}. ${message}`);
  }
  function setBunkerEffectResult(engine, scenario, status, message, outcome = "") {
    engine.bunkerEffectResults ??= {};
    const instanceId = scenario?.instanceId;
    if (!instanceId) return;
    engine.bunkerEffectResults[instanceId] = {
      cardId: Number(scenario.cardId ?? 0),
      status,
      message,
      ...outcome ? { outcome } : {}
    };
  }
  function setBunkerEffectResultByInstance(engine, instanceId, status, message, outcome = "") {
    const current = engine.bunkerEffectResults?.[instanceId] ?? {};
    engine.bunkerEffectResults ??= {};
    engine.bunkerEffectResults[instanceId] = {
      cardId: Number(current.cardId ?? findBunkerScenarioByInstance(engine, instanceId)?.cardId ?? 0),
      status,
      message,
      ...outcome ? { outcome } : {}
    };
  }
  function queueBunkerVote(engine, scenario, sourceTarget, type) {
    const voterIds = activePlayerIds(engine);
    const candidateIds = type === "king" ? engine.order.filter((id) => engine.players[id]?.status !== "dead") : voterIds.filter((id) => !engine.players[id]?.bunkerKing && !engine.players[id]?.immuneThisRound);
    if (!voterIds.length || !candidateIds.length) {
      const message = "\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u043D\u0435\u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E: \u043D\u0435\u0442 \u043F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0438\u0445 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432.";
      setBunkerEffectResult(engine, scenario, "resolved", message, "no_candidates");
      appendLog(engine, message);
      return;
    }
    const vote2 = {
      type,
      sourceTarget,
      sourceInstanceId: scenario.instanceId,
      candidateIds,
      voterIds,
      votes: {},
      revote: false
    };
    engine.bunkerVoteQueue ??= [];
    if (engine.pendingBunkerVote) engine.bunkerVoteQueue.push(vote2);
    else engine.pendingBunkerVote = vote2;
    setBunkerEffectResult(
      engine,
      scenario,
      "voting",
      type === "king" ? "\u0418\u0434\u0451\u0442 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u0437\u0430 \u0446\u0430\u0440\u044F." : "\u0418\u0434\u0451\u0442 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u0437\u0430 \u0436\u0435\u0440\u0442\u0432\u0443."
    );
    appendLog(
      engine,
      type === "king" ? "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211662 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0446\u0430\u0440\u044F \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C." : "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u211653 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0436\u0435\u0440\u0442\u0432\u0443 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C."
    );
  }
  function voteForBunkerEffect(engine, command) {
    const vote2 = engine.pendingBunkerVote;
    if (!vote2) throw new Error("\u0421\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F \u043F\u043E \u043A\u0430\u0440\u0442\u0435 \u0431\u0443\u043D\u043A\u0435\u0440\u0430.");
    refreshBunkerVoteParticipants(engine, vote2);
    const voterId = command.from;
    const targetId = command.data?.targetId;
    if (!vote2.voterIds.includes(voterId) || engine.players[voterId]?.status !== "active") {
      throw new Error("\u0412\u044B \u043D\u0435 \u0443\u0447\u0430\u0441\u0442\u0432\u0443\u0435\u0442\u0435 \u0432 \u044D\u0442\u043E\u043C \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438.");
    }
    if (!vote2.candidateIds.includes(targetId)) throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u043E\u0433\u043E \u043A\u0430\u043D\u0434\u0438\u0434\u0430\u0442\u0430.");
    if (vote2.type === "sacrifice" && (engine.players[targetId]?.status !== "active" || engine.players[targetId]?.bunkerKing || engine.players[targetId]?.immuneThisRound)) {
      throw new Error("\u0412 \u0436\u0435\u0440\u0442\u0432\u0443 \u043C\u043E\u0436\u043D\u043E \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043D\u0435 \u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0446\u0430\u0440\u0451\u043C.");
    }
    vote2.votes[voterId] = targetId;
    appendLog(engine, `${engine.players[voterId].name} \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043B \u0432 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438.`);
  }
  function resolveBunkerVote(engine, command, hostId) {
    if (command.from !== hostId) throw new Error("\u041F\u043E\u0434\u0432\u0435\u0441\u0442\u0438 \u0438\u0442\u043E\u0433 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F \u043C\u043E\u0436\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0435\u0434\u0443\u0449\u0438\u0439.");
    const vote2 = engine.pendingBunkerVote;
    if (!vote2) throw new Error("\u0421\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F \u043F\u043E \u043A\u0430\u0440\u0442\u0435 \u0431\u0443\u043D\u043A\u0435\u0440\u0430.");
    refreshBunkerVoteParticipants(engine, vote2);
    const submittedTargets = Object.entries(vote2.votes ?? {}).filter(([voterId, targetId]) => vote2.voterIds.includes(voterId) && vote2.candidateIds.includes(targetId)).map(([, targetId]) => targetId);
    if (!submittedTargets.length) throw new Error("\u041F\u043E\u043A\u0430 \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043B.");
    const counts = {};
    for (const targetId of submittedTargets) counts[targetId] = (counts[targetId] ?? 0) + 1;
    const maximum = Math.max(...Object.values(counts));
    const leaders = Object.keys(counts).filter((id) => counts[id] === maximum);
    if (leaders.length > 1) {
      vote2.candidateIds = leaders;
      vote2.votes = {};
      vote2.revote = true;
      setBunkerEffectResultByInstance(
        engine,
        vote2.sourceInstanceId,
        "voting",
        "\u041D\u0438\u0447\u044C\u044F. \u0418\u0434\u0451\u0442 \u043F\u0435\u0440\u0435\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u043C\u0435\u0436\u0434\u0443 \u043B\u0438\u0434\u0435\u0440\u0430\u043C\u0438.",
        "tie"
      );
      appendLog(engine, "\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043B\u043E\u0441\u044C \u043D\u0438\u0447\u044C\u0435\u0439. \u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u043F\u0435\u0440\u0435\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435.");
      return;
    }
    const winnerId = leaders[0];
    const winner = engine.players[winnerId];
    delete engine.pendingBunkerVote;
    if (vote2.type === "sacrifice") {
      if (!exilePlayer(engine, winnerId)) {
        engine.pendingBunkerVote = vote2;
        throw new Error("\u0412\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u043D\u0435\u043B\u044C\u0437\u044F \u043F\u0440\u0438\u043D\u0435\u0441\u0442\u0438 \u0432 \u0436\u0435\u0440\u0442\u0432\u0443.");
      }
      const extraCard = addRevealedBunkerCard(engine, drawUniqueBunkerCard(engine), "altar");
      const message = `${winner.name} \u043F\u0440\u0438\u043D\u0435\u0441\u0451\u043D \u0432 \u0436\u0435\u0440\u0442\u0432\u0443. \u041E\u0442\u043A\u0440\u044B\u0442\u0430 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \xAB${extraCard.title}\xBB.`;
      setBunkerEffectResultByInstance(engine, vote2.sourceInstanceId, "resolved", message, "sacrificed");
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
      const message = `${winner.name} \u0432\u044B\u0431\u0440\u0430\u043D \u0446\u0430\u0440\u0451\u043C, \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0451\u043D \u0432 \u0433\u0440\u0443\u043F\u043F\u0443 \u0438 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u0438\u0437\u0433\u043D\u0430\u043D.`;
      setBunkerEffectResultByInstance(engine, vote2.sourceInstanceId, "resolved", message, "king_chosen");
      appendLog(engine, message);
      repairCurrentTurn(engine);
    }
    if (!engine.pendingBunkerVote) promoteNextBunkerVote(engine);
  }
  function refreshBunkerVoteParticipants(engine, vote2, rebuild = false) {
    const activeIds2 = activePlayerIds(engine);
    const eligibleVoters = new Set(activeIds2);
    const eligibleCandidates = new Set(vote2.type === "king" ? engine.order.filter((id) => engine.players[id]?.status !== "dead") : activeIds2.filter((id) => !engine.players[id]?.bunkerKing && !engine.players[id]?.immuneThisRound));
    vote2.voterIds = rebuild ? [...eligibleVoters] : (vote2.voterIds ?? []).filter((id) => eligibleVoters.has(id));
    vote2.candidateIds = rebuild && !vote2.revote ? [...eligibleCandidates] : (vote2.candidateIds ?? []).filter((id) => eligibleCandidates.has(id));
    vote2.votes = Object.fromEntries(Object.entries(vote2.votes ?? {}).filter(
      ([voterId, targetId]) => vote2.voterIds.includes(voterId) && vote2.candidateIds.includes(targetId)
    ));
  }
  function promoteNextBunkerVote(engine) {
    while (!engine.pendingBunkerVote && engine.bunkerVoteQueue?.length) {
      const next = engine.bunkerVoteQueue.shift();
      refreshBunkerVoteParticipants(engine, next, true);
      if (!next.voterIds.length || !next.candidateIds.length) {
        const message = "\u041E\u0442\u043B\u043E\u0436\u0435\u043D\u043D\u043E\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E: \u043F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0438\u0445 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435\u0442.";
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
        next.type === "king" ? "\u0418\u0434\u0451\u0442 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u0437\u0430 \u0446\u0430\u0440\u044F." : "\u0418\u0434\u0451\u0442 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u0437\u0430 \u0436\u0435\u0440\u0442\u0432\u0443."
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
    if (command.from !== hostId) throw new Error("\u0420\u0430\u0441\u043A\u0440\u044B\u0432\u0430\u0442\u044C \u0443\u0441\u043B\u043E\u0432\u0438\u044F \u043C\u043E\u0436\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0435\u0434\u0443\u0449\u0438\u0439.");
    if ([PHASES.THREAT, PHASES.FINISHED].includes(engine.phase)) {
      throw new Error("\u041F\u043E\u0441\u043B\u0435 \u043D\u0430\u0447\u0430\u043B\u0430 \u0444\u0438\u043D\u0430\u043B\u044C\u043D\u043E\u0439 \u0443\u0433\u0440\u043E\u0437\u044B \u043A\u0430\u0440\u0442\u044B \u0443\u0441\u043B\u043E\u0432\u0438\u0439 \u043C\u0435\u043D\u044F\u0442\u044C \u043D\u0435\u043B\u044C\u0437\u044F.");
    }
    const scenarioType = command.data?.scenarioType;
    if (!["catastrophe", "bunker", "threat"].includes(scenarioType)) {
      throw new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0442\u0438\u043F \u0441\u0446\u0435\u043D\u0430\u0440\u0438\u044F.");
    }
    if (engine[scenarioType]?.status !== "hidden") throw new Error("\u042D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443 \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u043B\u044C\u0437\u044F \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044C.");
    const secret = engine.scenarioSecrets?.[scenarioType];
    if (!secret) throw new Error("\u0414\u0430\u043D\u043D\u044B\u0435 \u0441\u0446\u0435\u043D\u0430\u0440\u0438\u044F \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B.");
    engine[scenarioType] = {
      status: "revealed",
      cardId: Number(secret.id ?? 0),
      ...scenarioType === "bunker" ? {
        instanceId: nextBunkerCardInstanceId(engine),
        revealedRound: Number(engine.round ?? 1)
      } : {},
      title: secret.title,
      description: secret.description
    };
    appendLog(engine, `\u0420\u0430\u0441\u043A\u0440\u044B\u0442\u0430 \u043A\u0430\u0440\u0442\u0430 \xAB${secret.title}\xBB.`);
    if (scenarioType === "bunker") activateBunkerCard(engine, engine.bunker, "primary:bunker");
  }
  function hostEdit(engine, command, hostId) {
    if (command.from !== hostId) throw new Error("\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u0430\u0440\u0442\u0438\u044E \u043C\u043E\u0436\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0435\u0434\u0443\u0449\u0438\u0439.");
    if ([PHASES.THREAT, PHASES.FINISHED].includes(engine.phase)) {
      throw new Error("\u041F\u043E\u0441\u043B\u0435 \u043D\u0430\u0447\u0430\u043B\u0430 \u0444\u0438\u043D\u0430\u043B\u044C\u043D\u043E\u0439 \u0443\u0433\u0440\u043E\u0437\u044B \u0440\u0435\u0434\u0430\u043A\u0442\u043E\u0440 \u043F\u0430\u0440\u0442\u0438\u0438 \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D.");
    }
    const action = command.data?.action;
    if (action === "set_capacity") {
      const capacity = Number(command.data?.capacity);
      if (!Number.isInteger(capacity) || capacity < 1 || capacity >= engine.order.length) {
        throw new Error("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E\u0435 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u043C\u0435\u0441\u0442 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435.");
      }
      engine.capacity = capacity;
      const voteIsStillOpen = engine.phase === PHASES.VOTING || engine.phase === PHASES.RESULTS && engine.voteResult?.status === "tie";
      if (voteIsStillOpen && activePlayerIds(engine).length <= capacity) {
        engine.phase = PHASES.DISCUSSION;
        engine.currentPlayerIndex = -1;
        engine.voteResult = emptyVoteResult();
        resetSingleVoteEffects(engine);
        resetVotes(engine);
        delete engine.preVotingResultSnapshot;
        appendLog(engine, "\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E: \u043F\u043E\u0441\u043B\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0432\u043C\u0435\u0441\u0442\u0438\u043C\u043E\u0441\u0442\u0438 \u043C\u0435\u0441\u0442 \u0445\u0432\u0430\u0442\u0430\u0435\u0442 \u0432\u0441\u0435\u043C \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u043C \u0438\u0433\u0440\u043E\u043A\u0430\u043C.");
      }
      appendLog(engine, `\u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u0438\u0437\u043C\u0435\u043D\u0438\u043B \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u043C\u0435\u0441\u0442 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435: ${capacity}.`);
      return;
    }
    if (action === "set_special") {
      const playerId = command.data?.playerId;
      const specialId = Number(command.data?.specialId);
      const player = engine.players?.[playerId];
      const special = SPECIAL_CARDS.find((card) => card.id === specialId);
      if (!player || !special) throw new Error("\u0418\u0433\u0440\u043E\u043A \u0438\u043B\u0438 \u043E\u0441\u043E\u0431\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B.");
      engine.characters[playerId].special = special.text;
      engine.characters[playerId].specialId = special.id;
      player.specialUsed = false;
      player.revealedTraits.special = command.data?.revealed === true ? special.text : "";
      appendLog(engine, `\u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u0432\u044B\u0434\u0430\u043B \u0438\u0433\u0440\u043E\u043A\u0443 ${player.name} \u043E\u0441\u043E\u0431\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u2116${special.id}${command.data?.revealed ? `: ${special.text}` : ""}.`);
      return;
    }
    if (action === "set_trait" || action === "random_trait") {
      const playerId = command.data?.playerId;
      const trait = command.data?.trait;
      const player = engine.players?.[playerId];
      if (!player || !TRAIT_KEYS.includes(trait)) throw new Error("\u0418\u0433\u0440\u043E\u043A \u0438\u043B\u0438 \u0442\u0438\u043F \u043A\u0430\u0440\u0442\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D.");
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
      if (!value) throw new Error("\u0417\u043D\u0430\u0447\u0435\u043D\u0438\u0435 \u043A\u0430\u0440\u0442\u044B \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u043F\u0443\u0441\u0442\u044B\u043C.");
      const revealRequested = wasRevealed || command.data?.revealed === true;
      if (revealRequested && !wasRevealed && trait !== "special" && !canRevealTrait(player, trait)) {
        throw new Error("\u0423 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u0434\u043E\u043B\u0436\u043D\u0430 \u043E\u0441\u0442\u0430\u0442\u044C\u0441\u044F \u043E\u0434\u043D\u0430 \u0441\u043A\u0440\u044B\u0442\u0430\u044F \u043E\u0431\u044B\u0447\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430.");
      }
      engine.characters[playerId][trait] = value;
      if (trait === "special" && action === "set_trait") engine.characters[playerId].specialId = 0;
      if (trait === "special") player.specialUsed = false;
      if (revealRequested) {
        player.revealedTraits[trait] = value;
        if (!wasRevealed) recordFirstReveal(engine, playerId, trait);
      } else player.revealedTraits[trait] = "";
      appendLog(engine, `\u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u0438\u0437\u043C\u0435\u043D\u0438\u043B \u043A\u0430\u0440\u0442\u0443 \xAB${TRAIT_LABELS[trait]}\xBB \u0438\u0433\u0440\u043E\u043A\u0430 ${player.name}${revealRequested ? `: ${value}` : ""}.`);
      return;
    }
    if (action === "set_status") {
      const player = engine.players?.[command.data?.playerId];
      const status = command.data?.status;
      if (!player || !["active", "exiled"].includes(status)) throw new Error("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u0441\u0442\u0430\u0442\u0443\u0441 \u0438\u0433\u0440\u043E\u043A\u0430.");
      if (status === "exiled" && player.bunkerKing) throw new Error("\u0426\u0430\u0440\u044F \u043D\u0435\u043B\u044C\u0437\u044F \u0438\u0437\u0433\u043D\u0430\u0442\u044C \u0438\u0437 \u0431\u0443\u043D\u043A\u0435\u0440\u0430.");
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
      appendLog(engine, `\u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u0438\u0437\u043C\u0435\u043D\u0438\u043B \u0441\u0442\u0430\u0442\u0443\u0441 \u0438\u0433\u0440\u043E\u043A\u0430 ${player.name}: ${status === "active" ? "\u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0451\u043D \u0432 \u0438\u0433\u0440\u0443" : "\u0438\u0437\u0433\u043D\u0430\u043D"}.`);
      return;
    }
    if (action === "add_scenario") {
      const type = command.data?.scenarioType;
      if (!["catastrophe", "bunker", "threat"].includes(type)) throw new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0442\u0438\u043F \u043A\u0430\u0440\u0442\u044B \u0443\u0441\u043B\u043E\u0432\u0438\u0439.");
      const randomCard = command.data?.random === true ? type === "bunker" ? drawUniqueBunkerCard(engine) : drawScenarioCard(type, () => engineRandom(engine)) : null;
      const title = String(randomCard?.title ?? command.data?.title ?? "").trim();
      const description = String(randomCard?.description ?? command.data?.description ?? "").trim();
      if (!title || !description) throw new Error("\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0438 \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u043A\u0430\u0440\u0442\u044B.");
      engine.extraScenarios ??= {};
      engine.extraScenarios[type] ??= [];
      const card = {
        id: `extra_${Date.now()}_${engine.revision}`,
        ...randomCard ? { cardId: Number(randomCard.id ?? 0) } : {},
        ...type === "bunker" ? {
          instanceId: nextBunkerCardInstanceId(engine),
          revealedRound: Number(engine.round ?? 1)
        } : {},
        title,
        description
      };
      if (type === "bunker") rememberBunkerCard(engine, card);
      engine.extraScenarios[type].push(card);
      appendLog(engine, `\u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u0434\u043E\u0431\u0430\u0432\u0438\u043B \u043A\u0430\u0440\u0442\u0443 \xAB${title}\xBB.`);
      if (type === "bunker") activateBunkerCard(engine, card, `extra:bunker:${card.id}`);
      return;
    }
    if (action === "remove_scenario") {
      const type = command.data?.scenarioType;
      const cards = engine.extraScenarios?.[type];
      const cardIndex = cards?.findIndex((card) => card.id === command.data?.cardId) ?? -1;
      if (cardIndex < 0) throw new Error("\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430.");
      const [removed] = cards.splice(cardIndex, 1);
      appendLog(engine, `\u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u0443\u0431\u0440\u0430\u043B \u043A\u0430\u0440\u0442\u0443 \xAB${removed.title}\xBB.`);
      return;
    }
    if (action === "remove_primary_scenario") {
      const type = command.data?.scenarioType;
      if (!["catastrophe", "bunker", "threat"].includes(type)) throw new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0442\u0438\u043F \u043A\u0430\u0440\u0442\u044B \u0443\u0441\u043B\u043E\u0432\u0438\u0439.");
      const removedTitle = engine[type]?.title ?? "\u041A\u0430\u0440\u0442\u0430 \u0443\u0441\u043B\u043E\u0432\u0438\u0439";
      engine[type] = removedScenario(
        type === "catastrophe" ? "\u041A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u0430" : type === "bunker" ? "\u0411\u0443\u043D\u043A\u0435\u0440" : "\u0423\u0433\u0440\u043E\u0437\u0430",
        removedTitle,
        "\u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u0443\u0431\u0440\u0430\u043B \u044D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443 \u0438\u0437 \u043F\u0430\u0440\u0442\u0438\u0438."
      );
      appendLog(engine, `\u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u0443\u0431\u0440\u0430\u043B \u043A\u0430\u0440\u0442\u0443 \xAB${removedTitle}\xBB.`);
      return;
    }
    throw new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0440\u0435\u0434\u0430\u043A\u0442\u043E\u0440\u0430 \u0432\u0435\u0434\u0443\u0449\u0435\u0433\u043E.");
  }
  function playSpecial(engine, command) {
    const playerId = command.from;
    const player = engine.players?.[playerId];
    const character = engine.characters?.[playerId];
    const specialId = Number(character?.specialId ?? 0);
    if (!player || !character) throw new Error("\u041F\u0435\u0440\u0441\u043E\u043D\u0430\u0436 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D.");
    if (player.specialUsed) throw new Error("\u041E\u0441\u043E\u0431\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u0443\u0436\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0430.");
    if (!specialId) throw new Error("\u041E\u0441\u043E\u0431\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u043D\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u0430.");
    const resolvingPendingChoice = specialId === 54 && engine.pendingSpecialChoice?.playerId === playerId;
    if (!resolvingPendingChoice) {
      const availability = getSpecialAvailability(engine, playerId, specialId);
      if (!availability.allowed) throw new Error(availability.reason);
    } else if ([PHASES.THREAT, PHASES.FINISHED].includes(engine.phase)) {
      throw new Error("\u0424\u0438\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430 \u0443\u0436\u0435 \u043D\u0430\u0447\u0430\u043B\u0430\u0441\u044C.");
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
      if (!target || target.status !== "active") throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u0434\u043B\u044F \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u043A\u0430\u0440\u0442\u044B.");
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
      if (player.status !== "exiled") throw new Error("\u042D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443 \u043C\u043E\u0436\u043D\u043E \u0441\u044B\u0433\u0440\u0430\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0441\u043B\u0435 \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u044F.");
      const removed = removeBunkerTarget(
        engine,
        scenarioTarget,
        "\u041A\u0430\u0440\u0442\u0430 \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0435\u043D\u0430 \u043A \u0438\u0437\u0433\u043D\u0430\u043D\u043D\u044B\u043C \u0438 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u043F\u043E\u043C\u043E\u0433\u0430\u0435\u0442 \u0444\u0438\u043D\u0430\u043B\u0438\u0441\u0442\u0430\u043C."
      );
      addExtraScenario(engine, "exile", `\u0423 \u0438\u0437\u0433\u043D\u0430\u043D\u043D\u044B\u0445: ${removed.title}`, removed.description);
    } else if (specialId === 2) {
      requireTarget().cannotVoteAgainst ??= {};
      target.cannotVoteAgainst[playerId] = true;
    } else if (specialId === 3) {
      const card = drawUniqueBunkerCard(engine);
      replaceBunkerTarget(engine, scenarioTarget, card);
    } else if (specialId === 4) {
      player.voteMultiplier = 2;
    } else if (specialId >= 5 && specialId <= 9) {
      shuffleRevealedTrait(engine, { 5: "baggage", 6: "biology", 7: "hobby", 8: "health", 9: "fact" }[specialId]);
    } else if (specialId === 10) {
      linkProtection(engine, playerId, neighborId(engine, playerId, -1));
    } else if (specialId === 11) {
      if (player.status !== "exiled") throw new Error("\u042D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443 \u043C\u043E\u0436\u043D\u043E \u0441\u044B\u0433\u0440\u0430\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0441\u043B\u0435 \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u044F.");
      removeBunkerTarget(engine, scenarioTarget, "\u041A\u0430\u0440\u0442\u0430 \u0441\u0431\u0440\u043E\u0448\u0435\u043D\u0430 \u0434\u0438\u0432\u0435\u0440\u0441\u0438\u0435\u0439 \u0438 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430.");
    } else if (specialId === 12) {
      requireTarget().voteDisabled = true;
    } else if (specialId === 13) {
      const protectedId = engine.firstReveal?.health ?? engine.order.find((id) => engine.players[id].revealedTraits?.health);
      if (!protectedId) throw new Error("\u041F\u043E\u043A\u0430 \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u043B \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u0435.");
      linkProtection(engine, playerId, protectedId);
    } else if (specialId === 14) {
      linkProtection(engine, playerId, neighborId(engine, playerId, 1));
    } else if (specialId === 15 || specialId === 19) {
      const ages = activePlayerIds(engine).map((id) => ({ id, age: Number(engine.players[id].revealedTraits?.biology?.match(/\d+/)?.[0]) })).filter((item) => Number.isFinite(item.age));
      if (!ages.length) throw new Error("\u041D\u0435\u0442 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B\u0445 \u0431\u0438\u043E\u0434\u0430\u043D\u043D\u044B\u0445 \u0441 \u0432\u043E\u0437\u0440\u0430\u0441\u0442\u043E\u043C.");
      ages.sort((a, b) => specialId === 15 ? a.age - b.age : b.age - a.age);
      linkProtection(engine, playerId, ages[0].id);
    } else if ([16, 17, 21, 22, 23].includes(specialId)) {
      const swapTrait = { 16: "baggage", 17: "biology", 21: "hobby", 22: "health", 23: "fact" }[specialId];
      swapNeighborTrait(engine, playerId, targetId, swapTrait);
    } else if (specialId === 18) {
      const victim = requireTarget();
      if (victim.id === playerId) throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430.");
      character.baggage = victim.revealedTraits?.baggage || engine.characters[targetId].baggage;
      if (player.revealedTraits.baggage) player.revealedTraits.baggage = character.baggage;
      engine.characters[targetId].baggage = "\u0411\u0430\u0433\u0430\u0436 \u0437\u0430\u0431\u0440\u0430\u043B\u0438 \u043E\u0441\u043E\u0431\u043E\u0439 \u043A\u0430\u0440\u0442\u043E\u0439";
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
      if (player.status !== "exiled") throw new Error("\u042D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443 \u043C\u043E\u0436\u043D\u043E \u0441\u044B\u0433\u0440\u0430\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0441\u043B\u0435 \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u044F.");
      addExtraScenario(
        engine,
        "threat",
        "\u041D\u0430\u043B\u0451\u0442 \u043C\u0430\u0440\u043E\u0434\u0451\u0440\u043E\u0432",
        "\u0411\u0430\u043D\u0434\u0430 \u043C\u0430\u0440\u043E\u0434\u0451\u0440\u043E\u0432 \u0443\u0437\u043D\u0430\u043B\u0430 \u043E \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0438 \u0443\u0433\u0440\u043E\u0436\u0430\u0435\u0442 \u0444\u0438\u043D\u0430\u043B\u0438\u0441\u0442\u0430\u043C.",
        { hiddenUntilFinal: true }
      );
    } else if (specialId === 25) {
      const healthTarget = requireTarget();
      if (!healthTarget.revealedTraits?.health) {
        throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u0433\u0440\u043E\u043A\u0430 \u0441 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0439 \u043A\u0430\u0440\u0442\u043E\u0439 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F.");
      }
      replaceTrait(engine, healthTarget.id, "health", drawTraitCard("health", () => engineRandom(engine)));
    } else if (specialId === 26) {
      if (!TRAIT_KEYS.includes(trait) || trait === "special") throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0438\u043F \u043E\u0431\u044B\u0447\u043D\u043E\u0439 \u043A\u0430\u0440\u0442\u044B.");
      engine.roundEffects ??= {};
      engine.roundEffects.forcedTrait = trait;
    } else if (specialId === 27) {
      replaceTrait(engine, requireTarget().id, "health", "\u0418\u0434\u0435\u0430\u043B\u044C\u043D\u043E \u0437\u0434\u043E\u0440\u043E\u0432");
    } else if (specialId === 28) {
      if (engine.phase === PHASES.RESULTS) {
        const resultSnapshot = snapshot;
        const votingSnapshot = engine.preVotingResultSnapshot;
        if (!votingSnapshot) throw new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0434\u043E \u043F\u043E\u0434\u0441\u0447\u0451\u0442\u0430 \u0433\u043E\u043B\u043E\u0441\u043E\u0432.");
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
        appendLog(engine, `${restoredPlayer.name} \u0440\u0430\u0437\u044B\u0433\u0440\u044B\u0432\u0430\u0435\u0442 \xAB\u041F\u043B\u0430\u043D \u0411\xBB: \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043E\u0442\u043C\u0435\u043D\u0451\u043D, \u043D\u0430\u0447\u0438\u043D\u0430\u0435\u0442\u0441\u044F \u043D\u043E\u0432\u043E\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435.`);
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
        throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u0433\u0440\u043E\u043A\u0430 \u0441 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0439 \u043A\u0430\u0440\u0442\u043E\u0439 \u043F\u0440\u043E\u0444\u0435\u0441\u0441\u0438\u0438.");
      }
      replaceTrait(engine, professionTarget.id, "profession", drawTraitCard("profession", () => engineRandom(engine)));
    } else if (specialId === 30) {
      if (player.status !== "exiled") throw new Error("\u042D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443 \u043C\u043E\u0436\u043D\u043E \u0441\u044B\u0433\u0440\u0430\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0441\u043B\u0435 \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u044F.");
      if (engine.capacity <= 1) throw new Error("\u0412\u043C\u0435\u0441\u0442\u0438\u043C\u043E\u0441\u0442\u044C \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0443\u0436\u0435 \u043D\u0435\u043B\u044C\u0437\u044F \u0443\u043C\u0435\u043D\u044C\u0448\u0438\u0442\u044C.");
      engine.capacity = Math.max(1, engine.capacity - 1);
      appendLog(engine, `\u041F\u043E\u0441\u043B\u0435 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0439 \u0434\u0438\u0432\u0435\u0440\u0441\u0438\u0438 \u0432\u043C\u0435\u0441\u0442\u0438\u043C\u043E\u0441\u0442\u044C \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0443\u043C\u0435\u043D\u044C\u0448\u0435\u043D\u0430 \u0434\u043E ${engine.capacity}.`);
    } else if (specialId >= 31 && specialId <= 36) {
      const ownTrait = specialId === 31 ? trait : { 32: "biology", 33: "hobby", 34: "baggage", 35: "fact", 36: "profession" }[specialId];
      if (!TRAIT_KEYS.includes(ownTrait) || ownTrait === "special") throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u0430\u0440\u0442\u0443 \u0434\u043B\u044F \u0437\u0430\u043C\u0435\u043D\u044B.");
      replaceTrait(engine, playerId, ownTrait, drawTraitCard(ownTrait, () => engineRandom(engine)));
    } else if (specialId === 37) {
      const health = character.health;
      for (const id of activePlayerIds(engine)) replaceTrait(engine, id, "health", health);
    } else if (specialId === 38) {
      if (player.status !== "exiled") throw new Error("\u042D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443 \u043C\u043E\u0436\u043D\u043E \u0441\u044B\u0433\u0440\u0430\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0441\u043B\u0435 \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u044F.");
      const exileTarget = requireTarget();
      if (exileTarget.bunkerKing) throw new Error("\u0426\u0430\u0440\u044F \u043D\u0435\u043B\u044C\u0437\u044F \u0438\u0437\u0433\u043D\u0430\u0442\u044C \u0438\u0437 \u0431\u0443\u043D\u043A\u0435\u0440\u0430.");
      exilePlayer(engine, exileTarget.id);
    } else if (specialId === 39) {
      player.persistentVoter = true;
    } else if (specialId === 40) {
      player.secondChance = true;
    } else if (specialId === 41) {
      const other = requireTarget();
      if (other.id === playerId) throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u0434\u043B\u044F \u0437\u0430\u0440\u0430\u0436\u0435\u043D\u0438\u044F.");
      replaceTrait(engine, playerId, "health", "\u0427\u0443\u043C\u0430");
      replaceTrait(engine, other.id, "health", "\u0427\u0443\u043C\u0430");
    } else if (specialId === 42) {
      const other = requireTarget();
      if (other.id === playerId) throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430.");
      replaceTrait(engine, other.id, "health", "\u0418\u0434\u0435\u0430\u043B\u044C\u043D\u043E \u0437\u0434\u043E\u0440\u043E\u0432");
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
      appendLog(engine, "\u0410\u0431\u0441\u043E\u043B\u044E\u0442\u043D\u044B\u0439 \u0445\u0430\u043E\u0441 \u0437\u0430\u043C\u0435\u043D\u0438\u043B \u0432\u0441\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B\u0435 \u043E\u0431\u044B\u0447\u043D\u044B\u0435 \u043A\u0430\u0440\u0442\u044B \u043D\u043E\u0432\u044B\u043C\u0438 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u044B\u043C\u0438 \u043A\u0430\u0440\u0442\u0430\u043C\u0438.");
    } else if (specialId === 44) {
      const other = requireTarget();
      const biology = other.revealedTraits?.biology;
      if (!biology) {
        throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u0433\u0440\u043E\u043A\u0430 \u0441 \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u043C\u0438 \u0431\u0438\u043E\u0434\u0430\u043D\u043D\u044B\u043C\u0438, \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u0449\u0438\u043C\u0438 \u0432\u043E\u0437\u0440\u0430\u0441\u0442.");
      }
      const match = biology.match(/\d+/);
      if (!match) throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u0433\u0440\u043E\u043A\u0430 \u0441 \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u043C\u0438 \u0431\u0438\u043E\u0434\u0430\u043D\u043D\u044B\u043C\u0438, \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u0449\u0438\u043C\u0438 \u0432\u043E\u0437\u0440\u0430\u0441\u0442.");
      replaceTrait(engine, other.id, "biology", biology.replace(match[0], [...match[0]].reverse().join("")));
    } else if (specialId === 45) {
      const marked = requireTarget();
      const personalThreat = drawUniqueThreatCard(engine);
      addExtraScenario(
        engine,
        "threat",
        `\u041B\u0438\u0447\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430 \u0434\u043B\u044F ${marked.name}: ${personalThreat.title}`,
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
        `${character.baggage}; \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E: ${drawTraitCard("baggage", () => engineRandom(engine))}`,
        true
      );
    } else if (specialId === 48) {
      player.ignoreVotesIfEven = true;
    } else if (specialId === 49) {
      const linked = requireTarget();
      if (linked.id === playerId) throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430.");
      player.linkedExileTarget = linked.id;
    } else if (specialId === 51) {
      player.selfPenaltyAgainst = true;
    } else if (specialId === 52) {
      player.loneVoteTriple = true;
    } else if (specialId === 53) {
      applyAgeVoteMultiplier(engine, choice);
    } else if (specialId === 55) {
      const other = requireTarget();
      if (other.id === playerId) throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430.");
      player.soulSwapTarget = other.id;
    } else if (specialId === 56) {
      const other = requireTarget();
      if (other.id === playerId) throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430.");
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
      engine.roundEffects.missingTraitBonuses.push({ 59: "health", 61: "baggage", 62: "biology", 63: "fact" }[specialId]);
    } else if (specialId === 60) {
      for (const id of activePlayerIds(engine)) revealRandomHiddenTrait(engine, id);
    } else if (specialId === 64) {
      const targetScenario = getOpenBunkerTarget(engine, scenarioTarget);
      if (!targetScenario) throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0443\u044E \u043E\u0442\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0431\u0443\u043D\u043A\u0435\u0440\u0430.");
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
        throw new Error("\u0414\u043B\u044F \xAB\u0421\u043F\u043B\u0435\u0442\u0435\u043D\xBB \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0443\u044E \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0443, \u043A\u043E\u0442\u043E\u0440\u0443\u044E \u043C\u043E\u0436\u043D\u043E \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044C \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u043C \u0444\u0430\u043A\u0442\u043E\u043C.");
      }
      revealSpecificTrait(engine, other.id, chosenTrait);
      replaceTrait(
        engine,
        other.id,
        "fact",
        `${engine.characters[other.id].fact}; \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0444\u0430\u043A\u0442: ${drawTraitCard("fact", () => engineRandom(engine))}`,
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
      secretSpecial ? `${player.name} \u0442\u0430\u0439\u043D\u043E \u0430\u043A\u0442\u0438\u0432\u0438\u0440\u0443\u0435\u0442 \u0437\u0430\u0449\u0438\u0442\u043D\u0443\u044E \u043E\u0441\u043E\u0431\u0443\u044E \u043A\u0430\u0440\u0442\u0443.` : `${player.name} \u0440\u0430\u0437\u044B\u0433\u0440\u044B\u0432\u0430\u0435\u0442 \u043E\u0441\u043E\u0431\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u2116${specialId}: ${character.special}.${automatic ? " \u042D\u0444\u0444\u0435\u043A\u0442 \u043F\u0440\u0438\u043C\u0435\u043D\u0451\u043D \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438." : " \u042D\u0444\u0444\u0435\u043A\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0430\u0435\u0442 \u0432\u0435\u0434\u0443\u0449\u0438\u0439 \u0447\u0435\u0440\u0435\u0437 \u0440\u0435\u0434\u0430\u043A\u0442\u043E\u0440 \u043F\u0430\u0440\u0442\u0438\u0438."}`
    );
  }
  function replaceTrait(engine, playerId, trait, value, reveal = false) {
    const player = engine.players[playerId];
    const wasRevealed = Boolean(player?.revealedTraits?.[trait]);
    engine.characters[playerId][trait] = value;
    if (wasRevealed || reveal && canRevealTrait(player, trait)) {
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
    if (ids.length < 2) throw new Error("\u0414\u043B\u044F \u043F\u0435\u0440\u0435\u0440\u0430\u0437\u0434\u0430\u0447\u0438 \u043D\u0443\u0436\u043D\u044B \u0445\u043E\u0442\u044F \u0431\u044B \u0434\u0432\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0435 \u043A\u0430\u0440\u0442\u044B \u044D\u0442\u043E\u0433\u043E \u0442\u0438\u043F\u0430.");
    const originalValues = Object.fromEntries(ids.map((id) => [id, engine.characters[id][trait]]));
    const sourceIds = [...ids];
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
    const transfers = ids.map(
      (recipientId) => `${engine.players[recipientId].name} \u2190 ${engine.players[sourceByRecipient[recipientId]].name}`
    );
    appendLog(
      engine,
      `\u041F\u0435\u0440\u0435\u0440\u0430\u0437\u0434\u0430\u0447\u0430 \xAB${TRAIT_LABELS[trait]}\xBB: \u043A\u0430\u0440\u0442\u044B \u0441\u043C\u0435\u043D\u0438\u043B\u0438 \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u0435\u0432 \u0443 ${ids.length} \u0438\u0433\u0440\u043E\u043A\u043E\u0432 (${transfers.join(", ")}).`
    );
  }
  function swapNeighborTrait(engine, playerId, targetId, trait) {
    const active = activePlayerIds(engine);
    const index = active.indexOf(playerId);
    const neighbors = [active[(index - 1 + active.length) % active.length], active[(index + 1) % active.length]];
    if (!neighbors.includes(targetId)) throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u0433\u0440\u043E\u043A\u0430 \u043F\u0435\u0440\u0435\u0434 \u0441\u043E\u0431\u043E\u0439 \u0438\u043B\u0438 \u043F\u043E\u0441\u043B\u0435 \u0441\u0435\u0431\u044F.");
    if (!engine.players[playerId].revealedTraits?.[trait] || !engine.players[targetId].revealedTraits?.[trait]) {
      throw new Error("\u041E\u0431\u0435 \u043E\u0431\u043C\u0435\u043D\u0438\u0432\u0430\u0435\u043C\u044B\u0435 \u043A\u0430\u0440\u0442\u044B \u0434\u043E\u043B\u0436\u043D\u044B \u0431\u044B\u0442\u044C \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B.");
    }
    const own = engine.characters[playerId][trait];
    replaceTrait(engine, playerId, trait, engine.characters[targetId][trait], true);
    replaceTrait(engine, targetId, trait, own, true);
  }
  function giveNewSpecial(engine, playerId) {
    const special = drawSpecialCard(() => engineRandom(engine));
    engine.characters[playerId].special = special.text;
    engine.characters[playerId].specialId = special.id;
    engine.players[playerId].revealedTraits.special = engine.players[playerId].status === "exiled" ? special.text : "";
    engine.players[playerId].specialUsed = false;
  }
  function applyAgeVoteMultiplier(engine, choice) {
    if (!["younger", "older"].includes(choice)) throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043C\u043B\u0430\u0434\u0448\u0435 \u0438\u043B\u0438 \u0441\u0442\u0430\u0440\u0448\u0435 33 \u043B\u0435\u0442.");
    for (const id of activePlayerIds(engine)) {
      const text = engine.players[id].revealedTraits?.biology;
      const age = Number(text?.match(/\d+/)?.[0]);
      if (Number.isFinite(age) && (choice === "younger" ? age < 33 : age > 33)) {
        setRoundVoteMultiplier(engine, id);
      }
    }
  }
  function applyGenderVoteMultiplier(engine, choice) {
    if (!["female", "male"].includes(choice)) throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043C\u0443\u0436\u0447\u0438\u043D \u0438\u043B\u0438 \u0436\u0435\u043D\u0449\u0438\u043D.");
    for (const id of activePlayerIds(engine)) {
      const text = String(engine.players[id].revealedTraits?.biology ?? "").toLowerCase();
      if (choice === "female" && text.includes("\u0436\u0435\u043D\u0449") || choice === "male" && text.includes("\u043C\u0443\u0436\u0447")) {
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
    if (!["before", "after"].includes(choice)) throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u0433\u0440\u043E\u043A\u043E\u0432 \u0434\u043E \u0438\u043B\u0438 \u043F\u043E\u0441\u043B\u0435 \u0441\u0435\u0431\u044F.");
    const active = activePlayerIds(engine);
    const index = active.indexOf(playerId);
    const direction = choice === "before" ? -1 : 1;
    for (let offset = 1; offset <= 2; offset += 1) {
      const id = active[(index + direction * offset + active.length) % active.length];
      engine.players[id].voteMultiplier = 2;
    }
  }
  var SPECIAL_SNAPSHOT_KEYS = [
    "capacity",
    "totalRounds",
    "phase",
    "round",
    "currentPlayerIndex",
    "randomState",
    "players",
    "initialPlayerCount",
    "voteSchedule",
    "completedVotesByRound",
    "voteCycle",
    "characters",
    "votes",
    "voteResult",
    "roundEffects",
    "bunker",
    "threat",
    "threatResolution",
    "catastrophe",
    "extraScenarios",
    "bunkerRoundsRevealed",
    "firstReveal",
    "sharedSecrets",
    "lastExiledPlayerId",
    "bunkerCardSequence",
    "extraScenarioSequence",
    "bunkerEffectResults",
    "lastTraitShuffle",
    "preVotingResultSnapshot",
    "pendingBunkerVote",
    "bunkerVoteQueue",
    "finalBunkerEffectsResolved",
    "pendingSpecialChoice",
    "pendingSpecialSnapshot",
    "pendingSecretShare",
    "pendingSecretSharePrivate",
    "pendingSpecialRedirect"
  ];
  function captureSpecialSnapshot(engine) {
    return Object.fromEntries(SPECIAL_SNAPSHOT_KEYS.filter((key) => engine[key] !== void 0).map((key) => [key, structuredClone(engine[key])]));
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
    if (!previous?.state || !previous.playedBy || previous.playedBy === cancellerId) throw new Error("\u041D\u0435\u0442 \u0447\u0443\u0436\u043E\u0439 \u043E\u0441\u043E\u0431\u043E\u0439 \u043A\u0430\u0440\u0442\u044B, \u043A\u043E\u0442\u043E\u0440\u0443\u044E \u043C\u043E\u0436\u043D\u043E \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C.");
    const cancellerName = engine.players[cancellerId]?.name ?? "\u0418\u0433\u0440\u043E\u043A";
    const previousOwnerName = engine.players[previous.playedBy]?.name ?? "\u0418\u0433\u0440\u043E\u043A";
    restoreSpecialSnapshot(engine, previous.state);
    giveNewSpecial(engine, previous.playedBy);
    giveNewSpecial(engine, cancellerId);
    engine.lastSpecialSnapshot = { playedBy: "", specialId: 0, state: {} };
    appendLog(engine, `${cancellerName} \u043E\u0442\u043C\u0435\u043D\u044F\u0435\u0442 \u043E\u0441\u043E\u0431\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0438\u0433\u0440\u043E\u043A\u0430 ${previousOwnerName}. \u041E\u0431\u0430 \u043F\u043E\u043B\u0443\u0447\u0430\u044E\u0442 \u043D\u043E\u0432\u044B\u0435 \u043E\u0441\u043E\u0431\u044B\u0435 \u043A\u0430\u0440\u0442\u044B.`);
  }
  function redirectLastSpecial(engine, redirectorId, newChoice) {
    const stateBeforeRedirect = structuredClone(engine);
    try {
      const previous = engine.lastSpecialSnapshot;
      const previousSpecialId = Number(previous?.specialId ?? 0);
      if (!previous?.state || !previous.playedBy || [50, 71].includes(previousSpecialId)) {
        throw new Error("\u041D\u0435\u0442 \u043F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0435\u0439 \u043E\u0441\u043E\u0431\u043E\u0439 \u043A\u0430\u0440\u0442\u044B \u0434\u043B\u044F \u043F\u043E\u0434\u043C\u0435\u043D\u044B \u0446\u0435\u043B\u0438.");
      }
      const inputTypes = Object.entries(previous.data ?? {}).filter(([, value]) => value !== "" && value !== void 0).map(([key]) => key);
      if (!inputTypes.length) throw new Error("\u0423 \u0441\u044B\u0433\u0440\u0430\u043D\u043D\u043E\u0439 \u043A\u0430\u0440\u0442\u044B \u043D\u0435\u0442 \u0432\u044B\u0431\u043E\u0440\u0430, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043C\u043E\u0436\u043D\u043E \u043F\u043E\u0434\u043C\u0435\u043D\u0438\u0442\u044C.");
      const redirectorName = engine.players[redirectorId]?.name ?? "\u0418\u0433\u0440\u043E\u043A";
      const previousOwner = previous.playedBy;
      const redirectedData = { ...previous.data ?? {} };
      for (const key of ["targetId", "trait", "scenarioTarget", "choice"]) {
        if (newChoice[key] !== void 0 && newChoice[key] !== "") {
          redirectedData[key] = newChoice[key];
        }
      }
      const redirectSnapshot = captureSpecialSnapshot(engine);
      if (previousSpecialId === 54) {
        const selected = previous.choiceOptions?.find((option) => Number(option.index) === Number(redirectedData.choice));
        if (!selected) throw new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0432\u0430\u0440\u0438\u0430\u043D\u0442\u044B \xAB\u0421\u0442\u0440\u043E\u0438\u0442\u0435\u043B\u044F \u0431\u0443\u043D\u043A\u0435\u0440\u0430\xBB.");
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
        appendLog(engine, `${redirectorName} \u043F\u043E\u0434\u043C\u0435\u043D\u044F\u0435\u0442 \u0432\u044B\u0431\u043E\u0440 \xAB\u0421\u0432\u044F\u0437\u0430\u043D\u043D\u044B\u0445 \u0442\u0430\u0439\u043D\u043E\u0439\xBB. \u041D\u043E\u0432\u044B\u0439 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A \u0434\u043E\u043B\u0436\u0435\u043D \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0437\u0430\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443.`);
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
  function finalizeSpecialRedirect(engine, redirectorId, redirectorName, redirectSnapshot, redirectedData) {
    markSpecialCardUsed(engine, redirectorId);
    engine.lastSpecialSnapshot = {
      playedBy: redirectorId,
      specialId: 50,
      data: structuredClone(redirectedData ?? {}),
      state: redirectSnapshot,
      playedAtRevision: engine.revision + 1
    };
    appendLog(engine, `${redirectorName} \u043F\u043E\u0434\u043C\u0435\u043D\u044F\u0435\u0442 \u0432\u044B\u0431\u043E\u0440 \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u043E \u0441\u044B\u0433\u0440\u0430\u043D\u043D\u043E\u0439 \u043E\u0441\u043E\u0431\u043E\u0439 \u043A\u0430\u0440\u0442\u044B.`);
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
      appendLog(engine, `${engine.players[playerId].name} \u0440\u0430\u0437\u044B\u0433\u0440\u044B\u0432\u0430\u0435\u0442 \xAB\u0421\u0442\u0440\u043E\u0438\u0442\u0435\u043B\u044F \u0431\u0443\u043D\u043A\u0435\u0440\u0430\xBB \u0438 \u0432\u044B\u0431\u0438\u0440\u0430\u0435\u0442 \u043E\u0434\u043D\u0443 \u0438\u0437 \u0434\u0432\u0443\u0445 \u043A\u0430\u0440\u0442.`);
      return;
    }
    const optionIndex = Number(choice);
    const selected = pending.options?.find((option) => option.index === optionIndex);
    if (!selected) throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043E\u0434\u043D\u0443 \u0438\u0437 \u0434\u0432\u0443\u0445 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u043D\u044B\u0445 \u043A\u0430\u0440\u0442 \u0431\u0443\u043D\u043A\u0435\u0440\u0430.");
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
    appendLog(engine, `${engine.players[playerId].name} \u0432\u044B\u0431\u0438\u0440\u0430\u0435\u0442 \u043A\u0430\u0440\u0442\u0443 \xAB${selected.title}\xBB \u043A\u0430\u043A \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0431\u0430\u0433\u0430\u0436.`);
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
    if (index < 0 || active.length < 2) throw new Error("\u0421\u043E\u0441\u0435\u0434\u043D\u0438\u0439 \u0438\u0433\u0440\u043E\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D.");
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
  function removeBunkerTarget(engine, targetValue, reason = "\u041A\u0430\u0440\u0442\u0430 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430.") {
    const [scope, type, cardId] = String(targetValue ?? "").split(":");
    if (type !== "bunker") throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0431\u0443\u043D\u043A\u0435\u0440\u0430.");
    if (scope === "primary") {
      const removed = getOpenBunkerTarget(engine, targetValue);
      if (!removed) throw new Error("\u041E\u0441\u043D\u043E\u0432\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0435\u0449\u0451 \u043D\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0430.");
      engine.bunker = {
        status: "removed",
        title: "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430",
        description: `\xAB${removed.title}\xBB. ${reason}`,
        removedCardTitle: removed.title,
        revealedRound: Number(removed.revealedRound ?? 1)
      };
      return { ...removed };
    }
    if (scope === "extra") {
      const cards = engine.extraScenarios?.bunker ?? [];
      const index = cards.findIndex((card) => card.id === cardId);
      if (index < 0) throw new Error("\u0412\u044B\u0431\u0440\u0430\u043D\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430.");
      return cards.splice(index, 1)[0];
    }
    throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0431\u0443\u043D\u043A\u0435\u0440\u0430.");
  }
  function replaceBunkerTarget(engine, targetValue, replacement) {
    const [scope, type, cardId] = String(targetValue ?? "").split(":");
    if (type !== "bunker") throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0431\u0443\u043D\u043A\u0435\u0440\u0430.");
    if (scope === "primary") {
      const current = getOpenBunkerTarget(engine, targetValue);
      if (!current) throw new Error("\u041E\u0441\u043D\u043E\u0432\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0435\u0449\u0451 \u043D\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0430.");
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
      if (index < 0) throw new Error("\u0412\u044B\u0431\u0440\u0430\u043D\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430.");
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
    throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0431\u0443\u043D\u043A\u0435\u0440\u0430.");
  }
  function startSecretShare(engine, ownerId, targetId, ownerTrait, snapshot) {
    if (!TRAIT_KEYS.includes(ownerTrait) || ownerTrait === "special") throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u0432\u043E\u044E \u0437\u0430\u043A\u0440\u044B\u0442\u0443\u044E \u043E\u0431\u044B\u0447\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u0443.");
    if (engine.players[ownerId].revealedTraits?.[ownerTrait]) throw new Error("\u0414\u043B\u044F \u043E\u0431\u043C\u0435\u043D\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443.");
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
    appendLog(engine, `${engine.players[ownerId].name} \u043F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u0435\u0442 \u0438\u0433\u0440\u043E\u043A\u0443 ${engine.players[targetId].name} \u043E\u0431\u043C\u0435\u043D\u044F\u0442\u044C\u0441\u044F \u0442\u0430\u0439\u043D\u043E\u0439 \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u0435\u0439.`);
  }
  function respondSecretShare(engine, command) {
    if ([PHASES.THREAT, PHASES.FINISHED].includes(engine.phase)) {
      throw new Error("\u0424\u0438\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430 \u0443\u0436\u0435 \u043D\u0430\u0447\u0430\u043B\u0430\u0441\u044C.");
    }
    const pending = engine.pendingSecretShare;
    const privateData = engine.pendingSecretSharePrivate;
    if (!pending || !privateData || command.from !== pending.targetId) throw new Error("\u0414\u043B\u044F \u0432\u0430\u0441 \u043D\u0435\u0442 \u043E\u0436\u0438\u0434\u0430\u044E\u0449\u0435\u0433\u043E \u043E\u0431\u043C\u0435\u043D\u0430 \u0442\u0430\u0439\u043D\u044B\u043C\u0438 \u043A\u0430\u0440\u0442\u0430\u043C\u0438.");
    const targetTrait = command.data?.trait;
    if (!TRAIT_KEYS.includes(targetTrait) || targetTrait === "special") throw new Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0443\u044E \u043E\u0431\u044B\u0447\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u0443.");
    if (engine.players[pending.targetId].revealedTraits?.[targetTrait]) throw new Error("\u0414\u043B\u044F \u043E\u0431\u043C\u0435\u043D\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443.");
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
    appendLog(engine, `${engine.players[pending.ownerId].name} \u0438 ${engine.players[pending.targetId].name} \u043E\u0431\u043C\u0435\u043D\u044F\u043B\u0438\u0441\u044C \u0442\u0430\u0439\u043D\u043E\u0439 \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u0435\u0439.`);
    delete engine.pendingSecretShare;
    delete engine.pendingSecretSharePrivate;
    delete engine.pendingSpecialRedirect;
  }
  function cancelPendingSpecial(engine, command, hostId) {
    if (command.from !== hostId) throw new Error("\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0437\u0430\u0432\u0438\u0441\u0448\u0435\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043C\u043E\u0436\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0435\u0434\u0443\u0449\u0438\u0439.");
    const choiceOwnerId = engine.pendingSpecialChoice?.playerId;
    const shareOwnerId = engine.pendingSecretShare?.ownerId;
    if (!choiceOwnerId && !shareOwnerId) throw new Error("\u041D\u0435\u0442 \u043E\u0436\u0438\u0434\u0430\u044E\u0449\u0435\u0433\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u043E\u0441\u043E\u0431\u043E\u0439 \u043A\u0430\u0440\u0442\u044B.");
    const ownerId = shareOwnerId || choiceOwnerId;
    const ownerName = engine.players?.[ownerId]?.name ?? "\u0418\u0433\u0440\u043E\u043A";
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
    appendLog(engine, `\u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u043E\u0442\u043C\u0435\u043D\u044F\u0435\u0442 \u043D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043E\u0441\u043E\u0431\u043E\u0439 \u043A\u0430\u0440\u0442\u044B \u0438\u0433\u0440\u043E\u043A\u0430 ${ownerName}. \u041A\u0430\u0440\u0442\u0430 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u043D\u043E\u0439.`);
  }
  function exilePlayer(engine, playerId, visited = /* @__PURE__ */ new Set()) {
    if (visited.has(playerId) || !engine.players[playerId]) return;
    visited.add(playerId);
    const player = engine.players[playerId];
    if (player.bunkerKing) {
      appendLog(engine, `${player.name} \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435: \u0446\u0430\u0440\u044F \u043D\u0435\u043B\u044C\u0437\u044F \u0438\u0437\u0433\u043D\u0430\u0442\u044C.`);
      return false;
    }
    if (player.status !== "exiled") {
      player.revealedBeforeExile = TRAIT_KEYS.filter((trait) => player.revealedTraits?.[trait]);
    }
    player.status = "exiled";
    engine.lastExiledPlayerId = playerId;
    if (engine.roundEffects?.exileBaggage?.length) {
      replaceTrait(engine, playerId, "baggage", `${engine.characters[playerId].baggage}; \u0441 \u0441\u043E\u0431\u043E\u0439: ${engine.roundEffects.exileBaggage.join("; ")}`);
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
      const sameCard = target && (!player.sabotageScenarioInstanceId || target.instanceId === player.sabotageScenarioInstanceId);
      if (sameCard) {
        const removed = removeBunkerTarget(
          engine,
          player.sabotageScenarioTarget,
          "\u041A\u0430\u0440\u0442\u0430 \u0441\u043B\u043E\u043C\u0430\u043D\u0430 \u0438\u043B\u0438 \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u0430 \u0448\u0430\u043D\u0442\u0430\u0436\u043E\u043C."
        );
        appendLog(engine, `\u041F\u043E\u0441\u043B\u0435 \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u044F ${player.name} \u043A\u0430\u0440\u0442\u0430 \xAB${removed.title}\xBB \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u0441\u043B\u043E\u043C\u0430\u043D\u043D\u043E\u0439 \u0438\u043B\u0438 \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u043E\u0439.`);
      } else {
        appendLog(engine, `\u0421\u0430\u0431\u043E\u0442\u0430\u0436 ${player.name} \u043D\u0435 \u0441\u0440\u0430\u0431\u043E\u0442\u0430\u043B: \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0439 \u043A\u0430\u0440\u0442\u044B \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u0443\u0436\u0435 \u043D\u0435\u0442.`);
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
      appendLog(engine, "\u0424\u0438\u043D\u0430\u043B: \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B \u0432\u0441\u0435 \u043A\u0430\u0440\u0442\u044B \u0432\u0441\u0435\u0445 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432.");
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
    const revealedOrdinaryTraits = ORDINARY_TRAIT_KEYS.filter((trait) => player.revealedTraits?.[trait]);
    for (const trait of revealedOrdinaryTraits.slice(MAX_REVEALED_ORDINARY_TRAITS)) {
      player.revealedTraits[trait] = "";
    }
    const currentRevealIsPending = engine.phase === PHASES.REVEAL && Number(engine.round ?? 0) <= MAX_TRAIT_REVEAL_ROUNDS;
    const completedRevealRounds = Math.max(
      0,
      Number(engine.round ?? 0) - (currentRevealIsPending ? 1 : 0)
    );
    const targetCount = Math.min(MAX_REVEALED_ORDINARY_TRAITS, completedRevealRounds);
    const revealedTraits = [];
    while (revealedOrdinaryTraitCount(player) < targetCount) {
      const hidden = ORDINARY_TRAIT_KEYS.filter((trait2) => !player.revealedTraits?.[trait2]);
      if (!hidden.length) break;
      const trait = hidden[Math.floor(engineRandom(engine) * hidden.length)];
      if (!revealSpecificTrait(engine, playerId, trait)) break;
      revealedTraits.push(trait);
    }
    if (revealedTraits.length) {
      const details = revealedTraits.map((trait) => `${TRAIT_LABELS[trait]} \u2014 ${engine.characters[playerId][trait]}`).join("; ");
      appendLog(engine, `${player.name} \u0434\u043E\u0433\u043E\u043D\u044F\u0435\u0442 \u043F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043D\u044B\u0435 \u0440\u0430\u0443\u043D\u0434\u044B \u0438 \u0440\u0430\u0441\u043A\u0440\u044B\u0432\u0430\u0435\u0442: ${details}.`);
    }
  }
  function applySecondChances(engine) {
    const returnedIds = [];
    for (const id of engine.order) {
      const player = engine.players[id];
      if (player.status !== "exiled" || !player.secondChance) continue;
      const revealedKeys = Array.isArray(player.revealedBeforeExile) ? player.revealedBeforeExile : TRAIT_KEYS.filter((trait) => player.revealedTraits?.[trait]);
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
      appendLog(engine, `${player.name} \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442\u0441\u044F \u0432 \u043D\u043E\u0432\u043E\u043C \u043E\u0431\u0440\u0430\u0437\u0435 \u0431\u043B\u0430\u0433\u043E\u0434\u0430\u0440\u044F \xAB\u0412\u0442\u043E\u0440\u043E\u043C\u0443 \u0448\u0430\u043D\u0441\u0443\xBB.`);
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
    const hasVoteScheduleData = engine.voteSchedule && typeof engine.voteSchedule === "object" && !Array.isArray(engine.voteSchedule);
    const hasCompletedVoteData = engine.completedVotesByRound && typeof engine.completedVotesByRound === "object" && !Array.isArray(engine.completedVotesByRound);
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
      engine.voteSchedule[round] = Number.isFinite(target) ? Math.max(0, Math.trunc(target)) : 0;
    }
    if (!hasCompletedVoteData) {
      engine.completedVotesByRound = {};
      for (let round = 1; round < currentRound; round += 1) {
        engine.completedVotesByRound[round] = Number(engine.voteSchedule[round] ?? 0);
      }
      if (engine.phase === PHASES.RESULTS && engine.voteResult?.status === "exiled") {
        engine.voteSchedule[currentRound] = Math.max(1, Number(engine.voteSchedule[currentRound] ?? 0));
        engine.completedVotesByRound[currentRound] = 1;
      } else if (engine.phase === PHASES.VOTING || engine.phase === PHASES.RESULTS && engine.voteResult?.status === "tie") {
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
    const preserveCurrentVote = firstRound <= currentRound && activeCount > Number(engine.capacity ?? 0) && (engine.phase === PHASES.VOTING || engine.phase === PHASES.RESULTS && engine.voteResult?.status === "tie");
    for (let round = engine.totalRounds; round >= firstRound && excessVotes > 0; round -= 1) {
      const completed = completedRoundVotes(engine, round);
      const minimum = round === currentRound && preserveCurrentVote ? completed + 1 : completed;
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
    if (player?.status !== "active" || !ORDINARY_TRAIT_KEYS.includes(trait) || player.revealedTraits?.[trait]) {
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
    return { status: "hidden", title, description: "\u0414\u0430\u043D\u043D\u044B\u0435 \u0437\u0430\u0441\u0435\u043A\u0440\u0435\u0447\u0435\u043D\u044B." };
  }
  function removedScenario(label, removedTitle, reason) {
    return {
      status: "removed",
      title: `${label} \u0443\u0431\u0440\u0430\u043D\u0430`,
      description: `\xAB${removedTitle}\xBB. ${reason}`,
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

  // data/bunker/bots.js
  var BOT_ID_PREFIX = "dev_bot_";
  var ORDINARY_TRAIT_KEYS2 = TRAIT_KEYS.filter((trait) => trait !== "special");
  var MAX_REVEALED_ORDINARY_TRAITS2 = ORDINARY_TRAIT_KEYS2.length - 1;
  var BOT_NAMES = [
    "\u0411\u043E\u0442 \u0410\u043B\u044C\u0444\u0430",
    "\u0411\u043E\u0442 \u0411\u0440\u0430\u0432\u043E",
    "\u0411\u043E\u0442 \u0412\u0435\u0433\u0430",
    "\u0411\u043E\u0442 \u0413\u0430\u043C\u043C\u0430",
    "\u0411\u043E\u0442 \u0414\u0435\u043B\u044C\u0442\u0430",
    "\u0411\u043E\u0442 \u0415\u043D\u043E\u0442",
    "\u0411\u043E\u0442 \u0416\u0443\u043A",
    "\u0411\u043E\u0442 \u0418\u0441\u043A\u0440\u0430",
    "\u0411\u043E\u0442 \u041A\u0440\u043E\u0442",
    "\u0411\u043E\u0442 \u041B\u0443\u043D\u0430",
    "\u0411\u043E\u0442 \u041C\u0430\u044F\u043A",
    "\u0411\u043E\u0442 \u041D\u043E\u0440\u0434",
    "\u0411\u043E\u0442 \u041E\u043C\u0435\u0433\u0430",
    "\u0411\u043E\u0442 \u041F\u0438\u043A\u0441\u0435\u043B\u044C",
    "\u0411\u043E\u0442 \u0420\u0430\u0434\u0430\u0440"
  ];
  function isDeveloperBot(playerId) {
    return String(playerId ?? "").startsWith(BOT_ID_PREFIX);
  }
  function fillWithDeveloperBots(players, targetCount) {
    const result = [...players];
    const usedIds = new Set(result.map(([playerId]) => playerId));
    for (let index = 0; result.length < targetCount; index += 1) {
      const playerId = `${BOT_ID_PREFIX}${index + 1}`;
      if (usedIds.has(playerId)) continue;
      result.push([playerId, {
        name: BOT_NAMES[index] ?? `\u0411\u043E\u0442 ${index + 1}`,
        online: true,
        isBot: true
      }]);
      usedIds.add(playerId);
    }
    return result;
  }
  function getDeveloperBotCommands(engine, random = Math.random) {
    if (!engine || engine.phase === PHASES.FINISHED) return [];
    const reactionCommand = getDeveloperBotReactionCommand(engine, random);
    if (reactionCommand) return [reactionCommand];
    const pendingTarget = engine.pendingSecretShare?.targetId;
    if (engine.pendingSecretShare) {
      if (!isDeveloperBot(pendingTarget)) return [];
      const trait = TRAIT_KEYS.find((key) => key !== "special" && !engine.players?.[pendingTarget]?.revealedTraits?.[key]);
      return trait ? [{ type: "RESPOND_SECRET_SHARE", from: pendingTarget, data: { trait } }] : [];
    }
    const pendingChoice = engine.pendingSpecialChoice;
    if (pendingChoice) {
      if (!isDeveloperBot(pendingChoice.playerId)) return [];
      const choice = pendingChoice.options?.[0]?.index;
      return choice === void 0 ? [] : [{ type: "PLAY_SPECIAL", from: pendingChoice.playerId, data: { choice: String(choice) } }];
    }
    if (engine.pendingBunkerVote) {
      const vote2 = engine.pendingBunkerVote;
      return (vote2.voterIds ?? []).filter((playerId) => isDeveloperBot(playerId) && !vote2.votes?.[playerId]).map((playerId) => {
        const targetId = pick2(vote2.candidateIds ?? [], random);
        return targetId ? { type: "BUNKER_VOTE", from: playerId, data: { targetId } } : null;
      }).filter(Boolean);
    }
    const specialCommand = getDeveloperBotSpecialCommand(engine, random);
    if (specialCommand) return [specialCommand];
    if (engine.phase === PHASES.REVEAL) {
      const playerId = engine.order?.[engine.currentPlayerIndex];
      const player = engine.players?.[playerId];
      if (!isDeveloperBot(playerId) || !player || player.status !== "active") return [];
      const forcedTrait = engine.roundEffects?.forcedTrait;
      const revealedOrdinaryCount = ORDINARY_TRAIT_KEYS2.filter((trait2) => player.revealedTraits?.[trait2]).length;
      const trait = revealedOrdinaryCount >= MAX_REVEALED_ORDINARY_TRAITS2 ? null : forcedTrait && !player.revealedTraits?.[forcedTrait] ? forcedTrait : ORDINARY_TRAIT_KEYS2.find((key) => !player.revealedTraits?.[key]);
      return [
        ...trait ? [{ type: "REVEAL_TRAIT", from: playerId, data: { trait } }] : [],
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
  function getDeveloperBotSpecialCommand(engine, random = Math.random) {
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
    const pickOther = () => pick2(otherBotIds.length ? otherBotIds : otherActiveIds, random);
    const bunkerTargets = openBunkerTargets(engine);
    if (specialId === 50) return buildRedirectSpecialData(engine, random);
    if (specialId === 71) return {};
    if ([1, 3, 11, 64].includes(specialId)) {
      const scenarioTarget = pick2(bunkerTargets, random);
      return scenarioTarget ? { scenarioTarget } : null;
    }
    if ([2, 12, 18, 20, 27, 41, 42, 45, 49, 55].includes(specialId)) {
      const targetId = pickOther();
      return targetId ? { targetId } : null;
    }
    if ([16, 17, 21, 22, 23].includes(specialId)) {
      const trait = { 16: "baggage", 17: "biology", 21: "hobby", 22: "health", 23: "fact" }[specialId];
      const targetId = activeNeighborIds(engine, playerId).find((id) => engine.players[id].revealedTraits?.[trait] && engine.players[playerId].revealedTraits?.[trait]);
      return targetId ? { targetId } : null;
    }
    if (specialId === 25 || specialId === 29) {
      const trait = specialId === 25 ? "health" : "profession";
      const candidates = activeIds(engine).filter((id) => engine.players[id].revealedTraits?.[trait]);
      const targetId = pick2(candidates, random);
      return targetId ? { targetId } : null;
    }
    if (specialId === 26) {
      if (engine.phase !== PHASES.REVEAL) return null;
      const trait = ordinaryTraits.find((key) => activeIds(engine).some((id) => !engine.players[id].revealedTraits?.[key]));
      return trait ? { trait } : null;
    }
    if (specialId === 28) return null;
    if (specialId === 31) return { trait: pick2(ordinaryTraits, random) };
    if (specialId === 38) {
      const targetId = pick2(
        otherActiveIds.filter((id) => !engine.players[id]?.bunkerKing),
        random
      );
      return targetId ? { targetId } : null;
    }
    if (specialId === 44) {
      const candidates = otherActiveIds.filter((id) => /\d+/.test(engine.players?.[id]?.revealedTraits?.biology ?? ""));
      const targetId = pick2(candidates, random);
      return targetId ? { targetId } : null;
    }
    if (specialId === 53) return { choice: random() < 0.5 ? "younger" : "older" };
    if (specialId === 54) return {};
    if (specialId === 56) {
      const trait = ordinaryTraits.find((key) => !engine.players[playerId].revealedTraits?.[key]);
      const candidates = otherBotIds.filter((id) => ordinaryTraits.some((key) => !engine.players[id].revealedTraits?.[key]));
      const targetId = pick2(candidates, random);
      return trait && targetId ? { targetId, trait } : null;
    }
    if (specialId === 57) return { choice: random() < 0.5 ? "before" : "after" };
    if (specialId === 67) {
      const candidates = otherActiveIds.map((id) => ({
        id,
        traits: ordinaryTraits.filter((key) => {
          const target2 = engine.players[id];
          if (target2.revealedTraits?.[key]) return false;
          const revealedCount = ordinaryTraits.filter((trait) => target2.revealedTraits?.[trait]).length;
          const additionalReveals = key === "fact" || target2.revealedTraits?.fact ? 1 : 2;
          return revealedCount + additionalReveals <= ordinaryTraits.length - 1;
        })
      })).filter((item) => item.traits.length);
      const target = pick2(candidates, random);
      return target ? { targetId: target.id, trait: pick2(target.traits, random) } : null;
    }
    if (specialId === 69) return { choice: random() < 0.5 ? "female" : "male" };
    if ([5, 6, 7, 8, 9].includes(specialId)) {
      if (engine.phase === PHASES.REVEAL) return null;
      const trait = { 5: "baggage", 6: "biology", 7: "hobby", 8: "health", 9: "fact" }[specialId];
      return activeIds(engine).filter((id) => engine.players[id].revealedTraits?.[trait]).length >= 2 ? {} : null;
    }
    if (specialId === 13) return engine.firstReveal?.health ? {} : null;
    if ([15, 19].includes(specialId)) {
      return activeIds(engine).some((id) => /\d+/.test(engine.players[id].revealedTraits?.biology ?? "")) ? {} : null;
    }
    if (specialId === 43) {
      return activeIds(engine).some((id) => ordinaryTraits.some((key) => engine.players[id].revealedTraits?.[key])) ? {} : null;
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
      const choices = (previous.choiceOptions ?? []).filter((option) => String(option.index) !== String(previousData.choice));
      const choice = pick2(choices, random)?.index;
      return choice === void 0 ? null : { choice: String(choice) };
    }
    const snapshotEngine = {
      ...engine,
      ...structuredClone(previous.state)
    };
    if (previousSpecialId === 56) {
      return buildSecretShareRedirectData(snapshotEngine, previous, random);
    }
    if (previousSpecialId === 26) {
      const traits = ORDINARY_TRAIT_KEYS2.filter((trait2) => trait2 !== previousData.trait && activeIds(snapshotEngine).some((id) => !snapshotEngine.players?.[id]?.revealedTraits?.[trait2]));
      const trait = pick2(traits, random);
      return trait ? { trait } : null;
    }
    for (let firstIndex = 0; firstIndex < 32; firstIndex += 1) {
      for (let secondIndex = 0; secondIndex < 32; secondIndex += 1) {
        const values = [(firstIndex + 0.5) / 32, (secondIndex + 0.5) / 32];
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
    const ownerTraits = ORDINARY_TRAIT_KEYS2.filter((trait2) => !engine.players?.[ownerId]?.revealedTraits?.[trait2]);
    const alternateTraits = ownerTraits.filter((trait2) => trait2 !== previousData.trait);
    const trait = pick2(alternateTraits.length ? alternateTraits : ownerTraits, random);
    const targetIds = activeIds(engine).filter((id) => id !== ownerId && ORDINARY_TRAIT_KEYS2.some((candidateTrait) => !engine.players?.[id]?.revealedTraits?.[candidateTrait]));
    const alternateTargetIds = targetIds.filter((id) => id !== previousData.targetId);
    const preferredTargetIds = alternateTargetIds.length ? alternateTargetIds : targetIds;
    const botTargetIds = preferredTargetIds.filter(isDeveloperBot);
    const targetId = pick2(botTargetIds.length ? botTargetIds : preferredTargetIds, random);
    if (!targetId || !trait) return null;
    if (targetId === previousData.targetId && trait === previousData.trait) return null;
    return { targetId, trait };
  }
  function sameSpecialData(left, right) {
    const keys = [.../* @__PURE__ */ new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].sort();
    return keys.every((key) => String(left?.[key] ?? "") === String(right?.[key] ?? ""));
  }
  function activeIds(engine) {
    return (engine.order ?? []).filter((id) => engine.players?.[id]?.status === "active");
  }
  function activeNeighborIds(engine, playerId) {
    const ids = activeIds(engine);
    const index = ids.indexOf(playerId);
    if (index < 0 || ids.length < 2) return [];
    return [.../* @__PURE__ */ new Set([
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
  function pick2(items, random) {
    if (!items?.length) return void 0;
    return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  }
  function votingBotIds(engine) {
    const lastExiled = engine.lastExiledPlayerId;
    return engine.order.filter((playerId) => {
      const player = engine.players?.[playerId];
      return isDeveloperBot(playerId) && (player?.status === "active" || playerId === lastExiled || player?.persistentVoter);
    });
  }
  function voteCandidates(engine, voterId) {
    const voter = engine.players[voterId];
    const tied = engine.voteResult?.status === "tie" ? new Set(engine.voteResult.candidates ?? []) : null;
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

  // data/bunker/bunker.js
  var ROOM_STORAGE_KEY = "eulennest-bunker-room";
  var PLAYER_NAME_STORAGE_KEY = "eulennest-player-name";
  var IS_FILE_MODE = window.location.protocol === "file:";
  var select = (selector) => document.querySelector(selector);
  var ui = {
    modePlayer: select("#mode-player"),
    modeHost: select("#mode-host"),
    hostModeTab: select('label[for="mode-host"]'),
    lobby: select("#online-lobby"),
    lobbyForm: select("#online-lobby .setup-grid"),
    onlineName: select("#online-name"),
    createRoomButton: select("#create-room"),
    joinRoomButton: select("#join-room"),
    roomCodeInput: select("#room-code-input"),
    roomInfo: select("#room-info"),
    roomCodeOutput: select("#room-code-output"),
    restartRoom: select("#restart-room"),
    leaveRoom: select("#leave-room"),
    onlineError: select("#online-error"),
    status: select("#game-status span"),
    startGame: select("#start-game"),
    setupPanel: select("#setup-panel"),
    playerCount: select("#player-count"),
    bunkerCapacity: select("#bunker-capacity"),
    hostPlays: select("#host-plays"),
    developerMode: select("#developer-mode"),
    roundDrawer: select("#round-drawer"),
    roundDrawerToggle: select("#round-drawer-toggle"),
    roundDrawerClose: select("#round-drawer-close"),
    roundDrawerBackdrop: select("#round-drawer-backdrop"),
    roundToggleCurrent: select("#round-toggle-current"),
    roundToggleTotal: select("#round-toggle-total"),
    roundTogglePhase: select("#round-toggle-phase"),
    roundProgress: select("#round-progress"),
    roundCurrent: select("#round-current"),
    roundTotal: select("#round-total"),
    roundPhase: select("#round-phase"),
    playersAlive: select("#players-alive"),
    playersTotal: select("#players-total"),
    bunkerSlots: select("#bunker-slots"),
    skipTurn: select("#skip-turn"),
    nextPhase: select("#next-phase"),
    turnPanel: select("#turn-panel"),
    turnKicker: select("#turn-kicker"),
    turnTitle: select("#turn-title"),
    turnDescription: select("#turn-description"),
    finishTurn: select("#finish-turn"),
    characterTraits: select("#character-traits"),
    specialControls: select("#special-controls"),
    specialGuide: select("#special-guide"),
    specialTargetPlayer: select("#special-target-player"),
    specialTargetTrait: select("#special-target-trait"),
    specialTargetScenario: select("#special-target-scenario"),
    specialChoice: select("#special-choice"),
    playSpecial: select("#play-special"),
    secretShareResponse: select("#secret-share-response"),
    secretShareTrait: select("#secret-share-trait"),
    respondSecretShare: select("#respond-secret-share"),
    sharedSecrets: select("#shared-secrets"),
    playerRoster: select("#player-roster"),
    playersList: select("#players-list"),
    playerTemplate: select("#player-card-template"),
    activePlayerLabel: select("#active-player-label"),
    votePanel: select("#vote-panel"),
    voteRoundLabel: select("#vote-round-label"),
    voteList: select("#vote-list"),
    confirmVote: select("#confirm-vote"),
    voteStatus: select("#vote-status"),
    eventLog: select("#event-log"),
    logTemplate: select("#log-entry-template"),
    hostDossier: select("#host-dossier"),
    hostTraits: select("#host-character-traits"),
    hostFinishTurn: select("#host-finish-turn"),
    scenarioCards: {
      catastrophe: select("#catastrophe-card"),
      bunker: select("#bunker-card"),
      threat: select("#threat-card")
    },
    scenarioGrid: select("#scenario-grid"),
    hostEditor: select("#host-editor"),
    hostEditCapacity: select("#host-edit-capacity"),
    hostApplyCapacity: select("#host-apply-capacity"),
    hostEditPlayer: select("#host-edit-player"),
    hostEditTrait: select("#host-edit-trait"),
    hostEditValue: select("#host-edit-value"),
    hostEditRevealed: select("#host-edit-revealed"),
    hostRandomTrait: select("#host-random-trait"),
    hostApplyTrait: select("#host-apply-trait"),
    hostEditStatus: select("#host-edit-status"),
    hostApplyStatus: select("#host-apply-status"),
    hostEditScenarioType: select("#host-edit-scenario-type"),
    hostEditScenarioTitle: select("#host-edit-scenario-title"),
    hostEditScenarioDescription: select("#host-edit-scenario-description"),
    hostRandomScenario: select("#host-random-scenario"),
    hostAddScenario: select("#host-add-scenario"),
    hostSpecialPlayer: select("#host-special-player"),
    hostSpecialCard: select("#host-special-card"),
    hostSpecialRevealed: select("#host-special-revealed"),
    hostAssignSpecial: select("#host-assign-special"),
    hostSpecialPreview: select("#host-special-preview"),
    scenarioButtons: {
      catastrophe: select("#reveal-catastrophe"),
      bunker: select("#reveal-bunker"),
      threat: select("#reveal-threat")
    },
    threatResolutionStatus: select("#threat-resolution-status"),
    threatResolutionActions: select("#threat-resolution-actions"),
    threatSurvived: select("#threat-survived"),
    threatNonlethalFailed: select("#threat-nonlethal-failed"),
    threatFailed: select("#threat-failed")
  };
  var multiplayer = null;
  var room = null;
  var publicState = null;
  var privateState = {};
  var selectedVoteTarget = "";
  var selectedBunkerVoteTarget = "";
  var commandListenerStarted = false;
  var commandQueue = Promise.resolve();
  var hasSeenRoom = false;
  var leavingRoom = false;
  var lastCommandErrorAt = 0;
  var botActionTimer = 0;
  var botActionRevision = -1;
  init();
  async function init() {
    initSpecialCatalog();
    lockHostInterface();
    mountRoundDrawer();
    bindEvents();
    configureFileMode();
    ui.roundDrawer.inert = true;
    if (!IS_FILE_MODE && !isFirebaseConfigured) {
      setConnectionControlsDisabled(true);
      handleError(new Error("Firebase \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D."));
      return;
    }
    try {
      const MultiplayerClass = await loadMultiplayerClass();
      multiplayer = new MultiplayerClass(firebaseConfig);
      await multiplayer.connect();
      restorePlayerName();
      setConnectionControlsDisabled(false);
      setStatus(IS_FILE_MODE ? "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 \u0440\u0435\u0436\u0438\u043C \xB7 \u0431\u0435\u0437 Firebase" : "\u0413\u043E\u0442\u043E\u0432 \u043A \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044E");
      await restoreRoom();
    } catch (error) {
      handleError(error);
    }
  }
  function mountRoundDrawer() {
    document.body.append(ui.roundDrawerBackdrop, ui.roundDrawer);
  }
  function configureFileMode() {
    if (!IS_FILE_MODE) return;
    document.body.classList.add("is-local-file");
    ui.createRoomButton.textContent = "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u0443\u044E \u0438\u0433\u0440\u0443";
    ui.joinRoomButton.hidden = true;
    ui.roomCodeInput.closest("label").hidden = true;
    ui.hostPlays.checked = true;
    ui.developerMode.checked = true;
  }
  function bindEvents() {
    ui.createRoomButton.addEventListener("click", () => run(async () => {
      const roomCode = await createRoom(readPlayerName(), 17);
      showConnectedRoom(roomCode);
    }));
    ui.joinRoomButton.addEventListener("click", () => run(async () => {
      const roomCode = await joinRoom(ui.roomCodeInput.value, readPlayerName());
      showConnectedRoom(roomCode);
    }));
    ui.roomCodeInput.addEventListener("input", () => {
      ui.roomCodeInput.value = normalizeRoomId(ui.roomCodeInput.value);
    });
    ui.roomCodeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") ui.joinRoomButton.click();
    });
    ui.roomCodeOutput.addEventListener("click", () => run(copyRoomCode));
    ui.leaveRoom.addEventListener("click", () => run(leaveCurrentRoom));
    ui.restartRoom.addEventListener("click", () => run(resetCurrentGame));
    ui.startGame.addEventListener("click", () => run(startGame));
    ui.roundDrawerToggle.addEventListener("click", () => setRoundDrawer(true));
    ui.roundDrawerClose.addEventListener("click", () => setRoundDrawer(false));
    ui.roundDrawerBackdrop.addEventListener("click", () => setRoundDrawer(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("round-drawer-open")) {
        setRoundDrawer(false);
      }
    });
    ui.skipTurn.addEventListener("click", () => run(() => sendCommand(
      publicState?.pendingSecretShare || publicState?.pendingSpecialChoice ? "CANCEL_PENDING" : "SKIP_TURN"
    )));
    ui.nextPhase.addEventListener("click", () => run(() => sendCommand(
      publicState?.pendingSecretShare || publicState?.pendingSpecialChoice ? "CANCEL_PENDING" : "NEXT_PHASE"
    )));
    ui.finishTurn.addEventListener("click", () => run(() => sendCommand("FINISH_TURN")));
    ui.hostFinishTurn.addEventListener("click", () => run(() => sendCommand("FINISH_TURN")));
    ui.characterTraits.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action='reveal-trait']");
      const trait = button?.closest("[data-trait]")?.dataset.trait;
      if (trait) run(() => sendCommand("REVEAL_TRAIT", { trait }));
    });
    ui.hostTraits.addEventListener("click", (event) => {
      const button = event.target.closest("[data-host-reveal-trait]");
      if (!button || button.disabled) return;
      run(() => sendCommand("REVEAL_TRAIT", { trait: button.dataset.hostRevealTrait }));
    });
    ui.voteList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-vote-target]");
      if (button && !button.disabled) selectVoteTarget(button.dataset.voteTarget);
    });
    ui.confirmVote.addEventListener("click", () => {
      if (selectedVoteTarget) run(() => sendCommand("VOTE", { targetId: selectedVoteTarget }));
    });
    ui.playSpecial.addEventListener("click", () => run(playOrRespondSpecial));
    ui.respondSecretShare.addEventListener("click", () => run(
      () => sendCommand("RESPOND_SECRET_SHARE", { trait: ui.secretShareTrait.value })
    ));
    ui.specialTargetPlayer.addEventListener("change", renderPrivateState);
    for (const [scenarioType, button] of Object.entries(ui.scenarioButtons)) {
      button.addEventListener("click", () => run(() => sendCommand("REVEAL_SCENARIO", { scenarioType })));
    }
    ui.threatSurvived.addEventListener("click", () => {
      if (window.confirm("\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C, \u0447\u0442\u043E \u0444\u0438\u043D\u0430\u043B\u0438\u0441\u0442\u044B \u0441\u043F\u0440\u0430\u0432\u0438\u043B\u0438\u0441\u044C \u0441\u043E \u0432\u0441\u0435\u043C\u0438 \u0443\u0433\u0440\u043E\u0437\u0430\u043C\u0438?")) {
        run(() => sendCommand("RESOLVE_THREAT", { outcome: "survived" }));
      }
    });
    ui.threatNonlethalFailed.addEventListener("click", () => {
      if (window.confirm("\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C, \u0447\u0442\u043E \u0441\u043C\u0435\u0440\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0443\u0433\u0440\u043E\u0437\u044B \u0443\u0441\u0442\u0440\u0430\u043D\u0435\u043D\u044B, \u043D\u043E \u0434\u043E\u043C\u043E\u0432\u043E\u0433\u043E \u043D\u0435 \u043F\u043E\u0439\u043C\u0430\u043B\u0438? \u0424\u0438\u043D\u0430\u043B\u0438\u0441\u0442\u044B \u043F\u043E\u0442\u0435\u0440\u044F\u044E\u0442 \u0431\u0430\u0433\u0430\u0436.")) {
        run(() => sendCommand("RESOLVE_THREAT", { outcome: "nonlethal_failed" }));
      }
    });
    ui.threatFailed.addEventListener("click", () => {
      const onlyNonlethal = Number(publicState?.threatResolution?.lethalThreatCount ?? 0) === 0 && Number(publicState?.threatResolution?.nonlethalThreatCount ?? 0) > 0;
      const message = onlyNonlethal ? "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C, \u0447\u0442\u043E \u0434\u043E\u043C\u043E\u0432\u043E\u0433\u043E \u043D\u0435 \u043F\u043E\u0439\u043C\u0430\u043B\u0438? \u0424\u0438\u043D\u0430\u043B\u0438\u0441\u0442\u044B \u043F\u043E\u0442\u0435\u0440\u044F\u044E\u0442 \u0431\u0430\u0433\u0430\u0436, \u043D\u043E \u043E\u0441\u0442\u0430\u043D\u0443\u0442\u0441\u044F \u0436\u0438\u0432\u044B." : "\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C \u043F\u0430\u0440\u0442\u0438\u044E \u043F\u043E\u0440\u0430\u0436\u0435\u043D\u0438\u0435\u043C \u0431\u0443\u043D\u043A\u0435\u0440\u0430?";
      if (window.confirm(message)) {
        run(() => sendCommand("RESOLVE_THREAT", { outcome: "failed" }));
      }
    });
    ui.hostApplyCapacity.addEventListener("click", () => run(() => sendHostEdit({
      action: "set_capacity",
      capacity: Number(ui.hostEditCapacity.value)
    })));
    ui.hostApplyTrait.addEventListener("click", () => run(() => sendHostEdit({
      action: "set_trait",
      playerId: ui.hostEditPlayer.value,
      trait: ui.hostEditTrait.value,
      value: ui.hostEditValue.value,
      revealed: ui.hostEditRevealed.checked
    })));
    ui.hostRandomTrait.addEventListener("click", () => run(() => sendHostEdit({
      action: "random_trait",
      playerId: ui.hostEditPlayer.value,
      trait: ui.hostEditTrait.value,
      revealed: ui.hostEditRevealed.checked
    })));
    ui.hostApplyStatus.addEventListener("click", () => run(() => sendHostEdit({
      action: "set_status",
      playerId: ui.hostEditPlayer.value,
      status: ui.hostEditStatus.value
    })));
    ui.hostAddScenario.addEventListener("click", () => run(() => sendHostEdit({
      action: "add_scenario",
      scenarioType: ui.hostEditScenarioType.value,
      title: ui.hostEditScenarioTitle.value,
      description: ui.hostEditScenarioDescription.value
    })));
    ui.hostRandomScenario.addEventListener("click", () => run(() => sendHostEdit({
      action: "add_scenario",
      scenarioType: ui.hostEditScenarioType.value,
      random: true
    })));
    ui.hostSpecialCard.addEventListener("change", renderSpecialPreview);
    ui.hostAssignSpecial.addEventListener("click", () => run(() => sendHostEdit({
      action: "set_special",
      playerId: ui.hostSpecialPlayer.value,
      specialId: Number(ui.hostSpecialCard.value),
      revealed: ui.hostSpecialRevealed.checked
    })));
    ui.scenarioGrid.addEventListener("click", (event) => {
      const bunkerVote = event.target.closest("[data-bunker-vote-submit]");
      if (bunkerVote && !bunkerVote.disabled) {
        const controls = bunkerVote.closest("[data-bunker-vote-controls]");
        const targetId = controls?.querySelector("[data-bunker-vote-target]")?.value;
        if (targetId) run(() => sendCommand("BUNKER_VOTE", { targetId }));
        return;
      }
      const resolveBunkerVote2 = event.target.closest("[data-bunker-vote-resolve]");
      if (resolveBunkerVote2 && !resolveBunkerVote2.disabled) {
        run(() => sendCommand("RESOLVE_BUNKER_VOTE"));
        return;
      }
      const button = event.target.closest("[data-remove-scenario]");
      if (button) run(() => sendHostEdit({
        action: "remove_scenario",
        scenarioType: button.dataset.scenarioType,
        cardId: button.dataset.removeScenario
      }));
      const primary = event.target.closest("[data-remove-primary-scenario]");
      if (primary) run(() => sendHostEdit({
        action: "remove_primary_scenario",
        scenarioType: primary.dataset.removePrimaryScenario
      }));
    });
    ui.scenarioGrid.addEventListener("change", (event) => {
      const select2 = event.target.closest("[data-bunker-vote-target]");
      if (select2) selectedBunkerVoteTarget = select2.value;
    });
    ui.hostPlays.addEventListener("change", () => run(syncRoomSettings));
    ui.developerMode.addEventListener("change", () => run(syncRoomSettings));
    ui.playerCount.addEventListener("change", () => {
      syncBunkerCapacityControl();
      run(syncRoomSettings);
    });
    ui.playersList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-kick-player]");
      if (button) run(() => kickPlayer(button.dataset.kickPlayer));
    });
  }
  async function loadMultiplayerClass() {
    if (IS_FILE_MODE) return LocalMultiplayer;
    const onlineModulePath = "../../modules/Multiplayer.js";
    return (await import(onlineModulePath)).Multiplayer;
  }
  function normalizeRoomId(value) {
    return IS_FILE_MODE ? LocalMultiplayer.normalizeRoomId(value) : String(value ?? "").toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
  }
  function initSpecialCatalog() {
    ui.hostSpecialCard.replaceChildren(...SPECIAL_CARDS.map((card) => {
      const option = document.createElement("option");
      option.value = String(card.id);
      option.textContent = `\u2116${card.id} \xB7 ${specialCardTitle(card.text)}`;
      return option;
    }));
    renderSpecialPreview();
  }
  function specialCardTitle(text) {
    const title = String(text).split(":")[0].trim();
    return title.length <= 54 ? title : `${title.slice(0, 51)}\u2026`;
  }
  function specialUsage(specialId) {
    const afterExile = [1, 11, 24, 30, 38];
    const beforeVoting = [46, 47, 48, 49, 51, 52, 57, 58, 65, 68, 69, 70];
    const currentVoting = [4, 12, 20, 53];
    const roundStart = [59, 60, 61, 62, 63];
    const reaction = [50, 71];
    const targetPlayer = [2, 12, 16, 17, 18, 20, 21, 22, 23, 25, 27, 29, 38, 41, 42, 44, 45, 49, 55, 56, 67];
    const targetTrait = [26, 31, 56, 67];
    const targetScenario = [1, 3, 11, 64];
    const choice = [53, 57, 69];
    const timing = afterExile.includes(specialId) ? "\u043F\u043E\u0441\u043B\u0435 \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u044F \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u0430" : beforeVoting.includes(specialId) ? "\u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C" : currentVoting.includes(specialId) ? "\u0434\u043E \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F \u0442\u0435\u043A\u0443\u0449\u0435\u0433\u043E \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F" : roundStart.includes(specialId) ? "\u0432 \u043D\u0430\u0447\u0430\u043B\u0435 2\u20134 \u0440\u0430\u0443\u043D\u0434\u0430" : reaction.includes(specialId) ? "\u0441\u0440\u0430\u0437\u0443 \u043F\u043E\u0441\u043B\u0435 \u0447\u0443\u0436\u043E\u0439 \u043E\u0441\u043E\u0431\u043E\u0439 \u043A\u0430\u0440\u0442\u044B" : specialId === 28 ? "\u0432\u043E \u0432\u0440\u0435\u043C\u044F \u0438\u043B\u0438 \u0441\u0440\u0430\u0437\u0443 \u043F\u043E\u0441\u043B\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F" : specialId === 26 ? "\u0432\u043E \u0432\u0440\u0435\u043C\u044F \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u0438\u044F \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A" : "\u0432 \u043B\u044E\u0431\u043E\u0439 \u043C\u043E\u043C\u0435\u043D\u0442, \u043F\u043E\u043A\u0430 \u0432\u043B\u0430\u0434\u0435\u043B\u0435\u0446 \u0432 \u0438\u0433\u0440\u0435";
    const inputs = [];
    if (targetPlayer.includes(specialId)) inputs.push("\u0438\u0433\u0440\u043E\u043A");
    if (targetTrait.includes(specialId)) inputs.push("\u0442\u0438\u043F \u043A\u0430\u0440\u0442\u044B");
    if (targetScenario.includes(specialId)) inputs.push("\u043A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430");
    if (choice.includes(specialId)) inputs.push("\u0432\u0430\u0440\u0438\u0430\u043D\u0442 \u044D\u0444\u0444\u0435\u043A\u0442\u0430");
    return { timing, inputs, targetPlayer, targetTrait, targetScenario, choice };
  }
  function currentSpecialUsage(specialId) {
    const usage = specialUsage(specialId);
    if (specialId !== 50) return usage;
    const inputTypes = publicState?.lastSpecial?.inputTypes ?? [];
    const targetPlayer = inputTypes.includes("targetId") ? [50] : [];
    const targetTrait = inputTypes.includes("trait") ? [50] : [];
    const targetScenario = inputTypes.includes("scenarioTarget") ? [50] : [];
    const choice = inputTypes.includes("choice") ? [50] : [];
    const inputs = [];
    if (targetPlayer.length) inputs.push("\u043D\u043E\u0432\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430");
    if (targetTrait.length) inputs.push("\u043D\u043E\u0432\u044B\u0439 \u0442\u0438\u043F \u043A\u0430\u0440\u0442\u044B");
    if (targetScenario.length) inputs.push("\u043D\u043E\u0432\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0431\u0443\u043D\u043A\u0435\u0440\u0430");
    if (choice.length) inputs.push("\u043D\u043E\u0432\u044B\u0439 \u0432\u0430\u0440\u0438\u0430\u043D\u0442 \u044D\u0444\u0444\u0435\u043A\u0442\u0430");
    return { ...usage, inputs, targetPlayer, targetTrait, targetScenario, choice };
  }
  function renderSpecialPreview() {
    const card = SPECIAL_CARDS.find((item) => item.id === Number(ui.hostSpecialCard.value)) ?? SPECIAL_CARDS[0];
    const usage = specialUsage(card.id);
    ui.hostSpecialPreview.querySelector("strong").textContent = `\u2116${card.id} \xB7 ${specialCardTitle(card.text)}`;
    ui.hostSpecialPreview.querySelector("span").textContent = card.text;
    ui.hostSpecialPreview.querySelector("small").textContent = `\u0423\u0441\u043B\u043E\u0432\u0438\u0435 \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0438\u044F: ${usage.timing}. ${usage.inputs.length ? `\u041D\u0443\u0436\u043D\u043E \u0432\u044B\u0431\u0440\u0430\u0442\u044C: ${usage.inputs.join(", ")}.` : "\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0432\u044B\u0431\u043E\u0440 \u043D\u0435 \u043D\u0443\u0436\u0435\u043D."}`;
  }
  async function restoreRoom() {
    const savedRoom = localStorage.getItem(ROOM_STORAGE_KEY);
    if (!savedRoom) return;
    try {
      const roomCode = await joinRoom(savedRoom, readPlayerName());
      showConnectedRoom(roomCode);
      setStatus("\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E");
    } catch (error) {
      localStorage.removeItem(ROOM_STORAGE_KEY);
      showLobbyForm();
      ui.onlineError.textContent = `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u0435\u0440\u043D\u0443\u0442\u044C\u0441\u044F \u0432 \u043A\u043E\u043C\u043D\u0430\u0442\u0443: ${friendlyError(error)}`;
    }
  }
  function restorePlayerName() {
    const savedName = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    if (savedName) ui.onlineName.value = savedName;
  }
  function readPlayerName() {
    const playerName = ui.onlineName.value.trim().replace(/\s+/g, " ").slice(0, 24) || "\u0418\u0433\u0440\u043E\u043A";
    ui.onlineName.value = playerName;
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, playerName);
    return playerName;
  }
  async function createRoom(playerName, maxPlayers) {
    const roomCode = await multiplayer.createRoom(playerName, maxPlayers, null, GAME_TYPE);
    await multiplayer.setRoomSettings(readRoomSettingsFromControls());
    localStorage.setItem(ROOM_STORAGE_KEY, roomCode);
    connectToRoom();
    return roomCode;
  }
  async function joinRoom(roomCode, playerName) {
    const normalizedCode = await multiplayer.joinRoom(roomCode, playerName, null, GAME_TYPE);
    localStorage.setItem(ROOM_STORAGE_KEY, normalizedCode);
    connectToRoom();
    return normalizedCode;
  }
  function connectToRoom() {
    resetDeveloperBotScheduler();
    multiplayer.clearListeners();
    commandListenerStarted = false;
    commandQueue = Promise.resolve();
    hasSeenRoom = false;
    leavingRoom = false;
    multiplayer.subscribeRoom((roomState) => {
      if (hasSeenRoom && !roomState?.meta) {
        run(() => handleRoomUnavailable("\u041A\u043E\u043C\u043D\u0430\u0442\u0430 \u0431\u044B\u043B\u0430 \u0437\u0430\u043A\u0440\u044B\u0442\u0430 \u0432\u0435\u0434\u0443\u0449\u0438\u043C."));
        return;
      }
      if (roomState?.meta) hasSeenRoom = true;
      if (hasSeenRoom && roomState?.players !== null && !roomState?.players?.[multiplayer.user.uid]) {
        run(() => handleRoomUnavailable("\u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u0443\u0434\u0430\u043B\u0438\u043B \u0432\u0430\u0441 \u0438\u0437 \u043A\u043E\u043C\u043D\u0430\u0442\u044B."));
        return;
      }
      room = {
        meta: roomState?.meta ?? {},
        players: roomState?.players ?? {}
      };
      renderRoom();
    });
    multiplayer.subscribePublicState((state) => {
      publicState = state ?? null;
      renderGame();
    });
    multiplayer.subscribeHand((state) => {
      privateState = normalizePrivateState(state);
      renderPrivateState();
      if (botActionTimer && shouldDelayForHumanReaction()) {
        window.clearTimeout(botActionTimer);
        botActionTimer = 0;
        botActionRevision = -1;
        scheduleDeveloperBots();
      }
    });
  }
  function renderRoom() {
    if (!room?.meta?.hostId) return;
    showConnectedRoom(multiplayer.roomId);
    const entries = Object.entries(room.players ?? {});
    const host = isHost();
    const playing = room.meta.status !== "lobby";
    const settings = getRoomSettings();
    ui.playerCount.value = String(settings.playerCount);
    ui.bunkerCapacity.value = String(settings.bunkerCapacity);
    ui.hostPlays.checked = settings.hostPlays;
    ui.developerMode.checked = settings.developerMode;
    ui.modeHost.disabled = !host;
    ui.hostModeTab.hidden = !host;
    ui.startGame.hidden = !host || playing;
    ui.restartRoom.hidden = !host || !playing;
    ui.setupPanel.hidden = playing;
    ui.hostPlays.disabled = !host || playing;
    ui.developerMode.disabled = !host || playing;
    ui.playerCount.disabled = !host || playing;
    ui.bunkerCapacity.disabled = true;
    if (host && playing && publicState?.players) {
      ui.hostPlays.checked = Boolean(publicState.players[room.meta.hostId]);
    }
    document.body.classList.toggle("host-is-player", host && Boolean(publicState?.players?.[room.meta.hostId]));
    if (host) {
      ui.modeHost.checked = true;
      startCommandListener();
    } else {
      ui.modePlayer.checked = true;
    }
    if (publicState?.phase) renderGame();
    else renderWaitingPlayers(entries);
    const humanParticipants = entries.filter(([id, player]) => player.online !== false && (settings.hostPlays || id !== room.meta.hostId));
    const participants = settings.developerMode ? fillWithDeveloperBots(humanParticipants, settings.playerCount) : humanParticipants;
    const expected = settings.playerCount;
    ui.startGame.disabled = !host || playing || humanParticipants.length > expected || !settings.developerMode && participants.length !== expected;
    if (publicState?.players) {
      ui.playersAlive.textContent = Object.values(publicState.players).filter((player) => player.status === "active").length;
      ui.playersTotal.textContent = Object.keys(publicState.players).length;
    } else {
      ui.playersAlive.textContent = participants.length;
      ui.playersTotal.textContent = expected;
    }
    if (!playing) {
      setStatus(host ? `\u041B\u043E\u0431\u0431\u0438: ${participants.length}/${expected} \u0438\u0433\u0440\u043E\u043A\u043E\u0432` : `\u041B\u043E\u0431\u0431\u0438: ${participants.length}/${expected} \u0438\u0433\u0440\u043E\u043A\u043E\u0432. \u0416\u0434\u0451\u043C \u0432\u0435\u0434\u0443\u0449\u0435\u0433\u043E.`);
    }
  }
  function getRoomSettings() {
    const settings = room?.meta?.settings ?? {};
    const playerCount = normalizeRoomNumber(settings.playerCount, 8, 4, 16);
    return {
      playerCount,
      bunkerCapacity: getOfficialBunkerCapacity(playerCount),
      hostPlays: settings.hostPlays === true,
      developerMode: settings.developerMode === true
    };
  }
  function readRoomSettingsFromControls() {
    const playerCount = normalizeRoomNumber(ui.playerCount.value, 8, 4, 16);
    return {
      playerCount,
      bunkerCapacity: getOfficialBunkerCapacity(playerCount),
      hostPlays: ui.hostPlays.checked,
      developerMode: ui.developerMode.checked
    };
  }
  function syncBunkerCapacityControl() {
    const playerCount = normalizeRoomNumber(ui.playerCount.value, 8, 4, 16);
    ui.bunkerCapacity.value = String(getOfficialBunkerCapacity(playerCount));
  }
  function normalizeRoomNumber(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
  }
  async function syncRoomSettings() {
    if (!isHost() || room?.meta?.status !== "lobby") return;
    await multiplayer.setRoomSettings(readRoomSettingsFromControls());
  }
  function renderWaitingPlayers(entries) {
    const settings = getRoomSettings();
    const participants = entries.filter(([id, player]) => player.online !== false && (settings.hostPlays || id !== room.meta.hostId));
    const waitingEntries = settings.developerMode ? fillWithDeveloperBots(participants, settings.playerCount) : entries;
    const waitingPlayers = Object.fromEntries(waitingEntries.map(([id, player]) => [id, {
      id,
      name: player.name,
      status: player.online === false ? "offline" : "active",
      revealedTraits: {}
    }]));
    renderRosters(waitingPlayers, [], -1);
    ui.activePlayerLabel.textContent = "\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u0438\u0433\u0440\u043E\u043A\u043E\u0432";
  }
  function renderGame() {
    document.body.classList.toggle("has-game", Boolean(publicState?.phase));
    if (!publicState?.phase) {
      document.body.classList.remove("has-pending-bunker-vote");
      setRoundDrawer(false, false);
      ui.eventLog.replaceChildren();
      ui.votePanel.hidden = true;
      ui.hostEditor.hidden = true;
      ui.specialControls.hidden = true;
      ui.scenarioGrid.querySelectorAll(".scenario-card--extra").forEach((card) => card.remove());
      return;
    }
    const commandError = publicState.commandErrors?.[multiplayer?.user?.uid];
    if (commandError && Number(commandError.createdAt) > lastCommandErrorAt) {
      lastCommandErrorAt = Number(commandError.createdAt);
      ui.onlineError.textContent = commandError.message;
      setStatus(commandError.message);
    }
    const players = publicState.players ?? {};
    const activePlayers = Object.values(players).filter((player) => player.status === "active");
    const bunkerVotePending = Boolean(publicState.pendingBunkerVote);
    if (!bunkerVotePending) selectedBunkerVoteTarget = "";
    const hostIsPlayer = isHost() && Boolean(players[room?.meta?.hostId]);
    document.body.classList.toggle("host-is-player", hostIsPlayer);
    document.body.classList.toggle("has-pending-bunker-vote", bunkerVotePending);
    if (isHost() && room?.meta?.status !== "lobby") ui.hostPlays.checked = hostIsPlayer;
    ui.roundCurrent.textContent = Number(publicState.round ?? 0);
    ui.roundTotal.textContent = Number(publicState.totalRounds ?? 0);
    ui.roundToggleCurrent.textContent = Number(publicState.round ?? 0);
    ui.roundToggleTotal.textContent = Number(publicState.totalRounds ?? 0);
    ui.playersAlive.textContent = activePlayers.length;
    ui.playersTotal.textContent = Object.keys(players).length;
    ui.bunkerSlots.textContent = Number(publicState.capacity ?? 0);
    const visiblePhase = bunkerVotePending ? bunkerVoteTitle(publicState.pendingBunkerVote) : getDetailedPhaseLabel(publicState.phase);
    ui.roundPhase.textContent = visiblePhase;
    ui.roundTogglePhase.textContent = visiblePhase;
    ui.setupPanel.hidden = true;
    renderRosters(players, publicState.order ?? [], publicState.currentPlayerIndex ?? -1);
    renderScenarios();
    renderVoting();
    renderLog();
    renderControls();
    renderRoundProgress();
    renderHostEditor();
    renderPrivateState();
    scheduleDeveloperBots();
    if (publicState.phase === PHASES.FINISHED) {
      setStatus(publicState.threatResolution?.status === "failed" ? "\u0424\u0438\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430 \u043D\u0435 \u0443\u0441\u0442\u0440\u0430\u043D\u0435\u043D\u0430 \u2014 \u0431\u0443\u043D\u043A\u0435\u0440 \u043D\u0435 \u0432\u044B\u0436\u0438\u043B" : `\u0411\u0443\u043D\u043A\u0435\u0440 \u0432\u044B\u0436\u0438\u043B: ${activePlayers.map((player) => player.name).join(", ")}`);
    } else {
      setStatus(getStatusMessage());
    }
  }
  function getScheduledVotesForRound(round) {
    const normalizedRound = Math.max(1, Number(round ?? 1));
    const currentRound = Number(publicState?.round ?? 0);
    const currentTarget = Number(publicState?.roundVoteTarget);
    if (normalizedRound === currentRound && Number.isFinite(currentTarget)) {
      return Math.max(0, currentTarget);
    }
    const schedule = publicState?.voteSchedule;
    if (Array.isArray(schedule)) {
      const totalRounds = Math.max(1, Number(publicState?.totalRounds ?? 5));
      const index = schedule.length > totalRounds ? normalizedRound : normalizedRound - 1;
      return Math.max(0, Number(schedule[index] ?? 0));
    }
    if (schedule && typeof schedule === "object") {
      return Math.max(0, Number(schedule[normalizedRound] ?? 0));
    }
    return normalizedRound === 1 ? 0 : 1;
  }
  function getCurrentRoundVoteProgress() {
    const target = getScheduledVotesForRound(publicState?.round);
    const completed = Math.min(target, Math.max(0, Number(publicState?.roundVotesCompleted ?? 0)));
    const resultAlreadyCounted = publicState?.phase === PHASES.RESULTS && publicState?.voteResult?.status === "exiled";
    const current = target > 0 ? Math.min(target, Math.max(1, completed + (resultAlreadyCounted ? 0 : 1))) : 0;
    return { target, completed, current };
  }
  function getVoteProgressText() {
    const { target, current } = getCurrentRoundVoteProgress();
    return target > 0 ? `${current}/${target}` : "";
  }
  function voteCountText(count) {
    const value = Math.max(0, Number(count) || 0);
    const remainder100 = value % 100;
    const remainder10 = value % 10;
    const noun = remainder100 >= 11 && remainder100 <= 14 ? "\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0439" : remainder10 === 1 ? "\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435" : remainder10 >= 2 && remainder10 <= 4 ? "\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F" : "\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0439";
    return `${value} ${noun}`;
  }
  function getDetailedPhaseLabel(phase) {
    const { target, completed } = getCurrentRoundVoteProgress();
    const progress = getVoteProgressText();
    if (phase === PHASES.VOTING && progress) return `\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 ${progress}`;
    if (phase === PHASES.RESULTS && progress) return `\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F ${progress}`;
    if (phase === PHASES.DISCUSSION && completed < target && progress) return `\u041E\u0431\u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0435 \xB7 \u0434\u0430\u043B\u0435\u0435 ${progress}`;
    if (phase === PHASES.DISCUSSION && completed >= target) return "\u041E\u0431\u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0435 \xB7 \u0431\u0435\u0437 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F";
    return getPhaseLabel(phase);
  }
  function getRoundTimelineStatus(round, complete, current) {
    const target = getScheduledVotesForRound(round);
    if (complete) return target > 0 ? `\u041F\u0440\u043E\u0439\u0434\u0435\u043D\u043E \xB7 ${voteCountText(target)}` : "\u041F\u0440\u043E\u0439\u0434\u0435\u043D\u043E \xB7 \u0431\u0435\u0437 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F";
    if (!current) return target > 0 ? `\u041E\u0436\u0438\u0434\u0430\u0435\u0442 \xB7 ${voteCountText(target)}` : "\u041E\u0436\u0438\u0434\u0430\u0435\u0442 \xB7 \u0431\u0435\u0437 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F";
    const phase = publicState?.phase;
    const progress = getVoteProgressText();
    if ([PHASES.VOTING, PHASES.RESULTS].includes(phase) && progress) {
      return `${getPhaseLabel(phase)} \xB7 ${progress}`;
    }
    if (target === 0) return `${getPhaseLabel(phase)} \xB7 \u0431\u0435\u0437 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F`;
    if (phase === PHASES.DISCUSSION && progress) return `\u041E\u0431\u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0435 \xB7 \u0434\u0430\u043B\u0435\u0435 ${progress}`;
    return `${getPhaseLabel(phase)} \xB7 ${voteCountText(target)}`;
  }
  function renderRoundProgress() {
    const currentRound = Number(publicState?.round ?? 0);
    const totalRounds = Math.max(currentRound, Number(publicState?.totalRounds ?? 0));
    const finalStage = [PHASES.THREAT, PHASES.FINISHED].includes(publicState?.phase);
    const items = Array.from({ length: totalRounds }, (_, index) => {
      const round = index + 1;
      const item = document.createElement("li");
      const number = document.createElement("b");
      const label = document.createElement("span");
      const status = document.createElement("small");
      const complete = round < currentRound || finalStage && round === currentRound;
      const current = round === currentRound && !finalStage;
      number.textContent = String(round).padStart(2, "0");
      label.textContent = `\u0420\u0430\u0443\u043D\u0434 ${round}`;
      status.textContent = getRoundTimelineStatus(round, complete, current);
      item.classList.toggle("is-complete", complete);
      item.classList.toggle("is-current", current);
      if (current) item.setAttribute("aria-current", "step");
      item.append(number, label, status);
      return item;
    });
    const resolution = publicState?.threatResolution;
    if (resolution) {
      const item = document.createElement("li");
      const number = document.createElement("b");
      const label = document.createElement("span");
      const status = document.createElement("small");
      const pending = publicState.phase === PHASES.THREAT && resolution.status === "pending";
      const failed = resolution.status === "failed";
      number.textContent = "!";
      label.textContent = "\u0424\u0438\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430";
      status.textContent = pending ? "\u0410\u043A\u0442\u0438\u0432\u043D\u0430" : failed ? "\u041D\u0435 \u043F\u0440\u043E\u0439\u0434\u0435\u043D\u0430" : Number(resolution.threatCount ?? 0) > 0 ? "\u0423\u0441\u0442\u0440\u0430\u043D\u0435\u043D\u0430" : "\u0423\u0433\u0440\u043E\u0437 \u043D\u0435\u0442";
      item.classList.toggle("is-current", pending);
      item.classList.toggle("is-complete", resolution.status === "survived");
      item.classList.toggle("is-failed", failed);
      if (pending) item.setAttribute("aria-current", "step");
      item.append(number, label, status);
      items.push(item);
    }
    ui.roundProgress.replaceChildren(...items);
  }
  function renderRosters(players, order, currentIndex) {
    const entries = Object.entries(players);
    const currentId = currentIndex >= 0 ? order[currentIndex] : "";
    ui.playerRoster.replaceChildren(...entries.map(([id, player]) => {
      const row = document.createElement("p");
      const isCurrent = id === currentId;
      const summary = document.createElement("span");
      const name = document.createElement("b");
      const traits = document.createElement("small");
      const status = document.createElement("em");
      const revealed = Object.entries(player.revealedTraits ?? {}).filter(([, value]) => value);
      const shuffleLabel = currentTraitShuffleLabel(id);
      name.textContent = player.name;
      traits.textContent = revealed.length ? revealed.map(([trait, value]) => `${TRAIT_LABELS[trait]}: ${value}`).join(" \xB7 ") : "\u041A\u0430\u0440\u0442\u044B \u043D\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B";
      status.textContent = playerStatus(player, id === currentId, id);
      summary.append(name, traits);
      if (shuffleLabel) summary.append(createTraitShuffleBadge(shuffleLabel));
      row.append(summary, status);
      row.classList.toggle("is-current-turn", isCurrent);
      row.classList.toggle("is-dead", player.status === "dead");
      row.classList.toggle("is-bunker-king", Boolean(player.bunkerKing));
      row.classList.toggle("has-trait-shuffle", Boolean(shuffleLabel));
      if (isCurrent) row.setAttribute("aria-current", "true");
      return row;
    }));
    ui.playersList.replaceChildren(...entries.map(([id, player], index) => {
      const row = ui.playerTemplate.content.firstElementChild.cloneNode(true);
      const revealed = Object.entries(player.revealedTraits ?? {}).filter(([, value]) => value);
      const shuffleLabel = currentTraitShuffleLabel(id);
      row.dataset.playerId = id;
      row.dataset.playerStatus = player.status;
      row.classList.toggle("is-active", id === currentId);
      row.classList.toggle("is-exiled", player.status === "exiled");
      row.classList.toggle("is-dead", player.status === "dead");
      row.classList.toggle("is-bunker-king", Boolean(player.bunkerKing));
      row.classList.toggle("is-bot", isDeveloperBot(id));
      row.querySelector(":scope > b").textContent = String(index + 1).padStart(2, "0");
      row.querySelector("strong").textContent = player.name;
      row.querySelector("small").textContent = revealed.length ? revealed.map(([trait, value]) => `${TRAIT_LABELS[trait]}: ${value}`).join(" \xB7 ") : "\u041A\u0430\u0440\u0442\u044B \u043D\u0435 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B";
      row.querySelector("em").textContent = playerStatus(player, id === currentId, id);
      row.classList.toggle("has-trait-shuffle", Boolean(shuffleLabel));
      if (shuffleLabel) row.querySelector(":scope > span").append(createTraitShuffleBadge(shuffleLabel));
      if (isHost() && room?.meta?.status === "lobby" && id !== room.meta.hostId) {
        const kick = document.createElement("button");
        kick.type = "button";
        kick.className = "kick-player";
        kick.dataset.kickPlayer = id;
        kick.textContent = "\u0423\u0434\u0430\u043B\u0438\u0442\u044C";
        row.append(kick);
      }
      return row;
    }));
    const currentPlayer = players[currentId];
    ui.activePlayerLabel.textContent = currentPlayer ? `\u0425\u043E\u0434: ${currentPlayer.name}` : getPhaseLabel(publicState?.phase);
    ui.activePlayerLabel.classList.toggle("has-active-turn", Boolean(currentPlayer));
  }
  function currentTraitShuffleLabel(playerId) {
    const shuffle2 = publicState?.lastTraitShuffle;
    if (!shuffle2 || Number(shuffle2.round) !== Number(publicState?.round) || !(shuffle2.affectedIds ?? []).includes(playerId)) {
      return "";
    }
    return `\u041F\u0435\u0440\u0435\u0440\u0430\u0437\u0434\u0430\u043D\u043E: ${TRAIT_LABELS[shuffle2.trait] ?? "\u043E\u0442\u043A\u0440\u044B\u0442\u0430\u044F \u043A\u0430\u0440\u0442\u0430"}`;
  }
  function createTraitShuffleBadge(label) {
    const badge = document.createElement("span");
    badge.className = "trait-shuffle-badge";
    badge.textContent = `\u21BB ${label}`;
    return badge;
  }
  function playerStatus(player, isCurrent, playerId) {
    const king = player.bunkerKing ? "\u0426\u0430\u0440\u044C \xB7 " : "";
    if (player.status === "dead") return `${king}\u041F\u043E\u0433\u0438\u0431`;
    if (player.status === "exiled") {
      const canStillVote = playerId === publicState?.lastExiledPlayerId || player.persistentVoter;
      return canStillVote ? `${king}\u0418\u0437\u0433\u043D\u0430\u043D \xB7 \u043F\u0440\u0430\u0432\u043E \u0433\u043E\u043B\u043E\u0441\u0430` : `${king}\u0418\u0437\u0433\u043D\u0430\u043D`;
    }
    if (player.status === "offline" || room?.players?.[playerId]?.online === false) return `${king}\u041D\u0435 \u0432 \u0441\u0435\u0442\u0438`;
    if (isCurrent) return `${king}\u0425\u043E\u0434\u0438\u0442 \u0441\u0435\u0439\u0447\u0430\u0441`;
    return `${king}\u0412 \u0438\u0433\u0440\u0435`;
  }
  function renderPrivateState() {
    const myId = multiplayer?.user?.uid;
    const myPublicState = publicState?.players?.[myId];
    const bunkerVotePending = Boolean(publicState?.pendingBunkerVote);
    const myTurn = !bunkerVotePending && publicState?.phase === PHASES.REVEAL && publicState.order?.[publicState.currentPlayerIndex] === myId;
    const currentPlayerId = publicState?.order?.[publicState.currentPlayerIndex];
    const currentPlayer = currentPlayerId ? publicState?.players?.[currentPlayerId] : null;
    const revealPhase = publicState?.phase === PHASES.REVEAL;
    const requiredTrait = publicState?.requiredTrait;
    const ordinaryTraitKeys = TRAIT_KEYS.filter((trait) => trait !== "special");
    const revealedOrdinaryCount = ordinaryTraitKeys.filter((trait) => myPublicState?.revealedTraits?.[trait]).length;
    const ordinaryRevealLimitReached = revealedOrdinaryCount >= ordinaryTraitKeys.length - 1;
    const mustRevealRequiredTrait = Boolean(
      requiredTrait && myPublicState && !myPublicState.revealedTraits?.[requiredTrait] && !ordinaryRevealLimitReached
    );
    ui.turnPanel.classList.toggle("is-my-turn", myTurn);
    ui.turnPanel.classList.toggle("is-waiting-turn", revealPhase && !myTurn);
    if (bunkerVotePending) {
      ui.turnKicker.textContent = "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430";
      ui.turnTitle.textContent = bunkerVoteTitle(publicState.pendingBunkerVote);
      ui.turnDescription.textContent = "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u043F\u0430\u0440\u0442\u0438\u0438 \u0438 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u044D\u0442\u043E\u0439 \u043A\u0430\u0440\u0442\u044B.";
    } else if (myTurn) {
      ui.turnKicker.textContent = "\u0421\u0435\u0439\u0447\u0430\u0441 \u0432\u0430\u0448 \u0445\u043E\u0434";
      ui.turnTitle.textContent = ordinaryRevealLimitReached ? "\u041F\u044F\u0442\u044C \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B" : mustRevealRequiredTrait ? `\u0420\u0430\u0441\u043A\u0440\u043E\u0439\u0442\u0435: ${TRAIT_LABELS[requiredTrait]}` : "\u0420\u0430\u0441\u043A\u0440\u043E\u0439\u0442\u0435 \u043E\u0434\u043D\u0443 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0443";
      ui.turnDescription.textContent = ordinaryRevealLimitReached ? "\u041E\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u044E\u044E \u043E\u0431\u044B\u0447\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0441\u043A\u0440\u044B\u0442\u043E\u0439 \u0438 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u0445\u043E\u0434." : mustRevealRequiredTrait ? "\u041E\u0441\u043E\u0431\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u0437\u0430\u0434\u0430\u043B\u0430 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0443 \u0434\u043B\u044F \u0432\u0441\u0435\u0445 \u0438\u0433\u0440\u043E\u043A\u043E\u0432 \u0432 \u044D\u0442\u043E\u043C \u0440\u0430\u0443\u043D\u0434\u0435." : "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0443 \u043D\u0438\u0436\u0435, \u0437\u0430\u0442\u0435\u043C \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u0445\u043E\u0434.";
    } else if (revealPhase && currentPlayer) {
      ui.turnKicker.textContent = "\u0421\u0435\u0439\u0447\u0430\u0441 \u0445\u043E\u0434\u0438\u0442";
      ui.turnTitle.textContent = currentPlayer.name;
      ui.turnDescription.textContent = "\u0414\u043E\u0436\u0434\u0438\u0442\u0435\u0441\u044C \u0441\u0432\u043E\u0435\u0433\u043E \u0445\u043E\u0434\u0430. \u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u0438\u0433\u0440\u043E\u043A \u0434\u043E\u043B\u0436\u0435\u043D \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044C \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0443.";
    } else {
      ui.turnKicker.textContent = "\u0422\u0435\u043A\u0443\u0449\u0430\u044F \u0444\u0430\u0437\u0430";
      ui.turnTitle.textContent = getPhaseLabel(publicState?.phase);
      ui.turnDescription.textContent = "\u0421\u043B\u0435\u0434\u0438\u0442\u0435 \u0437\u0430 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435\u043C \u0438\u0433\u0440\u044B \u0438 \u0443\u043A\u0430\u0437\u0430\u043D\u0438\u044F\u043C\u0438 \u0432\u0435\u0434\u0443\u0449\u0435\u0433\u043E.";
    }
    for (const card of ui.characterTraits.querySelectorAll("[data-trait]")) {
      const trait = card.dataset.trait;
      const isSpecial = trait === "special";
      const valueElement = card.querySelector("[data-trait-value]");
      const button = card.querySelector("button");
      const revealed = Boolean(myPublicState?.revealedTraits?.[trait]);
      valueElement.textContent = privateState?.[trait] || "\u041D\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u043E";
      card.classList.toggle("is-revealed", revealed);
      card.classList.toggle("is-required", mustRevealRequiredTrait && trait === requiredTrait);
      button.textContent = revealed ? "\u0420\u0430\u0441\u043A\u0440\u044B\u0442\u043E" : "\u0420\u0430\u0441\u043A\u0440\u044B\u0442\u044C";
      button.disabled = bunkerVotePending || !myTurn || revealed || !isSpecial && ordinaryRevealLimitReached || !isSpecial && Boolean(myPublicState?.revealedThisTurn) || !isSpecial && mustRevealRequiredTrait && trait !== requiredTrait;
    }
    const hasHiddenOrdinaryTraits = TRAIT_KEYS.some((trait) => trait !== "special" && !myPublicState?.revealedTraits?.[trait]);
    const canFinish = !bunkerVotePending && myTurn && (Boolean(myPublicState?.revealedThisTurn) || !hasHiddenOrdinaryTraits || ordinaryRevealLimitReached);
    ui.finishTurn.disabled = !canFinish;
    ui.hostFinishTurn.disabled = !canFinish;
    ui.hostDossier.hidden = !isHost() || !myPublicState;
    const pendingShare = publicState?.pendingSecretShare?.targetId === myId ? publicState.pendingSecretShare : null;
    const pendingSpecial = privateState?.pendingSpecialChoice?.playerId === myId ? privateState.pendingSpecialChoice : null;
    const specialId = Number(privateState?.specialId ?? 0);
    const hasSpecial = specialId > 0 && Boolean(privateState?.special);
    const specialUi = currentSpecialUsage(specialId);
    const availability = hasSpecial ? getSpecialAvailability(publicState, myId, specialId) : { allowed: false, reason: "\u041E\u0441\u043E\u0431\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u043D\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u0430." };
    const canReactDuringBunkerVote = bunkerVotePending && [50, 71].includes(specialId) && availability.allowed;
    const completesPendingAction = Boolean(pendingSpecial);
    const bunkerVoteLocksSpecial = bunkerVotePending && !canReactDuringBunkerVote && !completesPendingAction;
    ui.specialControls.classList.toggle("can-react-during-bunker-vote", canReactDuringBunkerVote);
    renderSpecialTargetOptions(specialId, myId);
    renderSpecialTraitOptions(specialId, myId, false);
    renderSpecialScenarioOptions();
    renderSpecialChoiceOptions(pendingSpecial, specialId);
    renderSecretShareResponse(pendingShare, myId);
    const formIssue = specialFormIssue(specialUi, specialId, false, Boolean(pendingSpecial));
    const specialUsed = Boolean(myPublicState?.specialUsed);
    const hideSpecialInputs = specialUsed && !pendingSpecial;
    ui.specialGuide.textContent = bunkerVoteLocksSpecial ? "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0439 \u043A\u0430\u0440\u0442\u044B \u0431\u0443\u043D\u043A\u0435\u0440\u0430." : pendingShare ? "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0434\u043B\u044F \u043E\u0431\u043C\u0435\u043D\u0430. \u0415\u0441\u043B\u0438 \u0445\u043E\u0442\u0438\u0442\u0435 \u043F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C \u0440\u0435\u0430\u043A\u0446\u0438\u044E \u211650 \u0438\u043B\u0438 \u211671, \u0440\u0430\u0437\u044B\u0433\u0440\u0430\u0439\u0442\u0435 \u0435\u0451 \u0434\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438." : pendingSpecial ? "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043E\u0434\u043D\u0443 \u0438\u0437 \u0434\u0432\u0443\u0445 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u043D\u044B\u0445 \u043A\u0430\u0440\u0442 \u0431\u0443\u043D\u043A\u0435\u0440\u0430." : myPublicState?.specialUsed ? `\u041A\u0430\u0440\u0442\u0430 \u2116${specialId} \u0443\u0436\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0430.` : !availability.allowed ? `\u041A\u0430\u0440\u0442\u0430 \u2116${specialId} \u043F\u043E\u043A\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430: ${availability.reason}` : `\u041A\u0430\u0440\u0442\u0430 \u2116${specialId} \xB7 ${specialCardTitle(privateState.special)}. \u0423\u0441\u043B\u043E\u0432\u0438\u0435: ${specialUi.timing}.${specialUi.inputs.length ? ` \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435: ${specialUi.inputs.join(", ")}.` : ""}${formIssue ? ` ${formIssue}` : ""}`;
    ui.specialTargetPlayer.hidden = hideSpecialInputs || !specialUi.targetPlayer.includes(specialId);
    ui.specialTargetTrait.hidden = hideSpecialInputs || !specialUi.targetTrait.includes(specialId);
    ui.specialTargetScenario.hidden = hideSpecialInputs || !specialUi.targetScenario.includes(specialId);
    ui.specialChoice.hidden = hideSpecialInputs || !(specialUi.choice.includes(specialId) || pendingSpecial);
    for (const control of [
      ui.specialTargetPlayer,
      ui.specialTargetTrait,
      ui.specialTargetScenario,
      ui.specialChoice
    ]) {
      control.disabled = bunkerVoteLocksSpecial || hideSpecialInputs;
    }
    ui.specialControls.hidden = !myPublicState || !hasSpecial && !pendingShare && !pendingSpecial;
    ui.playSpecial.hidden = !hasSpecial && !pendingSpecial;
    ui.playSpecial.disabled = bunkerVoteLocksSpecial || (pendingSpecial ? Boolean(formIssue) : !hasSpecial || !availability.allowed || Boolean(formIssue));
    ui.playSpecial.textContent = pendingSpecial ? "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u0443" : myPublicState?.specialUsed ? "\u041E\u0441\u043E\u0431\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0430" : "\u0420\u0430\u0437\u044B\u0433\u0440\u0430\u0442\u044C \u043E\u0441\u043E\u0431\u0443\u044E \u043A\u0430\u0440\u0442\u0443";
    renderSharedSecrets();
    for (const element of ui.hostTraits.querySelectorAll("[data-host-trait]")) {
      element.textContent = privateState?.[element.dataset.hostTrait] || "\u041D\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u043E";
    }
    for (const card of ui.hostTraits.querySelectorAll("[data-host-trait-card]")) {
      const trait = card.dataset.hostTraitCard;
      const isSpecial = trait === "special";
      const revealed = Boolean(myPublicState?.revealedTraits?.[trait]);
      const button = card.querySelector("[data-host-reveal-trait]");
      card.classList.toggle("is-revealed", revealed);
      card.classList.toggle("is-required", mustRevealRequiredTrait && trait === requiredTrait);
      button.textContent = revealed ? "\u0420\u0430\u0441\u043A\u0440\u044B\u0442\u043E" : "\u0420\u0430\u0441\u043A\u0440\u044B\u0442\u044C";
      button.disabled = bunkerVotePending || !myTurn || revealed || !isSpecial && ordinaryRevealLimitReached || !isSpecial && Boolean(myPublicState?.revealedThisTurn) || !isSpecial && mustRevealRequiredTrait && trait !== requiredTrait;
      button.setAttribute("aria-pressed", String(revealed));
    }
  }
  function renderSpecialTargetOptions(specialId, myId) {
    const selected = ui.specialTargetPlayer.value;
    const redirectedSpecialId = Number(publicState?.lastSpecial?.specialId ?? 0);
    const actionId = specialId === 50 ? redirectedSpecialId : specialId;
    const ownerId = specialId === 50 ? publicState?.lastSpecial?.playedBy : myId;
    const activeIds2 = (publicState?.order ?? []).filter((id) => publicState?.players?.[id]?.status === "active");
    let allowedIds = [...activeIds2];
    if ([16, 17, 21, 22, 23].includes(actionId)) {
      const swapTrait = {
        16: "baggage",
        17: "biology",
        21: "hobby",
        22: "health",
        23: "fact"
      }[actionId];
      const index = activeIds2.indexOf(ownerId);
      allowedIds = index < 0 || activeIds2.length < 2 ? [] : [.../* @__PURE__ */ new Set([
        activeIds2[(index - 1 + activeIds2.length) % activeIds2.length],
        activeIds2[(index + 1) % activeIds2.length]
      ])].filter((id) => publicState?.players?.[ownerId]?.revealedTraits?.[swapTrait] && publicState?.players?.[id]?.revealedTraits?.[swapTrait]);
    } else if ([18, 41, 42, 49, 55, 56].includes(actionId)) {
      allowedIds = activeIds2.filter((id) => id !== ownerId);
    } else if (actionId === 25 || actionId === 29) {
      const requiredTrait = actionId === 25 ? "health" : "profession";
      allowedIds = activeIds2.filter((id) => publicState?.players?.[id]?.revealedTraits?.[requiredTrait]);
    } else if (actionId === 38) {
      allowedIds = activeIds2.filter((id) => !publicState?.players?.[id]?.bunkerKing);
    } else if (actionId === 44) {
      allowedIds = activeIds2.filter((id) => /\d+/.test(publicState?.players?.[id]?.revealedTraits?.biology ?? ""));
    } else if (actionId === 67) {
      allowedIds = activeIds2.filter((id) => gossipTraitOptions(publicState?.players?.[id]).length);
    }
    ui.specialTargetPlayer.replaceChildren(...allowedIds.map((id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = `${publicState.players[id].name}${id === myId ? " (\u0432\u044B)" : ""}`;
      return option;
    }));
    if (allowedIds.includes(selected)) ui.specialTargetPlayer.value = selected;
  }
  function renderSpecialTraitOptions(specialId, myId, pendingShare) {
    const selected = ui.specialTargetTrait.value;
    const redirectedSpecialId = Number(publicState?.lastSpecial?.specialId ?? 0);
    const actionId = specialId === 50 ? redirectedSpecialId : specialId;
    const ownerId = specialId === 50 ? publicState?.lastSpecial?.playedBy : myId;
    const targetId = ui.specialTargetPlayer.value;
    let traits = TRAIT_KEYS.filter((trait) => trait !== "special");
    if (pendingShare) {
      traits = traits.filter((trait) => !publicState?.players?.[myId]?.revealedTraits?.[trait]);
    } else if (actionId === 56) {
      traits = traits.filter((trait) => !publicState?.players?.[ownerId]?.revealedTraits?.[trait]);
    } else if (actionId === 67) {
      traits = gossipTraitOptions(publicState?.players?.[targetId]);
    }
    ui.specialTargetTrait.replaceChildren(...traits.map((trait) => {
      const option = document.createElement("option");
      option.value = trait;
      option.textContent = TRAIT_LABELS[trait];
      return option;
    }));
    if (traits.includes(selected)) ui.specialTargetTrait.value = selected;
  }
  function gossipTraitOptions(player) {
    if (!player || player.status !== "active") return [];
    const ordinaryTraits = TRAIT_KEYS.filter((trait) => trait !== "special");
    const revealedCount = ordinaryTraits.filter((trait) => player.revealedTraits?.[trait]).length;
    return ordinaryTraits.filter((trait) => {
      if (player.revealedTraits?.[trait]) return false;
      const additionalReveals = trait === "fact" || player.revealedTraits?.fact ? 1 : 2;
      return revealedCount + additionalReveals <= ordinaryTraits.length - 1;
    });
  }
  function specialFormIssue(usage, specialId, pendingShare, pendingSpecial) {
    if (pendingShare && !ui.specialTargetTrait.value) return "\u0423 \u0432\u0430\u0441 \u043D\u0435 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043A\u0440\u044B\u0442\u044B\u0445 \u043E\u0431\u044B\u0447\u043D\u044B\u0445 \u043A\u0430\u0440\u0442 \u0434\u043B\u044F \u043E\u0431\u043C\u0435\u043D\u0430.";
    if (pendingSpecial && !ui.specialChoice.value) return "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043E\u0434\u043D\u0443 \u0438\u0437 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u043D\u044B\u0445 \u043A\u0430\u0440\u0442.";
    if (usage.targetPlayer.includes(specialId) && !ui.specialTargetPlayer.value) return "\u041D\u0435\u0442 \u043F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0435\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430 \u0434\u043B\u044F \u044D\u0442\u043E\u0439 \u043A\u0430\u0440\u0442\u044B.";
    if (usage.targetTrait.includes(specialId) && !ui.specialTargetTrait.value) return "\u041D\u0435\u0442 \u043F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0435\u0439 \u0437\u0430\u043A\u0440\u044B\u0442\u043E\u0439 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438.";
    if (usage.targetScenario.includes(specialId) && !ui.specialTargetScenario.value) return "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043D\u0443\u0436\u043D\u0430 \u043E\u0442\u043A\u0440\u044B\u0442\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430.";
    if (usage.choice.includes(specialId) && !ui.specialChoice.value) return "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0432\u0430\u0440\u0438\u0430\u043D\u0442 \u044D\u0444\u0444\u0435\u043A\u0442\u0430.";
    return "";
  }
  function renderSpecialScenarioOptions() {
    const selected = ui.specialTargetScenario.value;
    const options = [];
    if (publicState?.bunker?.status === "revealed") {
      options.push({
        value: "primary:bunker",
        label: `\u041E\u0441\u043D\u043E\u0432\u043D\u0430\u044F${publicState.bunker.revealedRound ? ` \xB7 \u0440\u0430\u0443\u043D\u0434 ${publicState.bunker.revealedRound}` : ""} \xB7 ${publicState.bunker.title}`
      });
    }
    for (const card of publicState?.extraScenarios?.bunker ?? []) {
      const targetToken = card.id ?? card.instanceId;
      options.push({
        value: `extra:bunker:${targetToken}`,
        label: `${card.revealedRound ? `\u0420\u0430\u0443\u043D\u0434 ${card.revealedRound}` : "\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F"} \xB7 ${card.title}`
      });
    }
    ui.specialTargetScenario.replaceChildren(...options.map(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }));
    if (options.some((option) => option.value === selected)) ui.specialTargetScenario.value = selected;
  }
  function renderSharedSecrets() {
    const secrets = Object.values(privateState?.sharedSecrets ?? {});
    ui.sharedSecrets.hidden = !secrets.length;
    ui.sharedSecrets.replaceChildren(...secrets.map((secret) => {
      const row = document.createElement("p");
      const title = document.createElement("strong");
      title.textContent = `${secret.from}: ${TRAIT_LABELS[secret.trait] ?? secret.trait}`;
      row.append(title, document.createTextNode(` \u2014 ${secret.value}`));
      return row;
    }));
  }
  function renderSecretShareResponse(pendingShare, myId) {
    ui.secretShareResponse.hidden = !pendingShare;
    if (!pendingShare) return;
    const selected = ui.secretShareTrait.value;
    const options = TRAIT_KEYS.filter((trait) => trait !== "special").filter((trait) => !publicState?.players?.[myId]?.revealedTraits?.[trait]);
    ui.secretShareTrait.replaceChildren(...options.map((trait) => {
      const option = document.createElement("option");
      option.value = trait;
      option.textContent = TRAIT_LABELS[trait] ?? trait;
      return option;
    }));
    if (options.includes(selected)) ui.secretShareTrait.value = selected;
    ui.respondSecretShare.disabled = !options.length;
  }
  function renderSpecialChoiceOptions(pending, specialId) {
    const selected = ui.specialChoice.value;
    const redirectedSpecialId = Number(publicState?.lastSpecial?.specialId ?? 0);
    const actionId = specialId === 50 ? redirectedSpecialId : specialId;
    const defaultOptions = {
      53: [
        { value: "younger", label: "\u041C\u043B\u0430\u0434\u0448\u0435 33 \u043B\u0435\u0442" },
        { value: "older", label: "\u0421\u0442\u0430\u0440\u0448\u0435 33 \u043B\u0435\u0442" }
      ],
      57: [
        { value: "after", label: "\u0414\u0432\u0430 \u0438\u0433\u0440\u043E\u043A\u0430 \u043F\u043E\u0441\u043B\u0435 \u043C\u0435\u043D\u044F" },
        { value: "before", label: "\u0414\u0432\u0430 \u0438\u0433\u0440\u043E\u043A\u0430 \u043F\u0435\u0440\u0435\u0434\u043E \u043C\u043D\u043E\u0439" }
      ],
      69: [
        { value: "female", label: "\u0416\u0435\u043D\u0449\u0438\u043D\u044B" },
        { value: "male", label: "\u041C\u0443\u0436\u0447\u0438\u043D\u044B" }
      ]
    };
    const redirectedOptions = specialId === 50 ? privateState?.specialReactionChoiceOptions : null;
    const options = pending?.options?.map((card) => ({
      value: String(card.index),
      label: `${card.title} \u2014 ${card.description}`
    })) ?? redirectedOptions?.map((card) => ({
      value: String(card.index),
      label: `${card.title} \u2014 ${card.description}`
    })) ?? defaultOptions[actionId] ?? [];
    ui.specialChoice.replaceChildren(...options.map(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }));
    if (options.some((option) => option.value === selected)) ui.specialChoice.value = selected;
  }
  function renderScenarios() {
    const finalLocked = [PHASES.THREAT, PHASES.FINISHED].includes(publicState.phase);
    const bunkerVotePending = Boolean(publicState.pendingBunkerVote);
    const interactionLocked = finalLocked || bunkerVotePending;
    for (const scenarioType of ["catastrophe", "bunker", "threat"]) {
      const scenario = publicState[scenarioType];
      const card = ui.scenarioCards[scenarioType];
      const button = ui.scenarioButtons[scenarioType];
      clearBunkerCardUi(card);
      const label = card.querySelector(".scenario-card__label");
      label.textContent = scenarioType === "bunker" && scenario?.revealedRound ? `\u0411\u0443\u043D\u043A\u0435\u0440 \xB7 \u0440\u0430\u0443\u043D\u0434 ${scenario.revealedRound}` : scenarioType === "catastrophe" ? "\u041A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u0430" : scenarioType === "threat" ? "\u0423\u0433\u0440\u043E\u0437\u0430" : "\u0411\u0443\u043D\u043A\u0435\u0440";
      card.querySelector("[data-card-title]").textContent = scenario?.title || "\u0414\u0430\u043D\u043D\u044B\u0435 \u0437\u0430\u0441\u0435\u043A\u0440\u0435\u0447\u0435\u043D\u044B";
      card.querySelector("[data-card-description]").textContent = scenario?.description || "\u0414\u0430\u043D\u043D\u044B\u0435 \u0437\u0430\u0441\u0435\u043A\u0440\u0435\u0447\u0435\u043D\u044B.";
      button.hidden = !isHost() || scenario?.status !== "hidden" || interactionLocked;
      card.querySelector("[data-remove-primary-scenario]")?.remove();
      card.dataset.scenarioType = scenarioType;
      if (scenario?.instanceId) card.dataset.scenarioInstanceId = scenario.instanceId;
      else delete card.dataset.scenarioInstanceId;
      if (scenario?.cardId) card.dataset.scenarioCardId = String(scenario.cardId);
      else delete card.dataset.scenarioCardId;
      if (scenarioType === "bunker") {
        card.dataset.scenarioTarget = "primary:bunker";
        decorateBunkerScenarioCard(card, scenario, "primary:bunker");
      }
      if (isHost() && scenario?.status === "revealed" && !interactionLocked) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "scenario-card__remove";
        remove.dataset.removePrimaryScenario = scenarioType;
        remove.textContent = "\u0423\u0431\u0440\u0430\u0442\u044C \u043A\u0430\u0440\u0442\u0443";
        card.append(remove);
      }
    }
    ui.scenarioGrid.querySelectorAll(".scenario-card--extra").forEach((card) => card.remove());
    for (const [scenarioType, cards] of Object.entries(publicState.extraScenarios ?? {})) {
      for (const scenario of cards ?? []) {
        const card = document.createElement("article");
        const scenarioToken = scenario.id ?? scenario.instanceId;
        card.className = `scenario-card scenario-card--extra${scenarioType === "catastrophe" ? " scenario-card--danger" : ""}`;
        const label = document.createElement("span");
        const title = document.createElement("h2");
        const description = document.createElement("p");
        label.className = "scenario-card__label";
        label.textContent = scenarioType === "catastrophe" ? "\u041A\u0430\u0442\u0430\u0441\u0442\u0440\u043E\u0444\u0430" : scenarioType === "threat" ? "\u0423\u0433\u0440\u043E\u0437\u0430" : scenarioType === "exile" ? "\u0423 \u0438\u0437\u0433\u043D\u0430\u043D\u043D\u044B\u0445" : scenario.revealedRound ? `\u0411\u0443\u043D\u043A\u0435\u0440 \xB7 \u0440\u0430\u0443\u043D\u0434 ${scenario.revealedRound}` : "\u0411\u0443\u043D\u043A\u0435\u0440";
        title.textContent = scenario.title;
        description.textContent = scenario.description;
        card.append(label, title, description);
        card.dataset.scenarioType = scenarioType;
        if (scenarioToken) card.dataset.scenarioId = scenarioToken;
        if (scenario.instanceId) card.dataset.scenarioInstanceId = scenario.instanceId;
        if (scenario.cardId) card.dataset.scenarioCardId = String(scenario.cardId);
        if (scenario.targetId) card.dataset.threatTargetId = scenario.targetId;
        if (scenario.suppressed) card.dataset.threatSuppressed = "true";
        if (scenarioType === "bunker") {
          const targetValue = `extra:bunker:${scenarioToken}`;
          card.dataset.scenarioTarget = targetValue;
          decorateBunkerScenarioCard(card, scenario, targetValue);
        }
        if (isHost() && !interactionLocked) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "scenario-card__remove";
          remove.dataset.removeScenario = scenarioToken;
          remove.dataset.scenarioType = scenarioType;
          remove.textContent = "\u0423\u0431\u0440\u0430\u0442\u044C \u043A\u0430\u0440\u0442\u0443";
          card.append(remove);
        }
        const stackType = scenarioType === "exile" ? "bunker" : scenarioType;
        const stack = ui.scenarioGrid.querySelector(`[data-scenario-stack="${stackType}"]`);
        (stack ?? ui.scenarioGrid).append(card);
      }
    }
    renderBunkerVoteFallback();
    renderThreatResolution();
  }
  function clearBunkerCardUi(card) {
    card.querySelectorAll("[data-bunker-card-ui]").forEach((element) => element.remove());
    card.classList.remove("has-bunker-effect", "has-bunker-sabotage", "has-pending-bunker-vote");
  }
  function decorateBunkerScenarioCard(card, scenario, targetValue) {
    if (!scenario) return;
    const result = scenario.instanceId ? publicState?.bunkerEffectResults?.[scenario.instanceId] : null;
    if (result) {
      const resultBox = document.createElement("div");
      const heading = document.createElement("strong");
      const message = document.createElement("span");
      const status = String(result.status ?? "resolved").toLowerCase().replace(/[^a-z0-9_-]/g, "");
      resultBox.className = "bunker-effect-result";
      resultBox.dataset.bunkerCardUi = "effect";
      resultBox.dataset.effectStatus = status || "resolved";
      if (result.outcome) resultBox.dataset.effectOutcome = String(result.outcome);
      heading.textContent = result.status === "voting" ? "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043A\u0430\u0440\u0442\u044B" : result.status === "awaiting_final" ? "\u042D\u0444\u0444\u0435\u043A\u0442 \u0441\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0432 \u0444\u0438\u043D\u0430\u043B\u0435" : result.status === "pending" ? "\u042D\u0444\u0444\u0435\u043A\u0442 \u043A\u0430\u0440\u0442\u044B \u043E\u0436\u0438\u0434\u0430\u0435\u0442 \u0440\u0435\u0448\u0435\u043D\u0438\u044F" : "\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u044D\u0444\u0444\u0435\u043A\u0442\u0430";
      message.textContent = result.message || "\u042D\u0444\u0444\u0435\u043A\u0442 \u043A\u0430\u0440\u0442\u044B \u043F\u0440\u0438\u043C\u0435\u043D\u0451\u043D.";
      resultBox.append(heading, message);
      card.append(resultBox);
      card.classList.add("has-bunker-effect");
    }
    const sabotageTargets = (publicState?.bunkerSabotageTargets ?? []).filter((mark) => mark?.instanceId ? Boolean(
      scenario.instanceId && String(mark.instanceId) === String(scenario.instanceId)
    ) : Boolean(mark?.target && mark.target === targetValue));
    if (sabotageTargets.length) {
      const sabotageBox = document.createElement("div");
      sabotageBox.className = "bunker-sabotage-list";
      sabotageBox.dataset.bunkerCardUi = "sabotage";
      for (const mark of sabotageTargets) {
        const row = document.createElement("span");
        const player = publicState?.players?.[mark.playerId];
        const playerName = mark.playerName || player?.name || "\u0418\u0433\u0440\u043E\u043A";
        row.textContent = `\u0421\u0430\u0431\u043E\u0442\u0430\u0436: ${playerName}. \u0421\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u043F\u0440\u0438 \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u0438 \u044D\u0442\u043E\u0433\u043E \u0438\u0433\u0440\u043E\u043A\u0430.`;
        sabotageBox.append(row);
      }
      card.append(sabotageBox);
      card.classList.add("has-bunker-sabotage");
    }
    const pending = publicState?.pendingBunkerVote;
    const isVoteSource = Boolean(pending && (pending.sourceInstanceId && scenario.instanceId && String(scenario.instanceId) === String(pending.sourceInstanceId) || pending.sourceTarget && pending.sourceTarget === targetValue));
    if (isVoteSource) renderBunkerVoteControls(card, pending);
  }
  function renderBunkerVoteControls(card, pending) {
    const players = publicState?.players ?? {};
    const candidateIds = (Array.isArray(pending.candidateIds) ? pending.candidateIds : []).filter((id) => players[id]);
    const voterIds = Array.isArray(pending.voterIds) ? pending.voterIds : [];
    const submittedVoterIds = Array.isArray(pending.submittedVoterIds) ? pending.submittedVoterIds : [];
    const myId = multiplayer?.user?.uid;
    const canVote = voterIds.includes(myId);
    const submitted = submittedVoterIds.includes(myId);
    const hasSubmittedVotes = submittedVoterIds.some((id) => voterIds.includes(id));
    if (!candidateIds.includes(selectedBunkerVoteTarget)) {
      selectedBunkerVoteTarget = candidateIds[0] ?? "";
    }
    const controls = document.createElement("section");
    const heading = document.createElement("strong");
    const description = document.createElement("p");
    const progress = document.createElement("small");
    const select2 = document.createElement("select");
    const actions = document.createElement("div");
    const voteButton = document.createElement("button");
    controls.className = "bunker-vote-controls";
    controls.dataset.bunkerCardUi = "vote";
    controls.dataset.bunkerVoteControls = "";
    heading.textContent = bunkerVoteTitle(pending);
    description.textContent = pending.type === "king" ? "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0446\u0430\u0440\u044F. \u041F\u043E\u0441\u043B\u0435 \u043F\u043E\u0434\u0432\u0435\u0434\u0435\u043D\u0438\u044F \u0438\u0442\u043E\u0433\u043E\u0432 \u043E\u043D \u043F\u043E\u043B\u0443\u0447\u0438\u0442 \u043C\u0435\u0441\u0442\u043E \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0438 \u0438\u043C\u043C\u0443\u043D\u0438\u0442\u0435\u0442 \u043E\u0442 \u0438\u0437\u0433\u043D\u0430\u043D\u0438\u044F." : "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0430 \u0434\u043B\u044F \u0436\u0435\u0440\u0442\u0432\u044B. \u041F\u043E\u0441\u043B\u0435 \u043F\u043E\u0434\u0432\u0435\u0434\u0435\u043D\u0438\u044F \u0438\u0442\u043E\u0433\u043E\u0432 \u0431\u0443\u043D\u043A\u0435\u0440 \u043F\u043E\u043B\u0443\u0447\u0438\u0442 \u043D\u043E\u0432\u0443\u044E \u043A\u0430\u0440\u0442\u0443.";
    progress.textContent = `\u041F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043B\u0438: ${submittedVoterIds.length}/${voterIds.length}.${pending.revote ? " \u0418\u0434\u0451\u0442 \u043F\u0435\u0440\u0435\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435." : ""}`;
    select2.dataset.bunkerVoteTarget = "";
    select2.setAttribute("aria-label", pending.type === "king" ? "\u041A\u0430\u043D\u0434\u0438\u0434\u0430\u0442 \u0432 \u0446\u0430\u0440\u0438" : "\u041A\u0430\u043D\u0434\u0438\u0434\u0430\u0442 \u0434\u043B\u044F \u0436\u0435\u0440\u0442\u0432\u044B");
    select2.disabled = !canVote || !candidateIds.length;
    select2.replaceChildren(...candidateIds.map((id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = bunkerVoteCandidateLabel(id, myId);
      return option;
    }));
    if (candidateIds.includes(selectedBunkerVoteTarget)) select2.value = selectedBunkerVoteTarget;
    voteButton.type = "button";
    voteButton.className = "button button--wine";
    voteButton.dataset.bunkerVoteSubmit = "";
    voteButton.hidden = !canVote;
    voteButton.disabled = !candidateIds.length;
    voteButton.textContent = submitted ? "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0433\u043E\u043B\u043E\u0441" : "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u0433\u043E\u043B\u043E\u0441";
    actions.append(voteButton);
    if (isHost()) {
      const resolveButton = document.createElement("button");
      resolveButton.type = "button";
      resolveButton.className = "button button--primary";
      resolveButton.dataset.bunkerVoteResolve = "";
      resolveButton.disabled = !hasSubmittedVotes;
      resolveButton.textContent = pending.revote ? "\u041F\u043E\u0434\u0432\u0435\u0441\u0442\u0438 \u0438\u0442\u043E\u0433 \u043F\u0435\u0440\u0435\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F" : "\u041F\u043E\u0434\u0432\u0435\u0441\u0442\u0438 \u0438\u0442\u043E\u0433";
      actions.append(resolveButton);
    }
    if (!canVote) {
      const waiting = document.createElement("span");
      waiting.className = "bunker-vote-controls__waiting";
      waiting.textContent = isHost() ? "\u0412\u044B \u043D\u0435 \u0443\u0447\u0430\u0441\u0442\u0432\u0443\u0435\u0442\u0435 \u0432 \u044D\u0442\u043E\u043C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0438." : "\u0412\u044B \u043D\u0435 \u0432\u0445\u043E\u0434\u0438\u0442\u0435 \u0432 \u0441\u043F\u0438\u0441\u043E\u043A \u0433\u043E\u043B\u043E\u0441\u0443\u044E\u0449\u0438\u0445.";
      controls.append(heading, description, progress, waiting, actions);
    } else {
      controls.append(heading, description, progress, select2, actions);
    }
    card.append(controls);
    card.classList.add("has-pending-bunker-vote");
  }
  function renderBunkerVoteFallback() {
    const pending = publicState?.pendingBunkerVote;
    if (!pending || ui.scenarioGrid.querySelector("[data-bunker-vote-controls]")) return;
    const card = document.createElement("article");
    const label = document.createElement("span");
    const title = document.createElement("h2");
    const description = document.createElement("p");
    card.className = "scenario-card scenario-card--extra bunker-vote-fallback";
    card.dataset.scenarioType = "bunker";
    label.className = "scenario-card__label";
    label.textContent = "\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \xB7 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435";
    title.textContent = bunkerVoteTitle(pending);
    description.textContent = "\u0418\u0441\u0445\u043E\u0434\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u0430\u0441\u044C, \u043D\u043E \u043D\u0430\u0447\u0430\u0442\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043D\u0443\u0436\u043D\u043E \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C.";
    card.append(label, title, description);
    renderBunkerVoteControls(card, pending);
    ui.scenarioGrid.querySelector('[data-scenario-stack="bunker"]')?.append(card);
  }
  function bunkerVoteTitle(pending) {
    if (pending?.type === "king") return pending.revote ? "\u041F\u0435\u0440\u0435\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u0437\u0430 \u0446\u0430\u0440\u044F" : "\u0412\u044B\u0431\u043E\u0440 \u0446\u0430\u0440\u044F";
    return pending?.revote ? "\u041F\u0435\u0440\u0435\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u0437\u0430 \u0436\u0435\u0440\u0442\u0432\u0443" : "\u0416\u0435\u0440\u0442\u0432\u0435\u043D\u043D\u043E\u0435 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435";
  }
  function bunkerVoteCandidateLabel(playerId, myId) {
    const player = publicState?.players?.[playerId];
    if (!player) return "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0438\u0433\u0440\u043E\u043A";
    const notes = [];
    if (playerId === myId) notes.push("\u0432\u044B");
    if (player.bunkerKing) notes.push("\u0446\u0430\u0440\u044C");
    if (player.status === "exiled") notes.push("\u0438\u0437\u0433\u043D\u0430\u043D");
    if (player.status === "dead") notes.push("\u043F\u043E\u0433\u0438\u0431");
    return `${player.name}${notes.length ? ` (${notes.join(", ")})` : ""}`;
  }
  function renderThreatResolution() {
    const resolution = publicState?.threatResolution;
    const pending = publicState?.phase === PHASES.THREAT && resolution?.status === "pending";
    const survived = resolution?.status === "survived";
    const failed = resolution?.status === "failed";
    const onlyNonlethal = Number(resolution?.lethalThreatCount ?? 0) === 0 && Number(resolution?.nonlethalThreatCount ?? 0) > 0;
    const nonlethalFailure = Boolean(resolution?.nonlethalFailure);
    const primaryThreat = ui.scenarioCards.threat;
    const extraThreats = [
      ...ui.scenarioGrid.querySelectorAll('.scenario-card--extra[data-scenario-type="threat"]')
    ];
    const finalistIds = new Set(resolution?.finalistIds ?? []);
    const recordedThreatIds = Array.isArray(resolution?.extraThreatIds) ? new Set(resolution.extraThreatIds) : null;
    const updateCardState = (card, counted) => {
      card.classList.toggle("is-threat-active", Boolean(counted && pending));
      card.classList.toggle("is-threat-survived", Boolean(counted && survived));
      card.classList.toggle("is-threat-failed", Boolean(counted && failed));
      card.classList.toggle("is-threat-inactive", Boolean(resolution && !counted));
    };
    updateCardState(primaryThreat, !resolution || publicState?.threat?.status === "revealed");
    for (const card of extraThreats) {
      const scenarioId = card.dataset.scenarioId;
      const targetId = card.dataset.threatTargetId;
      const suppressed = card.dataset.threatSuppressed === "true";
      const counted = !resolution || (recordedThreatIds ? recordedThreatIds.has(scenarioId) : !targetId || finalistIds.has(targetId));
      updateCardState(card, counted);
      if (resolution) {
        card.querySelector(".scenario-card__label").textContent = counted ? "\u0424\u0438\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430" : suppressed ? "\u0423\u0433\u0440\u043E\u0437\u0430 \xB7 \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043D\u0430" : "\u0423\u0433\u0440\u043E\u0437\u0430 \xB7 \u0446\u0435\u043B\u044C \u0432\u044B\u0431\u044B\u043B\u0430";
      }
    }
    ui.threatResolutionStatus.hidden = !resolution;
    ui.threatResolutionActions.hidden = !isHost() || !pending;
    if (!resolution) return;
    const count = Number(resolution.threatCount ?? 0);
    const hasMixedThreats = Number(resolution.lethalThreatCount ?? 0) > 0 && Number(resolution.nonlethalThreatCount ?? 0) > 0;
    ui.threatNonlethalFailed.hidden = !pending || !hasMixedThreats;
    ui.threatFailed.textContent = onlyNonlethal ? "\u041D\u0435 \u043F\u043E\u0439\u043C\u0430\u043B\u0438 \u2014 \u043F\u043E\u0442\u0435\u0440\u044F\u0442\u044C \u0431\u0430\u0433\u0430\u0436" : "\u0411\u0443\u043D\u043A\u0435\u0440 \u043D\u0435 \u0432\u044B\u0436\u0438\u043B";
    ui.scenarioCards.threat.querySelector(".scenario-card__label").textContent = pending ? `\u0424\u0438\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430 \xB7 ${count}` : "\u0424\u0438\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430";
    ui.threatResolutionStatus.textContent = pending ? onlyNonlethal ? `\u0410\u043A\u0442\u0438\u0432\u043D\u043E \u043D\u0435\u0441\u043C\u0435\u0440\u0442\u0435\u043B\u044C\u043D\u044B\u0445 \u0443\u0433\u0440\u043E\u0437: ${count}. \u0415\u0441\u043B\u0438 \u0444\u0438\u043D\u0430\u043B\u0438\u0441\u0442\u044B \u043D\u0435 \u0441\u043F\u0440\u0430\u0432\u044F\u0442\u0441\u044F, \u043E\u043D\u0438 \u043F\u043E\u0442\u0435\u0440\u044F\u044E\u0442 \u0431\u0430\u0433\u0430\u0436, \u043D\u043E \u043E\u0441\u0442\u0430\u043D\u0443\u0442\u0441\u044F \u0436\u0438\u0432\u044B.` : `\u0410\u043A\u0442\u0438\u0432\u043D\u043E \u0443\u0433\u0440\u043E\u0437: ${count}. \u0424\u0438\u043D\u0430\u043B\u0438\u0441\u0442\u044B \u0434\u043E\u043B\u0436\u043D\u044B \u043E\u0431\u044A\u044F\u0441\u043D\u0438\u0442\u044C, \u043A\u0430\u043A\u0438\u0435 \u0438\u0445 \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0435 \u043A\u0430\u0440\u0442\u044B \u0438 \u0440\u0435\u0441\u0443\u0440\u0441\u044B \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u043F\u043E\u043C\u043E\u0433\u0443\u0442 \u0432\u044B\u0436\u0438\u0442\u044C.` : nonlethalFailure ? "\u0414\u043E\u043C\u043E\u0432\u043E\u0433\u043E \u043F\u043E\u0439\u043C\u0430\u0442\u044C \u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C: \u0444\u0438\u043D\u0430\u043B\u0438\u0441\u0442\u044B \u043F\u043E\u0442\u0435\u0440\u044F\u043B\u0438 \u0431\u0430\u0433\u0430\u0436, \u043D\u043E \u043E\u0441\u0442\u0430\u043B\u0438\u0441\u044C \u0436\u0438\u0432\u044B." : survived ? "\u0412\u0441\u0435 \u0444\u0438\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u0443\u0433\u0440\u043E\u0437\u044B \u0443\u0441\u0442\u0440\u0430\u043D\u0435\u043D\u044B. \u0411\u0443\u043D\u043A\u0435\u0440 \u0432\u044B\u0436\u0438\u043B." : "\u0423\u0433\u0440\u043E\u0437\u044B \u043D\u0435 \u0443\u0441\u0442\u0440\u0430\u043D\u0435\u043D\u044B. \u0411\u0443\u043D\u043A\u0435\u0440 \u043D\u0435 \u0432\u044B\u0436\u0438\u043B.";
  }
  function renderHostEditor() {
    const host = isHost();
    const locked = [PHASES.THREAT, PHASES.FINISHED].includes(publicState?.phase) || Boolean(publicState?.pendingBunkerVote);
    ui.hostEditor.hidden = !host || !publicState?.phase || locked;
    if (!host || !publicState?.phase || locked) return;
    if (document.activeElement !== ui.hostEditCapacity) ui.hostEditCapacity.value = String(publicState.capacity);
    const selectedPlayer = ui.hostEditPlayer.value;
    ui.hostEditPlayer.replaceChildren(...Object.entries(publicState.players ?? {}).map(([id, player]) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = player.name;
      return option;
    }));
    if (publicState.players?.[selectedPlayer]) ui.hostEditPlayer.value = selectedPlayer;
    const selectedSpecialPlayer = ui.hostSpecialPlayer.value;
    ui.hostSpecialPlayer.replaceChildren(...Object.entries(publicState.players ?? {}).map(([id, player]) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = player.name;
      return option;
    }));
    if (publicState.players?.[selectedSpecialPlayer]) ui.hostSpecialPlayer.value = selectedSpecialPlayer;
    const current = publicState.players?.[ui.hostEditPlayer.value];
    if (current && document.activeElement !== ui.hostEditStatus) ui.hostEditStatus.value = current.status;
  }
  function renderVoting() {
    const players = publicState.players ?? {};
    const activeEntries = Object.entries(players).filter(([, player]) => player.status === "active");
    const isVoting = publicState.phase === PHASES.VOTING;
    const bunkerVotePending = Boolean(publicState.pendingBunkerVote);
    const myPlayer = players[multiplayer?.user?.uid];
    const revoteCandidates = publicState.voteResult?.status === "tie" ? publicState.voteResult.candidates ?? [] : [];
    const isLastExiled = myPlayer?.status === "exiled" && multiplayer?.user?.uid === publicState.lastExiledPlayerId;
    const canVote = Boolean(myPlayer && (myPlayer.status === "active" || isLastExiled || myPlayer.persistentVoter) && !myPlayer.voteDisabled);
    ui.votePanel.hidden = ![PHASES.VOTING, PHASES.RESULTS].includes(publicState.phase);
    const voteProgress = getVoteProgressText();
    ui.voteRoundLabel.textContent = `\u0420\u0430\u0443\u043D\u0434 ${publicState.round}${voteProgress ? ` \xB7 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 ${voteProgress}` : ""}`;
    if (selectedVoteTarget && (!players[selectedVoteTarget] || revoteCandidates.length && !revoteCandidates.includes(selectedVoteTarget))) {
      selectedVoteTarget = "";
    }
    ui.voteList.replaceChildren(...activeEntries.map(([id, player]) => {
      const button = document.createElement("button");
      const name = document.createElement("span");
      const count = document.createElement("b");
      button.type = "button";
      button.dataset.voteTarget = id;
      button.classList.toggle("is-selected", id === selectedVoteTarget);
      button.disabled = bunkerVotePending || !isVoting || !canVote || player.immuneThisRound || player.bunkerKing || Boolean(myPlayer?.cannotVoteAgainst?.[id]) || Boolean(myPlayer?.forcedSelfVote && id !== multiplayer?.user?.uid) || revoteCandidates.length > 0 && !revoteCandidates.includes(id);
      name.textContent = player.name;
      count.textContent = publicState.phase === PHASES.RESULTS ? String(publicState.voteResult?.counts?.[id] ?? 0) : "";
      button.append(name, count);
      return button;
    }));
    ui.confirmVote.disabled = bunkerVotePending || !isVoting || !canVote || !selectedVoteTarget;
    ui.confirmVote.textContent = myPlayer?.voteSubmitted ? "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0433\u043E\u043B\u043E\u0441" : "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u0433\u043E\u043B\u043E\u0441";
    ui.voteStatus.textContent = voteStatusText(players);
  }
  function voteStatusText(players) {
    const result = publicState.voteResult;
    const voteProgress = getVoteProgressText();
    const votePrefix = voteProgress ? `\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 ${voteProgress}. ` : "";
    if (publicState.phase === PHASES.VOTING) {
      const eligibleVoters = Object.entries(players).filter(([id, player]) => (player.status === "active" || player.persistentVoter || player.status === "exiled" && id === publicState.lastExiledPlayerId) && !player.voteDisabled);
      const submitted = eligibleVoters.filter(([, player]) => player.voteSubmitted).length;
      const progress = `\u041F\u0440\u043E\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043B\u0438: ${submitted}/${eligibleVoters.length}.`;
      if (result?.status === "tie") {
        const names = (result.candidates ?? []).map((id) => players[id]?.name).filter(Boolean);
        return `${votePrefix}\u041F\u0435\u0440\u0435\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435: ${names.join(" \u0438\u043B\u0438 ")}. ${progress} \u0413\u043E\u043B\u043E\u0441 \u043C\u043E\u0436\u043D\u043E \u043C\u0435\u043D\u044F\u0442\u044C \u0434\u043E \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F.`;
      }
      return `${votePrefix}\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u0430\u043D\u0434\u0438\u0434\u0430\u0442\u0430. ${progress} \u0413\u043E\u043B\u043E\u0441 \u043C\u043E\u0436\u043D\u043E \u043C\u0435\u043D\u044F\u0442\u044C \u0434\u043E \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F.`;
    }
    if (publicState.phase === PHASES.RESULTS && result?.status === "exiled") {
      return `${votePrefix}${players[result.exiledPlayerId]?.name ?? "\u0418\u0433\u0440\u043E\u043A"} \u0438\u0437\u0433\u043D\u0430\u043D \u0438\u0437 \u0433\u0440\u0443\u043F\u043F\u044B.`;
    }
    if (publicState.phase === PHASES.RESULTS && result?.status === "tie") {
      return `${votePrefix}\u041D\u0438\u0447\u044C\u044F. \u0412\u0435\u0434\u0443\u0449\u0438\u0439 \u0434\u043E\u043B\u0436\u0435\u043D \u043D\u0430\u0447\u0430\u0442\u044C \u043F\u0435\u0440\u0435\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435.`;
    }
    if (publicState.phase === PHASES.FINISHED && publicState.threatResolution?.status === "failed") {
      return "\u0424\u0438\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430 \u043D\u0435 \u0443\u0441\u0442\u0440\u0430\u043D\u0435\u043D\u0430 \u2014 \u0431\u0443\u043D\u043A\u0435\u0440 \u043D\u0435 \u0432\u044B\u0436\u0438\u043B.";
    }
    if (publicState.phase === PHASES.FINISHED && publicState.threatResolution?.status === "survived") {
      return "\u0424\u0438\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430 \u0443\u0441\u0442\u0440\u0430\u043D\u0435\u043D\u0430 \u2014 \u0431\u0443\u043D\u043A\u0435\u0440 \u0432\u044B\u0436\u0438\u043B.";
    }
    if (publicState.phase === PHASES.FINISHED) return "\u0421\u043E\u0441\u0442\u0430\u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0430 \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0451\u043D.";
    return "\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 \u043F\u043E\u043A\u0430 \u0437\u0430\u043A\u0440\u044B\u0442\u043E.";
  }
  function renderControls() {
    const host = isHost();
    const phase = publicState.phase;
    const bunkerVotePending = Boolean(publicState.pendingBunkerVote);
    const pendingSpecialAction = Boolean(
      publicState.pendingSecretShare || publicState.pendingSpecialChoice
    );
    const currentPlayerId = publicState.order?.[publicState.currentPlayerIndex];
    const currentPlayer = currentPlayerId ? publicState.players?.[currentPlayerId] : null;
    const { target: voteTarget, completed: completedVotes, current: currentVote } = getCurrentRoundVoteProgress();
    const activePlayerCount = Object.values(publicState.players ?? {}).filter((player) => player.status === "active").length;
    const hasAnotherVote = completedVotes < voteTarget && activePlayerCount > Number(publicState.capacity ?? 0);
    ui.skipTurn.hidden = !host || phase !== PHASES.REVEAL || !currentPlayer;
    ui.skipTurn.disabled = bunkerVotePending && !pendingSpecialAction || !host || phase !== PHASES.REVEAL || !currentPlayer;
    ui.skipTurn.textContent = pendingSpecialAction ? "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0437\u0430\u0432\u0438\u0441\u0448\u0435\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0441\u043F\u0435\u0446\u043A\u0430\u0440\u0442\u044B" : currentPlayer ? `\u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0445\u043E\u0434: ${currentPlayer.name}` : "\u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0445\u043E\u0434";
    ui.nextPhase.hidden = !host || ![PHASES.DISCUSSION, PHASES.VOTING, PHASES.RESULTS].includes(phase);
    ui.nextPhase.disabled = bunkerVotePending && !pendingSpecialAction || !host;
    ui.nextPhase.textContent = pendingSpecialAction ? "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0437\u0430\u0432\u0438\u0441\u0448\u0435\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0441\u043F\u0435\u0446\u043A\u0430\u0440\u0442\u044B" : phase === PHASES.DISCUSSION ? hasAnotherVote ? `\u041D\u0430\u0447\u0430\u0442\u044C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 ${completedVotes + 1}/${voteTarget} \u2192` : Number(publicState.round ?? 0) >= Number(publicState.totalRounds ?? 0) ? "\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C \u0440\u0430\u0443\u043D\u0434 \u2192" : `\u041D\u0430\u0447\u0430\u0442\u044C \u0440\u0430\u0443\u043D\u0434 ${Number(publicState.round ?? 0) + 1} \u0431\u0435\u0437 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F \u2192` : phase === PHASES.VOTING ? `\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435${voteTarget > 0 ? ` ${currentVote}/${voteTarget}` : ""} \u2192` : publicState.voteResult?.status === "tie" ? `\u041F\u0435\u0440\u0435\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u0442\u044C${voteTarget > 0 ? ` ${currentVote}/${voteTarget}` : ""} \u2192` : hasAnotherVote ? `\u041F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u0438\u0442\u044C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 ${completedVotes + 1}/${voteTarget} \u2192` : Number(publicState.round ?? 0) >= Number(publicState.totalRounds ?? 0) ? "\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C \u0440\u0430\u0443\u043D\u0434 \u2192" : "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0440\u0430\u0443\u043D\u0434 \u2192";
    ui.roundDrawerToggle.classList.toggle(
      "needs-attention",
      bunkerVotePending || host && (phase === PHASES.REVEAL && Boolean(currentPlayer) || phase === PHASES.THREAT || [PHASES.DISCUSSION, PHASES.VOTING, PHASES.RESULTS].includes(phase))
    );
  }
  function setRoundDrawer(open, restoreFocus = true) {
    const shouldOpen = Boolean(open && publicState?.phase);
    document.body.classList.toggle("round-drawer-open", shouldOpen);
    ui.roundDrawerToggle.setAttribute("aria-expanded", String(shouldOpen));
    ui.roundDrawer.setAttribute("aria-hidden", String(!shouldOpen));
    ui.roundDrawer.inert = !shouldOpen;
    ui.roundDrawerBackdrop.hidden = !shouldOpen;
    if (shouldOpen) {
      window.requestAnimationFrame(() => ui.roundDrawerClose.focus());
    } else if (restoreFocus && !ui.roundDrawerToggle.hidden) {
      ui.roundDrawerToggle.focus();
    }
  }
  function renderLog() {
    const distanceFromBottom = ui.eventLog.scrollHeight - ui.eventLog.scrollTop - ui.eventLog.clientHeight;
    const keepAtBottom = !ui.eventLog.children.length || distanceFromBottom < 36;
    const events = Object.values(publicState.log ?? {}).sort((left, right) => left.createdAt - right.createdAt);
    ui.eventLog.replaceChildren(...events.map((event) => {
      const row = ui.logTemplate.content.firstElementChild.cloneNode(true);
      row.querySelector("time").textContent = new Date(event.createdAt).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit"
      });
      row.querySelector("span").textContent = event.message;
      return row;
    }));
    if (keepAtBottom) ui.eventLog.scrollTop = ui.eventLog.scrollHeight;
  }
  async function startGame() {
    if (!room?.meta?.hostId) throw new Error("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0441\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043A\u043E\u043C\u043D\u0430\u0442\u0443.");
    if (!isHost()) throw new Error("\u041D\u0430\u0447\u0430\u0442\u044C \u0438\u0433\u0440\u0443 \u043C\u043E\u0436\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0435\u0434\u0443\u0449\u0438\u0439.");
    const settings = getRoomSettings();
    const roomPlayers = Object.entries(room.players ?? {}).filter(([, player]) => player.online !== false);
    let players = settings.hostPlays ? roomPlayers : roomPlayers.filter(([playerId]) => playerId !== room.meta.hostId);
    const expectedPlayers = settings.playerCount;
    if (settings.developerMode && players.length <= expectedPlayers) {
      players = fillWithDeveloperBots(players, expectedPlayers);
    }
    if (players.length !== expectedPlayers) {
      throw new Error(`\u041D\u0443\u0436\u043D\u043E ${expectedPlayers} \u0438\u0433\u0440\u043E\u043A\u043E\u0432, \u0441\u0435\u0439\u0447\u0430\u0441 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E ${players.length}.`);
    }
    const capacity = settings.bunkerCapacity;
    if (capacity >= players.length) throw new Error("\u041C\u0435\u0441\u0442 \u0432 \u0431\u0443\u043D\u043A\u0435\u0440\u0435 \u0434\u043E\u043B\u0436\u043D\u043E \u0431\u044B\u0442\u044C \u043C\u0435\u043D\u044C\u0448\u0435, \u0447\u0435\u043C \u0438\u0433\u0440\u043E\u043A\u043E\u0432.");
    const engine = createInitialGame(players, capacity);
    await saveEngine(engine);
    startCommandListener();
  }
  function startCommandListener() {
    if (!isHost() || commandListenerStarted) return;
    commandListenerStarted = true;
    multiplayer.listenForCommands((command, commandId) => {
      commandQueue = commandQueue.then(() => processCommand(command, commandId)).catch(handleError);
    });
  }
  async function processCommand(command, commandId) {
    try {
      const engine = await multiplayer.getEngine();
      if (!engine) return;
      if (!applyCommand(engine, command, room?.meta?.hostId)) return;
      await saveEngine(engine);
    } catch (error) {
      await multiplayer.reportCommandError(command.from, friendlyError(error));
      throw error;
    } finally {
      await multiplayer.removeCommand(commandId);
    }
  }
  async function saveEngine(engine) {
    const publicGame = createPublicState(engine);
    const privateStates = createPrivateStates(engine);
    assertFirebaseSafe(engine);
    assertFirebaseSafe(publicGame);
    assertFirebaseSafe(privateStates);
    await multiplayer.setGame(engine, publicGame, privateStates);
  }
  function scheduleDeveloperBots() {
    if (!isHost() || !getRoomSettings().developerMode || !publicState?.phase) return;
    if (botActionTimer || botActionRevision === publicState.revision) return;
    botActionRevision = publicState.revision;
    botActionTimer = window.setTimeout(() => {
      botActionTimer = 0;
      commandQueue = commandQueue.then(runDeveloperBotStep).catch((error) => {
        botActionRevision = -1;
        handleError(error);
      });
    }, shouldDelayForHumanReaction() ? 8e3 : 450);
  }
  function shouldDelayForHumanReaction() {
    const mySpecialId = Number(privateState?.specialId ?? 0);
    const hostCanReact = [50, 71].includes(mySpecialId) && getSpecialAvailability(publicState, multiplayer?.user?.uid, mySpecialId).allowed;
    if (hostCanReact) return true;
    const reactionWindowOpen = Number(publicState?.lastSpecial?.playedAtRevision ?? -1) === Number(publicState?.revision ?? 0);
    if (!reactionWindowOpen) return false;
    return Object.keys(room?.players ?? {}).some((playerId) => playerId !== room?.meta?.hostId && publicState?.players?.[playerId]?.status === "active");
  }
  function resetDeveloperBotScheduler() {
    if (botActionTimer) window.clearTimeout(botActionTimer);
    botActionTimer = 0;
    botActionRevision = -1;
  }
  async function runDeveloperBotStep() {
    if (!isHost() || !getRoomSettings().developerMode) return;
    const engine = await multiplayer.getEngine();
    const commands = getDeveloperBotCommands(engine);
    if (!commands.length) return;
    for (const command of commands) {
      applyCommand(engine, command, room.meta.hostId);
    }
    await saveEngine(engine);
  }
  async function sendCommand(type, data = {}) {
    if (!multiplayer?.roomId) throw new Error("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u043E\u0439\u0434\u0438\u0442\u0435 \u0432 \u043A\u043E\u043C\u043D\u0430\u0442\u0443.");
    const commandData = type === "VOTE" ? { ...data, voteCycle: Number(publicState?.voteCycle ?? 0) } : data;
    await multiplayer.sendCommand(type, commandData, Number(publicState?.revision ?? 0));
  }
  async function sendHostEdit(data) {
    if (!isHost()) throw new Error("\u0420\u0435\u0434\u0430\u043A\u0442\u043E\u0440 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0435\u0434\u0443\u0449\u0435\u043C\u0443.");
    await sendCommand("HOST_EDIT", data);
  }
  async function playOrRespondSpecial() {
    const myId = multiplayer?.user?.uid;
    const pendingChoice = privateState?.pendingSpecialChoice?.playerId === myId;
    if (pendingChoice) {
      await sendCommand("PLAY_SPECIAL", { choice: ui.specialChoice.value });
      return;
    }
    const specialId = Number(privateState?.specialId ?? 0);
    const usage = currentSpecialUsage(specialId);
    const data = {};
    if (usage.targetPlayer.includes(specialId)) data.targetId = ui.specialTargetPlayer.value;
    if (usage.targetTrait.includes(specialId)) data.trait = ui.specialTargetTrait.value;
    if (usage.targetScenario.includes(specialId)) data.scenarioTarget = ui.specialTargetScenario.value;
    if (usage.choice.includes(specialId)) data.choice = ui.specialChoice.value;
    await sendCommand("PLAY_SPECIAL", data);
  }
  function selectVoteTarget(playerId) {
    selectedVoteTarget = playerId;
    renderVoting();
  }
  function normalizePrivateState(state) {
    return state && typeof state === "object" && !Array.isArray(state) ? state : {};
  }
  function isHost() {
    return Boolean(room?.meta?.hostId && multiplayer?.user?.uid === room.meta.hostId);
  }
  function getStatusMessage() {
    const phase = publicState?.phase;
    const currentPlayerId = publicState?.order?.[publicState?.currentPlayerIndex];
    const currentPlayer = currentPlayerId ? publicState?.players?.[currentPlayerId] : null;
    const { target: voteTarget, completed: completedVotes } = getCurrentRoundVoteProgress();
    const voteProgress = getVoteProgressText();
    const activePlayerCount = Object.values(publicState?.players ?? {}).filter((player) => player.status === "active").length;
    if (publicState?.pendingBunkerVote) {
      return `\u041A\u0430\u0440\u0442\u0430 \u0431\u0443\u043D\u043A\u0435\u0440\u0430: ${bunkerVoteTitle(publicState.pendingBunkerVote).toLowerCase()}`;
    }
    if (phase === PHASES.REVEAL && currentPlayer) return `\u0425\u043E\u0434\u0438\u0442: ${currentPlayer.name}`;
    if (phase === PHASES.DISCUSSION && (completedVotes >= voteTarget || activePlayerCount <= Number(publicState?.capacity ?? 0))) {
      return `\u0420\u0430\u0443\u043D\u0434 ${publicState?.round}: \u0431\u0435\u0437 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F`;
    }
    if (phase === PHASES.DISCUSSION) return `\u041E\u0431\u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0435 \u043F\u0435\u0440\u0435\u0434 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435\u043C ${voteProgress}`;
    if (phase === PHASES.VOTING) return `\u0418\u0434\u0451\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435 ${voteProgress}`;
    if (phase === PHASES.RESULTS) return `\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u044B \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u044F ${voteProgress}`;
    if (phase === PHASES.THREAT) return "\u0424\u0438\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430: \u0432\u0435\u0434\u0443\u0449\u0438\u0439 \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u044F\u0435\u0442 \u0438\u0441\u0445\u043E\u0434";
    return getPhaseLabel(phase);
  }
  function getPhaseLabel(phase) {
    return {
      [PHASES.LOBBY]: "\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u0438\u0433\u0440\u043E\u043A\u043E\u0432",
      [PHASES.REVEAL]: "\u0420\u0430\u0441\u043A\u0440\u044B\u0442\u0438\u0435 \u043A\u0430\u0440\u0442",
      [PHASES.DISCUSSION]: "\u041E\u0431\u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0435",
      [PHASES.VOTING]: "\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u043D\u0438\u0435",
      [PHASES.RESULTS]: "\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u044B",
      [PHASES.THREAT]: "\u0424\u0438\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0443\u0433\u0440\u043E\u0437\u0430",
      [PHASES.FINISHED]: "\u0418\u0433\u0440\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430"
    }[phase] ?? "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u0444\u0430\u0437\u0430";
  }
  function lockHostInterface() {
    ui.modeHost.disabled = true;
    ui.hostModeTab.hidden = true;
    ui.startGame.hidden = true;
    setConnectionControlsDisabled(true);
  }
  function showConnectedRoom(roomCode) {
    document.body.classList.add("is-connected");
    ui.roomCodeOutput.textContent = roomCode;
    ui.roomInfo.hidden = false;
    ui.lobbyForm.hidden = true;
    ui.startGame.hidden = true;
    ui.startGame.disabled = true;
    ui.onlineError.textContent = "";
  }
  function showLobbyForm() {
    document.body.classList.remove("is-connected", "has-game", "host-is-player", "has-pending-bunker-vote");
    ui.roomInfo.hidden = true;
    ui.lobbyForm.hidden = false;
  }
  function setConnectionControlsDisabled(disabled) {
    ui.createRoomButton.disabled = disabled;
    ui.joinRoomButton.disabled = disabled;
    ui.onlineName.disabled = disabled;
    ui.roomCodeInput.disabled = disabled;
  }
  async function copyRoomCode() {
    if (!multiplayer?.roomId) return;
    await navigator.clipboard.writeText(multiplayer.roomId);
    const original = ui.roomCodeOutput.textContent;
    ui.roomCodeOutput.textContent = "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E";
    setTimeout(() => {
      ui.roomCodeOutput.textContent = original;
    }, 900);
  }
  async function kickPlayer(playerId) {
    const playerName = room?.players?.[playerId]?.name ?? "\u0438\u0433\u0440\u043E\u043A\u0430";
    if (!window.confirm(`\u0423\u0434\u0430\u043B\u0438\u0442\u044C ${playerName} \u0438\u0437 \u043A\u043E\u043C\u043D\u0430\u0442\u044B?`)) return;
    await multiplayer.removePlayer(playerId);
  }
  async function leaveCurrentRoom() {
    if (!multiplayer?.roomId) return;
    const host = isHost();
    const message = host ? "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u043A\u043E\u043C\u043D\u0430\u0442\u0443 \u0434\u043B\u044F \u0432\u0441\u0435\u0445 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432?" : "\u0412\u044B\u0439\u0442\u0438 \u0438\u0437 \u043A\u043E\u043C\u043D\u0430\u0442\u044B?";
    if (!window.confirm(message)) return;
    if (host) await multiplayer.deleteRoom();
    else await multiplayer.leave();
    setRoundDrawer(false, false);
    resetDeveloperBotScheduler();
    localStorage.removeItem(ROOM_STORAGE_KEY);
    room = null;
    publicState = null;
    privateState = {};
    selectedVoteTarget = "";
    selectedBunkerVoteTarget = "";
    commandListenerStarted = false;
    lockHostInterface();
    showLobbyForm();
    setConnectionControlsDisabled(false);
    setStatus("\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F");
  }
  async function handleRoomUnavailable(message) {
    if (leavingRoom) return;
    leavingRoom = true;
    try {
      await multiplayer.leave();
    } catch (error) {
      console.warn("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E \u0437\u0430\u043A\u0440\u044B\u0442\u044C \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043A \u043A\u043E\u043C\u043D\u0430\u0442\u0435:", error);
    }
    localStorage.removeItem(ROOM_STORAGE_KEY);
    setRoundDrawer(false, false);
    resetDeveloperBotScheduler();
    room = null;
    publicState = null;
    privateState = {};
    commandListenerStarted = false;
    lockHostInterface();
    showLobbyForm();
    setConnectionControlsDisabled(false);
    ui.onlineError.textContent = message;
    setStatus(message);
  }
  async function resetCurrentGame() {
    if (!isHost()) throw new Error("\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u043F\u0430\u0440\u0442\u0438\u044E \u043C\u043E\u0436\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0435\u0434\u0443\u0449\u0438\u0439.");
    if (!window.confirm("\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C \u0442\u0435\u043A\u0443\u0449\u0443\u044E \u043F\u0430\u0440\u0442\u0438\u044E \u0438 \u0432\u0435\u0440\u043D\u0443\u0442\u044C\u0441\u044F \u0432 \u043B\u043E\u0431\u0431\u0438?")) return;
    setRoundDrawer(false, false);
    resetDeveloperBotScheduler();
    await commandQueue;
    commandQueue = Promise.resolve();
    await multiplayer.resetGame();
    publicState = null;
    privateState = {};
    selectedVoteTarget = "";
    selectedBunkerVoteTarget = "";
    lastCommandErrorAt = 0;
    document.body.classList.remove("has-game");
    renderGame();
    renderRoom();
    setStatus("\u041B\u043E\u0431\u0431\u0438 \u043E\u0442\u043A\u0440\u044B\u0442\u043E \u0434\u043B\u044F \u043D\u043E\u0432\u043E\u0439 \u043F\u0430\u0440\u0442\u0438\u0438");
  }
  function setStatus(message) {
    ui.status.textContent = message;
  }
  function handleError(error) {
    console.error(error);
    const message = friendlyError(error);
    ui.onlineError.textContent = message;
    setStatus(message);
  }
  function friendlyError(error) {
    if (error?.code === "auth/operation-not-allowed") return "\u0412 Firebase \u043D\u0443\u0436\u043D\u043E \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0430\u043D\u043E\u043D\u0438\u043C\u043D\u0443\u044E \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044E.";
    if (error?.code === "PERMISSION_DENIED") return "Firebase \u043E\u0442\u043A\u043B\u043E\u043D\u0438\u043B \u0437\u0430\u043F\u0440\u043E\u0441. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u0430 \u0431\u0430\u0437\u044B.";
    return error?.message ?? "\u041F\u0440\u043E\u0438\u0437\u043E\u0448\u043B\u0430 \u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430.";
  }
  async function run(action) {
    ui.onlineError.textContent = "";
    try {
      await action();
    } catch (error) {
      handleError(error);
    }
  }
})();
