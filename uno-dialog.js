"use strict";

(() => {
    const dialog = document.querySelector("#game-alert");
    const message = document.querySelector("#game-alert-message");
    const cancelButton = document.querySelector("#game-alert-cancel");
    const okButton = document.querySelector("#game-alert-ok");
    let resolveDialog = null;

    function finish(result) {
        if (!resolveDialog) return;
        const resolve = resolveDialog;
        resolveDialog = null;
        dialog.close();
        resolve(result);
    }

    function open(text, confirm = false) {
        if (resolveDialog) finish(false);
        message.textContent = text;
        cancelButton.hidden = !confirm;
        okButton.textContent = confirm ? "Да" : "Понятно";
        dialog.showModal();
        okButton.focus();
        return new Promise((resolve) => { resolveDialog = resolve; });
    }

    okButton.addEventListener("click", () => finish(true));
    cancelButton.addEventListener("click", () => finish(false));
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(false);
    });

    window.gameDialog = {
        alert(text) { return open(text); },
        confirm(text) { return open(text, true); }
    };
})();
