(() => {
    const toggle = document.querySelector(".uno-theme-toggle");
    const label = toggle?.querySelector(".uno-theme-toggle__label");
    if (!toggle || !label) return;

    const requestedTheme = new URLSearchParams(location.search).get("theme");
    const savedTheme = localStorage.getItem("eulennest-theme");

    const applyTheme = (isDay) => {
        document.body.classList.toggle("is-day", isDay);
        toggle.setAttribute("aria-pressed", String(isDay));
        toggle.setAttribute("aria-label", isDay ? "Включить ночную тему" : "Включить светлую тему");
        label.textContent = isDay ? "День" : "Ночь";
    };

    applyTheme(requestedTheme === "day" || (requestedTheme !== "night" && savedTheme === "day"));
    toggle.addEventListener("click", () => {
        const isDay = !document.body.classList.contains("is-day");
        applyTheme(isDay);
        localStorage.setItem("eulennest-theme", isDay ? "day" : "night");
    });
})();
