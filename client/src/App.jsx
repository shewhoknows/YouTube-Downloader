import { useState } from 'react';
import './App.css';

const QUALITY_OPTIONS = {
  mp4: [
    { value: '1080', label: '1080p' },
    { value: '720', label: '720p' },
    { value: '480', label: '480p' },
  ],
  mp3: [
    { value: '320', label: '320 kbps' },
    { value: '128', label: '128 kbps' },
  ],
};

function formatDuration(seconds) {
  if (seconds == null) return null;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');

  const [format, setFormat] = useState('mp4');
  const [quality, setQuality] = useState('1080');

  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');

  function chooseFormat(next) {
    setFormat(next);
    setQuality(QUALITY_OPTIONS[next][0].value);
  }

  async function handleFetch(e) {
    e?.preventDefault();
    if (!url.trim() || fetching) return;
    setError('');
    setInfo(null);
    setFetching(true);
    try {
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not fetch video information.');
      setInfo(data);
    } catch (err) {
      setError(err.message || 'Something went wrong while fetching the video.');
    } finally {
      setFetching(false);
    }
  }

  async function handleDownload() {
    if (!info || downloading) return;
    setError('');
    setDownloading(true);
    setProgress(0);
    setPhase('Starting');

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), format, quality, title: info.title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start the download.');

      const source = new EventSource(`/api/progress/${data.jobId}`);
      source.onmessage = (event) => {
        const update = JSON.parse(event.data);
        setProgress(update.progress ?? 0);
        setPhase(update.phase || '');

        if (update.status === 'ready') {
          source.close();
          // Trigger the browser download of the finished file.
          const a = document.createElement('a');
          a.href = `/api/file/${data.jobId}`;
          a.download = '';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setDownloading(false);
        } else if (update.status === 'error') {
          source.close();
          setError(update.error || 'The download failed.');
          setDownloading(false);
        }
      };
      source.onerror = () => {
        source.close();
        setError('Lost connection to the server during download.');
        setDownloading(false);
      };
    } catch (err) {
      setError(err.message || 'Something went wrong while downloading.');
      setDownloading(false);
    }
  }

  return (
    <div className="page">
      <main className="card">
        <header className="header">
          <h1>YouTube Downloader</h1>
          <p className="subtitle">Paste a video link to download it as MP4 or MP3.</p>
        </header>

        <form className="url-row" onSubmit={handleFetch}>
          <input
            type="text"
            inputMode="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={fetching}
            aria-label="YouTube URL"
          />
          <button type="submit" disabled={!url.trim() || fetching}>
            {fetching ? 'Fetching…' : 'Fetch'}
          </button>
        </form>

        {error && <div className="error" role="alert">{error}</div>}

        {fetching && !info && (
          <div className="loading">
            <span className="spinner" /> Fetching video details…
          </div>
        )}

        {info && (
          <section className="result">
            <div className="meta">
              {info.thumbnail && (
                <img className="thumb" src={info.thumbnail} alt="" loading="lazy" />
              )}
              <div className="meta-text">
                <h2 className="title" title={info.title}>{info.title}</h2>
                <p className="channel">{info.channel}</p>
                {info.duration != null && (
                  <p className="duration">{formatDuration(info.duration)}</p>
                )}
              </div>
            </div>

            <div className="options">
              <div className="option-group">
                <span className="option-label">Format</span>
                <div className="segmented">
                  <button
                    type="button"
                    className={format === 'mp4' ? 'active' : ''}
                    onClick={() => chooseFormat('mp4')}
                    disabled={downloading}
                  >
                    MP4 · Video
                  </button>
                  <button
                    type="button"
                    className={format === 'mp3' ? 'active' : ''}
                    onClick={() => chooseFormat('mp3')}
                    disabled={downloading}
                  >
                    MP3 · Audio
                  </button>
                </div>
              </div>

              <div className="option-group">
                <span className="option-label">Quality</span>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  disabled={downloading}
                >
                  {QUALITY_OPTIONS[format].map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <button className="download-btn" onClick={handleDownload} disabled={downloading}>
              {downloading ? 'Processing…' : `Download ${format.toUpperCase()}`}
            </button>

            {downloading && (
              <div className="progress">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="progress-label">
                  {phase}{progress > 0 && progress < 100 ? ` · ${Math.round(progress)}%` : ''}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
      <footer className="footnote">
        Powered by yt-dlp · for personal use with public videos only
      </footer>
    </div>
  );
}
