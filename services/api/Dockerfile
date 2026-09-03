FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY packages ./packages
COPY services/api ./services/api
COPY apps/web/public ./apps/web/public
ENV NODE_ENV=production PORT=8787
# Full-site audits persist to AUDIT_DB_PATH (node:sqlite, stable/unflagged as of
# Node 24 — bumped from node:22-alpine specifically for this). Mount a volume
# here in production so audit history survives container restarts/redeploys.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
USER node
EXPOSE 8787
CMD ["node","services/api/server.js"]
