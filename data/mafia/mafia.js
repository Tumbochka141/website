import { Multiplayer } from "../../modules/Multiplayer.js";
import { firebaseConfig, isFirebaseConfigured } from "../../firebase-config.js";
import {
    GAME_TYPE,
    PHASES,
    ROLES,
    applyCommand,
    assertFirebaseSafe,
    createInitialGame,
    createPrivateStates,
    createPublicState
} from "./engine.js";

// Точка входа интерфейса. Пока HTML не создан, держим здесь только зависимости,
// а правила игры развиваем и тестируем отдельно в engine.js.
export {
    Multiplayer,
    firebaseConfig,
    isFirebaseConfigured,
    GAME_TYPE,
    PHASES,
    ROLES,
    applyCommand,
    assertFirebaseSafe,
    createInitialGame,
    createPrivateStates,
    createPublicState
};

console.log("mafia.js загружен");

let multiplayer = null;
let room = null;
let publicState = null;
let privateState = null;

init();

async function init() {
    if (!isFirebaseConfigured){
        console.error("Firebase не настроен");
        return;
    }

    try{
        multiplayer = new Multiplayer(firebaseConfig);
        await multiplayer.connect();

        console.log("Подключение успешно", multiplayer.user.uid);

        bindEvents();
    } catch (error){
        console.error("Ошибка подключения", error);
    }
    
}

function bindEvents(){
    ui.createRoomButton.addEventListener("click", createRoom);
    ui.joinRoomButton.addEventListener("click", joinRoom);
    ui.startGameButton.addEventListener("click", startGame);
}

const ui = {
    onlineName: document.querySelector("#online-name"),
    createRoomButton: document.querySelector("#create-room"),
    joinRoomButton: document.querySelector("#join-room"),
    roomCodeInput: document.querySelector("#room-code-input"),
    roomInfo: document.querySelector("#room-info"),
    roomCodeOutput: document.querySelector("#room-code-output"),
    onlineError: document.querySelector("#online-error"),
    lobbyPlayers: document.querySelector("#lobby-players"),
    lobbyPlayersCount: document.querySelector("#lobby-player-count"),
    lobbyPlayersList: document.querySelector("#lobby-player-list"),
    startGameButton: document.querySelector("#start-game"),
    leaveLobbyButton: document.querySelector("#leave-lobby"),
    roleCard: document.querySelector("#role-card"),
    roleSymbol: document.querySelector("#role-symbol"),
    roleName: document.querySelector("#role-name"),
    roleDescription: document.querySelector("#role-description"),
    roleTeam: document.querySelector("#role-team"),
    roleTeamList: document.querySelector("#role-team-list"),
    roleGoal: document.querySelector("#role-goal")
};
const ROLE_CONTENT = {
    [ROLES.MAFIA]: {
        name: "Мафия",
        symbol: "♠",
        description: "Ты местный чмошник, которому кажется, что он крутой, так как он в мафии. Так что днём лучше себя не выдавать.",
        goal: "Убивай мирных и получи преимущество перед законом."
    },
    [ROLES.CITIZEN]: {
        name: "Мирный житель",
        symbol: "☀",
        description: "Ты просто житель. Казалось бы, мирный житель — простая роль, но от твоего выбора зависит, докажешь ли ты, что ты тупое стадо, которым легко манипулировать, или же некто, у кого чуть больше трёх извилин в мозгу.",
        goal: "Путём голосования найди мафию и положи конец всему беспределу."
    },
    [ROLES.DOCTOR]: {
        name: "Доктор",
        symbol: "✚",
        description: "Ранее ты потратил детство на образование, и вот сейчас ты гигачад, способный каждую ночь защитить одного бедолагу от неминуемой гибели — даже если этим бедолагой окажется убийца.",
        goal: "Выполни свой главный долг, который ты сам себе выбрал, — защити жителей."
    },
    [ROLES.DETECTIVE]: {
        name: "Полицейский",
        symbol: "⌕",
        description: "И вот, после всей твоей честной работы, пора наконец-таки посадить подонков, которые портят жизнь городу. Однако лишь тебе — и только тебе — дано узнать, кто же мафия.",
        goal: "Убеждай мирных жителей в своей правоте и засади подонков за решётку."
    },
    [ROLES.ESCORT]: {
        name: "Путана",
        symbol: "♥",
        description: "Жизнь тебя помотала, конечно, подруга. Однако, хоть ты и пала на самое дно общества, ты можешь спасти граждан обретённой способностью — блокировать чужое ночное действие.",
        goal: "Выполняй свою работу и помоги городу, блокируя способности других участников."
    },
    [ROLES.MANIAC]: {
        name: "Маньяк",
        symbol: "♦",
        description: "Скорее всего, отец тебя много бил в детстве и выбил из тебя все остатки здоровой психики. Впоследствии первой твоей жертвой стал как раз твой отец. И в такое сложное для города время ты делаешь свою любимую работу — убиваешь.",
        goal: "Убей каждого."
    },
    [ROLES.JESTER]: {
        name: "Самоубийца",
        symbol: "☠",
        description: "Бедолага ты, конечно. Ранее у тебя умерла жена, а из оставшихся родных — родители, которым стало на тебя плевать, как только тебе исполнилось 18. Так что для тебя самоубийство стало лучшим вариантом, на который ты не мог решиться, пока мафия не связалась с тобой и не дала работу: защищать их за деньги, которые после твоей смерти пойдут родным.",
        goal: "Добейся для себя смертной казни."
    }
};

async function createRoom() {
    const playerName = ui.onlineName.value.trim() || "игрок";

    ui.onlineError.textContent = "";
    ui.createRoomButton.disabled = true;

    try {
        const roomCode = await multiplayer.createRoom(playerName,16,null,GAME_TYPE);

        ui.roomCodeOutput.textContent = roomCode;
        ui.roomInfo.hidden = false;
        connectToRoom();

        console.log("Комната создана:", roomCode);
    } catch (error){
        ui.onlineError.textContent = error.message;
        console.error("Не удалось создать комнату:", error);
    } finally {
        ui.createRoomButton.disabled = false;
    }
}

async function joinRoom() {
    const playerName = ui.onlineName.value.trim() || "Игрок";
    const roomCode = Multiplayer.normalizeRoomId(ui.roomCodeInput.value);

    if (roomCode.length !== 6) {
        ui.onlineError.textContent = "Введите шестизначный код комнаты";
        return;
    }

    ui.onlineError.textContent = "";
    ui.joinRoomButton.disabled = true;

    try{
        const connectedCode = await multiplayer.joinRoom(roomCode, playerName, null, GAME_TYPE);

        ui.roomCodeOutput.textContent = connectedCode;
        ui.roomInfo.hidden = false;
        connectToRoom();

        console.log("Вход выполнен", connectedCode);
    } catch(error){
        ui.onlineError.textContent = error.message;
        console.error("Не удалось войти в комнату:", error);
    } finally {
        ui.joinRoomButton.disabled = false;
    }
}

function connectToRoom(){
    multiplayer.clearListeners();

    multiplayer.subscribeRoom((roomState) => {
        room = {
            meta: roomState?.meta ?? {},
            players:roomState?.players ?? {}
        };

        console.log("Комната обновилась", room);

        renderRoom();
    });

    multiplayer.subscribePublicState((state) =>{
        publicState = state ?? null;

        console.log("Общее состояние игры:", publicState);

        if(publicState?.phase){
            showGamePhase(publicState.phase);
        }

        renderPrivateState();
    });

    multiplayer.subscribeHand((state) => {
        privateState = state ?? null;

        console.log("Личное состояние:", privateState);
        renderPrivateState();
    });
}
function showGamePhase(phase){
    const phaseInputIds = {[PHASES.NIGHT]: "preview-game", [PHASES.DAY]: "preview-day", [PHASES.VOTING]: "preview-vote", [PHASES.FINISHED]: "preview-result"};
    const inputId = phaseInputIds[phase];
    const input = document.querySelector(`#${inputId}`);

    if (input){
        input.checked = true;
    }
}

function renderPrivateState(){
    const role = privateState?.role;
    const content = ROLE_CONTENT[role];

    if (!content) return;

    ui.roleCard.dataset.role = role;
    ui.roleSymbol.textContent = content.symbol;
    ui.roleName.textContent = content.name;
    ui.roleDescription.textContent = content.description;
    ui.roleGoal.textContent = content.goal;

    const teammateIds = role === ROLES.MAFIA ? (privateState.mafia ?? []).filter((playerId) => playerId !== multiplayer.user.uid): [];
    const teammateElements = teammateIds.map((playerId) => {
        const name = publicState?.players?.[playerId]?.name ?? "Союзник";
        const item = document.createElement("strong");
        const avatar = document.createElement("span");

        avatar.className = "avatar avatar--small";
        avatar.textContent = name.slice(0, 1).toUpperCase();

        item.append(avatar,name);

        return item;
    });

    ui.roleTeam.hidden = teammateElements.length === 0;
    ui.roleTeamList.replaceChildren(...teammateElements);
}

function renderRoom(){
    const players = Object.entries(room?.players ?? {});
    const maxPlayers = room?.meta?.maxPlayers ?? 16;
    const hostId = room?.meta?.hostId;

    const isHost = multiplayer.user.uid === hostId;
    const onlinePlayers = players.filter(([, player]) => player.online !== false);
    const isPlaying = room?.meta?.status !== "lobby";
    ui.lobbyPlayers.hidden = false;
    ui.lobbyPlayersCount.textContent = `${onlinePlayers.length} / ${maxPlayers}`;

    ui.startGameButton.hidden = !isHost || isPlaying;
    ui.startGameButton.disabled = onlinePlayers.length < 4;

    const playerElements = players.map(([playerId,player]) => {
        const item = document.createElement("li");
        const playerIsHost = playerId === hostId;

        item.textContent = playerIsHost? `${player.name} · ведущий`: player.name;

        return item;
    });

    ui.lobbyPlayersList.replaceChildren(...playerElements);
}

async function startGame() {
    const hostId = room?.meta?.hostId;

    if (multiplayer.user.uid !== hostId) {
        ui.onlineError.textContent = "Запустить игру може ток ведущий";
        return;
    }

    const players = Object.entries(room?.players ?? {}).filter(([, player])=> player.online !== false);

    if (players.length < 4) {
        ui.onlineError.textContent = "Нужно хотя-бы 4 человека";
        return;
    }

    ui.onlineError.textContent = "";
    ui.startGameButton.disabled = true;

    try{
        const engine = createInitialGame(players);
        const nextPublicState = createPublicState(engine);
        const privateStates = createPrivateStates(engine);

        assertFirebaseSafe(engine);
        assertFirebaseSafe(nextPublicState);
        assertFirebaseSafe(privateStates);

        await multiplayer.setGame(engine,nextPublicState,privateStates);
        console.log("Партия запушена:", engine);

    } catch(error){
        ui.onlineError.textContent = error.message;
        console.error("Не удалось запустить игру:", error);
        
    }
    
}
