FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Prisma engines expect OpenSSL available.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile


FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src

RUN pnpm run prisma:generate
RUN pnpm run build


FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/generated ./generated

EXPOSE 3000
# App Runner uses a TCP health check on port 3000 with a short tolerance
# (~25s). Anything that delays the server from listening fails the deploy and
# triggers a rollback. `prisma migrate deploy` runs over directUrl (DIRECT_URL),
# which App Runner cannot reach, so running it before the server wedged every
# deploy. Start the server immediately so the port opens at once, and run
# migrate in the background as best-effort (the runtime pooler connection that
# the server uses is reachable; schema is reconciled when migrate can connect).
CMD ["sh", "-c", "(pnpm -s prisma:migrate:deploy || echo '[startup] prisma migrate deploy failed (best-effort, ignored)') & exec node dist/main"]
