/**
 * L-Bonsai — main.js
 *
 * Orchestrates:
 *  1. LM Studio streaming integration (Pane 1 → Pane 2)
 *  2. Backend /api/generate-bonsai call (Pane 2 → Pane 3)
 *  3. 2D canvas bonsai rendering with Turtle2D (animated L-system growth)
 *  4. LM Studio health-check status light
 */

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
const vizHint      = document.getElementById("viz-hint");
const bonsaiCanvas = document.getElementById("bonsai-canvas");
const paneExecution= document.getElementById("pane-execution");
const lmStudioUrlInput = document.getElementById("lm-studio-url");
const modelSelector = document.getElementById("model-selector");
const connectBtn = document.getElementById("connect-btn");
const connectionStatusBadge = document.getElementById("connection-status-badge");
const connectionErrorMessage = document.getElementById("connection-error-message");

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

  btnGenerate.disabled = true;
  btnGenerate.textContent = "⏳ Generating…";
  paneExecution.classList.add("generating");
  codeOutput.value = "";
  showConnectionMessage(''); // Clear previous messages

  statusLight.className = "status-light amber";
  statusText.textContent = "Connecting…";

  // Initialize turtle for progressive rendering
  if (!turtle) turtle = new Turtle2D(ctx);
  turtle.startProgressive();

  let accumulatedCode = "";
  let lastBonsaiUpdate = 0;
  const BONSAI_UPDATE_INTERVAL = 500; // Update bonsai every 500ms

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
            accumulatedCode += delta;
            // Auto-scroll to bottom
            codeOutput.scrollTop = codeOutput.scrollHeight;

            // Update bonsai periodically as code streams in
            const now = Date.now();
            if (now - lastBonsaiUpdate > BONSAI_UPDATE_INTERVAL) {
              lastBonsaiUpdate = now;
              updateBonsaiFromCode(accumulatedCode);
            }
          }
        } catch {
          /* skip malformed chunk */
        }
      }
    }

    // Final update after streaming completes
    if (accumulatedCode.trim()) {
      updateBonsaiFromCode(accumulatedCode);
    }

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

/**
 * Update the bonsai visualization from the current code.
 * This is called periodically during streaming to show real-time growth.
 */
async function updateBonsaiFromCode(code) {
  const cleanCode = stripMarkdownFences(code.trim());
  if (!cleanCode) return;

  try {
    const resp = await fetch(`${BACKEND_URL}/stream-bonsai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: cleanCode }),
    });

    if (!resp.ok) return; // Silently fail for streaming updates

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();

    // Clear and restart for each update (could be optimized to be truly incremental)
    turtle.startProgressive();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const raw = decoder.decode(value, { stream: true });
      const lines = raw.split("\n").filter(l => l.startsWith("data: "));

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (!data || data === "{}") continue;

        try {
          const json = JSON.parse(data);

          if (json.lsystem_chunk) {
            // Render this chunk immediately
            turtle.interpretProgressive(json.lsystem_chunk);
          }

          if (json.complete) {
            const stats = turtle.endProgressive();
            if (stats) {
              console.log(`[${new Date().toISOString()}] Real-time bonsai: ${stats.branchCount} branches, ${stats.leafCount} leaves`);
            }
          }

          if (json.error) {
            console.log(`[${new Date().toISOString()}] Bonsai generation error: ${json.error}`);
          }
        } catch {
          /* skip malformed chunk */
        }
      }
    }
  } catch (err) {
    // Silently fail for streaming updates - don't interrupt code generation
    console.log(`[${new Date().toISOString()}] Bonsai update failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 2D Canvas Setup
// ---------------------------------------------------------------------------
const ctx = bonsaiCanvas.getContext("2d");

// Canvas background color
const BACKGROUND_COLOR = "#0d1117";
const BRANCH_COLOR = "#4a3728";
const LEAF_COLOR = "#2d6a3f";

// Resize handler
function resizeCanvas() {
  const canvas = bonsaiCanvas;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    // Redraw if we have a turtle
    if (turtle && turtle._lastLsystem) {
      turtle.drawImmediate(turtle._lastLsystem);
    }
  }
}

// Initial resize
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// ---------------------------------------------------------------------------
// Turtle2D — 2D L-system interpreter with animation
// ---------------------------------------------------------------------------
class Turtle2D {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} opts
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;

    this.stepLen    = opts.stepLen    ?? 30;       // pixels
    this.angle      = opts.angle      ?? 26;       // degrees
    this.trunkWidth = opts.trunkWidth ?? 8;        // pixels
    this.minWidth   = opts.minWidth   ?? 1;        // pixels
    this.leafSize   = opts.leafSize   ?? 6;        // pixels
    this.jitter     = opts.jitter     ?? 0.15;     // random angle noise

    // Animation state
    this._animationFrame = null;
    this._animating = false;
    this._drawCommands = [];
    this._currentCommandIndex = 0;

    // Stack for save/restore
    this._stack = [];

    // State for progressive rendering
    this._progressiveState = null;

    // Store last L-system for redraws
    this._lastLsystem = null;
  }

  _rnd(range) {
    return (Math.random() - 0.5) * 2 * range;
  }

  /**
   * Clear the canvas with background color
   */
  clear() {
    const canvas = this.ctx.canvas;
    this.ctx.fillStyle = BACKGROUND_COLOR;
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Convert L-system string to drawing commands
   */
  _parseToCommands(lsystem) {
    const commands = [];
    const canvas = this.ctx.canvas;

    // Start at bottom center of canvas
    let x = canvas.width / 2;
    let y = canvas.height - 50;
    let angle = -90; // pointing up
    let depth = 0;

    const stack = [];

    for (const cmd of lsystem) {
      switch (cmd) {
        case "F": {
          // Forward step — draw a branch
          const width = Math.max(
            this.minWidth,
            this.trunkWidth * Math.pow(0.72, depth)
          );
          const len = this.stepLen * (0.85 + Math.random() * 0.3);
          const angleWithJitter = angle + this._rnd(this.jitter * 15);

          const newX = x + len * Math.cos(angleWithJitter * Math.PI / 180);
          const newY = y + len * Math.sin(angleWithJitter * Math.PI / 180);

          commands.push({
            type: "branch",
            x1: x, y1: y,
            x2: newX, y2: newY,
            width: width,
            depth: depth
          });

          x = newX;
          y = newY;

          // Slight random angle drift for organic feel
          angle += this._rnd(8);
          break;
        }

        case "L": {
          // Leaf node
          commands.push({
            type: "leaf",
            x: x,
            y: y,
            size: this.leafSize * (0.8 + Math.random() * 0.4),
            rotation: Math.random() * Math.PI * 2
          });
          break;
        }

        case "[": {
          // Save state
          stack.push({ x, y, angle, depth });
          depth++;
          angle -= this.angle + this._rnd(this.jitter * this.angle);
          angle += this._rnd(60);
          break;
        }

        case "]": {
          // Restore state
          const state = stack.pop();
          if (state) {
            x = state.x;
            y = state.y;
            angle = state.angle;
            depth = state.depth;
          }
          break;
        }

        case "+": {
          angle += this.angle;
          break;
        }

        case "-": {
          angle -= this.angle;
          break;
        }
      }
    }

    return commands;
  }

  /**
   * Draw a single command
   */
  _drawCommand(cmd) {
    const ctx = this.ctx;

    if (cmd.type === "branch") {
      // Draw branch as a tapered line
      ctx.strokeStyle = BRANCH_COLOR;
      ctx.lineWidth = cmd.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cmd.x1, cmd.y1);
      ctx.lineTo(cmd.x2, cmd.y2);
      ctx.stroke();
    } else if (cmd.type === "leaf") {
      // Draw leaf as a filled circle
      ctx.fillStyle = LEAF_COLOR;
      ctx.beginPath();
      ctx.arc(cmd.x, cmd.y, cmd.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Draw all commands immediately (no animation)
   */
  drawImmediate(lsystem) {
    this._lastLsystem = lsystem;
    this.clear();
    const commands = this._parseToCommands(lsystem);

    let branchCount = 0;
    let leafCount = 0;

    for (const cmd of commands) {
      this._drawCommand(cmd);
      if (cmd.type === "branch") branchCount++;
      if (cmd.type === "leaf") leafCount++;
    }

    console.log(`[${new Date().toISOString()}] Drew ${branchCount} branches and ${leafCount} leaves`);
  }

  /**
   * Initialize or reset the progressive rendering state.
   */
  startProgressive() {
    this.clear();
    this._stack = [];
    this._progressiveState = {
      x: this.ctx.canvas.width / 2,
      y: this.ctx.canvas.height - 50,
      angle: -90,
      depth: 0,
      branchCount: 0,
      leafCount: 0
    };
  }

  /**
   * Interpret a chunk of L-system commands progressively.
   * @param {string} lsystemChunk - L-system commands to interpret
   */
  interpretProgressive(lsystemChunk) {
    if (!this._progressiveState) {
      this.startProgressive();
    }

    const state = this._progressiveState;
    const ctx = this.ctx;

    for (const cmd of lsystemChunk) {
      switch (cmd) {
        case "F": {
          // Forward step — draw a branch
          state.branchCount++;
          const width = Math.max(
            this.minWidth,
            this.trunkWidth * Math.pow(0.72, state.depth)
          );
          const len = this.stepLen * (0.85 + Math.random() * 0.3);
          const angleWithJitter = state.angle + this._rnd(this.jitter * 15);

          const newX = state.x + len * Math.cos(angleWithJitter * Math.PI / 180);
          const newY = state.y + len * Math.sin(angleWithJitter * Math.PI / 180);

          // Draw branch
          ctx.strokeStyle = BRANCH_COLOR;
          ctx.lineWidth = width;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(state.x, state.y);
          ctx.lineTo(newX, newY);
          ctx.stroke();

          state.x = newX;
          state.y = newY;

          // Slight random angle drift
          state.angle += this._rnd(8);
          break;
        }

        case "L": {
          // Leaf node
          state.leafCount++;
          const size = this.leafSize * (0.8 + Math.random() * 0.4);

          ctx.fillStyle = LEAF_COLOR;
          ctx.beginPath();
          ctx.arc(state.x, state.y, size, 0, Math.PI * 2);
          ctx.fill();
          break;
        }

        case "[": {
          // Push state
          this._stack.push({
            x: state.x,
            y: state.y,
            angle: state.angle,
            depth: state.depth
          });
          state.depth++;
          state.angle -= this.angle + this._rnd(this.jitter * this.angle);
          state.angle += this._rnd(60);
          break;
        }

        case "]": {
          // Pop state
          const s = this._stack.pop();
          if (s) {
            state.x = s.x;
            state.y = s.y;
            state.angle = s.angle;
            state.depth = s.depth;
          }
          break;
        }

        case "+": {
          state.angle += this.angle;
          break;
        }

        case "-": {
          state.angle -= this.angle;
          break;
        }
      }
    }
  }

  /**
   * End progressive rendering and return stats.
   */
  endProgressive() {
    if (!this._progressiveState) return null;
    const stats = {
      branchCount: this._progressiveState.branchCount,
      leafCount: this._progressiveState.leafCount
    };
    this._progressiveState = null;
    return stats;
  }

  /**
   * Interpret the L-system string and render with animation.
   * @param {string} lsystem
   */
  interpret(lsystem) {
    console.log(`[${new Date().toISOString()}] Turtle2D.interpret() started`);
    console.log(`[${new Date().toISOString()}] L-system string: "${lsystem}"`);

    this._lastLsystem = lsystem;

    // Stop any current animation
    if (this._animationFrame) {
      cancelAnimationFrame(this._animationFrame);
      this._animating = false;
    }

    // Parse L-system into drawing commands
    this._drawCommands = this._parseToCommands(lsystem);
    this._currentCommandIndex = 0;

    // Clear canvas
    this.clear();

    // Start animation
    this._animating = true;
    this._animate();

    const maxDepth = lsystem.split("[").length - 1;
    console.log(`[${new Date().toISOString()}] Max branch depth: ${maxDepth}`);
  }

  /**
   * Animation loop - draws commands one at a time
   */
  _animate() {
    if (!this._animating || this._currentCommandIndex >= this._drawCommands.length) {
      this._animating = false;

      // Log stats when done
      const branchCount = this._drawCommands.filter(c => c.type === "branch").length;
      const leafCount = this._drawCommands.filter(c => c.type === "leaf").length;
      console.log(`[${new Date().toISOString()}] Turtle2D.interpret() completed`);
      console.log(`[${new Date().toISOString()}] Rendered ${branchCount} branches and ${leafCount} leaves`);
      console.log(`[${new Date().toISOString()}] Total commands: ${this._drawCommands.length}`);
      return;
    }

    // Draw next few commands (batch for smoother animation)
    const commandsPerFrame = 3;
    for (let i = 0; i < commandsPerFrame && this._currentCommandIndex < this._drawCommands.length; i++) {
      this._drawCommand(this._drawCommands[this._currentCommandIndex]);
      this._currentCommandIndex++;
    }

    // Schedule next frame
    this._animationFrame = requestAnimationFrame(() => this._animate());
  }
}

let turtle = null;

// ---------------------------------------------------------------------------
// Helper: Strip markdown code fences from generated code
// ---------------------------------------------------------------------------
/**
 * Remove markdown code fences (```python, ```, etc.) from code string.
 * LLMs sometimes include these despite instructions not to.
 * @param {string} code - The code potentially wrapped in fences
 * @returns {string} - Clean code without fences
 */
function stripMarkdownFences(code) {
  // Match opening fence: ``` or ```python or ```py, etc.
  // Then capture everything until closing ```
  const fencePattern = /^```(?:python|py)?\s*\n([\s\S]*?)\n```$/;
  const match = code.match(fencePattern);
  if (match) {
    return match[1];
  }
  return code;
}

// ---------------------------------------------------------------------------
// Grow Bonsai (Pane 2 → Backend → Pane 3)
// ---------------------------------------------------------------------------
btnGrow.addEventListener("click", async () => {
  console.log(`[${new Date().toISOString()}] Grow Bonsai button clicked`);
  let code = codeOutput.value.trim();
  if (!code) {
    codeOutput.focus();
    return;
  }

  // Strip markdown code fences if present
  code = stripMarkdownFences(code);

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

    console.log(`[${new Date().toISOString()}] L-system received from backend:`, lsystem);
    console.log(`[${new Date().toISOString()}] AST node count: ${node_count}, L-system length: ${lsystem.length}`);

    vizHint.innerHTML = `🌱 Rendering ${node_count} AST nodes…`;

    // Build the bonsai
    if (!turtle) turtle = new Turtle2D(ctx);
    turtle.interpret(lsystem);

    vizHint.classList.add("hidden");

  } catch (err) {
    vizHint.innerHTML = `<span style="color:#f85149">⚠ ${err.message}</span>`;
  } finally {
    btnGrow.disabled = false;
    btnGrow.innerHTML = '<span class="btn-icon">🌿</span> Grow Bonsai';
  }
});

// Exported for testing
export { checkLmStudioHealth, Turtle3D, stripMarkdownFences };
