# Dipakai bila Base Directory di Coolify = /web (alternatifnya: Dockerfile di akar repo).
# PENTING: tambahkan Persistent Storage di Coolify yang dipasang ke /data (menyimpan akun, kuota, izin).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js accounts.js ./
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/auth/me || exit 1
CMD ["node", "server.js"]
