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
