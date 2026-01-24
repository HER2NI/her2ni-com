// recorder.js — WebM capture via MediaRecorder
export async function recordWebM(canvas, durationMs = 8000, fps = 30) {
  if (!canvas.captureStream) throw new Error("captureStream not supported in this browser.");

  const stream = canvas.captureStream(fps);
  const options = pickSupportedMime();
  const rec = new MediaRecorder(stream, options);

  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  const stopped = new Promise((resolve) => { rec.onstop = resolve; });

  rec.start(200);
  await sleep(durationMs);
  rec.stop();
  await stopped;

  const blob = new Blob(chunks, { type: rec.mimeType || "video/webm" });
  return blob;
}

function pickSupportedMime() {
  const candidates = [
    { mimeType: "video/webm;codecs=vp9" },
    { mimeType: "video/webm;codecs=vp8" },
    { mimeType: "video/webm" }
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return {};
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

export function downloadBlob(blob, filename = "her-crystal.webm") {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}