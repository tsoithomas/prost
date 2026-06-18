# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Prost — single production image.
#
# The NestJS API (apps/api) serves both the JSON API and the pre-built React SPA
# (apps/web) on one port. The app DB is file-based SQLite (Prisma), mounted at /data.
#
#   Stage 1 (builder): full pnpm install → build SPA + API → `pnpm deploy` the API's
#                      production dependency closure only (no web/build-tool deps).
#   Stage 2 (runtime): slim image with just that closure; runs as a non-root user.
# ─────────────────────────────────────────────────────────────────────────────

# ---- Stage 1: builder -------------------------------------------------------
FROM node:22-bookworm-slim AS builder

# Build toolchain for native modules (better-sqlite3, bcrypt) + openssl for Prisma.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# Copy the whole workspace (node_modules / dist excluded via .dockerignore) and install.
COPY . .
RUN pnpm install --frozen-lockfile

# Prisma client must exist before the API is type-checked/compiled. A dummy DATABASE_URL
# is fine — `prisma generate` does not connect to a database.
ENV DATABASE_URL="file:/tmp/build.db"
RUN pnpm --filter @prost/api exec prisma generate

# Build the SPA against a same-origin (empty) API base URL, then build everything.
# Vite reads VITE_API_URL from .env.production at the monorepo root (its envDir).
RUN printf 'VITE_API_URL=\n' > .env.production
RUN pnpm -w build

# Extract ONLY the API's production dependency closure into /prod (excludes web's
# Monaco/ag-grid/etc. and all dev/build tooling). `prisma` stays in the closure (it is a
# production dependency) so `migrate deploy` works at runtime. Regenerate the Prisma client
# inside /prod since the generated artifacts are not part of the package graph deploy copies.
RUN pnpm --filter=@prost/api deploy --prod /prod \
  && cd /prod \
  && node_modules/.bin/prisma generate --schema prisma/schema.prisma

# ---- Stage 2: runtime -------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# openssl: Prisma query engine + TLS. tini: PID 1 signal handling / zombie reaping.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=5354 \
    DATABASE_URL="file:/data/prost.db" \
    WEB_DIST_PATH="/app/public"

WORKDIR /app

# The API app (dist, prisma, package.json) + its production node_modules.
COPY --from=builder --chown=node:node /prod /app
# The pre-built SPA, served by the API from WEB_DIST_PATH.
COPY --from=builder --chown=node:node /app/apps/web/dist /app/public
# Entrypoint + runtime admin seed.
COPY --from=builder --chown=node:node /app/docker /app/docker

# SQLite app DB lives on a writable volume owned by the non-root runtime user.
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data

USER node

EXPOSE 5354

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5354)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "sh", "/app/docker/entrypoint.sh"]
