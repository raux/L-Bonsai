/**
 * L-Bonsai — main.js
 *
 * Orchestrates:
 *  1. LM Studio streaming integration (Pane 1 → Pane 2)
 *  2. Backend /api/generate-bonsai call (Pane 2 → Pane 3)
 *  3. Three.js 3D bonsai rendering with Turtle3D
 *  4. Ambient audio toggle + SFX
 *  5. LM Studio health-check status light
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
let LM_STUDIO_URL = "http://localhost:1234/v1";
const BACKEND_URL = "/api"; // proxied by Vite dev server to localhost:8000
const API_KEY = "lm-studio"; // Default API key for LM Studio connections

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const agentInput   = document.getElementById("agent-input");
const codeOutput   = document.getElementById("code-output");
const btnGenerate  = document.getElementById("btn-generate");
const btnGrow      = document.getElementById("btn-grow");
const statusLight  = document.getElementById("status-light");
const statusText   = document.getElementById("status-text");
const audioToggle  = document.getElementById("audio-toggle");
const audioIcon    = document.getElementById("audio-icon");
const vizHint      = document.getElementById("viz-hint");
const bonsaiCanvas = document.getElementById("bonsai-canvas");
const paneExecution= document.getElementById("pane-execution");
const lmStudioUrlInput = document.getElementById("lm-studio-url");
const modelSelector = document.getElementById("model-selector");
const connectBtn = document.getElementById("connect-btn");
const connectionStatusBadge = document.getElementById("connection-status-badge");
const connectionErrorMessage = document.getElementById("connection-error-message");

// ---------------------------------------------------------------------------
// Audio System
// ---------------------------------------------------------------------------
let audioCtx = null;
let ambientNode = null;
let ambientGain = null;
let ambientPlaying = false;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

/** Generate a short procedural chime/click SFX. */
function playSfx(type = "click") {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (type === "click") {
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.12);
  } else if (type === "chime") {
    osc.type = "triangle";
    osc.frequency.setValueAtTime(523.25, ctx.currentTime);      // C5
    gain.gain.setValueAtTime(0.22, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.55);
  } else if (type === "grow") {
    // Ascending arpeggio to celebrate bonsai growth
    const notes = [261.63, 329.63, 392.0, 523.25]; // C4 E4 G4 C5
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "sine";
      o.frequency.value = freq;
      const t = ctx.currentTime + i * 0.1;
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.start(t); o.stop(t + 0.4);
    });
    return;
  }
}

/** Start/stop lofi ambient drone. */
function startAmbient() {
  const ctx = getAudioCtx();
  ambientGain = ctx.createGain();
  ambientGain.gain.setValueAtTime(0, ctx.currentTime);
  ambientGain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 2);
  ambientGain.connect(ctx.destination);

  // Two layered detuned oscillators for a warm pad
  const freqs = [55, 82.41];
  freqs.forEach(f => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = f;
    // Slow LFO detune
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.15;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 3;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.detune);
    lfo.start();

    // Soft low-pass filter
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 300;
    osc.connect(filter);
    filter.connect(ambientGain);
    osc.start();
  });

  ambientPlaying = true;
}

function stopAmbient() {
  if (ambientGain) {
    const ctx = getAudioCtx();
    ambientGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
  }
  ambientPlaying = false;
}

audioToggle.addEventListener("click", () => {
  if (ambientPlaying) {
    stopAmbient();
    audioIcon.textContent = "🔇";
    audioToggle.classList.remove("active");
  } else {
    startAmbient();
    audioIcon.textContent = "🔊";
    audioToggle.classList.add("active");
  }
});

// ---------------------------------------------------------------------------
// LM Studio Health Check and Model Management
// ---------------------------------------------------------------------------
let availableModels = [];
let selectedModel = "local-model";
let healthCheckInterval = null;

/**
 * Update the connection status badge
 * @param {string} status - 'connected' | 'disconnected' | 'connecting'
 * @param {string} message - Status message to display
 */
function updateConnectionStatusBadge(status, message) {
  if (!connectionStatusBadge) return;

  connectionStatusBadge.className = `connection-status-badge ${status}`;

  const icons = {
    connected: '● ',
    disconnected: '○ ',
    connecting: '⏳ '
  };

  connectionStatusBadge.textContent = `${icons[status] || ''}${message}`;
}

/**
 * Show or hide connection error message
 * @param {string} message - Error message to display (empty to hide)
 * @param {string} type - 'error' | 'success' | 'info'
 */
function showConnectionMessage(message, type = 'error') {
  if (!connectionErrorMessage) return;

  if (!message) {
    connectionErrorMessage.textContent = '';
    connectionErrorMessage.className = 'connection-error-message';
    return;
  }

  connectionErrorMessage.textContent = message;
  connectionErrorMessage.className = `connection-error-message visible ${type}`;
}

// Initialize URL input with saved value or default (only if element exists)
if (lmStudioUrlInput) {
  const savedUrl = localStorage.getItem("lmStudioUrl") || "http://localhost:1234";
  lmStudioUrlInput.value = savedUrl;
  // Update module-level LM_STUDIO_URL with saved/default value
  LM_STUDIO_URL = `${savedUrl}/v1`;

  // Update LM_STUDIO_URL when input changes
  lmStudioUrlInput.addEventListener("input", () => {
    const baseUrl = lmStudioUrlInput.value.trim();
    localStorage.setItem("lmStudioUrl", baseUrl);
    // Update module-level variable immediately
    LM_STUDIO_URL = baseUrl ? `${baseUrl}/v1` : "http://localhost:1234/v1";
  });
}

async function fetchAvailableModels() {
  try {
    if (!LM_STUDIO_URL) return [];

    const resp = await fetch(`${LM_STUDIO_URL}/models`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      signal: AbortSignal.timeout(2500)
    });
    if (!resp.ok) return [];

    const data = await resp.json();
    return data.data || [];
  } catch {
    return [];
  }
}

async function updateModelSelector() {
  if (!modelSelector) return;

  const models = await fetchAvailableModels();
  availableModels = models;

  modelSelector.innerHTML = '<option value="">Select model...</option>';

  if (models.length === 0) {
    modelSelector.disabled = true;
    return;
  }

  modelSelector.disabled = false;
  models.forEach(model => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.id;
    modelSelector.appendChild(option);
  });

  // Restore previously selected model if available
  const savedModel = localStorage.getItem("selectedModel");
  if (savedModel && models.some(m => m.id === savedModel)) {
    modelSelector.value = savedModel;
    selectedModel = savedModel;
  } else if (models.length > 0) {
    modelSelector.value = models[0].id;
    selectedModel = models[0].id;
  }
}

if (modelSelector) {
  modelSelector.addEventListener("change", () => {
    selectedModel = modelSelector.value || "local-model";
    localStorage.setItem("selectedModel", selectedModel);
  });
}

async function checkLmStudioHealth() {
  try {
    const baseUrl = lmStudioUrlInput ? lmStudioUrlInput.value.trim() : "http://localhost:1234";
    if (!baseUrl) {
      updateConnectionStatusBadge('disconnected', 'Disconnected');
      return false;
    }

    // Validate URL format (basic check)
    try {
      new URL(baseUrl.startsWith('http') ? baseUrl : `http://${baseUrl}`);
    } catch {
      console.warn('Invalid URL format:', baseUrl);
      if (statusLight) statusLight.className = "status-light red";
      if (statusText) statusText.textContent = "Invalid URL";
      if (connectBtn) {
        connectBtn.className = "header-btn";
        connectBtn.innerHTML = '<span class="btn-icon">🔌</span><span class="btn-label">Connect</span>';
      }
      updateConnectionStatusBadge('disconnected', 'Invalid URL');
      showConnectionMessage('Invalid URL format. Please check the LM Studio URL.', 'error');
      return false;
    }

    LM_STUDIO_URL = `${baseUrl}/v1`;

    const resp = await fetch(`${LM_STUDIO_URL}/models`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      signal: AbortSignal.timeout(2500)
    });
    if (resp.ok) {
      if (statusLight) statusLight.className = "status-light green";
      if (statusText) statusText.textContent = "LM Studio ✓";
      if (connectBtn) {
        connectBtn.className = "header-btn connected";
        connectBtn.innerHTML = '<span class="btn-icon">✓</span><span class="btn-label">Connected</span>';
      }
      updateConnectionStatusBadge('connected', 'Connected');
      showConnectionMessage(''); // Clear any error messages
      return true;
    } else {
      const errorMsg = `Server returned HTTP ${resp.status}`;
      console.warn(errorMsg);
      showConnectionMessage(`${errorMsg}. Please check if LM Studio is running.`, 'error');
    }
  } catch (err) {
    const errorMsg = err.name === 'TimeoutError'
      ? 'Connection timeout. Is LM Studio running?'
      : err.message || 'Connection failed';
    console.warn('Connection error:', errorMsg);
    showConnectionMessage(errorMsg, 'error');
  }
  if (statusLight) statusLight.className = "status-light red";
  if (statusText) statusText.textContent = "LM Studio ✗";
  if (connectBtn) {
    connectBtn.className = "header-btn";
    connectBtn.innerHTML = '<span class="btn-icon">🔌</span><span class="btn-label">Connect</span>';
  }
  if (modelSelector) modelSelector.disabled = true;
  updateConnectionStatusBadge('disconnected', 'Disconnected');
  return false;
}

// Connect button handler
if (connectBtn) {
  connectBtn.addEventListener("click", async () => {
    playSfx("click");
    connectBtn.className = "header-btn connecting";
    connectBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-label">Connecting...</span>';
    if (statusLight) statusLight.className = "status-light amber";
    if (statusText) statusText.textContent = "Connecting…";
    updateConnectionStatusBadge('connecting', 'Connecting...');
    showConnectionMessage(''); // Clear previous messages

    const connected = await checkLmStudioHealth();
    if (connected) {
      await updateModelSelector();

      // Verify selected model is available
      if (selectedModel && modelSelector) {
        const models = await fetchAvailableModels();
        const modelAvailable = models.some(m => m.id === selectedModel);
        if (!modelAvailable && models.length > 0) {
          console.warn(`Previously selected model "${selectedModel}" not found. Using ${models[0].id}`);
          modelSelector.value = models[0].id;
          selectedModel = models[0].id;
          localStorage.setItem("selectedModel", selectedModel);
        }
      }

      playSfx("chime");
      showConnectionMessage('Successfully connected to LM Studio!', 'success');
      // Clear success message after 3 seconds
      setTimeout(() => showConnectionMessage(''), 3000);
    }
  });
}

// Initial connection attempt and start polling
(async () => {
  updateConnectionStatusBadge('connecting', 'Connecting...');
  const connected = await checkLmStudioHealth();
  if (connected) {
    await updateModelSelector();
  }

  // Poll every 5 seconds (only if elements exist)
  if (connectBtn) {
    healthCheckInterval = setInterval(async () => {
      const wasConnected = connectBtn.classList.contains("connected");
      const isConnected = await checkLmStudioHealth();

      // If we just connected, refresh models and validate selection
      if (isConnected && !wasConnected) {
        await updateModelSelector();

        // Verify selected model is still available
        if (selectedModel && modelSelector) {
          const models = await fetchAvailableModels();
          const modelAvailable = models.some(m => m.id === selectedModel);
          if (!modelAvailable && models.length > 0) {
            console.warn(`Previously selected model "${selectedModel}" not found. Switching to ${models[0].id}`);
            modelSelector.value = models[0].id;
            selectedModel = models[0].id;
            localStorage.setItem("selectedModel", selectedModel);
          }
        }
      }
    }, 5000);
  }
})();

// ---------------------------------------------------------------------------
// LM Studio Streaming (Pane 1 → Pane 2)
// ---------------------------------------------------------------------------
btnGenerate.addEventListener("click", async () => {
  const prompt = agentInput.value.trim();
  if (!prompt) return;

  playSfx("click");
  btnGenerate.disabled = true;
  btnGenerate.textContent = "⏳ Generating…";
  paneExecution.classList.add("generating");
  codeOutput.value = "";
  showConnectionMessage(''); // Clear previous messages

  statusLight.className = "status-light amber";
  statusText.textContent = "Connecting…";

  try {
    const resp = await fetch(`${LM_STUDIO_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: selectedModel || "local-model",
        messages: [
          {
            role: "system",
            content:
              "You are an expert Python developer. Respond with ONLY well-formatted Python code, " +
              "no markdown fences, no explanations — just the raw Python source code.",
          },
          { role: "user", content: prompt },
        ],
        stream: true,
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} ${resp.statusText}${errorText ? ` - ${errorText}` : ''}`);
    }

    statusLight.className = "status-light green";
    statusText.textContent = "LM Studio ✓";

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const raw = decoder.decode(value, { stream: true });
      const lines = raw.split("\n").filter(l => l.startsWith("data: "));

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") break;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            codeOutput.value += delta;
            // Auto-scroll to bottom
            codeOutput.scrollTop = codeOutput.scrollHeight;
          }
        } catch {
          /* skip malformed chunk */
        }
      }
    }

    playSfx("chime");
  } catch (err) {
    statusLight.className = "status-light red";
    statusText.textContent = "LM Studio ✗";
    const errorMsg = `Error connecting to LM Studio: ${err.message}`;
    codeOutput.value = `# ${errorMsg}\n#\n# Make sure LM Studio is running at ${LM_STUDIO_URL}\n# and a model is loaded.`;
    showConnectionMessage(errorMsg, 'error');
  } finally {
    btnGenerate.disabled = false;
    btnGenerate.innerHTML = '<span class="btn-icon">✨</span> Send to Local LLM';
    paneExecution.classList.remove("generating");
  }
});

// ---------------------------------------------------------------------------
// Three.js Scene Setup
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  canvas: bonsaiCanvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
scene.fog = new THREE.Fog(0x0d1117, 18, 40);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
camera.position.set(0, 4, 12);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2;
controls.maxDistance = 35;
controls.target.set(0, 3, 0);
controls.update();

// Lighting
const ambLight = new THREE.AmbientLight(0x334455, 1.2);
scene.add(ambLight);

const dirLight = new THREE.DirectionalLight(0xfff4e0, 1.6);
dirLight.position.set(6, 10, 8);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x203050, 0.5);
fillLight.position.set(-5, 2, -5);
scene.add(fillLight);

// Ground plane
const groundGeo = new THREE.CircleGeometry(7, 64);
const groundMat = new THREE.MeshLambertMaterial({ color: 0x1a2330 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Resize handler
function resizeRenderer() {
  const canvas = bonsaiCanvas;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (renderer.domElement.width !== w || renderer.domElement.height !== h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  resizeRenderer();
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ---------------------------------------------------------------------------
// Turtle3D — L-system interpreter
// ---------------------------------------------------------------------------
class Turtle3D {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts
   */
  constructor(scene, opts = {}) {
    this.scene = scene;

    this.stepLen    = opts.stepLen    ?? 0.32;
    this.angle      = opts.angle      ?? 26;     // degrees
    this.trunkR     = opts.trunkR     ?? 0.065;
    this.minR       = opts.minR       ?? 0.008;
    this.leafSize   = opts.leafSize   ?? 0.18;
    this.jitter     = opts.jitter     ?? 0.15;   // random angle noise

    // Stack for save/restore
    this._stack = [];

    // Shared geometry/materials for instancing efficiency
    this._branchMat = new THREE.MeshLambertMaterial({
      color: 0x4a3728,
    });
    this._leafMat = new THREE.MeshLambertMaterial({
      color: 0x2d6a3f,
      side: THREE.DoubleSide,
    });

    // Meshes to be added
    this._group = new THREE.Group();
    scene.add(this._group);
  }

  _rnd(range) {
    return (Math.random() - 0.5) * 2 * range;
  }

  /**
   * Interpret the L-system string and build geometry.
   * @param {string} lsystem
   */
  interpret(lsystem) {
    // Remove old tree
    this._group.clear();

    // Turtle state
    let pos   = new THREE.Vector3(0, 0, 0);
    let dir   = new THREE.Vector3(0, 1, 0);   // up
    let right = new THREE.Vector3(1, 0, 0);
    let depth = 0;  // bracket nesting depth

    const maxDepth = lsystem.split("[").length - 1;

    const push = () => {
      this._stack.push({ pos: pos.clone(), dir: dir.clone(), right: right.clone(), depth });
    };
    const pop = () => {
      const s = this._stack.pop();
      if (s) ({ pos, dir, right, depth } = s);
    };

    /** Rotate dir around the turtle's right axis by angleDeg. */
    const pitchBy = (angleDeg) => {
      const rad = THREE.MathUtils.degToRad(angleDeg + this._rnd(this.jitter * angleDeg));
      dir.applyAxisAngle(right, rad).normalize();
    };

    /** Rotate dir around the world Y axis by angleDeg. */
    const yawBy = (angleDeg) => {
      const rad = THREE.MathUtils.degToRad(angleDeg + this._rnd(this.jitter * angleDeg));
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), rad).normalize();
      right.applyAxisAngle(new THREE.Vector3(0, 1, 0), rad).normalize();
    };

    for (const cmd of lsystem) {
      switch (cmd) {

        case "F": {
          // Forward step — draw a branch cylinder
          const radius = Math.max(
            this.minR,
            this.trunkR * Math.pow(0.72, depth)
          );
          const len = this.stepLen * (0.85 + Math.random() * 0.3);
          const end = pos.clone().addScaledVector(dir, len);

          // Build cylinder aligned along the segment
          const midPoint = pos.clone().lerp(end, 0.5);
          const segDir = end.clone().sub(pos).normalize();
          const cylGeo = new THREE.CylinderGeometry(radius * 0.82, radius, len, 6, 1);
          const mesh = new THREE.Mesh(cylGeo, this._branchMat);
          mesh.castShadow = true;

          // Orient cylinder: default Y-up → align with segDir
          mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), segDir);
          mesh.position.copy(midPoint);

          this._group.add(mesh);
          pos.copy(end);

          // Slight random yaw drift for organic feel
          yawBy(this._rnd(8));
          break;
        }

        case "L": {
          // Leaf node — small flat disc/sphere
          const t = Math.random();
          let geo;
          if (t < 0.5) {
            geo = new THREE.SphereGeometry(this.leafSize * (0.6 + Math.random() * 0.8), 5, 4);
          } else {
            geo = new THREE.PlaneGeometry(
              this.leafSize * (0.8 + Math.random() * 0.6),
              this.leafSize * (0.8 + Math.random() * 0.6)
            );
          }
          const leaf = new THREE.Mesh(geo, this._leafMat);
          leaf.position.copy(pos);
          // Random orientation
          leaf.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI
          );
          leaf.castShadow = true;
          this._group.add(leaf);
          break;
        }

        case "[":
          push();
          depth++;
          pitchBy(this.angle);
          yawBy(this._rnd(60));
          break;

        case "]":
          pop();
          depth = Math.max(0, depth - 1);
          break;

        case "+":
          pitchBy(-this.angle);
          break;

        case "-":
          pitchBy(this.angle);
          break;

        default:
          break;
      }
    }
  }
}

let turtle = null;

// ---------------------------------------------------------------------------
// Grow Bonsai (Pane 2 → Backend → Pane 3)
// ---------------------------------------------------------------------------
btnGrow.addEventListener("click", async () => {
  const code = codeOutput.value.trim();
  if (!code) {
    codeOutput.focus();
    return;
  }

  playSfx("click");
  btnGrow.disabled = true;
  btnGrow.innerHTML = '<span class="btn-icon">⏳</span> Growing…';
  vizHint.classList.remove("hidden");
  vizHint.innerHTML = "⏳ Parsing AST…";

  try {
    const resp = await fetch(`${BACKEND_URL}/generate-bonsai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || resp.statusText);
    }

    const { lsystem, node_count } = await resp.json();

    vizHint.innerHTML = `🌱 Rendering ${node_count} AST nodes…`;

    // Build the bonsai
    if (!turtle) turtle = new Turtle3D(scene);
    turtle.interpret(lsystem);

    // Focus camera on tree
    controls.target.set(0, 4, 0);
    camera.position.set(0, 6, 14);
    controls.update();

    vizHint.classList.add("hidden");
    playSfx("grow");

  } catch (err) {
    vizHint.innerHTML = `<span style="color:#f85149">⚠ ${err.message}</span>`;
  } finally {
    btnGrow.disabled = false;
    btnGrow.innerHTML = '<span class="btn-icon">🌿</span> Grow Bonsai';
  }
});

// Exported for testing
export { checkLmStudioHealth, Turtle3D };
