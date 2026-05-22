# Deploying the Client Portal to a New Replit Project

This guide covers how to get the Client Portal (React front-end) and API Server (Express back-end) running in a fresh Replit project imported from this repository.

---

## 1. Create the Replit project

1. Go to [replit.com](https://replit.com) and click **Create Repl**.
2. Choose **Import from GitHub** and select the `client-portal` repository.
3. Replit will detect the Node.js workspace and scaffold the project automatically.

---

## 2. Provision a PostgreSQL database

1. In the Replit sidebar, open **Tools → Database**.
2. Click **Create database** to provision a new PostgreSQL instance.
3. Replit will automatically set the `DATABASE_URL` environment variable.

---

## 3. Set required environment variables

In the Replit sidebar, open **Secrets** and add each of the following:

| Variable | Description | Where to get it |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Auto-set by Replit after provisioning a database (step 2) |
| `CLERK_SECRET_KEY` | Server-side Clerk secret key (starts with `sk_`) | [Clerk Dashboard](https://dashboard.clerk.com) → API Keys |
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key (starts with `pk_`) | [Clerk Dashboard](https://dashboard.clerk.com) → API Keys |
| `VITE_CLERK_PUBLISHABLE_KEY` | Same publishable key, exposed to the React client | Same value as `CLERK_PUBLISHABLE_KEY` |
| `ADMIN_EMAIL_ALLOWLIST` | Comma-separated list of emails that may access the admin section (e.g. `jt@example.com`) | Set to J.T.'s email address |
| `PORTAL_COOKIE_SECRET` | Random string (≥ 16 chars) used to sign the client session cookie. **Must be set in production.** | Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

> **Important:** In production deployments, the API server will refuse to start if `PORTAL_COOKIE_SECRET` is not set or is too short.

---

## 4. Initialize the database schema

After setting `DATABASE_URL`, run the following command in the Replit shell to push the Drizzle schema:

```bash
pnpm --filter @workspace/db run push
```

This creates all required tables (`admin_users`, `intake_clients`, `checklist_items`, `portal_sessions`, `magic_link_tokens`).

---

## 5. Configure workflows

Create two workflows in Replit (under **Tools → Workflows** or `.replit`):

### API Server

- **Name**: `API Server`
- **Command**: `pnpm --filter @workspace/api-server run dev`
- **Environment variables needed**: `DATABASE_URL`, `CLERK_SECRET_KEY`, `ADMIN_EMAIL_ALLOWLIST`, `PORTAL_COOKIE_SECRET`

### Client Portal

- **Name**: `Client Portal`
- **Command**: `pnpm --filter @workspace/client-portal run dev`
- **Environment variables needed**: `VITE_CLERK_PUBLISHABLE_KEY`, `PORT`, `BASE_PATH`

> The `PORT` and `BASE_PATH` environment variables are set automatically by the Replit artifact system when the workflows are registered as artifacts.

---

## 6. Clerk configuration

In the [Clerk Dashboard](https://dashboard.clerk.com):

1. Create a new application (or reuse an existing one).
2. Under **Configure → Paths**, ensure the sign-in URL is `/portal/sign-in` and the sign-up URL is `/portal/sign-up` (adjust to match your Replit preview path prefix).
3. Copy the **Secret Key** and **Publishable Key** into Replit Secrets (step 3 above).

---

## Architecture overview

```
/portal/           → Client Portal (React + Vite, artifacts/client-portal)
/api/              → API Server (Express, artifacts/api-server)
  /api/portal/     → Portal API endpoints (admin + client)
  /api/health      → Health check
```

Both services run as separate Node.js processes. The React app talks to the API at `/api/portal/*` via the shared Replit proxy.
