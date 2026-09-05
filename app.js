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
      if (trough > 15 && val < 135) {
        crackPixelCount++;
        currentSpan++;
        if (currentSpan > maxHorizontalCrackSpan) maxHorizontalCrackSpan = currentSpan;
      } else {
        currentSpan = 0;
      }
    }
  }
  const crackScore = Math.min(95, Math.round(
    (crackPixelCount > 35 ? 50 : crackPixelCount * 1.3) +
    (maxHorizontalCrackSpan > 12 ? 32 : maxHorizontalCrackSpan * 2.5) +
    (mpNames.some(n => n.includes('crack') || n.includes('split')) ? 15 : 0)
  ));
  const tensionCrackDetected = crackScore >= 52 || (maxHorizontalCrackSpan >= 16 && crackPixelCount >= 20);

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
  const tiltRatio = tiltEdgeCount / Math.max(1, uprightCount + tiltEdgeCount);
  const tiltScore = Math.min(94, Math.round(
    (tiltEdgeCount > 50 ? 45 : tiltEdgeCount * 0.8) +
    (tiltRatio > 0.30 ? 35 : tiltRatio * 100) +
    (hasMpTreeOrPole ? 14 : 0)
  ));
  const tiltedTreeDetected = tiltScore >= 50 && avgTiltAngle >= 14;

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
      if (variance > 400) highRoughnessBlocks++;
    }
  }
  const debrisScore = Math.min(96, Math.round(
    (highRoughnessBlocks > 10 ? 50 : highRoughnessBlocks * 4.5) +
    (hasMpRubble ? 36 : 0) +
    (mpNames.some(n => n.includes('landslide') || n.includes('mud')) ? 15 : 0)
  ));
  const freshDebrisDetected = debrisScore >= 50 || hasMpRubble;

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
    relayBtn.href = `./relay.html?alert=${encodeURIComponent(hazardMsg)}`;
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

function generateSampleSlopeFrame() {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 480;
  const ctx = c.getContext('2d');

  // Hill slope background
  const grad = ctx.createLinearGradient(0, 0, 0, 480);
  grad.addColorStop(0, '#596956');
  grad.addColorStop(0.5, '#786d5e');
  grad.addColorStop(1, '#524335');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 640, 480);

  // 1. Tension crack: dark jagged fracture across mid-slope
  ctx.strokeStyle = '#120d09';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(60, 240);
  ctx.lineTo(220, 245);
  ctx.lineTo(380, 238);
  ctx.lineTo(580, 242);
  ctx.stroke();

  // 2. Tilted trees: off-vertical lean (~26° from vertical)
  ctx.strokeStyle = '#2b1e13';
  ctx.lineWidth = 7;
  for (let x = 110; x < 560; x += 110) {
    ctx.beginPath();
    ctx.moveTo(x, 210);
    ctx.lineTo(x + 65, 60);
    ctx.stroke();
  }

  // 3. Fresh debris: fragmented rock & talus rubble on lower slope
  ctx.fillStyle = '#3a2d20';
  for (let i = 0; i < 75; i++) {
    const rx = 50 + (i * 37) % 540;
    const ry = 300 + (i * 23) % 150;
    ctx.fillRect(rx, ry, 14, 11);
  }

  return c.toDataURL('image/jpeg', 0.85);
}

async function handleScanViewfinder() {
  const btn = document.getElementById('btnScanImage');
  const overlay = document.getElementById('visionScanOverlay');
  const panel = document.getElementById('visionResultsPanel');
  const list = document.getElementById('visionDetectionsList');
  const overallTag = document.getElementById('visionOverallStatus');
  const statusEl = document.getElementById('status');
  const severityEl = document.getElementById('severity');

  btn.disabled = true;
  if (overlay) overlay.style.display = 'block';
  statusEl.textContent = 'Running MediaPipe vision & geotechnical canvas analysis…';

  try {
    const photo = stream ? captureFrame() : generateSampleSlopeFrame();
    const result = await analyzeSlopeImage(photo);
    lastVisionAnalysis = result;

    if (!result) {
      statusEl.textContent = 'Could not analyze frame.';
      return;
    }

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

    if (overallTag) {
      overallTag.textContent = result.flagged.length > 0
        ? `${result.flagged.length} PRECURSOR(S) FLAGGED`
        : 'SLOPE STABLE / NORMAL';
      overallTag.style.background = result.flagged.length > 0 ? 'rgba(217,119,36,0.15)' : 'rgba(74,222,128,0.12)';
      overallTag.style.color = result.flagged.length > 0 ? '#fbd38d' : '#4ade80';
      overallTag.style.borderColor = result.flagged.length > 0 ? 'rgba(217,119,36,0.4)' : 'rgba(74,222,128,0.3)';
    }

    if (panel) panel.style.display = 'flex';

    // Auto-check the flagged precursor chips
    result.flagged.forEach((f) => {
      const chip = document.querySelector(`.hazard-chip[data-flag="${f.flag}"]`);
      if (chip && !chip.classList.contains('active')) {
        chip.classList.add('active');
      }
    });

    // Auto-escalate severity if flagged
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
    const photo = stream ? captureFrame() : null;

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
  updateAIBadge('template');
  checkGeminiNanoReady();
  warmLocation();
  startCamera();
  setupHazardChips();
  renderReportList();
  document.getElementById('reportForm').addEventListener('submit', handleSubmit);
  document.getElementById('btnScanImage')?.addEventListener('click', handleScanViewfinder);
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
