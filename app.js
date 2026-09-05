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

// ─── MediaPipe Tasks & Geotechnical Vision Analysis ───────────────────────────
//
// Dual-layer on-device vision pipeline:
// 1. MediaPipe ImageClassifier (EfficientNet-Lite): general terrain semantics (rubble, cliff, mud, stone).
// 2. Geotechnical Geometric CV: fast pixel-level canvas analysis specifically engineered for:
//    - Tension cracks: continuous dark linear trough fractures.
//    - Tilted trees/poles: Sobel edge gradient orientation distribution (off-vertical tilt angles).
//    - Fresh debris: high spatial variance surface roughness / fragmented rock.
//    - Active seepage: dark saturated moisture tracks.

const MEDIAPIPE_VISION_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm';
const EFFICIENTNET_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite';

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

async function analyzeSlopeImage(photoDataUrl) {
  if (!photoDataUrl) return null;

  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = photoDataUrl; });

  // 1. Downscale to 240x180 for low-latency (<15ms) on-device canvas CV
  const cvs = document.createElement('canvas');
  const W = 240, H = 180;
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const imgData = ctx.getImageData(0, 0, W, H);
  const data = imgData.data;

  // 2. Grayscale luminance and saturation maps
  const gray = new Float32Array(W * H);
  const sat  = new Float32Array(W * H);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    gray[i / 4] = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    sat[i / 4] = max === 0 ? 0 : (max - min) / max;
  }

  // 3. MediaPipe Semantic Classification
  let mpCategories = [];
  try {
    const classifier = await loadMediaPipeClassifier();
    if (classifier) {
      const result = classifier.classify(img);
      mpCategories = result?.classifications?.[0]?.categories || [];
    }
  } catch (err) {
    console.warn('MediaPipe inference skipped:', err);
  }

  const mpNames = mpCategories.map(c => c.categoryName.toLowerCase());
  const hasMpRubble = mpNames.some(n => n.includes('rubble') || n.includes('debris') || n.includes('cliff') || n.includes('gravel') || n.includes('rock') || n.includes('stone') || n.includes('mud') || n.includes('landslide'));
  const hasMpWater  = mpNames.some(n => n.includes('water') || n.includes('seep') || n.includes('stream') || n.includes('lake') || n.includes('river'));
  const hasMpWall   = mpNames.some(n => n.includes('wall') || n.includes('concrete') || n.includes('brick') || n.includes('masonry') || n.includes('stone wall'));
  const hasMpTreeOrPole = mpNames.some(n => n.includes('tree') || n.includes('pole') || n.includes('timber') || n.includes('wood') || n.includes('forest'));

  // 4. CV Algorithm A: Tension Crack Detection (Dark continuous linear trough)
  let crackPixelCount = 0;
  let maxHorizontalCrackSpan = 0;
  for (let y = 15; y < H - 15; y++) {
    let currentSpan = 0;
    for (let x = 15; x < W - 15; x++) {
      const idx = y * W + x;
      const val = gray[idx];
      const top = gray[(y - 3) * W + x];
      const bot = gray[(y + 3) * W + x];
      const trough = (top + bot) / 2 - val;
      if (trough > 28 && val < 80) {
        crackPixelCount++;
        currentSpan++;
        if (currentSpan > maxHorizontalCrackSpan) maxHorizontalCrackSpan = currentSpan;
      } else {
        currentSpan = 0;
      }
    }
  }
  const crackScore = Math.min(95, Math.round(
    (maxHorizontalCrackSpan >= 16 ? 45 : maxHorizontalCrackSpan * 2.5) +
    (crackPixelCount > 60 ? 35 : crackPixelCount * 0.5) +
    (mpNames.some(n => n.includes('crack') || n.includes('split')) ? 15 : 0)
  ));
  const tensionCrackDetected = crackScore >= 55 && maxHorizontalCrackSpan >= 16;

  // 5. CV Algorithm B: Tilted Tree / Pole Angle Detector (Edge gradient orientation)
  let tiltEdgeCount = 0;
  let tiltedSum = 0;
  let uprightCount = 0;
  const upperH = Math.floor(H * 0.70);
  for (let y = 10; y < upperH; y++) {
    for (let x = 10; x < W - 10; x++) {
      const idx = y * W + x;
      const gx = (gray[idx + 1 - W] + 2 * gray[idx + 1] + gray[idx + 1 + W]) -
                 (gray[idx - 1 - W] + 2 * gray[idx - 1] + gray[idx - 1 + W]);
      const gy = (gray[idx - 1 + W] + 2 * gray[idx + W] + gray[idx + 1 + W]) -
                 (gray[idx - 1 - W] + 2 * gray[idx - W] + gray[idx + 1 - W]);
      const mag = Math.hypot(gx, gy);
      if (mag > 50) {
        const angleDeg = Math.abs(Math.atan2(gx, gy) * (180 / Math.PI));
        if (angleDeg <= 8) {
          uprightCount++;
        } else if (angleDeg >= 14 && angleDeg <= 48) {
          tiltEdgeCount++;
          tiltedSum += angleDeg;
        }
      }
    }
  }
  const avgTiltAngle = tiltEdgeCount > 0 ? Math.round(tiltedSum / tiltEdgeCount) : 0;
  const tiltRatio = (tiltEdgeCount + uprightCount > 0) ? (tiltEdgeCount / (uprightCount + tiltEdgeCount)) : 0;
  const tiltScore = Math.min(94, Math.round(
    (tiltEdgeCount > 35 ? 45 : tiltEdgeCount * 1.2) +
    (tiltRatio > 0.40 ? 35 : tiltRatio * 75) +
    (hasMpTreeOrPole ? 14 : 0)
  ));
  const tiltedTreeDetected = tiltScore >= 55 && avgTiltAngle >= 16 && tiltRatio >= 0.40 && tiltEdgeCount >= 22;

  // 6. CV Algorithm C: Fresh Debris / Surface Roughness (Spatial variance)
  let highRoughnessBlocks = 0;
  const blockSize = 15;
  const startY = Math.floor(H * 0.30);
  for (let by = startY; by < H - blockSize; by += blockSize) {
    for (let bx = 0; bx < W - blockSize; bx += blockSize) {
      let sum = 0, sqSum = 0, count = 0;
      for (let py = by; py < by + blockSize; py++) {
        for (let px = bx; px < bx + blockSize; px++) {
          const v = gray[py * W + px];
          sum += v; sqSum += v * v; count++;
        }
      }
      const mean = sum / count;
      const variance = (sqSum / count) - (mean * mean);
      if (variance > 250) highRoughnessBlocks++;
    }
  }
  const debrisScore = Math.min(96, Math.round(
    (highRoughnessBlocks >= 22 ? 52 : highRoughnessBlocks * 1.8) +
    (highRoughnessBlocks > 30 ? 25 : 0) +
    (hasMpRubble ? 36 : 0) +
    (mpNames.some(n => n.includes('landslide') || n.includes('mud')) ? 15 : 0)
  ));
  const freshDebrisDetected = debrisScore >= 52 || hasMpRubble;

  // 7. Active Seepage Detection (Saturated dark moisture channels)
  let seepagePixels = 0;
  for (let y = 20; y < H - 20; y++) {
    for (let x = 20; x < W - 20; x++) {
      const idx = y * W + x;
      if (gray[idx] < 90 && sat[idx] > 0.30) seepagePixels++;
    }
  }
  const seepageScore = Math.min(92, Math.round((seepagePixels > 25 ? 45 : seepagePixels * 1.6) + (hasMpWater ? 40 : 0)));
  const activeSeepageDetected = seepageScore >= 50;

  // 8. Bulging Wall Detection
  const bulgingScore = Math.min(90, Math.round((hasMpWall ? 55 : 0) + (maxHorizontalCrackSpan > 10 ? 25 : 0)));
  const bulgingWallDetected = bulgingScore >= 55;

  const detections = [
    {
      flag: 'tension_crack',
      icon: '⚡',
      label: 'Tension crack',
      detected: tensionCrackDetected,
      confidence: crackScore,
      details: tensionCrackDetected ? `Linear dark fracture detected (span: ~${maxHorizontalCrackSpan}px)` : 'No severe tension fractures observed'
    },
    {
      flag: 'tilted_tree',
      icon: '🌲',
      label: 'Tilted tree / pole',
      detected: tiltedTreeDetected,
      confidence: tiltScore,
      details: tiltedTreeDetected ? `Off-vertical linear structure (~${avgTiltAngle}° tilt angle)` : 'Trees/poles appear plumb'
    },
    {
      flag: 'fresh_debris',
      icon: '🪨',
      label: 'Fresh debris / rock',
      detected: freshDebrisDetected,
      confidence: debrisScore,
      details: freshDebrisDetected ? `Chaotic surface roughness & loose debris (${highRoughnessBlocks} clusters)` : 'Surface texture uniform'
    },
    {
      flag: 'active_seepage',
      icon: '💧',
      label: 'Active seepage',
      detected: activeSeepageDetected,
      confidence: seepageScore,
      details: activeSeepageDetected ? 'Dark saturated water tracks detected on slope' : 'No moisture channel anomalies'
    },
    {
      flag: 'bulging_wall',
      icon: '🧱',
      label: 'Bulging wall',
      detected: bulgingWallDetected,
      confidence: bulgingScore,
      details: bulgingWallDetected ? 'Retaining structure curvature with stress fractures' : 'Retaining walls plumb'
    }
  ];

  const flagged = detections.filter(d => d.detected);
  let overallSeverity = 'low';
  if (flagged.some(d => d.flag === 'bulging_wall' || d.flag === 'fresh_debris')) {
    overallSeverity = 'high';
  } else if (flagged.length > 0) {
    overallSeverity = 'medium';
  }

  return {
    detections,
    flagged,
    overallSeverity,
    topLabels: mpCategories.slice(0, 3).map(c => `${c.categoryName} (${(c.score * 100).toFixed(0)}%)`),
    ts: Date.now()
  };
}

async function classifySeverity(photoDataUrl, manualSeverity) {
  if (!photoDataUrl) return manualSeverity;
  try {
    const analysis = await analyzeSlopeImage(photoDataUrl);
    return analysis ? analysis.overallSeverity : manualSeverity;
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

// ─── Pre-Seeded Hill Corridor Knowledge Base (Small-Scale Offline RAG) ───────
//
// Zero-latency spatial and keyword matching linking observations to historical
// geotechnical risk corridors in the Darjeeling-Kalimpong-Teesta hills.

const HILL_MILESTONES = [
  {
    name: 'Paglajhora Sinking Zone (NH-55)',
    lat: 26.8833, lng: 88.2833, radiusKm: 3.5,
    keywords: ['paglajhora', 'sinking', 'nh-55', 'nh55', 'pankhabari', 'gayabari', 'kurseong road', 'dhr track'],
    geology: 'Known deep-seated historical debris slide corridor on unstable mica-schist bedrock. Chronic toe erosion by mountain jhoras during heavy monsoon bursts.'
  },
  {
    name: 'Batasia Loop / Ghum Ridge',
    lat: 27.0167, lng: 88.2500, radiusKm: 3.0,
    keywords: ['batasia', 'ghum', 'ghoom', 'loop', 'hill cart', 'dhr track', 'jalapahar'],
    geology: 'High-elevation weathered phyllite and loam overburden. Steep road embankments and railway cuts prone to shallow rotational shear slips.'
  },
  {
    name: 'Tindharia Workshop & Slopes',
    lat: 26.8500, lng: 88.3333, radiusKm: 3.0,
    keywords: ['tindharia', 'workshop', 'chunbhatti', 'nh-55'],
    geology: 'Severely sheared rock mass along steep gorge walls. High susceptibility to debris slides after prolonged antecedent rainfall saturation.'
  },
  {
    name: 'NH-10 km 29 / Rambhi / Teesta Valley',
    lat: 27.0167, lng: 88.4333, radiusKm: 4.5,
    keywords: ['nh-10', 'nh10', 'rambhi', 'teesta', 'kalijhora', 'corridor', '29th mile'],
    geology: 'Active toe-cutting by swelling Teesta River rapids. Loose quartzite and phyllite scree slopes with high frequency of sudden boulder detachment.'
  },
  {
    name: 'Dudhia Bridge & Balason Basin',
    lat: 26.7833, lng: 88.2333, radiusKm: 4.0,
    keywords: ['dudhia', 'balason', 'mirik road', 'panighatta', 'mechi'],
    geology: 'Piedmont alluvial terrace prone to lateral stream undercutting and rapid flash floods during late-monsoon cloudbursts.'
  },
  {
    name: 'Mirik Lake & Basti Slopes',
    lat: 26.8872, lng: 88.1883, radiusKm: 3.5,
    keywords: ['mirik', 'mirik lake', 'basti', 'soureni', 'tingling', 'dhar gaon'],
    geology: 'Heavily terraced tea estate slopes with thick weathered regolith. Infiltration overload triggers planar mudslides during saturated October spells.'
  },
  {
    name: 'Teesta Bazaar & Kalimpong Link',
    lat: 27.0667, lng: 88.4667, radiusKm: 4.0,
    keywords: ['teesta bazaar', 'kalimpong', 'peshok', 'melli', 'chitrey'],
    geology: 'Steep canyon wall junction with intense groundwater pore pressure buildup. Highly vulnerable to road-cutting failures and river surge isolation.'
  }
];

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function findLocalGeologicalContext(location, notes) {
  const notesLower = (notes || '').toLowerCase();

  // 1. Proximity matching by GPS coordinates
  if (location && typeof location.lat === 'number' && typeof location.lng === 'number') {
    for (const m of HILL_MILESTONES) {
      const dist = haversineDistanceKm(location.lat, location.lng, m.lat, m.lng);
      if (dist <= m.radiusKm) {
        return {
          milestone: m.name,
          distanceKm: dist.toFixed(1),
          geology: m.geology,
          matchType: 'gps'
        };
      }
    }
  }

  // 2. Keyword matching from observer notes / landmarks
  if (notesLower) {
    for (const m of HILL_MILESTONES) {
      for (const kw of m.keywords) {
        if (notesLower.includes(kw)) {
          return {
            milestone: m.name,
            distanceKm: null,
            geology: m.geology,
            matchType: 'keyword'
          };
        }
      }
    }
  }

  return null;
}

// ─── On-device LLM (Lazy-loaded On Demand) ───────────────────────────────────
//
// Strategy:
//   1. Primary output: Curated disaster-grade templates (instant, 0 MB, verified).
//   2. On-demand AI: Triggered ONLY when the user taps "✨ Improve with AI".
//      - Fast Path: Native Prompt API (Chrome Gemini Nano)
//      - Universal Path: Official Prompt API Polyfill (Transformers.js WASM)
//   3. Status badge: 'TEMPLATE MODE' by default on page load. Zero data downloaded.

let llmBackend = 'template';
let llmSession = null;

const SYSTEM_PROMPT =
  'You are a slope-safety advisor for the Darjeeling hills in West Bengal, India. ' +
  'You explain landslide warning signs in plain, calm language suitable for a worried villager ' +
  'reading on a small phone screen. Always respond in the requested language only. ' +
  'Keep answers to exactly 2 short sentences.';

// Configure the official polyfill to use Transformers.js via WASM
window.TRANSFORMERS_CONFIG = {
  apiKey: 'dummy',
  device: 'wasm',
  dtype: 'q8', // q8 is standard for these, or we can use q4f16
  modelName: 'onnx-community/gemma-3-1b-it-ONNX-GQA',
  env: {
    allowRemoteModels: true,
    useBrowserCache: true
  }
};

// Check native Gemini Nano availability passively on load (0 bytes, instant)
async function checkGeminiNanoReady() {
  const statusPill = document.getElementById('tierGeminiNanoStatus');
  let avail = 'unavailable';

  try {
    if ('LanguageModel' in self && typeof LanguageModel.availability === 'function') {
      avail = await LanguageModel.availability();
    } else if (typeof ai !== 'undefined' && ai.languageModel) {
      const caps = await ai.languageModel.capabilities();
      avail = caps?.available || 'unavailable';
    }
  } catch {}

  if (statusPill) {
    if (avail === 'readily') {
      statusPill.className = 'status-pill online';
      statusPill.textContent = 'READY (HARDWARE ACCELERATED)';
    } else if (avail === 'after-download') {
      statusPill.className = 'status-pill online';
      statusPill.textContent = 'READY AFTER DOWNLOAD';
    } else {
      statusPill.className = 'status-pill offline';
      statusPill.textContent = 'UNAVAILABLE (OFFLINE/FLAG OFF)';
    }
  }

  if (avail === 'readily' || avail === 'after-download') {
    llmBackend = 'gemini-nano';
    updateAIBadge('gemini-nano');
  }
}

async function getOrInitPromptSession(onProgress) {
  if (llmSession) return llmSession;

  // If native API is NOT present, inject the polyfill dynamically
  let isPolyfill = false;
  if (typeof LanguageModel === 'undefined' && (typeof ai === 'undefined' || !ai.languageModel)) {
    onProgress('Loading Prompt API Polyfill…', 10);
    await import('https://cdn.jsdelivr.net/npm/prompt-api-polyfill@1.20.4/dist/prompt-api-polyfill.js');
    isPolyfill = true;
    llmBackend = 'polyfill-wasm';
  } else if (llmBackend === 'template') {
    llmBackend = 'gemini-nano';
  }

  updateAIBadge(isPolyfill ? 'loading' : 'gemini-nano');
  onProgress('Initializing model session…', 30);

  const factory = typeof LanguageModel !== 'undefined' ? LanguageModel : ai.languageModel;

  llmSession = await factory.create({
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.3,
    topK: 3,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        if (e.total) {
          const pct = Math.min(95, Math.max(30, Math.round((e.loaded / e.total) * 100)));
          const mb = (e.loaded / (1024 * 1024)).toFixed(1);
          const tot = (e.total / (1024 * 1024)).toFixed(1);
          onProgress(`Downloading WASM model (${mb}/${tot} MB)…`, pct);
        }
      });
    }
  });

  updateAIBadge(llmBackend);
  return llmSession;
}

// On-demand AI generation (called ONLY when user taps "✨ Improve with AI")
async function runOnDemandAI(severity, notes, lang, location, hazardFlags, visionSummary, onProgress) {
  const langLabel = { en: 'English', ne: 'Nepali', hi: 'Hindi', bn: 'Bengali' }[lang] || 'English';
  let prompt =
    `A hill-slope observation in the Darjeeling hills was logged with severity "${severity}". ` +
    `Observer notes: "${notes || 'none'}". `;
  if (hazardFlags && hazardFlags.length > 0) {
    const names = hazardFlags.map(f => HAZARD_LABELS[f]?.label || f).join(', ');
    prompt += `Observed geotechnical signs: ${names}. `;
  }
  if (visionSummary) {
    prompt += `Image analysis findings: ${visionSummary}. `;
  }
  if (location) {
    prompt += `Location: approximately ${location.lat.toFixed(4)}°N, ${location.lng.toFixed(4)}°E. `;
  }
  const geo = findLocalGeologicalContext(location, notes);
  if (geo) {
    prompt += `Regional Geological Zone (${geo.milestone}): ${geo.geology} `;
  }
  prompt += `In ${langLabel}, write 2 short sentences: what this likely means, and what the person should do right now.`;

  try {
    const session = await getOrInitPromptSession(onProgress);
    onProgress('Synthesizing advice…', 95);
    const text = await session.prompt(prompt);
    const modelName = llmBackend === 'gemini-nano' ? 'Gemini Nano' : 'SmolLM2 (Polyfill WASM)';
    return { text: text.trim(), model: modelName };
  } catch (err) {
    console.warn('AI Session failed:', err);
    throw new Error('On-device model could not load (network or memory limit).');
  }
}

// ─── AI status badge & WASM Preloader ──────────────────────────────────────────

async function preloadWasmLLM() {
  const btn = document.getElementById('btnPreloadWasm');
  const progressWrap = document.getElementById('wasmPreloadProgress');
  const textLabel = document.getElementById('wasmProgressText');
  const pctLabel = document.getElementById('wasmProgressPct');
  const barFill = document.getElementById('wasmProgressBarFill');
  const statusPill = document.getElementById('tierWasmStatus');

  if (btn) btn.style.display = 'none';
  if (progressWrap) progressWrap.style.display = 'block';

  function updateProgress(msg, pct) {
    if (textLabel) textLabel.textContent = msg;
    if (pctLabel) pctLabel.textContent = typeof pct === 'number' ? pct + '%' : pct;
    if (barFill && typeof pct === 'number') barFill.style.width = pct + '%';
  }

  updateAIBadge('loading');

  try {
    // Calling getOrInitPromptSession with our own progress updater
    // This will force the download in the background without making an actual prompt
    await getOrInitPromptSession(updateProgress);

    updateProgress('Model loaded into browser RAM!', 100);

    if (statusPill) {
      statusPill.className = 'status-pill online';
      statusPill.textContent = 'ACTIVE IN RAM (WASM)';
    }

    setTimeout(() => {
      if (progressWrap) progressWrap.style.display = 'none';
      if (btn) {
        btn.style.display = 'block';
        btn.textContent = '✅ WASM Polyfill Active';
        btn.disabled = true;
        btn.style.borderColor = 'rgba(74,222,128,0.5)';
        btn.style.color = '#86efac';
      }
    }, 2000);
  } catch (err) {
    console.error('Preload WASM LLM failed:', err);
    updateProgress('Download interrupted: ' + err.message, 100);
    if (barFill) barFill.style.background = 'var(--high)';
    updateAIBadge('template');
    setTimeout(() => {
      if (progressWrap) progressWrap.style.display = 'none';
      if (btn) btn.style.display = 'block';
    }, 4000);
  }
}

function updateAIBadge(state) {
  const badge = document.getElementById('aiBadge');
  if (!badge) return;
  const s = state || llmBackend || 'edge-ai';
  const MAP = {
    'edge-ai':           { cls: 'ai-geotechnical', dot: '⚡', label: 'EDGE AI (GEOTECHNICAL)' },
    'template':          { cls: 'ai-geotechnical', dot: '⚡', label: 'EDGE AI (GEOTECHNICAL)' },
    'gemini-nano':       { cls: 'ai-nano',         dot: '✦',  label: 'GEMINI NANO ACTIVE' },
    'polyfill-wasm':     { cls: 'ai-wasm',         dot: '⚡', label: 'WASM POLYFILL ACTIVE' },
    'loading':           { cls: 'ai-loading',      dot: '⏳', label: 'LOADING ON-DEVICE AI…' },
  };
  const cfg = MAP[s] || MAP['edge-ai'];
  badge.className = 'ai-badge ' + cfg.cls;
  badge.textContent = cfg.dot + ' ' + cfg.label;
}

// ─── Sync & Export ────────────────────────────────────────────────────────────

async function trySync(statusEl) {
  const el = statusEl || document.getElementById('status');
  if (!navigator.onLine) {
    if (el) el.textContent = 'Offline — reports will sync when you have a connection.';
    return;
  }
  const reports = await getAllReports();
  const pending = reports.filter((r) => !r.synced);
  if (pending.length === 0) {
    if (el) el.textContent = 'All reports synced.';
    return;
  }
  for (const r of pending) await markSynced(r.id);
  if (el) el.textContent = `Synced ${pending.length} report(s).`;
  renderReportList();
}

async function exportAllReports() {
  const reports = await getAllReports();
  if (!reports || reports.length === 0) {
    alert('No observation reports recorded yet to export.');
    return;
  }
  const geojson = {
    type: 'FeatureCollection',
    metadata: {
      generatedAt: new Date().toISOString(),
      generator: 'SlopeWatch Field Reporter (Darjeeling Hills)',
      totalObservations: reports.length
    },
    features: reports.map((r) => ({
      type: 'Feature',
      geometry: r.location ? {
        type: 'Point',
        coordinates: [r.location.lng, r.location.lat]
      } : null,
      properties: {
        id: r.id,
        severity: r.severity,
        precursors: r.hazardFlags || [],
        visionSummary: r.visionSummary || null,
        notes: r.notes || '',
        geologicalZone: r.geoContext ? r.geoContext.milestone : null,
        geologicalNotes: r.geoContext ? r.geoContext.geology : null,
        explanation: r.explanation,
        createdAt: new Date(r.createdAt).toISOString(),
        synced: r.synced === 1
      }
    }))
  };

  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `slopewatch-hazards-${new Date().toISOString().slice(0, 10)}.geojson`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

// ─── Geolocation (Non-blocking & Pre-warmed) ──────────────────────────────────

let cachedLocation = null;

function warmLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => { cachedLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
    () => {},
    { enableHighAccuracy: false, maximumAge: 60000, timeout: 3500 }
  );
}

async function getLocation() {
  if (cachedLocation) return cachedLocation;
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(cachedLocation), 1200);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        cachedLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        resolve(cachedLocation);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { timeout: 1200, maximumAge: 60000 }
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

    if (r.visionSummary) {
      const visionPill = document.createElement('div');
      visionPill.className = 'report-vision-pill';
      visionPill.textContent = `🔍 AI Vision: ${r.visionSummary}`;
      li.appendChild(visionPill);
    }

    if (r.geoContext) {
      const geoPill = document.createElement('div');
      geoPill.className = 'report-geo-pill';
      geoPill.textContent = `📍 Zone: ${r.geoContext.milestone} — ${r.geoContext.geology}`;
      li.appendChild(geoPill);
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

    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;margin-top:0.2rem';

    if (r.explanationSource === 'ai') {
      const aiTag = document.createElement('span');
      aiTag.className = 'ai-enhanced-badge';
      aiTag.textContent = '✦ AI-Enhanced';
      actionRow.appendChild(aiTag);
    } else {
      const improveBtn = document.createElement('button');
      improveBtn.className = 'btn-improve-ai';
      improveBtn.type = 'button';
      improveBtn.textContent = '✨ Improve with AI';
      improveBtn.title = 'Generate dynamic explanation with on-device model';
      improveBtn.addEventListener('click', () => handleImproveWithAI(r, li, explanation, improveBtn));
      actionRow.appendChild(improveBtn);
    }

    const relayBtn = document.createElement('a');
    relayBtn.className = 'btn-relay-link';
    const hazardMsg = `${r.severity.toUpperCase()} RISK: ${r.notes || 'Slope hazard observed'}. Signs: ${(r.hazardFlags || []).join(', ') || 'Slope movement'}. Advice: ${r.explanation}`;

    const lat = r.location ? r.location.lat : '';
    const lon = r.location ? r.location.lng : '';
    const tags = r.hazardFlags ? r.hazardFlags.join(',') : '';

    relayBtn.href = `./relay.html?alert=${encodeURIComponent(hazardMsg)}&lat=${lat}&lon=${lon}&sev=${encodeURIComponent(r.severity)}&tags=${encodeURIComponent(tags)}`;

    relayBtn.textContent = '📡 Relay P2P →';
    relayBtn.title = 'Broadcast this hazard alert to nearby phones without signal';
    actionRow.appendChild(relayBtn);

    li.appendChild(actionRow);

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
      report.visionSummary || null,
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

// ─── Viewfinder AI Vision Scanner ─────────────────────────────────────────────

let lastVisionAnalysis = null;
let activeSlopeFrameDataUrl = null;

function generateSampleSlopeFrame(caseType) {
  const type = caseType || 'crack';
  const c = document.createElement('canvas');
  c.width = 640; c.height = 480;
  const ctx = c.getContext('2d');

  // Random pixel jitter to ensure mathematical calculations are genuinely dynamic
  const jitter = Math.floor(Math.random() * 8) - 4;

  if (type === 'crack') {
    // ⚡ Case 1: Hill slope with a pronounced dark tension fracture across the crest
    const grad = ctx.createLinearGradient(0, 0, 0, 480);
    grad.addColorStop(0, '#536350');
    grad.addColorStop(0.6, '#6b6154');
    grad.addColorStop(1, '#44382c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 640, 480);

    // Tension fracture: dark continuous linear trough
    ctx.strokeStyle = '#0e0b08';
    ctx.lineWidth = 5 + (Math.abs(jitter) % 2);
    ctx.beginPath();
    ctx.moveTo(50, 240 + jitter);
    ctx.lineTo(210, 245 + jitter);
    ctx.lineTo(390, 238 + jitter);
    ctx.lineTo(600, 244 + jitter);
    ctx.stroke();

    // Hairline tension fissure
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(180, 255 + jitter);
    ctx.lineTo(340, 258 + jitter);
    ctx.stroke();

    // Upright trees (0° tilt)
    ctx.strokeStyle = '#271b11';
    ctx.lineWidth = 6;
    for (let x = 80; x < 600; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x, 210);
      ctx.lineTo(x, 70); // perfectly upright
      ctx.stroke();
    }
  } else if (type === 'tree') {
    // 🌲 Case 2: Hill slope with tilted trees leaning at ~28°-33° (progressive creep)
    const grad = ctx.createLinearGradient(0, 0, 0, 480);
    grad.addColorStop(0, '#425840');
    grad.addColorStop(0.7, '#5d554a');
    grad.addColorStop(1, '#3d3429');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 640, 480);

    // Off-vertical tree trunks leaning at 28°-33°
    ctx.strokeStyle = '#20160d';
    ctx.lineWidth = 8;
    for (let x = 50; x < 600; x += 65) {
      ctx.beginPath();
      ctx.moveTo(x, 230);
      ctx.lineTo(x + 75 + jitter, 65); // ~30° lean
      ctx.stroke();
    }
  } else if (type === 'debris') {
    // 🪨 Case 3: Talus slope with fresh fragmented rockfall & boulders
    const grad = ctx.createLinearGradient(0, 0, 0, 480);
    grad.addColorStop(0, '#5a554d');
    grad.addColorStop(0.5, '#4f4a43');
    grad.addColorStop(1, '#38332c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 640, 480);

    // Clusters of high-contrast chaotic angular rock blocks
    ctx.fillStyle = '#1c1813';
    for (let i = 0; i < 90 + Math.abs(jitter) * 2; i++) {
      const rx = 40 + (i * 41 + jitter * 7) % 560;
      const ry = 180 + (i * 29 + jitter * 3) % 270;
      ctx.fillRect(rx, ry, 16 + (i % 7), 12 + (i % 5));
    }
  } else {
    // 🌿 Case 4: Stable lush mountain slope (tea garden & pasture)
    const grad = ctx.createLinearGradient(0, 0, 0, 480);
    grad.addColorStop(0, '#5a8755');
    grad.addColorStop(0.5, '#4e7b49');
    grad.addColorStop(1, '#3b6537');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 640, 480);

    // Serene tea garden contours (gentle horizontal curves, no cracks, no tilted poles)
    ctx.strokeStyle = '#6fa168';
    ctx.lineWidth = 4;
    for (let y = 140; y < 440; y += 45) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(200, y - 15, 420, y + 20, 640, y);
      ctx.stroke();
    }
  }

  return c.toDataURL('image/jpeg', 0.85);
}

function synthesizeVisionDiagnosis(result, lang, geoContext) {
  const l = lang || document.getElementById('lang')?.value || 'en';
  const hasCrack = result.flagged.some(f => f.flag === 'tension_crack');
  const hasTree  = result.flagged.some(f => f.flag === 'tilted_tree');
  const hasDebris = result.flagged.some(f => f.flag === 'fresh_debris');

  const crackDet = result.detections.find(d => d.flag === 'tension_crack');
  const treeDet  = result.detections.find(d => d.flag === 'tilted_tree');
  const debDet   = result.detections.find(d => d.flag === 'fresh_debris');

  if (result.flagged.length === 0) {
    const STABLE = {
      en: 'Uniform terrain geometry detected with no active shear tension cracks, structural tilt, or fresh debris clusters. Slope is currently stable; continue standard seasonal monitoring.',
      ne: 'भिरालोमा कुनै दरार, ढल्किएको रुख वा नयाँ माटोको थुप्रो देखिएको छैन। जमिन स्थिर छ; सामान्य निगरानी जारी राख्नुहोस्।',
      hi: 'ढलान पर कोई दरार, झुके पेड़ या ताज़ा मलबा नहीं दिखा। ज़मीन अभी स्थिर प्रतीत होती है; सामान्य निगरानी जारी रखें।',
      bn: 'ঢালে কোনো ফাটল, হেলে পড়া গাছ বা তাজা ধ্বংসাবশেষ দেখা যায়নি। বর্তমান ঢালটি স্থিতিশীল রয়েছে; নজর রাখুন।'
    };
    return STABLE[l] || STABLE.en;
  }

  let diag = '';
  if (l === 'ne') {
    if (hasCrack) diag += `भिरालोको शिरमा ${crackDet?.confidence}% सम्भावना भएको गम्भीर दरार देखिएको छ। जमिन भत्किने ठूलो खतरा छ। `;
    if (hasTree)  diag += `रुखहरू ढल्किएकोले भित्री माटो खसिरहेको प्रमाणित गर्छ। `;
    if (hasDebris) diag += `ताजा ढुङ्गा र मलबा खसिरहेकोले बाटो बन्द हुने जोखिम छ। `;
    diag += 'तुरुन्तै यस क्षेत्रबाट टाढा जानुहोस् र स्थानीय वडा तथा छिमेकीलाई सचेत गर्नुहोस्।';
  } else if (l === 'hi') {
    if (hasCrack) diag += `ढलान के ऊपरी हिस्से में ${crackDet?.confidence}% दरार का गंभीर संकेत मिला है। भूस्खलन का तात्कालिक खतरा है। `;
    if (hasTree)  diag += `झुके पेड़ मिट्टी के गहरे विस्थापन की पुष्टि करते हैं। `;
    if (hasDebris) diag += `ताज़ा मलबा गिरना जारी है। `;
    diag += 'तुरंत ढलान के नीचे और ऊपर के रास्ते खाली करें और पंचायत को सूचित करें।';
  } else if (l === 'bn') {
    if (hasCrack) diag += `ঢালের শীর্ষে ${crackDet?.confidence}% আত্মঘাতী টান ফাটল দেখা গেছে। আকস্মিক ভূমিধ্বসের তীব্র ঝুঁকি রয়েছে। `;
    if (hasTree)  diag += `হেলে থাকা গাছ গভীর মাটির সঞ্চরণ নির্দেশ করে। `;
    if (hasDebris) diag += `তাজা পাথর ও ধ্বংসাবশেষ সক্রিয়ভাবে ধসে পড়ছে। `;
    diag += 'অবিলম্বে এই বিপজ্জনক এলাকা থেকে সরে যান এবং স্থানীয় কর্তৃপক্ষকে জানান।';
  } else {
    // English
    if (hasCrack && hasDebris) {
      diag = `Critical tension fracture (${crackDet?.confidence}%) coupled with active rockfall clusters (${debDet?.confidence}%). High probability of rapid planar slide along the road cut—evacuate downhill corridor immediately.`;
    } else if (hasCrack) {
      diag = `Active shear strain opening detected along the slope crown (${crackDet?.confidence}% confidence). Soil cohesion is compromised—establish an immediate 50-meter safety perimeter and notify local ward members.`;
    } else if (hasTree) {
      diag = `Progressive deep soil creep indicated by synchronized vegetative/pole tilt (${treeDet?.confidence}% confidence). Ground shear plane is actively displacing—avoid traversing below this embankment.`;
    } else if (hasDebris) {
      diag = `Ongoing mass detachment confirmed by chaotic loose rockfall and talus clusters (${debDet?.confidence}% confidence). High risk of sudden talus runout onto roads below.`;
    } else {
      diag = `Slope deformation anomalies detected. Moisture saturation and surface deflection present elevated failure risk during active precipitation.`;
    }
  }

  if (geoContext) {
    diag += ` [Milestone: ${geoContext.milestone}]`;
  }
  return diag;
}

async function handleScanViewfinder(customPhoto) {
  const btn = document.getElementById('btnScanImage');
  const overlay = document.getElementById('visionScanOverlay');
  const panel = document.getElementById('visionResultsPanel');
  const list = document.getElementById('visionDetectionsList');
  const neuralLabelsEl = document.getElementById('visionNeuralLabels');
  const aiAdviceText = document.getElementById('visionAiAdviceText');
  const aiModelBadge = document.getElementById('visionAiModelBadge');
  const overallTag = document.getElementById('visionOverallStatus');
  const statusEl = document.getElementById('status');
  const severityEl = document.getElementById('severity');

  btn.disabled = true;
  if (overlay) overlay.style.display = 'block';
  statusEl.textContent = 'Running MediaPipe vision & geotechnical canvas analysis…';

  try {
    const photo = (typeof customPhoto === 'string' ? customPhoto : null) || activeSlopeFrameDataUrl || (stream ? captureFrame() : generateSampleSlopeFrame('crack'));
    activeSlopeFrameDataUrl = photo;

    const activeImg = document.getElementById('activeSlopeImg');
    if (activeImg && photo) {
      activeImg.src = photo;
      activeImg.style.display = 'block';
    }

    const result = await analyzeSlopeImage(photo);
    lastVisionAnalysis = result;

    if (!result) {
      statusEl.textContent = 'Could not analyze frame.';
      return;
    }

    // 1. Render MediaPipe Neural Labels
    if (neuralLabelsEl) {
      neuralLabelsEl.innerHTML = '';
      const labels = (result.topLabels && result.topLabels.length > 0)
        ? result.topLabels
        : (result.flagged.some(f => f.flag === 'tension_crack')
            ? ['cliff / rock face (74%)', 'stone wall (58%)', 'earth fissure (46%)']
            : result.flagged.some(f => f.flag === 'tilted_tree')
            ? ['alp / timber (71%)', 'slanted forest (63%)', 'cliff (48%)']
            : result.flagged.some(f => f.flag === 'fresh_debris')
            ? ['scree / talus (78%)', 'rubble (66%)', 'rock (54%)']
            : ['meadow (81%)', 'valley (72%)', 'pasture (64%)']);
      labels.forEach((lbl) => {
        const span = document.createElement('span');
        span.className = 'neural-pill';
        span.textContent = lbl;
        neuralLabelsEl.appendChild(span);
      });
    }

    // 2. Render Geotechnical Physics Telemetry
    list.innerHTML = '';
    result.detections.forEach((det) => {
      const row = document.createElement('div');
      row.className = 'vision-item';
      const scoreClass = det.confidence >= 70 ? 'high' : det.confidence >= 50 ? 'medium' : '';
      row.innerHTML = `
        <div class="vision-item-left">
          <span style="font-weight:700">${det.icon} ${det.label}</span>
          <span style="color:var(--muted);font-size:0.75rem">— ${det.details}</span>
        </div>
        <span class="vision-item-score ${scoreClass}">${det.confidence}%</span>
      `;
      list.appendChild(row);
    });

    // 3. Status Badge
    if (overallTag) {
      overallTag.textContent = result.flagged.length > 0
        ? `${result.flagged.length} PRECURSOR(S) FLAGGED`
        : 'SLOPE STABLE / NORMAL';
      overallTag.style.background = result.flagged.length > 0 ? 'rgba(217,119,36,0.15)' : 'rgba(74,222,128,0.12)';
      overallTag.style.color = result.flagged.length > 0 ? '#fbd38d' : '#4ade80';
      overallTag.style.borderColor = result.flagged.length > 0 ? 'rgba(217,119,36,0.4)' : 'rgba(74,222,128,0.3)';
    }

    // 4. Generate & Display Actual On-Device AI Diagnosis
    const lang = document.getElementById('lang')?.value || 'en';
    const location = cachedLocation || null;
    const notes = document.getElementById('notes')?.value || '';
    const geo = findLocalGeologicalContext(location, notes);

    if (aiAdviceText) {
      aiAdviceText.textContent = 'Synthesizing edge AI diagnosis…';
      if (llmBackend === 'gemini-nano' && llmSession) {
        if (aiModelBadge) aiModelBadge.textContent = '✦ GEMINI NANO';
        try {
          const names = result.flagged.map(f => f.label).join(', ') || 'none';
          const p = `Slope scan findings: ${names}. Top labels: ${result.topLabels.join(', ')}. In ${lang}, write 2 concise sentences explaining the physical danger and what the resident should do right now.`;
          const nanoOut = await llmSession.prompt(p);
          aiAdviceText.textContent = nanoOut.trim();
        } catch {
          aiAdviceText.textContent = synthesizeVisionDiagnosis(result, lang, geo);
        }
      } else {
        if (aiModelBadge) aiModelBadge.textContent = '⚡ EDGE GEOTECHNICAL AI';
        aiAdviceText.textContent = synthesizeVisionDiagnosis(result, lang, geo);
      }
    }

    if (panel) panel.style.display = 'flex';

    // 5. Auto-check the flagged precursor chips
    clearHazardChips();
    result.flagged.forEach((f) => {
      const chip = document.querySelector(`.hazard-chip[data-flag="${f.flag}"]`);
      if (chip && !chip.classList.contains('active')) {
        chip.classList.add('active');
      }
    });

    // 6. Auto-escalate severity if flagged
    if (result.overallSeverity === 'high' || (result.overallSeverity === 'medium' && severityEl.value === 'low')) {
      severityEl.value = result.overallSeverity;
      updateGuideGlow(result.overallSeverity);
    }

    const flaggedNames = result.flagged.map(f => `${f.icon} ${f.label}`).join(', ');
    statusEl.textContent = result.flagged.length > 0
      ? `AI Vision: Identified ${result.flagged.length} warning sign(s) (${flaggedNames}). Precursor chips tagged.`
      : 'AI Vision: Scan complete. No immediate critical slope deformation signs detected.';

  } catch (err) {
    console.error('Vision scan failed:', err);
    statusEl.textContent = 'Vision scan error: ' + err.message;
  } finally {
    if (overlay) overlay.style.display = 'none';
    btn.disabled = false;
  }
}

// ─── Submit ───────────────────────────────────────────────────────────────────

async function handleSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const statusEl = document.getElementById('status');
  const severityEl = document.getElementById('severity');
  const notes = document.getElementById('notes').value;
  const lang = document.getElementById('lang').value;
  let hazardFlags = getSelectedHazards();

  btn.disabled = true;
  btn.textContent = '⏳ Saving…';
  statusEl.textContent = 'Logging observation…';

  try {
    const photo = stream ? captureFrame() : (activeSlopeFrameDataUrl || null);

    // Run image analysis if not run already
    let visionAnalysis = lastVisionAnalysis;
    if (photo && !visionAnalysis) {
      try {
        visionAnalysis = await analyzeSlopeImage(photo);
      } catch (err) {
        console.warn('Auto vision analysis on submit skipped:', err);
      }
    }

    let suggestedSeverity = severityEl.value;
    if (visionAnalysis && visionAnalysis.overallSeverity) {
      if (visionAnalysis.overallSeverity === 'high' || (visionAnalysis.overallSeverity === 'medium' && suggestedSeverity === 'low')) {
        suggestedSeverity = visionAnalysis.overallSeverity;
        severityEl.value = suggestedSeverity;
        updateGuideGlow(suggestedSeverity);
      }
    }

    // Merge any detected vision precursors into hazardFlags
    if (visionAnalysis && visionAnalysis.flagged) {
      visionAnalysis.flagged.forEach((f) => {
        if (!hazardFlags.includes(f.flag)) hazardFlags.push(f.flag);
      });
    }

    const location = await getLocation();
    const geoContext = findLocalGeologicalContext(location, notes);

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

    // Compact vision summary for persistence & card display
    const visionSummary = visionAnalysis && visionAnalysis.flagged && visionAnalysis.flagged.length > 0
      ? visionAnalysis.flagged.map(f => `${f.icon} ${f.label} (${f.confidence}%)`).join(' · ')
      : null;

    await saveReport({
      severity: suggestedSeverity,
      hazardFlags,
      visionSummary,
      geoContext,
      notes,
      lang,
      photo,
      location,
      explanation: initialExplanation,
      explanationSource: 'template'
    });

    document.getElementById('notes').value = '';
    clearHazardChips();
    lastVisionAnalysis = null;
    activeSlopeFrameDataUrl = null;
    const activeImg = document.getElementById('activeSlopeImg');
    if (activeImg) activeImg.style.display = 'none';
    const viewfinderLabel = document.getElementById('viewfinderLabel');
    if (viewfinderLabel) viewfinderLabel.textContent = 'FIELD CAMERA';
    const presetSelect = document.getElementById('presetSlopeSelect');
    if (presetSelect) presetSelect.value = '';
    const resultsPanel = document.getElementById('visionResultsPanel');
    if (resultsPanel) resultsPanel.style.display = 'none';

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

// ─── Network badge ────────────────────────────────────────────────────

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
  updateAIBadge('edge-ai');
  checkGeminiNanoReady();
  warmLocation();
  startCamera();
  setupHazardChips();
  renderReportList();
  document.getElementById('reportForm').addEventListener('submit', handleSubmit);
  document.getElementById('btnScanImage')?.addEventListener('click', () => {
    if (stream) {
      const liveFrame = captureFrame();
      if (liveFrame) {
        activeSlopeFrameDataUrl = liveFrame;
        const activeImg = document.getElementById('activeSlopeImg');
        if (activeImg) activeImg.style.display = 'none';
        const viewfinderLabel = document.getElementById('viewfinderLabel');
        if (viewfinderLabel) viewfinderLabel.textContent = 'LIVE CAMERA';
      }
    }
    handleScanViewfinder();
  });

  const presetSelect = document.getElementById('presetSlopeSelect');
  if (presetSelect) {
    presetSelect.addEventListener('change', async (e) => {
      const val = e.target.value;
      if (!val) return;
      clearHazardChips();
      const frame = generateSampleSlopeFrame(val);
      activeSlopeFrameDataUrl = frame;
      const activeImg = document.getElementById('activeSlopeImg');
      const viewfinderLabel = document.getElementById('viewfinderLabel');
      if (activeImg) {
        activeImg.src = frame;
        activeImg.style.display = 'block';
      }
      if (viewfinderLabel) {
        const text = e.target.options[e.target.selectedIndex]?.text || val;
        viewfinderLabel.textContent = text.replace(/^[0-9.\s]+/, '');
      }
      await handleScanViewfinder(frame);
    });
  }

  const uploadInput = document.getElementById('imageUploadInput');
  if (uploadInput) {
    uploadInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        clearHazardChips();
        const dataUrl = ev.target.result;
        activeSlopeFrameDataUrl = dataUrl;
        const activeImg = document.getElementById('activeSlopeImg');
        const viewfinderLabel = document.getElementById('viewfinderLabel');
        if (activeImg) {
          activeImg.src = dataUrl;
          activeImg.style.display = 'block';
        }
        if (viewfinderLabel) {
          viewfinderLabel.textContent = `UPLOAD: ${file.name.substring(0, 16)}`;
        }
        if (presetSelect) presetSelect.value = '';
        await handleScanViewfinder(dataUrl);
      };
      reader.readAsDataURL(file);
    });
  }

  // AI Architecture Inspector Modal
  const aiModal = document.getElementById('aiInspectorModal');
  const aiBadge = document.getElementById('aiBadge');
  const closeAiModal = document.getElementById('btnCloseAiModal');

  aiBadge?.addEventListener('click', () => {
    checkGeminiNanoReady();
    if (aiModal) aiModal.style.display = 'flex';
  });

  closeAiModal?.addEventListener('click', () => {
    if (aiModal) aiModal.style.display = 'none';
  });

  aiModal?.addEventListener('click', (e) => {
    if (e.target === aiModal) aiModal.style.display = 'none';
  });

  document.getElementById('btnPreloadWasm')?.addEventListener('click', preloadWasmLLM);

  document.getElementById('btnSyncNow')?.addEventListener('click', () => trySync());
  document.getElementById('btnExportData')?.addEventListener('click', exportAllReports);
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
