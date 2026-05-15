# AI University Assistant Backend

Express API for the Telegram Mini App and future Telegram bot.

## Environment

Copy `.env.example` to `.env` and set:

- `JWT_SECRET`
- `GEMINI_API_KEY`
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

## Deploy

This repository includes `render.yaml`. Create a Render web service from the repo, add the environment variables, and Render will serve both backend and static frontend.

## One-time MongoDB migration

Set `MONGODB_URI`, Firebase credentials, then run:

```bash
npm run migrate:mongo
```
