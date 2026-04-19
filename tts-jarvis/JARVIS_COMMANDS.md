# Jarvis Commands

Локальные команды Jarvis живут в:

`beta/UI/src/lib/jarvisCommands.ts`

## Как это работает

- Текстовый ввод и голосовой ввод используют один и тот же реестр.
- Если фраза совпадает с локальной командой, она не уходит в gateway.
- Вместо этого UI сам добавляет ответ Jarvis и при необходимости:
  - переключает вкладку
  - открывает или закрывает диалог
  - включает или выключает голос
  - запускает reconnect

## Как добавить новую команду

1. Открой `beta/UI/src/lib/jarvisCommands.ts`.
2. Добавь новый объект в массив `jarvisResolvers`.
3. Заполни:
   - `id`
   - `title`
   - `category`
   - `description`
   - `responsePreview`
   - `examples`
4. В `resolve(input, context)` верни объект результата:
   - `response`
   - опционально `sectionTarget`
   - опционально `dialogAction`
   - опционально `reconnect`
   - опционально `voiceOutput`
   - опционально `suppressSpeech`

## Минимальный шаблон

```ts
{
  definition: {
    id: "jarvis-custom",
    title: "Custom Command",
    category: "Core",
    description: "Short description.",
    responsePreview: "Preview response.",
    examples: ["custom command", "кастомная команда"],
  },
  resolve(input) {
    if (!matchesWhole(input, ["custom command", "кастомная команда"])) {
      return null;
    }
    return {
      command: this.definition,
      response: "Custom response.",
    };
  },
}
```

## Что обновится автоматически

После добавления команды:

- она появится во вкладке `Jarvis`
- ее можно будет вызвать текстом
- ее можно будет вызвать голосом

## Кастомный аудио-ответ для конкретной команды

Можно назначить свой клип на конкретный `command.id` без TTS:

1. Положи файл в `beta/UI/public/audio/jarvis-custom/`.
2. Имя файла должно совпадать с `command.id`:
   - `jarvis-help.mp3` или `jarvis-help.wav`
   - `jarvis-capabilities.mp3` или `jarvis-capabilities.wav`
3. Перезапусти UI.

Приоритет воспроизведения:

- `jarvis-custom/<command-id>.mp3|wav`
- встроенный уникальный клип для этой команды
- общий fallback по категории реакции (`reply`, `ok`, и т.д.)

## Cron реакции

`Jarvis Activity` теперь показывает и cron-события gateway (если в имени события есть `cron`), с отдельным аудио-откликом.
