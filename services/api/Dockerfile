FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
# The gateway never launches a browser — rendering is the renderer service's
# job and its own image. Omitting optional dependencies keeps Playwright and
# its browser binaries out of this image entirely; the SKIP flag is belt and
# braces for anyone who drops the flag above.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev --omit=optional --no-audit --no-fund
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
