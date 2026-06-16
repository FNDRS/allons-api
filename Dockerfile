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
# Run migrations on startup, but never let them block the server from coming
# up: App Runner rolls back the whole deploy if the container doesn't start
# listening, so a migrate hang/failure against the DB would otherwise wedge
# every deploy. Time-box migrate and start the server regardless; the schema
# is reconciled by `prisma migrate deploy` whenever it can connect.
CMD ["sh", "-c", "timeout 90 pnpm -s prisma:migrate:deploy || echo '[startup] prisma migrate deploy skipped/failed; starting server anyway'; node dist/main"]
