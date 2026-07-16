export const firebaseConfig = {
    apiKey: "AIzaSyDDKO_bDhCnkrap5yOsjzxZtRNWz8Xh9Xg",
    authDomain: "ealennest.firebaseapp.com",
    databaseURL: "https://ealennest-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "ealennest",
    storageBucket: "ealennest.firebasestorage.app",
    messagingSenderId: "1009418443211",
    appId: "1:1009418443211:web:db5c6cfd897c52f02a7e4e",
    measurementId: "G-5G0E86C4SB"
};

export const isFirebaseConfigured = Boolean(firebaseConfig.databaseURL)
    && !Object.values(firebaseConfig).some((value) => value.includes("PASTE_"));
