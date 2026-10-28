# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3210 \
    DB_PATH=/data/2space.sqlite \
    WEB_DIST=/app/apps/web/dist

FROM base AS development
ENV NODE_ENV=development
RUN mkdir -p /app/node_modules /app/apps/web/node_modules /app/apps/server/node_modules /app/apps/web/dist /app/apps/server/dist /data \
    && chown -R node:node /app /data && chmod 700 /data
USER node
EXPOSE 3210 5173
CMD ["sh", "-c", "npm ci && node scripts/dev.mjs"]

FROM base AS build
ENV NODE_ENV=development
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/server/ ./apps/server/
COPY apps/web/ ./apps/web/
RUN npm ci && NODE_ENV=production npm run build && npm prune --omit=dev

FROM base AS production
COPY --from=build --chown=node:node /app/node_modules/ ./node_modules/
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=node:node /app/apps/server/dist/ ./apps/server/dist/
COPY --from=build --chown=node:node /app/apps/web/dist/ ./apps/web/dist/
COPY --from=build --chown=node:node /app/packages/shared/ ./packages/shared/
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
EXPOSE 3210
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3210/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "run", "start", "-w", "@2space/server"]
