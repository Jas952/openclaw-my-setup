# Councils

`councils/` — это слой автоматизированного контроля вокруг моего workspace. Он помогает понимать, что происходит в системе, где есть риски и какие проблемы требуют внимания.

## Что это делает

Здесь собраны:

- профили проверок;
- движок запуска review-сценариев;
- evidence-слой;
- структурированные отчёты по security и platform health.

## Структура

```text
councils/
├── checks/
│   ├── review-profiles/   — профили советов и видов проверки
│   └── security-checks/   — переиспользуемые security-check сценарии
├── data/
│   ├── delivery/          — доставка отчетов и уведомлений
│   ├── evidence/          — нормализованные evidence-артефакты
│   ├── reports/           — итоговые отчеты по профилям
│   ├── state/             — runtime state и служебные маркеры
│   └── telegram/          — Telegram-oriented delivery state
├── engine/                — orchestration-движок council-проверок
└── scripts/               — служебные сценарии запуска
```

## Как это работает

1. Профиль проверки определяет, что именно нужно анализировать.
2. Движок собирает evidence и нормализует входные данные.
3. Security/platform-health логика формирует выводы и рекомендации.
4. Результат сохраняется как machine-readable report.
5. При необходимости отчёт отправляется дальше в Telegram или другой operational-слой.

Отчеты сохраняются в виде:

- `councils/data/reports/<profile>/latest.json`
- `councils/data/reports/<profile>/<profile>-<timestamp>.json`


