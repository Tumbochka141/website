if (window.opener && location.hash) {
    window.opener.postMessage(
        { type: "eulennest-discord-oauth", hash: location.hash },
        location.origin
    );
    history.replaceState(null, "", location.pathname);
    window.close();
} else {
    document.body.textContent = "Окно можно закрыть и вернуться в Eulennest.";
}
