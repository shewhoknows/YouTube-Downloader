# YouTube Downloader

A simple, clean web app for downloading a single public YouTube video as **MP4
(video)** or **MP3 (audio)**, powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp).

- Paste a URL → fetch the video's thumbnail, title, duration, and channel.
- Pick a format (MP4 / MP3) and quality (1080p / 720p / 480p, or 320 / 128 kbps).
- Download — progress is shown live while yt-dlp fetches and converts.
- Clear inline errors for invalid, private, age-restricted, or unavailable videos.
- Temp files are cleaned up automatically after every download.

> Single public videos only. Playlists, batch downloads, and any bypass of
> YouTube's age/region restrictions are intentionally not supported.

## Stack

- **Frontend:** React + Vite
- **Backend:** Node + Express, shelling out to `yt-dlp`
- Progress is streamed from the backend to the browser via Server-Sent Events.

## Prerequisites

Both must be installed and available on your `PATH`:

- **[yt-dlp](https://github.com/yt-dlp/yt-dlp#installation)** — the download engine
- **[ffmpeg](https://ffmpeg.org/download.html)** — required for MP3 extraction
  and for merging high-quality video + audio streams

Verify:

```bash
yt-dlp --version
ffmpeg -version
```

(Optionally set `YTDLP_PATH` to point at a specific yt-dlp binary.)

## Setup

```bash
npm install        # installs both client and server (npm workspaces)
```

## Run (development)

```bash
npm run dev
```

This starts the Express backend on **http://localhost:5176** and the Vite dev
server on **http://localhost:5173**. Open the Vite URL in your browser — API
requests are proxied to the backend automatically.

You can also run the two halves separately:

```bash
npm run dev:server
npm run dev:client
```

## Run (production)

```bash
npm run build      # builds the client into client/dist
npm start          # Express serves the API and the built client on :5176
```

Then open http://localhost:5176.

## Deploy (access it from anywhere)

The app ships as a single Docker image that bundles Node, `yt-dlp`, and
`ffmpeg`, and serves the API + built frontend on one port. That image runs
anywhere — a VPS, Fly.io, Railway, Render, etc.

### Configuration

| Variable                   | Default     | Purpose                                              |
| -------------------------- | ----------- | ---------------------------------------------------- |
| `PORT`                     | `5176`      | Port the server listens on                           |
| `HOST`                     | `0.0.0.0`   | Bind address                                         |
| `APP_PASSWORD`             | _(unset)_   | If set, the whole app requires this password (Basic auth) |
| `MAX_CONCURRENT_DOWNLOADS` | `2`         | Max simultaneous yt-dlp jobs                         |
| `YTDLP_PATH`               | `yt-dlp`    | Path to the yt-dlp binary                            |
| `YTDLP_PLAYER_CLIENT`      | _(unset)_   | yt-dlp player client(s), e.g. `tv,web_safari,android` |
| `YTDLP_EXTRACTOR_ARGS`     | _(unset)_   | Full `--extractor-args` override (advanced)          |
| `YTDLP_FORCE_IPV4`         | `0`         | Set to `1` to force IPv4 (can help with some blocks) |

### Hosted on a cloud IP and getting "bot check" / "sign-in" errors?

This is YouTube blocking the **server's datacenter IP** (Railway, Fly, AWS…),
not a problem with the app — the same video usually works from a home network.

To clear it without any login, the Docker image **bundles a PO-token
(proof-of-origin) provider** ([bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider)).
It runs alongside the app on `127.0.0.1:4416`, solves YouTube's BotGuard
challenge, and yt-dlp uses the token automatically — no account or cookies.
This works only with the Docker image (Fly/Railway/compose), not the bare
`npm start`, which assumes a normal IP.

Because of the extra process, give the container a bit more memory
(**~1 GB**). If YouTube still blocks a specific video you can try a different
player client via the `YTDLP_PLAYER_CLIENT` variable (e.g. `android`), but with
the token provider running the defaults usually work. The last-resort options
remain running from a residential IP or supplying account cookies.

> **Set `APP_PASSWORD` on any public deployment.** The app shells out to
> `yt-dlp`, so you don't want it open to the world. Any username works; the
> password must match.

### Option A — Fly.io (fastest public URL)

```bash
fly launch --copy-config --no-deploy     # creates the app (pick a name + region)
fly secrets set APP_PASSWORD=your-password
fly deploy
```

Your app goes live at `https://<app-name>.fly.dev`, reachable from any device.

### Option B — Railway

Railway reads `railway.json` and builds the `Dockerfile` automatically.

**Dashboard (no CLI):**
1. Push this repo to GitHub (already done if you're reading this there).
2. Railway → **New Project → Deploy from GitHub repo** → pick this repo/branch.
3. In the service's **Variables**, add `APP_PASSWORD` (and optionally
   `MAX_CONCURRENT_DOWNLOADS`). Railway sets `PORT` itself — the app honors it.
4. **Settings → Networking → Generate Domain** to get your public HTTPS URL.

**CLI:**
```bash
npm i -g @railway/cli
railway login
railway init                 # create/link a project
railway up                   # build & deploy using the Dockerfile
railway variables --set APP_PASSWORD=your-password
railway domain               # generate a public URL
```

### Option C — Any server with Docker (self-host)

```bash
docker compose up -d --build             # uncomment APP_PASSWORD in docker-compose.yml first
# open http://<server-ip>:5176
```

Or without compose:

```bash
docker build -t youtube-downloader .
docker run -d -p 5176:5176 -e APP_PASSWORD=your-password youtube-downloader
```

For HTTPS and a real domain, put it behind a reverse proxy (Caddy, Nginx, or
your platform's built-in TLS). Render/Railway can deploy the same `Dockerfile`
directly and give you an HTTPS URL automatically.

### Keeping yt-dlp current

YouTube changes often; rebuild the image periodically to pull the latest
`yt-dlp` (the Dockerfile fetches the newest release on each build).

## How it works

1. `POST /api/info` runs `yt-dlp --dump-json` and returns the video metadata.
2. `POST /api/download` starts a yt-dlp job into a temp directory and returns a
   `jobId`.
3. The browser subscribes to `GET /api/progress/:jobId` (SSE) and shows live
   progress parsed from yt-dlp's stdout.
4. When the job is ready, the browser fetches `GET /api/file/:jobId`, which
   streams the file as a download and then deletes the temp directory.

## Notes

- This tool is intended for personal use with content you have the right to
  download. Respect YouTube's Terms of Service and applicable copyright law.
