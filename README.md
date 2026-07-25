# SchoolGate Guardian — Backend API

A self-hostable REST backend for the SchoolGate Guardian app (school access
control, attendance, school-bus tracking, visitor management, and a sales CRM).

Built with **Node.js + Express + Prisma + PostgreSQL**. It replaces the app's
original low-code (Base44) backend with a clean, idiomatic REST API and a
Postgres schema you own end to end.

---

## Stack

- **Node.js** (ES modules) + **Express** — HTTP API
- **Prisma** ORM + **PostgreSQL** — schema, migrations, queries
- **JWT** auth (`jsonwebtoken`) + **bcryptjs** password hashing
- **Multer** file uploads, **Nodemailer** email
- Role-based access control driven by the `RolePermissions` table
- Multi-tenant isolation by `school_id`
- **Socket.IO** realtime — JWT-authenticated, per-entity events on every change

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Start Postgres (or point DATABASE_URL at your own)
docker compose up -d

# 3. Configure environment
cp .env.example .env
#   edit .env — at minimum set DATABASE_URL and JWT_SECRET

# 4. Create the database schema
npm run prisma:generate
npm run prisma:migrate      # creates tables from prisma/schema.prisma

# 5. Seed role permissions + a superadmin account
npm run seed

# 6. Run the API
npm run dev                 # http://localhost:4000
```

Health check: `GET http://localhost:4000/health`.

> Note: `prisma generate` / `migrate` download a query engine on first run, so
> the machine you run them on needs outbound network access to Prisma's CDN.

---

## Data model

24 entities, each with base fields `id`, `created_date`, `updated_date`,
`created_by`. Field names are snake_case to match the app's existing payloads.

| Domain | Models |
| --- | --- |
| Core | `School`, `Person`, `Class`, `User` |
| Access control | `AccessLog`, `SecurityAlert` |
| Attendance | `Attendance` |
| Passes / visitors | `OneTimePass`, `GuestPass`, `Visitor` |
| School bus | `SchoolBus`, `BusScanLog` |
| Messaging | `Message` |
| Onboarding | `Invitation` |
| Admin / config | `RolePermissions`, `DashboardConfig`, `SystemConfig`, `AuditLog` |
| CRM | `CRMLead`, `CRMCustomer`, `CRMProduct`, `CRMOrder`, `CRMActivity`, `CRMSalesTarget` |

`User` merges authentication (email, password, global `role`) with the profile
fields the app expects (`school_id`, `person_id`, `user_category`, `gate_name`,
`assigned_bus_id`, …). Passwords are never returned by the API.

See `prisma/schema.prisma` for the full definition.

---

## Authentication

JWT bearer tokens. Obtain one via `/auth/login` (or `/auth/register`) and send
it on every request:

```
Authorization: Bearer <token>
```

| Method | Path | Description |
| --- | --- | --- |
| POST | `/auth/register` | Create an account. The very first account becomes `admin` / `superadmin`. |
| POST | `/auth/login` | Returns `{ token, user }`. |
| GET | `/auth/me` | Current user (equivalent to the app's `auth.me()`). |
| PATCH | `/auth/me` | Update own profile (`auth.updateMe()`). |
| POST | `/auth/change-password` | Change password. |
| POST | `/auth/logout` | No-op for stateless JWT (provided for symmetry). |

---

## Entity REST API

Every model is exposed generically under `/api/entities/:entity` (the entity
name is case-insensitive, e.g. `Person`, `person`, `AccessLog`, `crmlead`).

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/entities/:entity` | List. Supports filters, `sort`, `limit`, `skip`. |
| POST | `/api/entities/:entity/query` | List with a JSON filter body (richer operators). |
| GET | `/api/entities/:entity/count` | Count matching records. |
| GET | `/api/entities/:entity/:id` | Fetch one. |
| POST | `/api/entities/:entity` | Create. |
| POST | `/api/entities/:entity/bulk` | Bulk create (array body). |
| PUT / PATCH | `/api/entities/:entity/:id` | Update. |
| DELETE | `/api/entities/:entity/:id` | Delete. |

### Filtering

Query-string filters map to exact matches, with optional operator suffixes:

```
GET /api/entities/Person?category=student&active=true&sort=-created_date&limit=50
GET /api/entities/CRMLead?estimated_value_gte=100000&status_ne=lost
GET /api/entities/AccessLog?person_id=<id>&sort=-timestamp&limit=20
```

Supported suffixes: `_gte`, `_lte`, `_gt`, `_lt`, `_ne`, `_contains`,
`_startsWith`, `_in` (comma-separated). `sort` accepts a comma list; a leading
`-` means descending.

The `/query` endpoint takes the same filters as a JSON body:

```jsonc
POST /api/entities/CRMLead/query
{
  "where": { "status": "proposal", "assigned_to": "rep@school.com" },
  "sort": "-estimated_value",
  "limit": 25,
  "skip": 0
}
```

### Creating the User entity

`POST /api/entities/User` accepts a plaintext `password` field, which is hashed
into `password_hash` server-side. `password_hash` is never returned.

---

## Multi-tenancy & permissions

- **Tenant isolation:** entities carrying `school_id` are automatically scoped
  to the caller's school. `superadmin` and `head_of_schools` can see across all
  schools; other roles are restricted to their own.
- **RBAC:** actions are checked against the `RolePermissions` table (seeded with
  sensible defaults per role). Admin-level roles bypass fine-grained checks.
  Entities without a mapped permission resource are open to any authenticated
  user. If no `RolePermissions` row exists for a role, access is permitted
  (permissive fallback) so a fresh install is usable before you customise roles.

Adjust the mapping in `src/lib/registry.js` (`RESOURCE_MAP`) and the defaults in
`prisma/seed.js`.

---

## Integrations

| Method | Path | Description |
| --- | --- | --- |
| POST | `/integrations/upload` | Multipart upload (field `file`). Returns `{ file_url }`. |
| POST | `/integrations/send-email` | Send an email `{ to, subject, body, html?, from_name? }`. |
| POST | `/integrations/extract-data` | Stub (`501`) — wire to your OCR/LLM provider. |

Uploaded files are served from `/uploads/*`. If SMTP is not configured, emails
are logged to the console instead of sent (handy for local development).

---

## Server functions (ports of the original serverless functions)

Call with a user JWT **or** the scheduler secret header `x-cron-secret: <CRON_SECRET>`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/functions/crmFollowUpReminders` | Email reps about leads due/overdue today. |
| POST | `/functions/crmStageEmailSequence` | Stage-change emails; body `{ data, old_data }`. |
| POST | `/functions/notifyBusEvent` | Notify parents on bus boarding / drop-off. |
| POST | `/functions/sendAbsenceReport` | Email each school's admin a daily absence report. Body `{ school_id?, test? }`. |
| POST | `/functions` | Generic invoke: `{ name, payload }`. |
| GET | `/functions` | List available function names. |

Wire the CRM and bus functions to fire on entity changes from your app layer,
and schedule `crmFollowUpReminders` / `sendAbsenceReport` with cron
(e.g. a system crontab or a hosted scheduler) hitting the endpoints with the
`x-cron-secret` header.

Example daily cron (08:00 Africa/Lagos = 07:00 UTC):

```cron
0 7 * * * curl -s -X POST https://api.yourhost.com/functions/sendAbsenceReport \
  -H "x-cron-secret: $CRON_SECRET" -H "content-type: application/json" -d '{}'
```

---

## Realtime (Socket.IO)

The API server also serves a Socket.IO endpoint on the same port. Clients pass
their JWT on the handshake (`auth: { token }`), then `emit('subscribe', '<Entity>')`
to join that entity's room. On every create/update/delete the server emits an
`entity_event` `{ entity, action, id, school_id, at }` to that room. Payloads
carry no record data (so nothing leaks across tenants over the socket); clients
refetch through the tenant-scoped REST API in response.

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:4000', { auth: { token } });
socket.emit('subscribe', 'AccessLog');
socket.on('entity_event', (e) => { /* e.action, e.id … -> refetch */ });
```

---

## Invitations

| Method | Path | Description |
| --- | --- | --- |
| POST | `/users/invite` | Create + email an invitation. Admin/management only. |

Returns the `Invitation` record and an invite link. Invitations are also
available through the generic entity API (`/api/entities/Invitation`).

---

## Project layout

```
prisma/
  schema.prisma        # the full data model (24 entities + User auth)
  seed.js              # role permissions + superadmin
src/
  server.js            # entrypoint
  app.js               # Express app assembly
  config/env.js        # env parsing
  lib/                 # prisma client, auth, email, registry, query, permissions, tenant, audit
  middleware/          # auth, error handling
  controllers/         # generic entity controller
  routes/              # auth, entities, integrations, functions, users
  functions/           # the four ported server functions
```

---

## Environment variables

See `.env.example`. Key ones: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`,
`PUBLIC_URL`, SMTP settings, `CRON_SECRET`, and the seed superadmin credentials.
