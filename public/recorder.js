/**
 * Recording the city, in the browser and nowhere else.
 *
 * The screen saver (?embed=1) already flies itself around a city for as long as
 * you leave it running, which is exactly the thing people ask for a clip of --
 * and the only way to get one was to point a screen recorder at a window and
 * crop the result. The browser can already do this: canvas.captureStream() hands
 * the WebGL front buffer to MediaRecorder as a live video track, so the city
 * encodes itself while it draws, at whatever size the renderer is set to rather
 * than whatever size the window happened to be.
 *
 * ?record=15 is fifteen seconds of the city, saved when it finishes.
 */

// In preference order. Chrome has encoded MP4 from MediaRecorder since 126, and
// it is worth asking for first: Reddit, iMessage and every video editor take an
// MP4, while a VP9 WebM has to be converted before most of them will look at it.
// Everything else falls back through WebM, which Chrome and Firefox have always had.
const MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E', // H.264 baseline: the one that plays everywhere
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** The best container this browser will encode, or null if it records nothing. */
export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  return MIME_TYPES.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) ?? null;
}

const extensionFor = (mime) => (mime.startsWith('video/mp4') ? 'mp4' : 'webm');

/**
 * Record `seconds` of whatever the canvas is drawing.
 *
 * The stream is pulled by the compositor, not by us: every frame the page paints
 * goes into the track on its own. That means a recording is only ever as smooth
 * as the tab actually ran -- which is the honest thing to publish, and also why
 * a recording started while the tab is in the background records nothing at all.
 *
 * @returns {Promise<Blob>} the finished video
 */
export function recordCanvas(canvas, { seconds = 15, fps = 60, bitrate = 12e6, onTick } = {}) {
  const mimeType = pickMimeType();
  if (!mimeType) return Promise.reject(new Error('this browser cannot record a canvas'));

  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  return new Promise((resolve, reject) => {
    let ticker = null;
    const finish = () => {
      clearInterval(ticker);
      for (const t of stream.getTracks()) t.stop(); // let go of the canvas
      const blob = new Blob(chunks, { type: mimeType });
      // An empty file means the frames never arrived -- a backgrounded tab, or a
      // canvas the compositor never promoted. Say so rather than saving 0 bytes.
      if (!blob.size) reject(new Error('the recording came back empty (was the tab in the background?)'));
      else resolve(blob);
    };
    rec.onstop = finish;
    rec.onerror = (e) => { clearInterval(ticker); reject(e.error || new Error('recording failed')); };

    // A timeslice makes the recorder hand over chunks as it goes, so a recording
    // that is interrupted still has everything up to the interruption.
    rec.start(250);
    const started = performance.now();
    if (onTick) {
      onTick(0, seconds);
      ticker = setInterval(() => onTick(Math.min((performance.now() - started) / 1000, seconds), seconds), 100);
    }
    setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, seconds * 1000);
  });
}

/** Hand the finished file to the browser's downloads. */
export function saveBlob(blob, basename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${basename}.${extensionFor(blob.type)}`;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoked on a delay: Chrome reads the blob after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return a.download;
}

/**
 * The "REC" pill. It is DOM, not canvas, so it never lands in the video -- the
 * stream carries the canvas alone. That is the whole reason the countdown can
 * sit on top of the thing being recorded.
 */
export function createRecorderBadge() {
  const el = document.createElement('div');
  el.id = 'rec-badge';
  el.innerHTML = '<span class="rec-dot"></span><span class="rec-text">recording</span>';
  document.body.append(el);
  return {
    tick(done, total) {
      el.querySelector('.rec-text').textContent = `recording ${Math.ceil(total - done)}s`;
    },
    encoding() { el.classList.add('encoding'); el.querySelector('.rec-text').textContent = 'encoding…'; },
    saved(name) { el.classList.add('done'); el.querySelector('.rec-text').textContent = `saved ${name}`; },
    failed(msg) { el.classList.add('failed'); el.querySelector('.rec-text').textContent = msg; },
    remove() { el.remove(); },
  };
}
