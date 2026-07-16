const owlModule = document.createElement('script');
owlModule.src = 'modules/sovanaskakalke.js';
document.head.append(owlModule);

document.addEventListener('DOMContentLoaded', () => {
    const serverLink = document.querySelector('.sidebar-server-link');
    const discordCounts = document.querySelector('[data-discord-counts]');
    const discordName = document.querySelector('[data-discord-name]');

    if (serverLink && discordCounts) {
        const inviteCode = new URL(serverLink.href).pathname.split('/').filter(Boolean).pop();

        fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(inviteCode)}?with_counts=true`)
            .then((response) => {
                if (!response.ok) throw new Error(`Discord API: ${response.status}`);
                return response.json();
            })
            .then((invite) => {
                const online = Number(invite.approximate_presence_count).toLocaleString('ru-RU');
                const members = Number(invite.approximate_member_count).toLocaleString('ru-RU');

                discordCounts.textContent = `${online} онлайн · ${members} участников`;
                if (discordName && invite.guild?.name) {
                    discordName.textContent = invite.guild.name;
                }
            })
            .catch(() => {
                discordCounts.textContent = 'Данные временно недоступны';
            });
    }

    const items = Array.from(document.querySelectorAll('.gallery-item'));
    if (items.length !== 4) return;

    // Начальные классы для позиций
    let classes = ['pos1', 'pos2', 'pos3', 'pos4'];

    function setPosition(item, position, isActive) {
        item.classList.remove('pos1', 'pos2', 'pos3', 'pos4', 'active');
        item.classList.add(position);
        item.classList.toggle('active', isActive);
    }

    // Применяем начальные классы
    items.forEach((item, index) => {
        setPosition(item, classes[index], index === 0);
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
            setPosition(item, nextClasses[index], nextClasses[index] === 'pos1');
        });

        classes = nextClasses;
    }

    // Запуск цикла каждые 4 секунды
    setInterval(cyclePositions, 4000);
});
