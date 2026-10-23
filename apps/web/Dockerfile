# Build context: root repo (lihat docker-compose.yml)
FROM node:24-alpine AS build
RUN npm install -g pnpm@10.22.0
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY services/catalog/package.json services/catalog/
COPY services/order/package.json services/order/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @shopqa/web
COPY apps/web apps/web
RUN pnpm --filter @shopqa/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
