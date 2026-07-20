(() => {
    const STORAGE_KEY = "eulennest-bunker-palette";
    const button = document.querySelector("#bunker-theme-toggle");
    if (!button) return;

    const readPalette = () => {
        try {
            return localStorage.getItem(STORAGE_KEY);
        } catch (error) {
            console.warn("Не удалось прочитать палитру:", error);
            return "cold";
        }
    };

    const storePalette = (palette) => {
        try {
            localStorage.setItem(STORAGE_KEY, palette);
        } catch (error) {
            console.warn("Не удалось сохранить палитру:", error);
        }
    };

    const applyPalette = (isWarm) => {
        document.body.classList.toggle("is-warm", isWarm);
        button.setAttribute("aria-pressed", String(isWarm));
        const label = isWarm ? "Включить холодное освещение" : "Включить тёплое освещение";
        button.setAttribute("aria-label", label);
        button.title = isWarm ? "Холодное освещение" : "Тёплое освещение";
    };

    const animateSwitch = (isWarm) => {
        const animationClass = isWarm ? "is-igniting" : "is-shutting-down";
        button.classList.remove("is-igniting", "is-shutting-down");
        void button.offsetWidth;
        button.classList.add(animationClass);
        window.setTimeout(() => button.classList.remove(animationClass), 520);
    };

    applyPalette(readPalette() === "warm");
    button.addEventListener("click", () => {
        const nextIsWarm = !document.body.classList.contains("is-warm");
        animateSwitch(nextIsWarm);
        applyPalette(nextIsWarm);
        storePalette(nextIsWarm ? "warm" : "cold");
    });
})();
