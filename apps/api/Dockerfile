# Build context: repo root (docker compose build.context = .)
# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable

# Manifests first so the dependency layer is cached until a package.json or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY tests/package.json tests/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@testpulse/api..."

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @testpulse/shared build \
    && pnpm --filter @testpulse/api build \
    # --legacy: pnpm 10 no longer deploys without inject-workspace-packages; this copies
    # the built @testpulse/shared (dist) into the deployed node_modules.
    && pnpm --filter @testpulse/api deploy --prod --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
