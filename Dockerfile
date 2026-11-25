# One image: the API, serving the built website from the same process.
#   docker build -t vantrarun .
#   docker run -p 10000:10000 -e DATABASE_URL=... -e JWT_SECRET=... vantrarun
# The phone app (native/) is not part of this image; it is built with EAS.

# ---- build the website ----
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
COPY server/package.json server/package.json
RUN npm ci --workspace web --include-workspace-root=false
COPY web web
RUN npm run build --workspace web

# ---- the server ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev --workspace server --include-workspace-root=false && npm cache clean --force
COPY server server
COPY --from=web /app/web/dist web/dist

# PORT is what Render expects a web service to listen on. /data is where the
# persistent disk is mounted; uploads go there unless a bucket is configured.
ENV PORT=10000 \
    WEB_DIST=/app/web/dist \
    UPLOAD_DIR=/data/uploads \
    TRUST_PROXY=true
EXPOSE 10000

# Runs as root so it can write to the mounted disk whatever its ownership; the
# container holds nothing but this app.
CMD ["node", "server/src/index.js"]
