const themeToggles = Array.from(document.querySelectorAll('.day-night-toggle'));
const themeToggle = themeToggles[0];

if (themeToggle) {
    const toggleLabel = themeToggle.querySelector('.day-night-toggle__label');

    const applyTheme = (isNight) => {
        document.body.classList.toggle('is-night', isNight);
        themeToggle.setAttribute('aria-pressed', String(isNight));
        themeToggle.setAttribute(
            'aria-label',
            isNight ? 'Включить дневной режим' : 'Включить ночной режим'
        );

        if (toggleLabel) {
            toggleLabel.textContent = isNight ? 'NIGHT MODE' : 'DAY MODE';
        }

        themeToggles.slice(1).forEach((toggle) => {
            toggle.setAttribute('aria-pressed', String(isNight));
            toggle.setAttribute('aria-label', themeToggle.getAttribute('aria-label'));
            const label = toggle.querySelector('.day-night-toggle__label');
            if (label) label.textContent = isNight ? 'NIGHT MODE' : 'DAY MODE';
        });
    };

    const savedTheme = localStorage.getItem('eulennest-theme');
    const requestedTheme = new URLSearchParams(location.search).get('theme');
    applyTheme(requestedTheme === 'day' ? false : requestedTheme === 'night' ? true : savedTheme !== 'day');

    themeToggle.addEventListener('click', () => {
        const isNight = !document.body.classList.contains('is-night');
        applyTheme(isNight);
        localStorage.setItem('eulennest-theme', isNight ? 'night' : 'day');
    });

    themeToggles.slice(1).forEach((toggle) => {
        toggle.addEventListener('click', () => themeToggle.click());
    });
}
