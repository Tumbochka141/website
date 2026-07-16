import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
    getDatabase, ref, get, set, update, remove, push, onValue, onChildAdded,
    onDisconnect, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class Multiplayer {
    constructor(config) {
        const app = getApps().find((item) => item.name === "eulennest-multiplayer")
            ?? initializeApp(config, "eulennest-multiplayer");
        this.auth = getAuth(app);
        this.db = getDatabase(app);
        this.user = null;
        this.roomId = null;
        this.unsubscribers = [];
    }

    async connect() {
        if (this.auth.currentUser) {
            this.user = this.auth.currentUser;
            return this.user;
        }

        const credential = await signInAnonymously(this.auth);
        this.user = credential.user;
        return this.user;
    }

    static normalizeRoomId(value) {
        return String(value ?? "").toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
    }

    static createRoomId() {
        const bytes = crypto.getRandomValues(new Uint8Array(6));
        return [...bytes].map((byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
    }

    async createRoom(playerName, maxPlayers = 4) {
        await this.connect();

        for (let attempt = 0; attempt < 8; attempt++) {
            const roomId = Multiplayer.createRoomId();
            const metaRef = ref(this.db, `rooms/${roomId}/meta`);
            const result = await runTransaction(metaRef, (current) => {
                if (current) return;
                return {
                    hostId: this.user.uid,
                    status: "lobby",
                    maxPlayers,
                    createdAt: Date.now()
                };
            }, { applyLocally: false });

            if (result.committed) {
                await this.joinRoom(roomId, playerName);
                return roomId;
            }
        }

        throw new Error("Не получилось подобрать свободный код комнаты.");
    }

    async joinRoom(roomId, playerName) {
        await this.connect();
        const normalizedRoomId = Multiplayer.normalizeRoomId(roomId);
        if (normalizedRoomId.length !== 6) throw new Error("Код комнаты должен содержать 6 символов.");

        const metaSnapshot = await get(ref(this.db, `rooms/${normalizedRoomId}/meta`));
        const meta = metaSnapshot.val();
        if (!meta) throw new Error("Комната не найдена.");
        if (meta.status !== "lobby") throw new Error("Партия в этой комнате уже началась.");

        const playersSnapshot = await get(ref(this.db, `rooms/${normalizedRoomId}/players`));
        const players = playersSnapshot.val() ?? {};
        if (!players[this.user.uid] && Object.keys(players).length >= meta.maxPlayers) {
            throw new Error("В комнате уже нет свободных мест.");
        }

        const playerRef = ref(this.db, `rooms/${normalizedRoomId}/players/${this.user.uid}`);
        const result = await runTransaction(playerRef, (current) => current ?? {
            name: sanitizeName(playerName),
            joinedAt: Date.now(),
            online: true
        }, { applyLocally: false });

        if (!result.committed) throw new Error("Не получилось войти в комнату.");

        this.roomId = normalizedRoomId;
        this.playerRef = playerRef;
        await onDisconnect(playerRef).remove();
        return normalizedRoomId;
    }

    subscribeRoom(callback) {
        this.requireRoom();
        const room = { meta: null, players: null };
        const emit = () => callback({ meta: room.meta, players: room.players });
        this.track(onValue(ref(this.db, `rooms/${this.roomId}/meta`), (snapshot) => { room.meta = snapshot.val(); emit(); }));
        this.track(onValue(ref(this.db, `rooms/${this.roomId}/players`), (snapshot) => { room.players = snapshot.val() ?? {}; emit(); }));
    }

    subscribePublicState(callback) {
        this.requireRoom();
        return this.track(onValue(ref(this.db, `rooms/${this.roomId}/public`), (snapshot) => callback(snapshot.val())));
    }

    subscribeHand(callback) {
        this.requireRoom();
        return this.track(onValue(ref(this.db, `rooms/${this.roomId}/hands/${this.user.uid}`), (snapshot) => callback(snapshot.val() ?? [])));
    }

    listenForCommands(callback) {
        this.requireRoom();
        const commandsRef = ref(this.db, `rooms/${this.roomId}/commands`);
        return this.track(onChildAdded(commandsRef, async (snapshot) => {
            const command = snapshot.val();
            await callback(command, snapshot.key);
        }));
    }

    async sendCommand(type, data, revision) {
        this.requireRoom();
        const commandRef = push(ref(this.db, `rooms/${this.roomId}/commands`));
        await set(commandRef, { type, data, revision, from: this.user.uid, createdAt: serverTimestamp() });
    }

    async removeCommand(commandId) {
        await remove(ref(this.db, `rooms/${this.roomId}/commands/${commandId}`));
    }

    async setGame(engine, publicState, hands) {
        this.requireRoom();
        const patch = {
            [`rooms/${this.roomId}/engine`]: engine,
            [`rooms/${this.roomId}/public`]: publicState,
            [`rooms/${this.roomId}/meta/status`]: publicState.phase === "finished" ? "finished" : "playing"
        };
        for (const [playerId, hand] of Object.entries(hands)) {
            patch[`rooms/${this.roomId}/hands/${playerId}`] = hand;
        }
        await update(ref(this.db), patch);
    }

    async getEngine() {
        this.requireRoom();
        return (await get(ref(this.db, `rooms/${this.roomId}/engine`))).val();
    }

    async getRoom() {
        this.requireRoom();
        return (await get(ref(this.db, `rooms/${this.roomId}`))).val();
    }

    async leave() {
        this.clearListeners();
        if (this.playerRef) await remove(this.playerRef);
        this.roomId = null;
        this.playerRef = null;
    }

    clearListeners() {
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    }

    track(unsubscribe) {
        this.unsubscribers.push(unsubscribe);
        return unsubscribe;
    }

    requireRoom() {
        if (!this.roomId || !this.user) throw new Error("Сначала войди в комнату.");
    }
}

function sanitizeName(value) {
    const name = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
    return name || "Безымянная сова";
}
