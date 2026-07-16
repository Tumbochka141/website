export const firebaseConfig = {
    apiKey: "PASTE_FIREBASE_API_KEY",
    authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
    databaseURL: "https://PASTE_DATABASE_NAME.REGION.firebasedatabase.app",
    projectId: "PASTE_PROJECT_ID",
    appId: "PASTE_FIREBASE_APP_ID"
};

export const isFirebaseConfigured = !Object.values(firebaseConfig).some((value) => value.includes("PASTE_"));
