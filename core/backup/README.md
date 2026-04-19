# OpenClaw Backup

Автоматические зашифрованные бекапы SQLite БД → Google Drive с алертами в Telegram.

## Файлы

| Файл | Назначение |
|---|---|
| `backup.js` | Основной скрипт: авто-поиск БД, tar, AES-256, upload, ротация |
| `restore.js` | Восстановление из Drive |
| `auth-setup.js` | Одноразовая OAuth2 авторизация Google Drive |
| `backup.config.json` | Настройки: пути сканирования, retention, папка на Drive |
| `.env.example` | Шаблон секретов → скопировать в `.env` |

## Первоначальная настройка

### 1. Установить зависимости

```bash
cd /Users/dmitriy/openclaw/core/backup
npm install
```

### 2. Получить Google Drive credentials

1. Открыть [Google Cloud Console](https://console.cloud.google.com/)
2. Создать проект (или выбрать существующий)
3. **APIs & Services → Enable APIs** → найти **Google Drive API** → Enable
4. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Тип приложения: **Desktop app**
6. Скопировать **Client ID** и **Client Secret**

### 3. Создать .env

```bash
cp .env.example .env
```

Заполнить в `.env`:
- `BACKUP_PASSWORD` — любой сильный пароль
- `GDRIVE_CLIENT_ID` — из шага 2
- `GDRIVE_CLIENT_SECRET` — из шага 2

### 4. Авторизоваться в Google Drive (одноразово)

```bash
node auth-setup.js
```

Откроется URL → авторизоваться в браузере → вставить код → скопировать `GDRIVE_REFRESH_TOKEN` в `.env`.

### 5. Тестовый запуск

```bash
node backup.js
```

## Использование

```bash
# Запустить бекап
node backup.js

# Список доступных бекапов
node restore.js --list

# Интерактивное восстановление
node restore.js

# Восстановить конкретный бекап
node restore.js --backup=2026-02-21

# Восстановить без подтверждения
node restore.js --force --backup=2026-02-21
```

## Настройка параметров (backup.config.json)

| Параметр | По умолчанию | Описание |
|---|---|---|
| `scanPaths` | `["~/.openclaw", "~/clawd"]` | Где искать `.db`/`.sqlite` файлы |
| `excludePatterns` | `["browser/", "node_modules/"]` | Исключить из поиска |
| `gDriveFolderName` | `"OpenClaw Backups"` | Папка на Google Drive |
| `retentionCount` | `7` | Хранить последних N бекапов |
| `telegramChatId` | `"455103738"` | Куда слать алерты |

## Добавить в cron (почасово)

```bash
crontab -e
```

Добавить строку:
```
0 * * * * cd /Users/dmitriy/openclaw/core/backup && node backup.js >> /tmp/openclaw-backup.log 2>&1
```

## Что бекапится сейчас

Авто-поиск по `scanPaths`. Текущие БД:
- `~/.openclaw/memory/personal.sqlite` — память бота

Будущие (добавятся автоматически при создании):
- `~/clawd/data/cron-log.db`
- `~/clawd/data/interactions.db`
- `~/clawd/data/logs.db`
- `skills/knowledge-base/data/knowledge.db`

## Шифрование

Используется `openssl enc -aes-256-cbc -pbkdf2 -iter 100000`.
Без `BACKUP_PASSWORD` расшифровать архив невозможно — **не теряй пароль**.

## Структура архива

```
backup-2026-02-21T14-00-00Z.tar.gz.enc  ← зашифрованный архив
  └── manifest.json                      ← список БД + метадата
  └── /Users/dmitriy/.openclaw/memory/personal.sqlite
  └── ...все найденные БД с полными путями
```

На Drive хранится `index.json` с метаданными всех бекапов (незашифрованный).
