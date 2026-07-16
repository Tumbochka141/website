# Подключение UNO Online

1. Создай проект на [Firebase Console](https://console.firebase.google.com/).
2. Добавь Web App и скопируй объект `firebaseConfig` в `firebase-config.js`.
3. Открой **Authentication → Sign-in method** и включи **Anonymous**.
4. Создай **Realtime Database**. Значение `databaseURL` обязательно должно присутствовать в конфигурации.
5. Установи Firebase CLI: `npm install -g firebase-tools`.
6. В папке сайта выполни `firebase login`, затем `firebase use --add` и `firebase deploy --only database` — это загрузит правила из `firebase.rules.json`.
7. Для локальной проверки запусти в папке сайта:

   ```powershell
   python -m http.server 8000
   ```

8. Открой `http://localhost:8000/uno.html?mode=online` в двух разных браузерах или в обычном и приватном окне.

Нельзя открывать мультиплеер через `file:///`: ES-модулям требуется HTTP(S). На GitHub Pages это ограничение исчезнет.
