# Moifone ERP API — production image.
# No build step (plain ESM JS); install prod deps + run under pm2-runtime so the
# container uses every CPU core (cluster mode) and forwards signals correctly.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# pm2-runtime = Docker-friendly PM2 (foreground, proper SIGTERM handling).
RUN npm install -g pm2

# Install deps first for layer caching.
COPY package*.json ./
RUN npm ci --omit=dev

# App source.
COPY . .

EXPOSE 5010

# Container-level liveness: hit the app's /health (also checks DB).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5010/health || exit 1

CMD ["pm2-runtime", "start", "ecosystem.config.cjs", "--env", "production"]
