FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 PERSISTENT_DATA_DIR=/data DB_PATH=/data/kursor.sqlite FILE_STORAGE_DIR=/data/files BACKUP_DIR=/data/backups REQUIRE_PERSISTENT_STORAGE=true
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node . .
RUN chmod 755 /app/docker-entrypoint.sh
RUN mkdir -p /data/files /data/backups && chown -R node:node /data /app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
