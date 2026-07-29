# Email setup (Resend)

The backend sends email through one helper — `src/lib/email.js` — which picks a
transport at runtime:

| Condition | Provider used |
| --- | --- |
| `RESEND_API_KEY` is set | **Resend** HTTP API (recommended) |
| else `SMTP_HOST` is set | SMTP via nodemailer |
| else | `console` — the message is logged, not sent |

`EMAIL_PROVIDER=resend\|smtp\|console` forces a specific one; leave it blank to
auto-detect. Nothing else in the codebase changes when you switch — every caller
uses `sendEmail()`.

Emails the app sends: school-admin invites and re-invites, password reset,
new-user credentials, bus boarding/drop-off alerts to parents, daily absence
reports, CRM follow-up + stage-change emails, subscription expiry notices, and
the generic `POST /integrations/send-email` endpoint.

---

## 1. Create the Resend account

1. Sign up at <https://resend.com> (free tier is enough to start — currently
   3,000 emails/month, 100/day; check their pricing page for current limits).
2. Verify your login email address when prompted.

At this point you can already send **test** emails: use
`from: "onboarding@resend.dev"`, but Resend will only deliver to the email
address you signed up with. That is fine for a smoke test — not for production.

## 2. Add and verify your sending domain

Production sends require a domain you control (e.g. `schoolgate.ng`).

1. Resend dashboard → **Domains** → **Add Domain**.
2. Enter the domain and pick the region closest to your users.
3. Resend shows a set of DNS records — typically:
   - an **MX** record on the `send` subdomain (bounce/complaint feedback),
   - a **TXT** SPF record on `send`,
   - a **TXT** DKIM record on `resend._domainkey`.
4. Add each record **exactly as shown** in your DNS provider (Cloudflare,
   Namecheap, Route 53, …). If your provider auto-appends the domain name, enter
   only the host part (`send`, `resend._domainkey`) — not the full hostname.
   Set Cloudflare records to **DNS only** (grey cloud), not proxied.
5. Back in Resend, click **Verify**. Propagation is usually minutes, but can
   take up to 48h.
6. Optional but recommended: add a DMARC record on `_dmarc`, starting with
   `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain`.

Until the domain shows **Verified**, sends from it are rejected and
`sendEmail()` returns `{ delivered: false, error: "Resend rejected the message
(403): ..." }`.

## 3. Create an API key

Resend dashboard → **API Keys** → **Create API Key**.

- Permission: **Sending access** (not full access).
- Domain: restrict it to the domain you just verified.
- Copy the key (`re_...`) immediately — it is shown only once.

Use a separate key per environment (dev / staging / production) so you can
revoke one without breaking the others.

## 4. Configure the backend

In `schoolgate-backend/.env` (copy from `.env.example` if you haven't):

```bash
EMAIL_PROVIDER="resend"                # or leave "" to auto-detect
RESEND_API_KEY="re_xxxxxxxxxxxxxxxxxxxx"
EMAIL_FROM="SchoolGate Guardian <no-reply@yourdomain.com>"
APP_URL="https://app.yourdomain.com"   # where invite/reset links point — the WEB APP, not the API
```

Notes:

- **`EMAIL_FROM` must be on the verified domain.** The display-name form
  (`Name <addr@domain>`) is supported; `from_name` passed by a caller overrides
  the display name but keeps the address.
- `APP_URL` is what invite and password-reset links are built from. Get this
  wrong and users receive links to the API host instead of the frontend.
- `.env` is not committed — never put a real key in `.env.example`.

## 5. Verify it works

The API reports the resolved transport on startup, so check the boot log first:

```
Email: resend, from SchoolGate Guardian <no-reply@yourdomain.com>, links → https://app.yourdomain.com
```

If instead you see `Email: NOT SENDING — …`, the credentials aren't reaching the
process — fix that before going further. In production this line is a `⚠️`
warning.

Then send one through the integrations endpoint with any valid user JWT:

```bash
curl -X POST http://localhost:4000/integrations/send-email \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"you@yourdomain.com","subject":"SchoolGate test","body":"Hello from Resend."}'
```

Expected: `{"delivered":true,"provider":"resend","messageId":"..."}` and the
message appearing under **Emails** in the Resend dashboard.

If you get `"provider":"console"`, the key was not loaded — the process needs a
restart after editing `.env`.

Then test a real flow end to end: create a school in the superadmin app and
confirm the admin invite arrives with a working set-password link.

## 6. Deploy

**Render** (`render.yaml`) — `EMAIL_PROVIDER`, `RESEND_API_KEY` and `APP_URL`
are declared in the blueprint as `sync: false`, meaning Render prompts for them
and the values never enter git. Fill them in at Environment → Add Environment
Variable. Leaving `EMAIL_PROVIDER` blank is fine — auto-detect picks Resend as
soon as the key is present.

**Docker** — pass them through the compose `environment:` block or an
`--env-file`. Do not bake the key into the image.

After deploying, redeploy/restart the service so the new env is picked up, and
resend one invite to confirm.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `provider: "console"` in the response | `RESEND_API_KEY` empty or process not restarted. |
| `Resend rejected the message (403)` | Domain not verified, or `EMAIL_FROM` uses a different domain than the key allows. |
| `(422) Invalid \`from\` field` | `EMAIL_FROM` malformed — use `Name <user@domain.com>`. |
| `(401)` | Key revoked, truncated on copy, or wrong environment's key. |
| Delivered per Resend, but not in the inbox | Check the recipient's spam folder; add DMARC; avoid `no-reply@` if deliverability matters. |
| Sends work for you only | Still using `onboarding@resend.dev` — switch to your verified domain. |
| Rate-limit errors during bulk sends | Free tier daily cap, or Resend's 2 req/s limit on the send endpoint — batch the absence/CRM jobs or upgrade. |

A delivery failure never throws: `sendEmail()` returns
`{ delivered: false, error }` so a failed notification can't break the request
that triggered it. Check the server logs for `[email:failed]` lines.
