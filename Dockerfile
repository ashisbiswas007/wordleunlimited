# syntax=docker/dockerfile:1

# ---------- build stage: install deps, generate dictionaries, precompress assets ----------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

COPY . .

# gen-words writes public/src/dict/**, build-assets writes .br/.gz siblings next to
# every static file so the running server never has to compress anything at runtime.
RUN node scripts/gen-words.mjs && node scripts/build-assets.mjs

# ---------- runtime stage ----------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# tini reaps zombies and forwards SIGTERM so Coolify's graceful stop works
RUN apk add --no-cache tini wget

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
