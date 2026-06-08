# AI University Assistant Backend

Express API for the Telegram Mini App and future Telegram bot.

## Environment

Copy `.env.example` to `.env` and set:

- `JWT_SECRET`
- `GEMINI_API_KEY`
- `TELEGRAM_BOT_TOKEN` for the Telegram bot. Leave it empty to run only the web app.
- `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_BASE64`
- For local development you can use `FIREBASE_SERVICE_ACCOUNT_PATH=./service-account.json`

Before running the app, enable Cloud Firestore in the Firebase project and create a Firestore database.

## Firebase collections

- `users`
- `events_cache`
- `chats`
- `notifications`

## Main API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/telegram`
- `POST /api/calendar/connect`
- `POST /api/calendar/refresh`
- `GET /api/calendar/events`
- `GET /api/calendar/deadlines`
- `GET /api/calendar/summary`
- `GET /api/chats`
- `POST /api/chats/:id/message`

## Telegram bot

The bot starts together with `server.js` when `TELEGRAM_BOT_TOKEN` is present.

User flow:

1. `/start`
2. Student sends group number.
3. Student sends Moodle Calendar URL.
4. Bot saves the profile in Firestore, refreshes Moodle events, and enables commands.

Commands:

- `/register` - restart registration
- `/profile` - show saved group and calendar status
- `/group <group>` - update group
- `/calendar <url>` - update Moodle Calendar URL and refresh cache
- `/today` - today's events
- `/week` - next 7 days
- `/deadlines` - upcoming deadlines
- `/notifications on/off` - toggle shared notification settings
- `/testnotify` - preview the next notification
- `/refresh` - refresh Moodle calendar
- `/ask <question>` - ask Gemini AI
- `/help` - show help
- `/cancel` - cancel the current input step

Notifications use the same `user.settings` object as the web profile:

- `settings.notifications`
- `settings.classReminderMinutes`
- `settings.deadlineReminderHours`
- `settings.urgentDeadlineHours`

The scheduler runs every 10 minutes by default and writes sent notification keys to the `notifications` collection to avoid duplicates.

## Deploy

This repository includes `render.yaml`. Create a Render web service from the repo, add the environment variables, and Render will serve both backend and static frontend.

## One-time MongoDB migration

Set `MONGODB_URI`, Firebase credentials, then run:

```bash
npm run migrate:mongo
```
