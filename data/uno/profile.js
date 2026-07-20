import { PLAYER_NAME_STORAGE_KEY } from "./constants.js";

export function saveIdentity(nameInput) {
    const profile = window.DiscordProfile?.getProfile();
    const name = nameInput.value.trim().slice(0, 24) || profile?.name || "Игрок";
    nameInput.value = name;
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
    return { name, avatarUrl: profile?.avatarUrl ?? null };
}

export function isDiscordAvatar(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname === "cdn.discordapp.com";
    } catch {
        return false;
    }
}

export function friendlyError(error) {
    if (error?.code === "auth/operation-not-allowed") return "В Firebase нужно включить анонимную авторизацию.";
    if (error?.code === "PERMISSION_DENIED") return "Firebase отклонил запрос: проверь правила базы.";
    return error?.message ?? "Что-то пошло не так.";
}
