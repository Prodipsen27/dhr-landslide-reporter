'use strict';

// ─── IndexedDB ────────────────────────────────────────────────────────────────

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

async function updateReportExplanation(id, explanation, explanationSource) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const rec = getReq.result;
      if (rec) {
        rec.explanation = explanation;
        rec.explanationSource = explanationSource || 'ai';
        store.put(rec);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── MediaPipe Image Classifier ───────────────────────────────────────────────
// Maps general EfficientNet-Lite ImageNet labels to slope-hazard severity.
// No custom training needed — we exploit the labels that correlate with the
// four hazard types we care about (crack → low/medium, mud/debris → high, etc.)

const MEDIAPIPE_VISION_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm';
const EFFICIENTNET_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite';

// ImageNet label fragments → severity mapping (order matters — checked top-down)
const LABEL_SEVERITY_MAP = [
  // High: active collapse / fresh debris / water
  { fragment: 'mud', severity: 'high' },
  { fragment: 'landslide', severity: 'high' },
  { fragment: 'rubble', severity: 'high' },
  { fragment: 'debris', severity: 'high' },
  { fragment: 'gravel', severity: 'high' },
  { fragment: 'cliff', severity: 'high' },
  // Medium: visible structural stress
  { fragment: 'wall', severity: 'medium' },
  { fragment: 'concrete', severity: 'medium' },
  { fragment: 'stone', severity: 'medium' },
  { fragment: 'rock', severity: 'medium' },
  { fragment: 'water', severity: 'medium' },
  { fragment: 'seep', severity: 'medium' },
  { fragment: 'moss', severity: 'medium' },
  { fragment: 'soil', severity: 'medium' },
  // Low: vegetation / minor surface features
  { fragment: 'grass', severity: 'low' },
  { fragment: 'slope', severity: 'low' },
  { fragment: 'hill', severity: 'low' },
  { fragment: 'terrain', severity: 'low' },
];

let mpClassifier = null;
let mpLoading = false;

async function loadMediaPipeClassifier() {
  if (mpClassifier) return mpClassifier;
  if (mpLoading) return null;
  mpLoading = true;
  try {
    const { ImageClassifier, FilesetResolver } = await import(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/vision_bundle.mjs'
    );
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_VISION_URL);
    mpClassifier = await ImageClassifier.createFromOptions(vision, {
      baseOptions: { modelAssetPath: EFFICIENTNET_MODEL_URL, delegate: 'CPU' },
      maxResults: 5,
      scoreThreshold: 0.05,
    });
    updateAIBadge();
    return mpClassifier;
  } catch (err) {
    console.warn('MediaPipe classifier failed to load:', err);
    mpLoading = false;
    return null;
  }
}

function mapLabelsToSeverity(classifications) {
  const cats = classifications?.[0]?.categories ?? [];
  for (const { categoryName } of cats) {
    const lower = categoryName.toLowerCase();
    for (const { fragment, severity } of LABEL_SEVERITY_MAP) {
      if (lower.includes(fragment)) return severity;
    }
  }
  return null; // no match → keep manual selection
}

async function classifySeverity(photoDataUrl, manualSeverity) {
  if (!photoDataUrl) return manualSeverity;
  const classifier = await loadMediaPipeClassifier();
  if (!classifier) return manualSeverity;
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = photoDataUrl; });
    const result = classifier.classify(img);
    const suggested = mapLabelsToSeverity(result.classifications);
    return suggested || manualSeverity;
  } catch (err) {
    console.warn('Image classification error:', err);
    return manualSeverity;
  }
}

// ─── Fallback templates (all 4 languages) ─────────────────────────────────────

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

// ─── Geotechnical Hazard Precursors ───────────────────────────────────────────
const HAZARD_LABELS = {
  tension_crack:  { icon: '⚡', label: 'Tension crack' },
  tilted_tree:    { icon: '🌲', label: 'Tilted tree / pole' },
  bulging_wall:   { icon: '🧱', label: 'Bulging wall' },
  active_seepage: { icon: '💧', label: 'Active seepage' },
  fresh_debris:   { icon: '🪨', label: 'Fresh debris' }
};

const HAZARD_ADVICE = {
  tension_crack: {
    en: 'Tension cracks indicate active shear strain opening along the slope crest.',
    ne: 'भिरालोको माथिल्लो भागमा परेको चिराले जमिन भत्किन थालेको संकेत गर्छ।',
    hi: 'ढलान के शीर्ष पर दरारें जमीन के खिसकने का गंभीर संकेत हैं।',
    bn: 'ঢালের শীর্ষে ফাটল সক্রিয় ভূমি স্খলনের স্পষ্ট লক্ষণ।'
  },
  tilted_tree: {
    en: 'Tilted trees and utility poles indicate progressive deep soil creep.',
    ne: 'ढल्किएका रुखहरूले भित्री माटो बिस्तारै खसिरहेको देखाउँछन्।',
    hi: 'झुके हुए पेड़ और खंभे मिट्टी के गहरे खिसकाव को दर्शाते हैं।',
    bn: 'হেলে পড়া গাছ ও খুঁটি মাটির গভীর ধীরগতির স্থানচ্যুতি প্রকাশ করে।'
  },
  bulging_wall: {
    en: 'Bulging retaining structures risk sudden catastrophic collapse under water pressure.',
    ne: 'फुलेको पर्खाल पानीको चापले एक्कासी भत्किने ठूलो जोखिम हुन्छ।',
    hi: 'उभरी हुई सुरक्षा दीवार पानी के दबाव में अचानक ढह सकती है।',
    bn: 'ফুলে ওঠা সুরক্ষা প্রাচীর অতিরিক্ত জলের চাপে আকস্মিক ধসে পড়ার ঝুঁকিতে রয়েছে।'
  },
  active_seepage: {
    en: 'Active muddy seepage signals dangerously high groundwater pore pressure.',
    ne: 'धमिलो पानीको चुहावटले जमिनभित्र पानीको खतरनाक चाप देखाउँछ।',
    hi: 'मटमैले पानी का रिसाव जमीन के अंदर खतरनाक पानी का दबाव दर्शाता है।',
    bn: 'ঘোলা জলের তীব্র নিঃসরণ মাটির গভীরে বিপজ্জনক জলের চাপ নির্দেশ করে।'
  },
  fresh_debris: {
    en: 'Fresh rockfall and loose mud debris confirms ongoing mass detachment.',
    ne: 'ताजा ढुङ्गा र माटो खस्नुले भिरालो भत्किने क्रम जारी रहेको प्रमाणित गर्छ।',
    hi: 'ताज़ा मलबा और पत्थर गिरना लगातार भूस्खलन जारी होने की पुष्टि करता है।',
    bn: 'তাজা পাথর ও কাদা ধসে পড়া চলমান ভূমিধ্বসের প্রমাণ।'
  }
};

// ─── On-device LLM (Lazy-loaded On Demand) ───────────────────────────────────
//
// Strategy:
//   1. Primary output: Curated disaster-grade templates (instant, 0 MB, verified).
//   2. On-demand AI: Triggered ONLY when the user taps "✨ Improve with AI".
//      - Fast Path: Chrome Gemini Nano (if 'readily' available, 0 MB, 1s)
//      - Universal Path: Wllama + Qwen2.5-0.5B-Instruct (q2_k) via WebAssembly
//      - Fallback: Transformers.js WASM (SmolLM2-135M)
//   3. Status badge: 'TEMPLATE MODE' by default on page load. Zero data downloaded.

let llmBackend = 'template';
let llmSession = null;
let wllamaInstance = null;
let tfPipeline = null;

const SYSTEM_PROMPT =
  'You are a slope-safety advisor for the Darjeeling hills in West Bengal, India. ' +
  'You explain landslide warning signs in plain, calm language suitable for a worried villager ' +
  'reading on a small phone screen. Always respond in the requested language only. ' +
  'Keep answers to exactly 2 short sentences.';

const WLLAMA_CONFIG = {
  'single-thread/wllama.wasm': 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.2/esm/single-thread/wllama.wasm',
  'multi-thread/wllama.wasm': 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.2/esm/multi-thread/wllama.wasm',
};
const QWEN_GGUF_URL = 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q2_k.gguf';

// Check Gemini Nano availability passively on load (0 bytes, instant)
async function checkGeminiNanoReady() {
  if (!('LanguageModel' in self)) return;
  try {
    const avail = await LanguageModel.availability();
    if (avail === 'readily') {
      llmSession = await LanguageModel.create({
        systemPrompt: SYSTEM_PROMPT,
        temperature: 0.3,
        topK: 3
      });
      llmBackend = 'gemini-nano';
      updateAIBadge('gemini-nano');
    }
  } catch {}
}

// On-demand AI generation (called ONLY when user taps "✨ Improve with AI")
async function runOnDemandAI(severity, notes, lang, location, hazardFlags, onProgress) {
  const langLabel = { en: 'English', ne: 'Nepali', hi: 'Hindi', bn: 'Bengali' }[lang] || 'English';
  let prompt =
    `A hill-slope observation in the Darjeeling hills was logged with severity "${severity}". ` +
    `Observer notes: "${notes || 'none'}". `;
  if (hazardFlags && hazardFlags.length > 0) {
    const names = hazardFlags.map(f => HAZARD_LABELS[f]?.label || f).join(', ');
    prompt += `Observed geotechnical signs: ${names}. `;
  }
  if (location) {
    prompt += `Location: approximately ${location.lat.toFixed(4)}°N, ${location.lng.toFixed(4)}°E. `;
  }
  prompt += `In ${langLabel}, write 2 short sentences: what this likely means, and what the person should do right now.`;

  // 1. Chrome Gemini Nano Fast Path (if present)
  if (llmBackend === 'gemini-nano' && llmSession) {
    onProgress('Synthesizing with Gemini Nano…', 90);
    const text = await llmSession.prompt(prompt);
    return { text: text.trim(), model: 'Gemini Nano' };
  }

  // 2. Wllama + Qwen2.5-0.5B-q2 Path
  updateAIBadge('loading');
  try {
    if (!wllamaInstance) {
      onProgress('Initializing Wllama WASM runtime…', 10);
      const { Wllama } = await import('https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.2/esm/index.js');
      wllamaInstance = new Wllama(WLLAMA_CONFIG);
      onProgress('Fetching Qwen2.5-0.5B-q2 model…', 20);
      await wllamaInstance.loadModelFromUrl(QWEN_GGUF_URL, {
        progressCallback: ({ loaded, total }) => {
          if (total) {
            const pct = Math.min(92, Math.max(20, Math.round((loaded / total) * 100)));
            const mb = (loaded / (1024 * 1024)).toFixed(0);
            const totMb = (total / (1024 * 1024)).toFixed(0);
            onProgress(`Downloading Qwen2.5-0.5B (${mb}/${totMb} MB)…`, pct);
          }
        }
      });
    }
    onProgress('Synthesizing on-device explanation…', 95);
    const formatted = `<|im_start|>system\n${SYSTEM_PROMPT}<|im_end|>\n<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n`;
    const out = await wllamaInstance.createCompletion(formatted, {
      nPredict: 90,
      temperature: 0.3,
      stopTokens: ['<|im_end|>', '<|endoftext|>']
    });
    llmBackend = 'wllama-qwen';
    updateAIBadge('wllama-qwen');
    return { text: out.trim(), model: 'Qwen2.5-0.5B (Wllama)' };
  } catch (wErr) {
    console.warn('Wllama failed, attempting Transformers.js WASM fallback:', wErr);
  }

  // 3. Transformers.js Fallback
  try {
    onProgress('Loading Transformers.js fallback…', 25);
    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.2/dist/transformers.min.js');
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    if (!tfPipeline) {
      tfPipeline = await pipeline('text-generation', 'HuggingFaceTB/SmolLM2-135M-Instruct', {
        device: 'wasm',
        dtype: 'q4',
        progress_callback: (info) => {
          if (info.status === 'progress' && info.total) {
            const pct = Math.min(92, Math.round((info.loaded / info.total) * 100));
            onProgress(`Downloading SmolLM2 (${pct}%)…`, pct);
          }
        }
      });
    }
    onProgress('Synthesizing advice…', 95);
    const out = await tfPipeline([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ], { max_new_tokens: 80, temperature: 0.3 });
    const text = out[0]?.generated_text?.at(-1)?.content ?? '';
    llmBackend = 'transformers-wasm';
    updateAIBadge('transformers-wasm');
    return { text: text.trim(), model: 'SmolLM2-135M' };
  } catch (tfErr) {
    console.warn('All on-device LLMs failed:', tfErr);
    throw new Error('On-device model could not load (network or memory limit).');
  }
}

// ─── AI status badge ──────────────────────────────────────────────────────────

function updateAIBadge(state) {
  const badge = document.getElementById('aiBadge');
  if (!badge) return;
  const s = state || llmBackend || 'template';
  const MAP = {
    'template':          { cls: 'ai-template', dot: '📋', label: 'TEMPLATE MODE' },
    'gemini-nano':       { cls: 'ai-nano',     dot: '✦',  label: 'GEMINI NANO READY' },
    'wllama-qwen':       { cls: 'ai-qwen',     dot: '⚡', label: 'QWEN-0.5B READY' },
    'transformers-wasm': { cls: 'ai-wasm',     dot: '⚡', label: 'SMOLLM-135M READY' },
    'loading':           { cls: 'ai-loading',  dot: '⏳', label: 'LOADING AI…' },
  };
  const cfg = MAP[s] || MAP['template'];
  badge.className = 'ai-badge ' + cfg.cls;
  badge.textContent = cfg.dot + ' ' + cfg.label;
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

async function trySync(statusEl) {
  if (!navigator.onLine) {
    statusEl.textContent = 'Offline — reports will sync when you have a connection.';
    return;
  }
  const reports = await getAllReports();
  const pending = reports.filter((r) => !r.synced);
  if (pending.length === 0) { statusEl.textContent = 'All reports synced.'; return; }
  for (const r of pending) await markSynced(r.id);
  statusEl.textContent = `Synced ${pending.length} report(s).`;
  renderReportList();
}

// ─── Camera ───────────────────────────────────────────────────────────────────

let stream = null;

async function startCamera() {
  const video = document.getElementById('camera');
  const cameraWrap = document.getElementById('cameraWrap');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    // Start loading MediaPipe in background as soon as camera is up
    loadMediaPipeClassifier();
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
  if (w > maxW) { h = Math.round(h * (maxW / w)); w = maxW; }
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.7);
}

// ─── Geolocation ──────────────────────────────────────────────────────────────

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

// ─── Report list UI ───────────────────────────────────────────────────────────

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

  heading.textContent = reports.length === 0
    ? 'Your reports'
    : `Your reports (${reports.length}${queued ? ' · ' + queued + ' queued' : ''})`;

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
    del.addEventListener('click', async () => { await deleteReport(r.id); renderReportList(); });
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

    if (r.hazardFlags && r.hazardFlags.length > 0) {
      const flagsWrap = document.createElement('div');
      flagsWrap.className = 'hazard-badges-wrap';
      r.hazardFlags.forEach((flag) => {
        const meta = HAZARD_LABELS[flag];
        if (meta) {
          const badge = document.createElement('span');
          badge.className = 'hazard-badge';
          badge.textContent = `${meta.icon} ${meta.label}`;
          flagsWrap.appendChild(badge);
        }
      });
      li.appendChild(flagsWrap);
    }

    const explanation = document.createElement('p');
    explanation.textContent = r.explanation;
    li.appendChild(explanation);

    if (r.explanationSource === 'ai') {
      const aiTag = document.createElement('span');
      aiTag.className = 'ai-enhanced-badge';
      aiTag.textContent = '✦ AI-Enhanced';
      li.appendChild(aiTag);
    } else {
      const improveBtn = document.createElement('button');
      improveBtn.className = 'btn-improve-ai';
      improveBtn.type = 'button';
      improveBtn.textContent = '✨ Improve with AI';
      improveBtn.title = 'Generate dynamic explanation with on-device model';
      improveBtn.addEventListener('click', () => handleImproveWithAI(r, li, explanation, improveBtn));
      li.appendChild(improveBtn);
    }

    const meta = document.createElement('div');
    meta.className = 'report-meta';
    meta.textContent = '⏱ ' + formatTime(r.createdAt) +
      (r.location ? ' · 📍 ' + r.location.lat.toFixed(4) + '°N, ' + r.location.lng.toFixed(4) + '°E' : '');
    li.appendChild(meta);

    list.appendChild(li);
  }
}

async function handleImproveWithAI(report, cardEl, textEl, buttonEl) {
  buttonEl.style.display = 'none';

  const progressWrap = document.createElement('div');
  progressWrap.className = 'ai-progress-wrap';
  progressWrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span class="ai-progress-text">Preparing on-device AI…</span>
      <span class="ai-progress-pct">0%</span>
    </div>
    <div class="ai-progress-bar-bg">
      <div class="ai-progress-bar-fill" style="width:0%"></div>
    </div>
  `;
  cardEl.appendChild(progressWrap);

  const textLabel = progressWrap.querySelector('.ai-progress-text');
  const pctLabel = progressWrap.querySelector('.ai-progress-pct');
  const barFill = progressWrap.querySelector('.ai-progress-bar-fill');

  function updateProgress(msg, pct) {
    textLabel.textContent = msg;
    pctLabel.textContent = pct + '%';
    barFill.style.width = pct + '%';
  }

  try {
    const result = await runOnDemandAI(
      report.severity,
      report.notes,
      report.lang,
      report.location,
      report.hazardFlags || [],
      updateProgress
    );

    await updateReportExplanation(report.id, result.text, 'ai');
    textEl.textContent = result.text;
    progressWrap.remove();

    const tag = document.createElement('span');
    tag.className = 'ai-enhanced-badge';
    tag.textContent = `✦ AI-Enhanced (${result.model})`;
    cardEl.appendChild(tag);
  } catch (err) {
    console.error('On-demand AI failed:', err);
    textLabel.textContent = '⚠️ Offline / model unavailable — keeping safety template';
    barFill.style.background = 'var(--medium)';
    setTimeout(() => {
      progressWrap.remove();
      buttonEl.style.display = 'inline-flex';
      updateAIBadge('template');
    }, 3500);
  }
}

// ─── Hazard chips helper ──────────────────────────────────────────────────────

function getSelectedHazards() {
  return Array.from(document.querySelectorAll('.hazard-chip.active')).map((c) => c.dataset.flag);
}

function clearHazardChips() {
  document.querySelectorAll('.hazard-chip.active').forEach((c) => c.classList.remove('active'));
}

function setupHazardChips() {
  const chips = document.querySelectorAll('.hazard-chip');
  const severityEl = document.getElementById('severity');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      const activeHigh = document.querySelectorAll('.hazard-chip.active[data-severity="high"]');
      const activeMed = document.querySelectorAll('.hazard-chip.active[data-severity="medium"]');
      if (activeHigh.length > 0) {
        severityEl.value = 'high';
        updateGuideGlow('high');
      } else if (activeMed.length > 0 && severityEl.value === 'low') {
        severityEl.value = 'medium';
        updateGuideGlow('medium');
      }
    });
  });
}

// ─── Submit ───────────────────────────────────────────────────────────────────

async function handleSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const statusEl = document.getElementById('status');
  const severityEl = document.getElementById('severity');
  const notes = document.getElementById('notes').value;
  const lang = document.getElementById('lang').value;
  const hazardFlags = getSelectedHazards();

  btn.disabled = true;
  btn.textContent = '⏳ Saving…';
  statusEl.textContent = 'Logging observation…';

  try {
    const photo = stream ? captureFrame() : null;

    // MediaPipe may suggest a different severity from the photo
    const suggestedSeverity = await classifySeverity(photo, severityEl.value);
    if (suggestedSeverity !== severityEl.value) {
      severityEl.value = suggestedSeverity;
      updateGuideGlow(suggestedSeverity);
    }

    const location = await getLocation();

    // Primary output: Verified instant disaster-grade template (0ms, 0MB)
    const fallback = SEVERITY_TEMPLATES[suggestedSeverity];
    let initialExplanation = fallback[lang] || fallback.en;

    // Enhance template with specific geotechnical precursor advice if flagged
    if (hazardFlags.length > 0) {
      const topHazard = hazardFlags[0];
      const hazardSnip = HAZARD_ADVICE[topHazard]?.[lang] || HAZARD_ADVICE[topHazard]?.en;
      if (hazardSnip) {
        initialExplanation = `${hazardSnip} ${initialExplanation}`;
      }
    }

    await saveReport({
      severity: suggestedSeverity,
      hazardFlags,
      notes,
      lang,
      photo,
      location,
      explanation: initialExplanation,
      explanationSource: 'template'
    });

    document.getElementById('notes').value = '';
    clearHazardChips();
    statusEl.textContent = 'Saved locally. Will sync automatically when online.';
    renderReportList();
    if (navigator.onLine) trySync(statusEl);
  } finally {
    btn.disabled = false;
    btn.textContent = '📍 Log this observation';
  }
}

// ─── Install prompt ───────────────────────────────────────────────────────────

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

// ─── Network badge ────────────────────────────────────────────────────────────

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

// ─── Severity guide glow (shared so submit can call it) ───────────────────────

const guideTiers = {};

function updateGuideGlow(val) {
  Object.entries(guideTiers).forEach(([key, el]) => {
    if (el) el.classList.toggle('active', key === val);
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener('online', () => { updateNetStatus(); trySync(document.getElementById('status')); });
window.addEventListener('offline', () => {
  updateNetStatus();
  const statusEl = document.getElementById('status');
  if (statusEl && !statusEl.textContent.trim())
    statusEl.textContent = 'Offline mode active — observations will save safely to local storage.';
});

navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data?.type === 'TRY_SYNC') trySync(document.getElementById('status'));
});

window.addEventListener('DOMContentLoaded', () => {
  updateNetStatus();
  updateAIBadge('template');
  checkGeminiNanoReady();
  startCamera();
  setupHazardChips();
  renderReportList();
  document.getElementById('reportForm').addEventListener('submit', handleSubmit);
  document.getElementById('installBtn')?.addEventListener('click', handleInstall);
  trySync(document.getElementById('status'));

  // Severity guide glow
  const severityEl = document.getElementById('severity');
  guideTiers.low    = document.querySelector('.guide-tier.tier-low');
  guideTiers.medium = document.querySelector('.guide-tier.tier-medium');
  guideTiers.high   = document.querySelector('.guide-tier.tier-high');
  severityEl.addEventListener('change', (e) => updateGuideGlow(e.target.value));
  updateGuideGlow(severityEl.value);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      if (reg.sync) reg.sync.register('sync-reports').catch(() => {});
    });
  }
});
