# Integrated Government Services System (Lesotho)

One citizen account and one verified citizen record for Home Affairs, Passport, Traffic, Finance, Pension and Police services.

- Frontend: React 18 + Vite + React Router (`client/`)
- Backend: Node.js 20 + Express (`server/`)
- Database: PostgreSQL (`server/db/migrations/001_init.sql` is the full schema)
- Hosting: one Render web service (API serves the built React app) + one Render PostgreSQL database

The corrected system specification, including everything that is automated, is in `docs/SYSTEM_SPEC.md`.

## Folder structure

```
render.yaml                 Render Blueprint (web service + database)
package.json                Root build/start scripts used by Render
server/
  db/migrations/001_init.sql  PostgreSQL schema (tables, indexes, triggers)
  src/index.js                Express app, serves client/dist in production
  src/migrate.js              Applies migrations and seeds on start-up
  src/seed.js                 Reference data (departments, services, fees, offices, holidays, policies) + demo data
  src/lib/workflow.js         Status rules and automatic checks
  src/lib/automation.js       Scheduled jobs (slots, reminders, expiry, missed visits, pension notices)
  src/lib/access.js           Least-privilege field access and information requests
  src/routes/                 auth, catalogue, citizen, applications, staff, access-requests, audit, admin
client/
  src/pages/public/           Welcome, register, log in, password reset, staff sign in
  src/pages/citizen/          Dashboard, services, passport flows, application wizard, applications, notifications, profile, privacy
  src/pages/staff/            Staff dashboard, queue, review, identity checks, information requests, audit log
  src/pages/admin/            Overview, staff, services and fees, offices, information sharing, settings and register
docs/
  SYSTEM_SPEC.md              Corrected specification
  smoke-test.mjs              Automated API test of the six test journeys
```

## Run it on your computer

You need Node.js 20 or newer and PostgreSQL.

1. Create a database:
   ```
   createdb govservices
   ```
2. Configure the server:
   ```
   cd server
   cp .env.example .env      (then edit DATABASE_URL)
   npm install
   npm run dev               (creates the tables and demo data on first start, port 4000)
   ```
3. In a second terminal, start the React app:
   ```
   cd client
   npm install
   npm run dev               (http://localhost:5173, API calls are proxied to port 4000)
   ```

## Deploy on Render

1. Push this folder to a GitHub repository.
2. In Render choose **New > Blueprint**, select the repository. Render reads `render.yaml` and creates:
   - `gov-services-db` (PostgreSQL)
   - `gov-services` (web service; build `npm run build`, start `npm start`)
3. When asked, enter `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the first administrator.
4. Wait for the deploy. On first start the server creates all tables, reference data and (while `SEED_DEMO=true`) demonstration data.
5. Open the web service URL. Health check: `/api/health`.

If you prefer to create things by hand instead of the Blueprint: create a PostgreSQL database, then a Web Service with build command `npm run build`, start command `npm start`, and environment variables `NODE_ENV=production`, `DATABASE_URL` (the database's Internal URL), `JWT_SECRET` (long random text), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SEED_DEMO`, `SHOW_RESET_LINK`.

Notes for the free plan:
- The web service sleeps when idle. Automation still runs on start-up and on the first request after waking. For exact timing, add a Render Cron Job running `npm run automation --prefix server` with the same `DATABASE_URL`.
- Free Render databases expire after a period set by Render. Use a paid database for real use.

### Before real use

- Set `SEED_DEMO=false` and `SHOW_RESET_LINK=false`.
- Configure SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) so password reset emails are sent.
- Import the population register (Admin > Settings and register).
- Confirm each service's requirements, fees, office addresses and phone numbers with the departments and mark them confirmed in the admin area.

## Demo accounts (only when SEED_DEMO=true)

| Who | Log in with | Password |
|---|---|---|
| Citizen, Palesa Mokoena | `58000001` or `DEMO100001` or `palesa@example.com` | `Citizen@2026` |
| Elderly citizen, 'Makhotso Lebona (no email) | `58000002` | `Citizen@2026` |
| Citizen, Thabo Mofokeng (has passport history) | `58000003` | `Citizen@2026` |
| Home Affairs officer / supervisor | `HA-001` / `HA-002` | `Staff@2026` |
| Passport officer / supervisor | `PS-001` / `PS-002` | `Staff@2026` |
| Traffic, Finance, Police officer | `TR-001`, `FN-001`, `PL-001` | `Staff@2026` |
| Pension officer / supervisor | `PN-001` / `PN-002` | `Staff@2026` |
| Administrator | value of `ADMIN_EMAIL` (default `admin@gov.ls.demo`) | value of `ADMIN_PASSWORD` (default `Admin@2026!`) |

To test automatic identity verification, register a new account with one of these unused register entries:

| National ID | First name | Surname | Date of birth |
|---|---|---|---|
| DEMO100004 | Tumelo | Ramoeletsi | 1956-12-01 (turns 70 soon: pension notice) |
| DEMO100005 | Lerato | Nthako | 2001-06-05 |
| DEMO100006 | Teboho | Sello | 1979-11-23 |
| DEMO100007 | Mpho | Khoali | 1999-07-21 |
| DEMO100008 | Neo | Matsoso | 1990-01-15 |

Any other ID number, or a mismatched surname or date of birth, creates an account that waits in the Home Affairs identity queue (staff `HA-001`).

## Test

With the server running on a fresh database:

```
node docs/smoke-test.mjs http://localhost:4000
```

It runs all six test journeys against the API and prints PASS or FAIL for each check.
