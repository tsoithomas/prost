#!/bin/sh
# Container entrypoint for the Prost single-image deployment.
#  1. Provide safe defaults for boot-critical secrets (demo only — override in production).
#  2. Ensure the SQLite data directory exists.
#  3. Apply Prisma migrations to the app DB (idempotent).
#  4. Seed the admin user if ADMIN_EMAIL / ADMIN_PASSWORD are provided.
#  5. Exec the API (which also serves the built SPA).
set -e

# The image's `pnpm deploy` output lands at /app (dist, prisma, node_modules, package.json).
APP_DIR=/app

# --- 1. Boot-critical secrets -------------------------------------------------
# JWT_SECRET, CREDENTIAL_ENCRYPTION_KEY and DATABASE_URL are required for the API to
# start (NestJS calls getOrThrow on them). For a throwaway `docker run`, generate
# ephemeral values so the container boots — but WARN, because they must be stable and
# secret in production (a rotating CREDENTIAL_ENCRYPTION_KEY makes stored connection
# credentials undecryptable across restarts).
if [ -z "$JWT_SECRET" ]; then
  JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")"
  export JWT_SECRET
  echo "[entrypoint] WARNING: JWT_SECRET not set — generated an ephemeral one. Set JWT_SECRET in production."
fi

if [ -z "$CREDENTIAL_ENCRYPTION_KEY" ]; then
  CREDENTIAL_ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  export CREDENTIAL_ENCRYPTION_KEY
  echo "[entrypoint] WARNING: CREDENTIAL_ENCRYPTION_KEY not set — generated an ephemeral one."
  echo "[entrypoint]          Set a stable 32-byte base64 key in production or saved connection"
  echo "[entrypoint]          credentials will not survive a restart."
fi

# --- 2. Data directory --------------------------------------------------------
# DATABASE_URL defaults to file:/data/prost.db (see Dockerfile). Make sure the dir exists.
DB_PATH="$(echo "${DATABASE_URL:-file:/data/prost.db}" | sed -e 's#^file:##')"
DB_DIR="$(dirname "$DB_PATH")"
mkdir -p "$DB_DIR"

# --- 3. Migrations ------------------------------------------------------------
echo "[entrypoint] Applying database migrations..."
cd "$APP_DIR"
node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma

# --- 4. Admin seed (optional, idempotent) -------------------------------------
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  echo "[entrypoint] Seeding admin user..."
  # seed.cjs lives outside the API package, so point NODE_PATH at the deployed node_modules
  # (where @prisma/client and bcrypt resolve) for its top-level requires.
  NODE_PATH="$APP_DIR/node_modules" node /app/docker/seed.cjs
fi

# --- 5. Start the server ------------------------------------------------------
echo "[entrypoint] Starting Prost on port ${PORT:-3001}..."
exec node dist/main.js
