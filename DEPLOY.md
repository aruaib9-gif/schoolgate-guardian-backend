# Deploying SchoolGate Guardian — a plain-English guide

This guide assumes you are **not** a backend developer. Every step is copy‑paste.
Your project already includes the database setup, Docker files, Swagger docs, and
a Render blueprint — this explains how to use them.

## The mental model

Think of the backend as a **restaurant**:

| Piece | What it really is | Analogy |
|---|---|---|
| **Database** (PostgreSQL) | Where all data is stored | The pantry |
| **Docker** | Packages the app so it runs the same everywhere | A shipping container |
| **Swagger** | Interactive docs of every endpoint | The menu |
| **Deploy** | Making it public on the internet | Opening the restaurant |

---

## 1. Run it on your own laptop

**Prerequisite:** Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and [Node.js 18+](https://nodejs.org).

```bash
cd schoolgate-backend

cp .env.example .env          # create your settings file
docker compose up -d          # start the PostgreSQL database
npm install                   # install app dependencies (first time only)
npm run prisma:deploy         # create the database tables
npm run seed                  # load starter data (admin login, demo schools)
npm run dev                   # start the API
```

The API is now at **http://localhost:4000**.
Open **http://localhost:4000/docs** to see the interactive Swagger menu.

### Run the whole thing (app + database) with Docker only

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api npm run seed   # one time
```

Handy commands:

```bash
docker compose -f docker-compose.prod.yml logs -f     # watch logs
docker compose -f docker-compose.prod.yml down        # stop everything
```

---

## 2. The Swagger docs (the API "menu")

Start the backend, then open **http://localhost:4000/docs** (or `/docs` on your
live URL). To test a protected endpoint:

1. Open `POST /auth/login` → **Try it out** → enter email + password → **Execute**.
2. Copy the `token` from the response.
3. Click the green **Authorize** button (top right), paste the token, **Authorize**.
4. Now every other endpoint is testable live — no code required.

The raw machine-readable spec is at `/docs.json`.

---

## 3. Deploy live — Option A: Render (recommended, easiest)

Render hosts the app and database for you; there is no server to manage.
This repo includes **`render.yaml`**, which sets up everything in one click.

1. Push this backend to a **GitHub** repository.
2. Sign up at [render.com](https://render.com).
3. Click **New → Blueprint**, connect your GitHub repo, and select it.
   Render reads `render.yaml` and creates a PostgreSQL database + the API service.
4. Render will ask you to fill in the secret values (the ones marked "you type in"):

   | Variable | What to put |
   |---|---|
   | `CORS_ORIGIN` | Your frontend's web address (e.g. `https://app.yourschool.com`) |
   | `PUBLIC_URL` | Leave blank for now; set to your Render URL after step 5 |
   | `SEED_SUPERADMIN_EMAIL` | Your admin email |
   | `SEED_SUPERADMIN_PASSWORD` | A strong password |
   | `SEED_SCHOOL_ADMIN_PASSWORD` | A strong password |
   | `SMTP_*`, `EMAIL_FROM` | Your email provider details (optional — skip to log emails instead) |

   `DATABASE_URL`, `JWT_SECRET`, and `CRON_SECRET` are filled in **automatically** —
   don't touch them.
5. Click **Apply**. Render builds the Docker image and starts the API.
   Database tables are created automatically on startup.
6. Open your service → **Shell** tab and run once to load starter data:
   ```bash
   npm run seed
   ```
7. Copy your live URL (e.g. `https://schoolgate-api.onrender.com`), paste it into
   the `PUBLIC_URL` env var, and save (the service restarts).
8. Visit **`https://your-app.onrender.com/docs`** — your API is live and public. 🎉

> **Note on the free plan:** free Render databases expire after a while and free
> web services sleep when idle. For a real deployment, change both `plan: free`
> lines in `render.yaml` to `starter` (or higher).

---

## 3. Deploy live — Option B: A rented server (VPS)

More control, a bit more work. On a small Ubuntu server (e.g. DigitalOcean $6/mo)
with Docker installed:

```bash
git clone <your-repo-url>
cd schoolgate-backend
cp .env.example .env
nano .env        # fill in real JWT_SECRET, passwords, CORS_ORIGIN, PUBLIC_URL

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api npm run seed
```

Then point your domain at the server's IP address and put HTTPS in front of it
(a tool like [Caddy](https://caddyserver.com) does this automatically). Render
handles HTTPS for you; on a VPS you set it up yourself.

---

## ⚠️ Before going live — do not skip this

Change every "change-me" placeholder to a real value, especially:

- **`JWT_SECRET`** → a long random string (protects everyone's login sessions).
- **`SEED_SUPERADMIN_PASSWORD`** → a real strong password.
- **`CORS_ORIGIN`** → your actual frontend URL, **not** `*`.

The defaults in `.env.example` are for local testing only. Anyone who knows them
could break into a live site.

---

## Quick reference

| I want to… | Command / URL |
|---|---|
| Start the DB locally | `docker compose up -d` |
| Create/update tables | `npm run prisma:deploy` |
| Load starter data | `npm run seed` |
| Start the API (dev) | `npm run dev` |
| Run app + DB together | `docker compose -f docker-compose.prod.yml up -d --build` |
| See the API docs | `http://localhost:4000/docs` |
| Check it's alive | `http://localhost:4000/health` |
