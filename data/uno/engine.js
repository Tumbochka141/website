import { COLORS } from "./constants.js";
import { cardLabel, isPlayable, shuffle } from "./cards.js";

export function drawCards(engine, playerId, amount) {
    for (let index = 0; index < amount; index++) {
        if (!engine.deck.length && engine.discard.length > 1) {
            const topCard = engine.discard.pop();
            engine.deck = shuffle(engine.discard);
            engine.discard = [topCard];
        }
        if (engine.deck.length) engine.hands[playerId].push(engine.deck.pop());
    }
}

export function nextIndex(engine, steps = 1) {
    return (engine.current + engine.direction * steps + engine.order.length * steps) % engine.order.length;
}

export function moveNext(engine, steps = 1) {
    engine.current = nextIndex(engine, steps);
}

export function playCards(engine, playerId, indexes, selectedColor, getPlayerName) {
    const cards = engine.hands[playerId];
    const selectedIndexes = [...new Set(Array.isArray(indexes) ? indexes : [])];
    if (selectedIndexes.length < 1 || selectedIndexes.length > 2) {
        throw new Error("Можно сыграть одну или две карты.");
    }

    const selectedCards = selectedIndexes.map((index) => cards[index]);
    const card = selectedCards[0];
    const topCard = engine.discard.at(-1);
    if (!card || !isPlayable(card, engine.currentColor, topCard)) {
        throw new Error("Эта карта не подходит.");
    }
    if (selectedCards.length === 2 && (
        !card.color
        || !selectedCards[1]
        || selectedCards[1].color !== card.color
        || selectedCards[1].value !== card.value
    )) {
        throw new Error("Вместе можно класть только точные цветные дубли.");
    }

    selectedIndexes.sort((left, right) => right - left).forEach((index) => cards.splice(index, 1));
    engine.discard.push(...selectedCards);
    engine.currentColor = card.color ?? selectedColor;
    if (!engine.currentColor || !COLORS.includes(engine.currentColor)) throw new Error("Нужно выбрать цвет.");

    if (!cards.length) {
        engine.unoPendingPlayerId = null;
        engine.winner = playerId;
        return `${getPlayerName(playerId)} победил!`;
    }

    engine.unoPendingPlayerId = cards.length === 1 ? playerId : null;
    const count = selectedCards.length;
    if (card.value === "reverse") {
        if (count % 2) engine.direction *= -1;
        moveNext(engine, count === 2 ? 1 : (engine.order.length === 2 ? 2 : 1));
    } else if (card.value === "skip") {
        moveNext(engine, 1 + count);
    } else if (card.value === "+2" || card.value === "+4") {
        const amount = (card.value === "+2" ? 2 : 4) * count;
        const target = engine.order[nextIndex(engine)];
        drawCards(engine, target, amount);
        moveNext(engine, 2);
    } else {
        moveNext(engine);
    }

    return `${getPlayerName(playerId)} кладёт ${count === 2 ? "две карты " : ""}${cardLabel(card)}.`;
}
