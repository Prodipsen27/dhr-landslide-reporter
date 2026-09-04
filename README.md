# SlopeWatch — Offline Landslide Observation Reporter & Community Relay

**Track B1 ("Code for Communities") — GDG Siliguri Hackathon**

On 4–5 October 2025, the Geological Survey of India (GSI) issued an orange alert and the IMD issued a red alert for the Darjeeling hills — yet intense rainfall (>300mm in 12 hours) triggered fatal landslides along NH-10 and rural tea estate roads, in large part because warnings and real-time ground observations cannot cross the "last mile" in cellular dead-zones.

**SlopeWatch** solves both halves of the B1 challenge under zero-connectivity field conditions:
1. **Report-Up**: Anyone walking a slope logs real-time observations, tags geotechnical precursors, receives an immediate plain-language safety explanation on-device, and queues the report in IndexedDB to auto-sync when cellular signal returns.
2. **Relay-Down**: A connected phone receiving an official district disaster alert rebroadcasts it phone-to-phone across air-gapped subnets via **WebRTC (Host-only ICE)** and **Web Bluetooth (BLE Mesh Relay)** without any cellular data or external servers.

---

## Architecture & Features

### 1. Report-Up (Offline Observation Logging)
- **`getUserMedia` Field Camera HUD**: Hardware-accelerated viewfinder with tactile reticles and resolution capping (1280px max, 70% JPEG quality) to prevent mobile memory bloat. Graceful fallback if camera is unavailable or denied.
- **Geotechnical Precursor Indicators**: Field-tested slope failure signs that generic ImageNet classifiers miss:
  - ⚡ **Tension crack**: Shear strain along the slope crown / road edge
  - 🌲 **Tilted tree / pole**: Rotational failure / progressive soil creep
  - 🧱 **Bulging retaining wall**: Lateral hydrostatic pressure before structural breach
  - 💧 **Active seepage**: High pore-water pressure buildup
  - 🪨 **Fresh rock / debris**: Active mass ravelling / rockfall
  - Tapping chips automatically recommends appropriate severity levels (`high` / `medium`) and tags the report.
- **Primary Disaster Safety Templates**: Verified, instant (0ms, 0MB) safety explanations in **English, Nepali (नेपाली), Hindi (हिन्दी), and Bengali (বাংলা)**. Reports are logged in `<50ms` and never wait for network or AI downloads.
- **On-Demand On-Device AI ("✨ Improve with AI")**:
  - **Gemini Nano Fast-Path**: Leverages Chrome built-in `window.ai` (`LanguageModel`) if readily available (0MB download, 1s execution).
  - **Wllama + Qwen2.5-0.5B (GGUF q2_k)**: Universal WebAssembly engine loaded lazily *only* when requested by user, with real-time download/inference progress indicators.
  - **Transformers.js (SmolLM2-135M)**: Secondary lightweight WASM fallback.
  - Prompt automatically injects the observed geotechnical precursor tags for hyper-local geotechnical safety advice.
- **IndexedDB + Background Sync**: Complete PWA persistence. Reports queue locally with sync state flags (`synced: 0`). Service worker triggers `sync-reports` on background network restoration, with on-open and `online` event fallbacks for non-Chromium browsers.

### 2. Relay-Down (Zero-Signal Peer-to-Peer Rebroadcast)
- **Air-Gapped WebRTC Hotspot Relay (`relay.html`)**:
  - Operates over a shared portable mobile hotspot with **zero cellular data**.
  - Uses **Host-Only ICE Candidates** (`iceServers: []`) — avoids the 10-second STUN freeze that bricks standard WebRTC when no internet is present.
  - Air-gapped signalling via compact base64-encoded QR codes (sender offer QR $\rightarrow$ receiver camera scan $\rightarrow$ receiver answer QR $\rightarrow$ direct local subnet WebRTC data channel).
  - Web Speech API integration: automatically announces incoming hazard alerts in English/Indian speech synthesis.
- **Web Bluetooth (BLE) Mesh Relay**:
  - Native browser Bluetooth API (`navigator.bluetooth`) to discover and communicate with roadside emergency repeater beacons (ESP32 / nRF52 disaster nodes) stationed at road checkpoints (e.g. NH-10 / Hill Cart Road).
  - Supports Nordic UART Service (NUS) and HM-10 serial GATT characteristics with 20-byte MTU chunking.
  - Built-in simulation sandbox (`🧪 Simulate Ingesting Nearby Roadside BLE Packet`) for demo and evaluation environments without physical BLE hardware.

---

## How to Run & Test

SlopeWatch is completely zero-build vanilla HTML5, CSS3, and modern JavaScript.

### 1. Start Local Server
PWAs and Web APIs (`getUserMedia`, `serviceWorker`, `navigator.bluetooth`) require a secure context (`localhost` or HTTPS):

```bash
# Using npx serve:
npx serve .

# Or Python 3:
python -m http.server 8080
```

### 2. Field Test Checklist
1. **Offline Persistence**: Open `http://localhost:8080` (or your local IP), enable airplane mode in DevTools or on your phone, refresh page — verify app shell loads from `sw.js` cache.
2. **Observation Logging**: Tap a geotechnical indicator (e.g. `[ 🧱 Bulging wall ]`), notice severity auto-escalates to High Danger, and tap **"Log this observation"**. The record appears immediately with badge tags and safety instructions.
3. **On-Demand AI**: Tap **"✨ Improve with AI"** on any logged card to inspect progress synthesis without freezing the UI.
4. **Offline Relay**: Navigate to `relay.html` (`📡 RELAY MODE`). Generate an alert offer QR or switch to the **📶 BLUETOOTH** tab and trigger the BLE repeater simulation.

---

## Target Deployment Environment
- **Target Geography**: Darjeeling, Kalimpong, Kurseong, Mirik, and the Teesta Valley (West Bengal, India).
- **Target Hardware**: Ultra-low-cost Android smartphones (2GB–4GB RAM, Android Go / standard Chrome), offline field workers, civil defense volunteers, and tea estate panchayat leaders.
