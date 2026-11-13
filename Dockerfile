FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

COPY . .

RUN pnpm install --frozen-lockfile

ENV PORT=8080
ENV BASE_PATH=/
ENV NODE_ENV=production

RUN pnpm --filter @workspace/cleo-dashboard run build \
  && pnpm --filter @workspace/api-server run build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

COPY . .

RUN pnpm install --prod --frozen-lockfile \
  && mkdir -p /data \
  && chown node:node /data

COPY --from=build /app/artifacts/api-server/dist /app/artifacts/api-server/dist
COPY --from=build /app/artifacts/cleo-dashboard/dist/public /app/artifacts/cleo-dashboard/dist/public

ENV NODE_ENV=production
ENV CLEO_AUTH_DIR=/data/cleo-auth
ENV CLEO_SESSION_FILE=/data/cleo-sessions.json

EXPOSE 8080

USER node

CMD ["node", "artifacts/api-server/dist/index.mjs"]
