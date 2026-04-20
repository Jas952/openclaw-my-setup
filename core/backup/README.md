# OpenClaw Backup

Automatic encrypted SQLite database backups to Google Drive with Telegram alerts.

## Files

| File | Purpose |
|---|---|
| `backup.js` | Main script: DB auto-discovery, tar, AES-256, upload, rotation |
| `restore.js` | Restore from Drive |
| `auth-setup.js` | One-time OAuth2 authorization for Google Drive |
| `backup.config.json` | Settings: scan paths, retention, Drive folder |
| `.env.example` | Secrets template -> copy to `.env` |

## Encryption

Encryption uses `openssl enc -aes-256-cbc -pbkdf2 -iter 100000`.
Without `BACKUP_PASSWORD`, the archive cannot be decrypted - **do not lose the password**.

## Archive Structure

```
backup-2026-02-21T14-00-00Z.tar.gz.enc  ← encrypted archive
  └── manifest.json                      ← database list + metadata
  └── /Users/dmitriy/.openclaw/memory/personal.sqlite
  └── ...all discovered databases with full paths
```

Drive stores `index.json` with metadata for all backups in unencrypted form.
