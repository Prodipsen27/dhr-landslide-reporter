'use strict';

/* ----------------------------------------------------------------------
 * SlopeWatch — offline landslide observation reporter
 * ------------------------------------------------------------------- */

// --- IndexedDB: local queue of reports, works fully offline ----------
const DB_NAME = 'slopewatch';
const STORE = 'reports';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('synced', 'synced');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveReport(report) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({ ...report, synced: 0, createdAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllReports() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function markSynced(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const rec = getReq.result;
      if (rec) { rec.synced = 1; store.put(rec); }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Severity classification -------------------------------------------
// TODO before the event: replace this stub with a MediaPipe Image Classifier
// loaded from a small custom-trained .tflite model (cracks / seepage /
// bulging wall / debris). Model loading looks like:
//
//   import { ImageClassifier, FilesetResolver } from
//     "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";
//   const vision = await FilesetResolver.forVisionTasks(".../wasm");
//   const classifier = await ImageClassifier.createFromOptions(vision, {
//     baseOptions: { modelAssetPath: "./models/slope-hazard.tflite" }
//   });
//   const result = classifier.classify(imageElement);
//
// Until that model exists, the observer picks severity manually and the
// on-device LLM still does the explanation — so the app is fully usable
// without the trained classifier, and you can drop the model in later
// without touching any other code.
async function classifySeverity(_imageBitmap, manualSeverity) {
  return manualSeverity; // 'low' | 'medium' | 'high'
}

// --- On-device LLM explanation, with template fallback -----------------
const SEVERITY_TEMPLATES = {
  low: {
    en: 'Minor signs observed (small crack or damp patch). Keep an eye on it after the next heavy rain; not an immediate danger.',
    action: 'Monitor. No need to evacuate.'
  },
  medium: {
    en: 'Noticeable signs of slope movement (wider crack, active seepage, or a leaning tree/wall). This can worsen quickly with more rain.',
    action: 'Avoid staying directly below or above this spot. Tell your Panchayat/ward member.'
  },
  high: {
    en: 'Serious signs (fresh debris, a visibly bulging wall, or a large fresh crack across a path or road). This can fail with little warning.',
    action: 'Move away from the slope now and warn others nearby. Report to local authorities immediately.'
  }
};

async function explainWithLLM(severity, notes, lang) {
  const fallback = SEVERITY_TEMPLATES[severity];
  const langLabel = { en: 'English', ne: 'Nepali', hi: 'Hindi', bn: 'Bengali' }[lang] || 'English';

  if (!('LanguageModel' in self)) {
    return `${fallback.en} ${fallback.action} (on-device model unavailable — showing a plain-language template instead.)`;
  }

  try {
    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') {
      return `${fallback.en} ${fallback.action} (on-device model unavailable on this device — showing a template instead.)`;
    }
    const session = await LanguageModel.create();
    const prompt =
      `A hill-slope observation was logged with severity "${severity}". ` +
      `Observer notes: "${notes || 'none'}". ` +
      `In ${langLabel}, write 2 short sentences: what this means, and what the person should do right now. ` +
      `Keep it plain and calm, suitable for a worried villager reading it on a small phone screen.`;
    const result = await session.prompt(prompt);
    return result;
  } catch (err) {
    console.warn('LLM explanation failed, using template fallback:', err);
    return `${fallback.en} ${fallback.action} (on-device model error — showing a template instead.)`;
  }
}

// --- Sync: push queued reports once a connection is available ----------
async function trySync(statusEl) {
  if (!navigator.onLine) {
    statusEl.textContent = 'Offline — reports will sync when you have a connection.';
    return;
  }
  const reports = await getAllReports();
  const pending = reports.filter((r) => !r.synced);
  if (pending.length === 0) {
    statusEl.textContent = 'All reports synced.';
    return;
  }
  // TODO before the event: point this at a real backend / relay endpoint.
  // For the hackathon demo, we simulate a sync so the queue-and-sync flow
  // is visible even without a server.
  for (const r of pending) {
    await markSynced(r.id);
  }
  statusEl.textContent = `Synced ${pending.length} report(s).`;
  renderReportList();
}

// --- UI wiring -----------------------------------------------------------
let stream = null;

async function startCamera() {
  const video = document.getElementById('camera');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
  } catch (err) {
    document.getElementById('cameraError').textContent =
      'Camera unavailable (' + err.message + '). You can still submit a report without a photo.';
  }
}

function captureFrame() {
  const video = document.getElementById('camera');
  const canvas = document.getElementById('captureCanvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}

async function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000 }
    );
  });
}

async function renderReportList() {
  const list = document.getElementById('reportList');
  const reports = await getAllReports();
  list.innerHTML = '';
  reports
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach((r) => {
      const li = document.createElement('li');
      li.className = 'report-item severity-' + r.severity;
      li.innerHTML = `
        <strong>${r.severity.toUpperCase()}</strong>
        <span class="sync-badge">${r.synced ? 'synced' : 'queued'}</span>
        <p>${r.explanation}</p>
        <small>${new Date(r.createdAt).toLocaleString()}${r.location ? ` · ${r.location.lat.toFixed(4)}, ${r.location.lng.toFixed(4)}` : ''}</small>
      `;
      list.appendChild(li);
    });
}

async function handleSubmit(e) {
  e.preventDefault();
  const statusEl = document.getElementById('status');
  const severity = document.getElementById('severity').value;
  const notes = document.getElementById('notes').value;
  const lang = document.getElementById('lang').value;

  statusEl.textContent = 'Thinking through this offline…';

  const photo = stream ? captureFrame() : null;
  const finalSeverity = await classifySeverity(photo, severity);
  const location = await getLocation();
  const explanation = await explainWithLLM(finalSeverity, notes, lang);

  await saveReport({ severity: finalSeverity, notes, lang, photo, location, explanation });

  document.getElementById('notes').value = '';
  statusEl.textContent = 'Saved locally. Will sync automatically when online.';
  renderReportList();
  trySync(statusEl);
}

window.addEventListener('online', () => trySync(document.getElementById('status')));
navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data?.type === 'TRY_SYNC') trySync(document.getElementById('status'));
});

window.addEventListener('DOMContentLoaded', () => {
  startCamera();
  renderReportList();
  document.getElementById('reportForm').addEventListener('submit', handleSubmit);
  trySync(document.getElementById('status'));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js');
  }
});
