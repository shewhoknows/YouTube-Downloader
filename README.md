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
