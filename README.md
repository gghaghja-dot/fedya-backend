# FedyaLM Backend — готово к GitHub / Render

## Как залить в репозиторий

1. Открой https://github.com/gghaghja-dot/fedya-backend
2. Залей **содержимое этой папки** в корень репозитория  
   (файлы `server.js`, `package.json`, `src/`, … — не клади папку внутрь папки)
3. **Не** заливай `.env` — его здесь нет специально

### Через Git (локально)

```bash
cd путь/к/этой/папке
git init
git remote add origin https://github.com/gghaghja-dot/fedya-backend.git
git add .
git commit -m "FedyaLM backend production"
git branch -M main
git push -u origin main --force
```

> `--force` только если хочешь полностью заменить старую заглушку на GitHub.

---

## Переменные на Render (Environment)

Скопируй в Render → Environment (значения — свои реальные):

```
SUPABASE_URL=https://XXXX.supabase.co
SUPABASE_SECRET_KEY=ваш_secret_key
UPSTASH_REDIS_REST_URL=https://XXXX.upstash.io
UPSTASH_REDIS_REST_TOKEN=ваш_token
JWT_SECRET=длинный_случайный_секрет
REFRESH_SECRET=другой_длинный_секрет
ADMIN_EMAIL=gghaghja@example.com
PORT=3000
NODE_ENV=production
CORS_ORIGINS=*
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
FCM_SERVER_KEY=
```

**Start Command:** `npm start`  
**Build Command:** `npm install`

Health check: `/health`

---

## Локально

```bash
cp .env.example .env
# заполни .env
npm install
npm start
```

SQL-апгрейд (если ещё не делал): `sql/UPGRADE_NOW.sql` → Supabase SQL Editor → Run.
