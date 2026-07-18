(() => {
    const error = document.querySelector("#online-error");
    const createButton = document.querySelector("#online-create");
    const joinButton = document.querySelector("#online-join");

    if (location.protocol === "file:") {
        error.textContent = "Онлайн-режим нужно открыть через GitHub Pages или локальный сервер, а не как file://.";
        createButton.disabled = true;
        joinButton.disabled = true;
        return;
    }

    const entryUrl = new URL("../../uno.js", document.currentScript.src);
    import(entryUrl.href).catch((loadError) => {
        console.error(loadError);
        error.textContent = "Не удалось загрузить игровую логику UNO.";
        createButton.disabled = true;
        joinButton.disabled = true;
    });
})();
