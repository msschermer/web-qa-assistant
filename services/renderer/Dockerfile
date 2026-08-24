FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
COPY package*.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev --no-audit --no-fund
COPY packages/rules ./packages/rules
COPY packages/integrity ./packages/integrity
COPY services/renderer ./services/renderer
ENV NODE_ENV=production RENDERER_PORT=8790
EXPOSE 8790
CMD ["node","services/renderer/server.js"]
