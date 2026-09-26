# Напоминания в Discord

Worker раз в час получает `/data/reminders.json` с сайта и отправляет одно сообщение о событиях на ближайшие сутки или текущий час.

Из этой папки:

```sh
npx wrangler secret put DISCORD_WEBHOOK_REMINDERS
npx wrangler deploy
```

Необязательно задайте секрет `DISCORD_REMINDERS_ROLE_ID` для упоминания роли. Проверка без отправки: `GET /preview?hours=24`.
