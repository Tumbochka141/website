import { COLOR_CLASSES, COLORS_BY_DATA_KEY } from "./constants.js";

const select = (selector) => document.querySelector(selector);

export const ui = {
    entry: select("#online-entry"),
    room: select("#online-room"),
    game: select(".game-board"),
    name: select("#online-name"),
    codeInput: select("#online-code-input"),
    code: select("#online-code"),
    create: select("#online-create"),
    join: select("#online-join"),
    leave: select("#online-leave"),
    start: select("#online-start"),
    players: select("#online-players"),
    opponents: select("#opponents"),
    status: select("#status-text"),
    hand: select("#player-hand"),
    top: select("#discard-pile"),
    draw: select("#draw-pile"),
    deckCount: select("#deck-count"),
    uno: select("#uno-call"),
    pass: select("#pass-turn"),
    reveal: select("#reveal-hand"),
    error: select("#online-error"),
    colorDialog: select("#color-dialog"),
    direction: select("#direction-indicator"),
    currentColor: select("#current-color")
};

let renderedDirection = null;

export function renderTableIndicators(color, direction) {
    const colorClass = COLOR_CLASSES[color];
    ui.game.classList.remove("has-active-color", "color-red", "color-yellow", "color-green", "color-blue");
    if (colorClass) ui.game.classList.add("has-active-color", `color-${colorClass}`);

    ui.currentColor.hidden = !colorClass;
    ui.currentColor.setAttribute("aria-label", colorClass ? `Текущий цвет: ${color}` : "Текущий цвет не выбран");
    ui.direction.hidden = false;
    ui.direction.textContent = direction === 1 ? "↻" : "↺";
    ui.direction.setAttribute("aria-label", direction === 1
        ? "Направление по часовой стрелке"
        : "Направление против часовой стрелки");

    if (renderedDirection !== null && renderedDirection !== direction) {
        ui.direction.classList.remove("is-changing");
        void ui.direction.offsetWidth;
        ui.direction.classList.add("is-changing");
    }
    renderedDirection = direction;
}

export function chooseColor() {
    return new Promise((resolve) => {
        ui.colorDialog.showModal();
        ui.colorDialog.querySelectorAll("button").forEach((button) => {
            button.onclick = () => {
                ui.colorDialog.close();
                resolve(COLORS_BY_DATA_KEY[button.dataset.color]);
            };
        });
    });
}
