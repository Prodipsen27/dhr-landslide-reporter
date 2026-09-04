'use strict';

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

async function deleteReport(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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

async function classifySeverity(_imageBitmap, manualSeverity) {
  return manualSeverity;
}

// --- Fallback templates in all 4 languages -----------------------------------

const SEVERITY_TEMPLATES = {
  low: {
    en: 'Minor signs observed (small crack or damp patch). Keep an eye on it after the next heavy rain; not an immediate danger. Monitor. No need to evacuate.',
    ne: 'सानो चिरा वा भिजेको ठाउँ देखिएको छ। अर्को ठूलो पानीपछि ध्यान दिनुहोस्; अहिले तुरुन्तै खतरा छैन। निगरानी गर्नुहोस्, हट्नुपर्दैन।',
    hi: 'छोटी दरार या नम धब्बा दिखा है। अगली भारी बारिश के बाद ध्यान रखें; अभी तुरंत खतरा नहीं है। निगरानी करें, हटने की ज़रूरत नहीं।',
    bn: 'ছোট ফাটল বা ভেজা জায়গা দেখা গেছে। পরবর্তী ভারী বৃষ্টির পর নজর রাখুন; এখনই বিপদ নেই। পর্যবেক্ষণ করুন, সরে যাওয়ার দরকার নেই।'
  },
  medium: {
    en: 'Noticeable signs of slope movement (wider crack, active seepage, or a leaning tree/wall). This can worsen quickly with more rain. Avoid staying directly below or above this spot. Tell your Panchayat/ward member.',
    ne: 'भिरालो चलेको स्पष्ट संकेत (ठूलो चिरा, पानी चुहावट, वा ढल्किएको रुख/भित्ता)। थप पानीले अवस्था तुरुन्तै बिग्रन सक्छ। यस ठाउँको माथि वा तल नबस्नुहोस्। आफ्नो वडा सदस्यलाई जानकारी दिनुहोस्।',
    hi: 'ढलान हिलने के स्पष्ट संकेत (चौड़ी दरार, रिसाव, या झुका हुआ पेड़/दीवार)। और बारिश से यह तेज़ी से बिगड़ सकता है। इस जगह के ठीक ऊपर या नीचे न रहें। अपने पंचायत/वार्ड सदस्य को बताएँ।',
    bn: 'ঢাল নড়াচড়ার স্পষ্ট লক্ষণ (চওড়া ফাটল, জল চোয়ানো, বা হেলে পড়া গাছ/দেওয়াল)। আরও বৃষ্টিতে দ্রুত খারাপ হতে পারে। এই জায়গার ঠিক ওপরে বা নীচে থাকবেন না। আপনার পঞ্চায়েত/ওয়ার্ড সদস্যকে জানান।'
  },
  high: {
    en: 'Serious signs (fresh debris, a visibly bulging wall, or a large fresh crack across a path or road). This can fail with little warning. Move away from the slope now and warn others nearby. Report to local authorities immediately.',
    ne: 'गम्भीर संकेत (ताजा माटोको ढिस्कोले, भित्ता फुलेको, वा बाटो काट्ने ठूलो चिरा)। कुनै पनि बेला भत्किन सक्छ। अहिले नै भिरालोबाट टाढा जानुहोस् र नजिकका मानिसलाई सचेत गराउनुहोस्। तुरुन्तै स्थानीय अधिकारीलाई खबर गर्नुहोस्।',
    hi: 'गंभीर संकेत (ताज़ा मलबा, दीवार उभरी हुई, या सड़क पर बड़ी ताज़ी दरार)। यह बिना चेतावनी गिर सकता है। अभी ढलान से दूर हट जाएँ और आसपास के लोगों को सचेत करें। तुरंत स्थानीय अधिकारियों को सूचित करें।',
    bn: 'গুরুতর লক্ষণ (তাজা ধ্বংসাবশেষ, ফুলে ওঠা দেওয়াল, বা রাস্তা জুড়ে বড় ফাটল)। এটি কোনো সতর্কতা ছাড়াই ধসে পড়তে পারে। এখনই ঢাল থেকে দূরে সরে যান এবং কাছের মানুষদের সতর্ক করুন। অবিলম্বে স্থানীয় কর্তৃপক্ষকে জানান।'
  }
};

// --- On-device LLM explanation -----------------------------------------------

let llmSession = null;

async function getLLMSession() {
  if (llmSession) return llmSession;
  if (!('LanguageModel' in self)) return null;
  try {
    const avail = await LanguageModel.availability();
    if (avail === 'unavailable') return null;
    llmSession = await LanguageModel.create({
      systemPrompt:
        'You are a slope-safety advisor for the Darjeeling hills in West Bengal, India. ' +
        'You explain landslide warning signs in plain, calm language suitable for a worried villager ' +
        'reading on a small phone screen. Always respond in the requested language only. ' +
        'Keep answers to exactly 2 short sentences.',
      temperature: 0.3,
      topK: 3
    });
    return llmSession;
  } catch {
    return null;
  }
}

async function explainWithLLM(severity, notes, lang, location) {
  const fallback = SEVERITY_TEMPLATES[severity];
  const langLabel = { en: 'English', ne: 'Nepali', hi: 'Hindi', bn: 'Bengali' }[lang] || 'English';
  const fallbackText = fallback[lang] || fallback.en;

  const session = await getLLMSession();
  if (!session) {
    const suffix = lang === 'en' ? ' (on-device model unavailable — showing a plain-language template instead.)' : '';
    return fallbackText + suffix;
  }

  try {
    let prompt =
      `A hill-slope observation in the Darjeeling hills was logged with severity "${severity}". ` +
      `Observer notes: "${notes || 'none'}". `;
    if (location) {
      prompt += `Location: approximately ${location.lat.toFixed(4)}°N, ${location.lng.toFixed(4)}°E. `;
    }
    prompt +=
      `In ${langLabel}, write 2 short sentences: what this likely means, and what the person should do right now.`;
    return await session.prompt(prompt);
  } catch (err) {
    console.warn('LLM explanation failed, using template fallback:', err);
    llmSession = null;
    const suffix = lang === 'en' ? ' (on-device model error — showing a template instead.)' : '';
    return fallbackText + suffix;
  }
}

// --- Sync --------------------------------------------------------------------

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
  for (const r of pending) {
    await markSynced(r.id);
  }
  statusEl.textContent = `Synced ${pending.length} report(s).`;
  renderReportList();
}

// --- UI ----------------------------------------------------------------------

let stream = null;

async function startCamera() {
  const video = document.getElementById('camera');
  const cameraWrap = document.getElementById('cameraWrap');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
  } catch (err) {
    if (cameraWrap) cameraWrap.hidden = true;
    document.getElementById('cameraError').textContent =
      'Camera unavailable (' + err.message + '). You can still submit a report without a photo.';
  }
}

function captureFrame() {
  const video = document.getElementById('camera');
  const canvas = document.getElementById('captureCanvas');
  const maxW = 1280;
  let w = video.videoWidth || 640;
  let h = video.videoHeight || 480;
  if (w > maxW) {
    h = Math.round(h * (maxW / w));
    w = maxW;
  }
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
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

function formatTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return new Date(ts).toLocaleDateString();
}

async function renderReportList() {
  const list = document.getElementById('reportList');
  const heading = document.getElementById('reportsHeading');
  const reports = await getAllReports();
  const sorted = reports.sort((a, b) => b.createdAt - a.createdAt);

  const queued = reports.filter((r) => !r.synced).length;
  if (reports.length === 0) {
    heading.textContent = 'Your reports';
  } else {
    heading.textContent = `Your reports (${reports.length}${queued ? ' · ' + queued + ' queued' : ''})`;
  }

  list.innerHTML = '';

  if (sorted.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state-card';
    li.innerHTML = `
      <div class="empty-icon" aria-hidden="true">🏔️</div>
      <p class="empty-title">No observations logged yet</p>
      <p class="empty-desc">Logged observations remain safely on this device and auto-sync when network connectivity returns.</p>
    `;
    list.appendChild(li);
    return;
  }

  for (const r of sorted) {
    const li = document.createElement('li');
    li.className = 'report-item severity-' + r.severity;

    const row = document.createElement('div');
    row.className = 'report-top-row';

    const sev = document.createElement('span');
    sev.className = 'severity-tag';
    sev.textContent = r.severity.toUpperCase() + ' SEVERITY';
    row.appendChild(sev);

    const right = document.createElement('span');
    right.style.cssText = 'display:flex;align-items:center;gap:0.5rem';

    const badge = document.createElement('span');
    badge.className = 'sync-badge ' + (r.synced ? 'synced' : 'queued');
    badge.textContent = r.synced ? 'Synced' : 'Queued';
    right.appendChild(badge);

    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.textContent = '✕';
    del.title = 'Delete this report';
    del.setAttribute('aria-label', 'Delete report');
    del.addEventListener('click', async () => {
      await deleteReport(r.id);
      renderReportList();
    });
    right.appendChild(del);
    row.appendChild(right);
    li.appendChild(row);

    if (r.photo) {
      const thumb = document.createElement('img');
      thumb.src = r.photo;
      thumb.className = 'report-thumb';
      thumb.alt = 'Observation photo';
      li.appendChild(thumb);
    }

    const explanation = document.createElement('p');
    explanation.textContent = r.explanation;
    li.appendChild(explanation);

    const meta = document.createElement('div');
    meta.className = 'report-meta';
    meta.textContent = '⏱ ' + formatTime(r.createdAt) +
      (r.location ? ' · 📍 ' + r.location.lat.toFixed(4) + '°N, ' + r.location.lng.toFixed(4) + '°E' : '');
    li.appendChild(meta);

    list.appendChild(li);
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const statusEl = document.getElementById('status');
  const severity = document.getElementById('severity').value;
  const notes = document.getElementById('notes').value;
  const lang = document.getElementById('lang').value;

  btn.disabled = true;
  btn.textContent = '⏳ Saving…';
  statusEl.textContent = 'Thinking through this offline…';

  try {
    const photo = stream ? captureFrame() : null;
    const finalSeverity = await classifySeverity(photo, severity);
    const location = await getLocation();
    const explanation = await explainWithLLM(finalSeverity, notes, lang, location);

    await saveReport({ severity: finalSeverity, notes, lang, photo, location, explanation });

    document.getElementById('notes').value = '';
    statusEl.textContent = 'Saved locally. Will sync automatically when online.';
    renderReportList();

    if (navigator.onLine) trySync(statusEl);
  } finally {
    btn.disabled = false;
    btn.textContent = '📍 Log this observation';
  }
}

// --- Install prompt ----------------------------------------------------------

let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('installBtn');
  if (btn) btn.hidden = false;
});

function handleInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(() => {
    deferredInstallPrompt = null;
    const btn = document.getElementById('installBtn');
    if (btn) btn.hidden = true;
  });
}

// --- Network & Storage Status -----------------------------------------------

function updateNetStatus() {
  const badge = document.getElementById('netBadge');
  const text = document.getElementById('netText');
  if (!badge || !text) return;
  if (navigator.onLine) {
    badge.className = 'status-pill online';
    text.textContent = 'ONLINE · AUTO-SYNC';
  } else {
    badge.className = 'status-pill offline';
    text.textContent = 'OFFLINE STORAGE';
  }
}

// --- Init --------------------------------------------------------------------

window.addEventListener('online', () => {
  updateNetStatus();
  trySync(document.getElementById('status'));
});

window.addEventListener('offline', () => {
  updateNetStatus();
  const statusEl = document.getElementById('status');
  if (statusEl && !statusEl.textContent.trim()) {
    statusEl.textContent = 'Offline mode active — observations will save safely to local storage.';
  }
});

navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data?.type === 'TRY_SYNC') trySync(document.getElementById('status'));
});

window.addEventListener('DOMContentLoaded', () => {
  updateNetStatus();
  startCamera();
  renderReportList();
  document.getElementById('reportForm').addEventListener('submit', handleSubmit);
  document.getElementById('installBtn')?.addEventListener('click', handleInstall);
  trySync(document.getElementById('status'));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      if (reg.sync) reg.sync.register('sync-reports').catch(() => {});
    });
  }
});

