document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.querySelector('.day-night-toggle');

    if (themeToggle) {
        const applyTheme = (isNight) => {
            document.body.classList.toggle('is-night', isNight);
            themeToggle.setAttribute('aria-pressed', String(isNight));
            themeToggle.setAttribute('aria-label', isNight ? 'Включить дневной режим' : 'Включить ночной режим');
            themeToggle.querySelector('.day-night-toggle__label').textContent = isNight ? 'NIGHT MODE' : 'DAY MODE';
        };

        const savedTheme = localStorage.getItem('eulennest-theme');
        applyTheme(savedTheme !== 'day');

        themeToggle.addEventListener('click', () => {
            const isNight = !document.body.classList.contains('is-night');
            applyTheme(isNight);
            localStorage.setItem('eulennest-theme', isNight ? 'night' : 'day');
        });
    }

    const items = Array.from(document.querySelectorAll('.gallery-item'));
    if (items.length !== 4) return;

    // Начальные классы для позиций
    let classes = ['pos1', 'pos2', 'pos3', 'pos4'];

    // Применяем начальные классы
    items.forEach((item, index) => {
        let className = 'gallery-item ' + classes[index];
        if (index === 0) { // pos1 is first item
            className += ' active';
        }
        item.className = className;
    });

    function cyclePositions() {
        // Против часовой (←↓→↑):
        const nextClasses = [
            classes[3], // pos1 станет pos4
            classes[0], // pos2 станет pos1
            classes[1], // pos3 станет pos2
            classes[2]  // pos4 станет pos3
        ];

        items.forEach((item, index) => {
            setTimeout(() => {
                let className = 'gallery-item ' + nextClasses[index];
                if (nextClasses[index] === 'pos1') {
                    className += ' active';
                }
                item.className = className;
            }, index * 150); // стадийная задержка для плавности
        });

        classes = nextClasses;
    }

    // Запуск цикла каждые 2 секунды
    setInterval(cyclePositions, 2200);
});
