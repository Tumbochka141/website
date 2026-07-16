const themeToggle = document.querySelector('.day-night-toggle');

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
    };

    const savedTheme = localStorage.getItem('eulennest-theme');
    applyTheme(savedTheme !== 'day');

    themeToggle.addEventListener('click', () => {
        const isNight = !document.body.classList.contains('is-night');
        applyTheme(isNight);
        localStorage.setItem('eulennest-theme', isNight ? 'night' : 'day');
    });
}
