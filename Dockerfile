# ---------- Stage 1: build the React client ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Install all workspace deps (incl. Vite) and build the client.
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci

COPY . .
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5176
ENV HOST=0.0.0.0

# ffmpeg (for MP3 extraction + stream merging) and a self-contained yt-dlp.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
       -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

# Install only the server's production dependencies.
COPY server/package.json server/
RUN cd server && npm install --omit=dev --no-package-lock

# App code + the client build from stage 1.
COPY server/ server/
COPY --from=build /app/client/dist client/dist

USER node
EXPOSE 5176
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS http://localhost:${PORT}/api/health || exit 1

CMD ["node", "server/index.js"]
