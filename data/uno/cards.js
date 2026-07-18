import { CARD_LABELS, COLOR_CLASSES, COLORS } from "./constants.js";

export function createDeck() {
    const deck = [];

    for (const color of COLORS) {
        deck.push({ color, value: 0, type: "number" });
        for (let value = 1; value <= 9; value++) {
            deck.push({ color, value, type: "number" }, { color, value, type: "number" });
        }
        for (const value of ["skip", "reverse", "+2"]) {
            deck.push({ color, value, type: "action" }, { color, value, type: "action" });
        }
    }

    for (let index = 0; index < 4; index++) {
        deck.push(
            { color: null, value: "wild", type: "wild" },
            { color: null, value: "+4", type: "wild" }
        );
    }
    return deck;
}

export function shuffle(deck) {
    for (let index = deck.length - 1; index > 0; index--) {
        const target = Math.floor(Math.random() * (index + 1));
        [deck[index], deck[target]] = [deck[target], deck[index]];
    }
    return deck;
}

export function cardLabel(card) {
    return CARD_LABELS[card.value] ?? String(card.value);
}

export function isPlayable(card, currentColor, topCard) {
    return card.type === "wild" || card.color === currentColor || card.value === topCard.value;
}

export function createCardElement(card, { button = false, playable = false } = {}) {
    const element = document.createElement(button ? "button" : "div");
    if (button) element.type = "button";
    element.className = `uno-card uno-card--${card?.color ? COLOR_CLASSES[card.color] : "wild"}${playable ? " is-playable" : ""}`;

    const value = document.createElement("span");
    value.className = "uno-card__value";
    value.textContent = card ? cardLabel(card) : "?";
    element.append(value);
    return element;
}
