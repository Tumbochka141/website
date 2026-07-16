"use strict";

(() => {
    const STORAGE_KEY = "eulennest-discord-profile";
    const STATE_KEY = "eulennest-discord-oauth-state";
    const MESSAGE_TYPE = "eulennest-discord-oauth";
    let root = null;
    let pendingLogin = null;

    function getProfile() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? null;
        } catch {
            localStorage.removeItem(STORAGE_KEY);
            return null;
        }
    }

    function saveProfile(profile) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
        render();
        dispatchEvent(new CustomEvent("discord-profile-change", { detail: profile }));
        return profile;
    }

    function disconnect() {
        localStorage.removeItem(STORAGE_KEY);
        render();
        dispatchEvent(new CustomEvent("discord-profile-change", { detail: null }));
    }

    function avatarUrl(user) {
        if (user.avatar) {
            const extension = user.avatar.startsWith("a_") ? "gif" : "png";
            return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`;
        }
        const index = user.discriminator && user.discriminator !== "0"
            ? Number(user.discriminator) % 5
            : Number((BigInt(user.id) >> 22n) % 6n);
        return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    }

    function createState() {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    }

    function callbackUrl() {
        const file = window.EULENNEST_DISCORD?.callbackFile || "discord-callback.html";
        return new URL(file, location.href).href;
    }

    async function connect() {
        const clientId = window.EULENNEST_DISCORD?.clientId;
        if (!clientId || clientId.includes("PASTE_")) throw new Error("Сначала добавь Discord Client ID в discord-config.js.");
        if (location.protocol === "file:") throw new Error("Вход через Discord работает только через HTTP(S).");
        if (pendingLogin) return pendingLogin.promise;

        const state = createState();
        sessionStorage.setItem(STATE_KEY, state);
        const authorize = new URL("https://discord.com/oauth2/authorize");
        authorize.search = new URLSearchParams({
            response_type: "token",
            client_id: clientId,
            scope: "identify",
            state,
            redirect_uri: callbackUrl()
        });

        const popup = open(authorize.href, "eulennest-discord", "popup,width=520,height=760");
        if (!popup) throw new Error("Браузер заблокировал окно входа через Discord.");
        pendingLogin = {};
        pendingLogin.promise = new Promise((resolve, reject) => Object.assign(pendingLogin, { resolve, reject, popup }));
        pendingLogin.timer = setInterval(() => {
            if (popup.closed) settleLogin(new Error("Окно входа через Discord было закрыто."));
        }, 500);
        return pendingLogin.promise;
    }

    async function acceptOAuth(hash) {
        const values = new URLSearchParams(hash.replace(/^#/, ""));
        const expectedState = sessionStorage.getItem(STATE_KEY);
        sessionStorage.removeItem(STATE_KEY);
        if (!pendingLogin || !expectedState || values.get("state") !== expectedState) throw new Error("Discord вернул неверный OAuth state.");
        if (values.get("error")) throw new Error(values.get("error_description") || "Discord отклонил вход.");
        const token = values.get("access_token");
        const tokenType = values.get("token_type") || "Bearer";
        if (!token) throw new Error("Discord не вернул токен доступа.");

        const response = await fetch("https://discord.com/api/v10/users/@me", {
            headers: { Authorization: `${tokenType} ${token}` }
        });
        if (!response.ok) throw new Error("Не получилось получить профиль Discord.");
        const user = await response.json();
        return saveProfile({
            id: user.id,
            name: user.global_name || user.username,
            username: user.username,
            avatarUrl: avatarUrl(user)
        });
    }

    function settleLogin(error, profile = null) {
        if (!pendingLogin) return;
        const pending = pendingLogin;
        pendingLogin = null;
        clearInterval(pending.timer);
        if (error) pending.reject(error);
        else pending.resolve(profile);
    }

    function render() {
        if (!root) return;
        const profile = getProfile();
        root.classList.toggle("is-connected", Boolean(profile));
        const avatar = root.querySelector("[data-discord-avatar]");
        const name = root.querySelector("[data-discord-name]");
        const login = root.querySelector("[data-discord-login]");
        const logout = root.querySelector("[data-discord-logout]");
        avatar.hidden = !profile;
        if (profile) avatar.src = profile.avatarUrl;
        name.textContent = profile?.name || "Discord";
        login.hidden = Boolean(profile);
        logout.hidden = !profile;
    }

    function mount(selector = "#discord-profile") {
        root = document.querySelector(selector);
        if (!root) return;
        root.querySelector("[data-discord-login]").addEventListener("click", async () => {
            try { await connect(); }
            catch (error) {
                if (window.gameDialog) await window.gameDialog.alert(error.message);
                else {
                    const name = root.querySelector("[data-discord-name]");
                    name.textContent = error.message;
                    setTimeout(render, 3500);
                }
            }
        });
        root.querySelector("[data-discord-logout]").addEventListener("click", disconnect);
        render();
    }

    addEventListener("message", async (event) => {
        if (event.origin !== location.origin || event.data?.type !== MESSAGE_TYPE) return;
        if (pendingLogin) clearInterval(pendingLogin.timer);
        try { settleLogin(null, await acceptOAuth(event.data.hash)); }
        catch (error) { settleLogin(error); }
    });

    window.DiscordProfile = { mount, connect, disconnect, getProfile };
})();
