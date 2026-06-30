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

# ---------- Stage 2: build the PO-token provider ----------
# A small companion service that solves YouTube's BotGuard challenge and hands
# yt-dlp a proof-of-origin token, so a server (datacenter IP) isn't treated as
# a bot. No account or cookies involved.
FROM node:20-bookworm-slim AS potbuild
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /pot
WORKDIR /pot/server
RUN npm install && (npm run build || npx tsc)

# ---------- Stage 3: runtime ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5176
ENV HOST=0.0.0.0
# Put the Python venv (yt-dlp + GetPOT plugin) first on PATH.
ENV PATH=/opt/venv/bin:$PATH

# ffmpeg (MP3 extraction + stream merging), Python + a venv for yt-dlp and the
# bgutil GetPOT plugin. Using pip-installed yt-dlp so the plugin is discovered.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 python3-venv \
  && python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir "yt-dlp[default]" bgutil-ytdlp-pot-provider \
  && rm -rf /var/lib/apt/lists/*

# The built PO-token provider (Node service) from stage 2.
COPY --from=potbuild /pot/server /opt/pot-provider

# Install only the server's production dependencies.
COPY server/package.json server/
RUN cd server && npm install --omit=dev --no-package-lock

# App code + the client build from stage 1.
COPY server/ server/
COPY --from=build /app/client/dist client/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER node
EXPOSE 5176
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD curl -fsS http://localhost:${PORT}/api/health || exit 1

# Starts the PO-token provider, then the web server.
CMD ["docker-entrypoint.sh"]
