# Build context: root repo (lihat docker-compose.yml)
FROM node:24-alpine AS build
RUN npm install -g pnpm@10.22.0
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY services/catalog/package.json services/catalog/
COPY services/order/package.json services/order/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @shopqa/catalog
COPY services/catalog services/catalog
RUN pnpm --filter @shopqa/catalog build \
 && pnpm --filter @shopqa/catalog deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 3001
HEALTHCHECK --interval=5s --timeout=3s --retries=10 CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "dist/server.js"]
