import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  YTDLP,
  isValidYouTubeUrl,
  fetchInfo,
  buildDownloadArgs,
  parseProgressLine,
  mapError,
  sanitizeFilename,
  tailStderr,
  initCookies,
} from './ytdlp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5176;
const HOST = process.env.HOST || '0.0.0.0';
const TMP_ROOT = path.join(os.tmpdir(), 'yt-downloader');
// Optional gate for public deployments. When set, every request (except the
// health check) requires HTTP Basic auth with this value as the password.
const APP_PASSWORD = process.env.APP_PASSWORD || '';
// Cap simultaneous yt-dlp jobs so a public instance can't be overwhelmed.
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '2', 10));
let activeDownloads = 0;

const app = express();
app.set('trust proxy', true); // honor X-Forwarded-* behind a platform/reverse proxy
app.use(cors());
app.use(express.json());

// Health check stays public so platform probes don't need credentials.
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Optional HTTP Basic auth. Works transparently with fetch, the SSE progress
// stream, and the download navigation since the browser caches credentials.
if (APP_PASSWORD) {
  const expected = Buffer.from(APP_PASSWORD);
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const provided = Buffer.from(
        Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':')
      );
      if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="YouTube Downloader"');
    return res.status(401).send('Authentication required.');
  });
  console.log('Password protection is ENABLED.');
}

// ---------------------------------------------------------------------------
// In-memory job registry. Each download is a job that produces one temp file.
// ---------------------------------------------------------------------------
const jobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000; // sweep abandoned jobs after 1 hour

async function cleanupJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  jobs.delete(jobId);
  if (job.child && !job.child.killed) {
    try { job.child.kill('SIGKILL'); } catch { /* ignore */ }
  }
  if (job.dir) {
    await fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Periodically remove stale jobs whose files were never downloaded.
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) cleanupJob(id);
  }
}, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Fetch metadata for a single YouTube video.
app.post('/api/info', async (req, res) => {
  const url = (req.body?.url || '').trim();
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Please enter a valid YouTube video URL.' });
  }
  try {
    const info = await fetchInfo(url);
    res.json(info);
  } catch (err) {
    res.status(422).json({ error: err.userFacing ? err.message : 'Could not fetch video information.' });
  }
});

// Start a download job. Returns a jobId the client subscribes to for progress.
app.post('/api/download', async (req, res) => {
  const { url, format, quality, title } = req.body || {};
  if (!isValidYouTubeUrl((url || '').trim())) {
    return res.status(400).json({ error: 'Please enter a valid YouTube video URL.' });
  }
  if (!['mp4', 'mp3'].includes(format)) {
    return res.status(400).json({ error: 'Invalid format requested.' });
  }
  if (activeDownloads >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'The server is busy right now. Please try again in a moment.' });
  }

  const jobId = randomUUID();
  const dir = path.join(TMP_ROOT, jobId);
  await fsp.mkdir(dir, { recursive: true });

  const ext = format === 'mp3' ? 'mp3' : 'mp4';
  const outputTemplate = path.join(dir, 'media.%(ext)s');
  const args = buildDownloadArgs({ url: url.trim(), format, quality, outputTemplate });

  const job = {
    id: jobId,
    dir,
    createdAt: Date.now(),
    status: 'processing', // processing | ready | error
    progress: 0,
    phase: 'Starting',
    error: null,
    fileName: `${sanitizeFilename(title)}.${ext}`,
    filePath: null,
    stderr: '',
    listeners: new Set(),
    child: null,
  };
  jobs.set(jobId, job);

  activeDownloads += 1;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      activeDownloads = Math.max(0, activeDownloads - 1);
    }
  };

  const child = spawn(YTDLP, args);
  job.child = child;

  const handleLine = (line) => {
    const update = parseProgressLine(line);
    if (update) {
      job.progress = update.progress;
      job.phase = update.phase;
      emit(job);
    }
  };

  // Parse stdout line-by-line for progress.
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) handleLine(line);
  });
  child.stderr.on('data', (d) => (job.stderr += d.toString()));

  child.on('error', (err) => {
    release();
    job.status = 'error';
    job.error = `Failed to start yt-dlp: ${err.message}`;
    emit(job);
    cleanupJob(jobId);
  });

  child.on('close', async (code) => {
    release();
    if (code !== 0) {
      console.error(`[yt-dlp:download] exited ${code}:\n${tailStderr(job.stderr)}`);
      job.status = 'error';
      job.error = mapError(job.stderr);
      emit(job);
      await cleanupJob(jobId);
      return;
    }
    // Find the produced file (media.<ext>).
    try {
      const files = await fsp.readdir(dir);
      const produced = files.find((f) => f.startsWith('media.'));
      if (!produced) throw new Error('no output file');
      job.filePath = path.join(dir, produced);
      job.status = 'ready';
      job.progress = 100;
      job.phase = 'Ready';
      emit(job);
    } catch {
      job.status = 'error';
      job.error = 'Download finished but the file could not be found.';
      emit(job);
      await cleanupJob(jobId);
    }
  });

  res.json({ jobId });
});

// Server-Sent Events stream of progress for a job.
app.get('/api/progress/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Unknown or expired job.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = () => {
    const payload = {
      status: job.status,
      progress: job.progress,
      phase: job.phase,
      error: job.error,
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  job.listeners.add(res);
  send(); // push current state immediately

  req.on('close', () => {
    job.listeners?.delete(res);
  });
});

function emit(job) {
  for (const res of job.listeners) {
    res.write(
      `data: ${JSON.stringify({
        status: job.status,
        progress: job.progress,
        phase: job.phase,
        error: job.error,
      })}\n\n`
    );
  }
}

// Stream the finished file to the browser, then clean up.
app.get('/api/file/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'ready' || !job.filePath) {
    return res.status(404).json({ error: 'File is not ready or has expired.' });
  }
  if (!fs.existsSync(job.filePath)) {
    cleanupJob(job.id);
    return res.status(404).json({ error: 'File no longer available.' });
  }

  res.download(job.filePath, job.fileName, (err) => {
    // Whether the transfer succeeded or the client aborted, drop the temp files.
    cleanupJob(job.id);
    if (err && !res.headersSent) {
      res.status(500).end();
    }
  });
});

// ---------------------------------------------------------------------------
// Serve the built client in production (single-port deployment).
// ---------------------------------------------------------------------------
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

initCookies();

app.listen(PORT, HOST, () => {
  console.log(`yt-downloader server listening on http://${HOST}:${PORT}`);
});
