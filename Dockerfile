# Dockerfile di akar repo: membangun gateway web (folder web/) tanpa perlu mengatur Base Directory.
# Di Coolify pilih Build Pack = Dockerfile, Base Directory = /, Port = 3000.
# (Alternatif: Base Directory = /web, memakai web/Dockerfile.)
# PENTING: tambahkan Persistent Storage di Coolify yang dipasang ke /data (menyimpan akun, kuota, izin).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev
COPY web/server.js web/accounts.js ./
COPY web/public ./public
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/auth/me || exit 1
CMD ["node", "server.js"]
