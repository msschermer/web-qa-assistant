FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY packages ./packages
COPY services/api ./services/api
COPY apps/web/public ./apps/web/public
ENV NODE_ENV=production PORT=8787
USER node
EXPOSE 8787
CMD ["node","services/api/server.js"]
