# Coinglass Large Orderbook Test

Тестовая площадка для проверки, можно ли стабильно собирать данные со страницы:
`https://www.coinglass.com/large-orderbook-statistics`

## Что уже проверено

1. Страница открывается в headless Chrome через Playwright CLI без ручного клика.
2. В ресурсах страницы видны запросы к `https://capi.coinglass.com/...`.
3. Ключевые endpoints:
   - `/api/largeOrder`
   - `/api/largeTakerOrder`
   - `/api/v2/kline`
4. Ответы от этих endpoints приходят с `code=0`, но payload внутри поля `data` зашифрован.
5. Прямой `curl` без браузерного контекста обычно возвращает только `success` без данных.
6. В запросах присутствуют служебные заголовки (`encryption: true`, `cache-ts-v2`, `language`, `referer`), но одного этого недостаточно для простого CLI-сбора в виде чистого JSON.

## Быстрый запуск probe

```bash
cd /Users/dmitriy/openclaw/beta/coinglass-large-orderbook-test
chmod +x scripts/run_probe.sh
./scripts/run_probe.sh
```

Результаты складываются в:
- `output/probe-<UTC_TIMESTAMP>/report.txt`
- `output/probe-<UTC_TIMESTAMP>/playwright-cli/*`

## Альтернативный сбор (без fetch-перехвата)

`fetch`/сырой API здесь неудобны из-за зашифрованного поля `data`.
Поэтому добавлен DOM-based collector, который берет уже отрисованные значения из `document.body.innerText`.

Запуск:

```bash
cd /Users/dmitriy/openclaw/beta/coinglass-large-orderbook-test
chmod +x scripts/run_dom_collector.sh
./scripts/run_dom_collector.sh
```

Результат:
- `output/dom-collector-<UTC_TIMESTAMP>/orders.json`
- `output/dom-collector-<UTC_TIMESTAMP>/open.log`
- `output/dom-collector-<UTC_TIMESTAMP>/eval.log`

Формат `orders.json`:
- `instrument`, `interval`
- `row_count`
- `rows[]` c полями:
  - `side` (`B`/`S`)
  - `price`
  - `amount_text` (пример: `$2.57M`)
  - `amount_usd` (число в USD)
  - `age_text`

## Что нужно от пользователя

1. Подтвердить, что мы идем по пути browser-collector (Playwright) и принимаем риск ломкости при изменениях сайта.
2. Подтвердить юридически/по ToS, что такой способ сбора для вашего use-case допустим.
3. Дать целевой режим сбора:
   - какие символы (`BTCUSDT`, `ETHUSDT`, ...),
   - какой интервал обновления (например, каждые 10/30/60 сек),
   - как долго хранить историю.
4. Подтвердить формат хранения (например, `jsonl` + `sqlite`) и папку в проекте, куда писать production-данные.

## Следующий шаг после подтверждения

Сделать постоянный локальный collector-процесс: Playwright + периодический дамп расшифрованных/нормализованных данных в репозиторий для дальнейшего использования в `/review`.
