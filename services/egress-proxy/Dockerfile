FROM node:22-alpine
WORKDIR /app
COPY services/egress-proxy ./services/egress-proxy
USER node
EXPOSE 8899
CMD ["node","services/egress-proxy/server.js"]
