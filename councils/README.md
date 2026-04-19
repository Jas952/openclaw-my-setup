# Councils

`councils/` — это слой автоматизированного контроля, review-логики и security/platform-health анализа вокруг моего OpenClaw workspace.

## За что отвечает эта папка

На практике этот блок нужен для того, чтобы бот и вся окружающая его среда не были "черным ящиком". Здесь собраны профили проверок, движок запуска review-сценариев, evidence-слой и выходные отчеты.

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
5. При необходимости он доставляется дальше в Telegram или другой operational-слой.

## Пример выходного результата

Отчеты сохраняются в виде:

- `councils/data/reports/<profile>/latest.json`
- `councils/data/reports/<profile>/<profile>-<timestamp>.json`

Внутри таких отчетов обычно есть:

- `reportFormatVersion`
- структурированные `headings`
- `recommendations[]`
- `references[]` с привязкой к `path:line`
- `evidenceIndex[]`

Это позволяет использовать councils и как human-readable review-слой, и как основу для последующего автоматического анализа.
