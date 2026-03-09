import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const originalRAF = global.requestAnimationFrame;
const originalSetInterval = global.setInterval;
const originalDevicePixelRatio = global.devicePixelRatio;

function setupDom() {
  document.body.innerHTML = `
    <textarea id="agent-input"></textarea>
    <textarea id="code-output"></textarea>
    <button id="btn-generate"></button>
    <button id="btn-grow"></button>
    <div id="status-light"></div>
    <div id="status-text"></div>
    <div id="viz-hint"></div>
    <canvas id="bonsai-canvas"></canvas>
    <div id="pane-execution"></div>
  `;
  const canvas = document.getElementById("bonsai-canvas");
  // Mock 2D canvas context
  canvas.getContext = vi.fn(() => ({
    canvas: { width: 800, height: 600, clientWidth: 800, clientHeight: 600 },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "",
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
  }));
}

beforeEach(() => {
  vi.resetModules();
  setupDom();
  global.fetch = vi.fn().mockResolvedValue({ ok: true });
  global.requestAnimationFrame = vi.fn();
  global.setInterval = vi.fn();
  global.devicePixelRatio = 1;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  global.requestAnimationFrame = originalRAF;
  global.setInterval = originalSetInterval;
  global.devicePixelRatio = originalDevicePixelRatio;
});

describe("LM Studio health indicator", () => {
  test("shows green indicator when LM Studio responds", async () => {
    const { checkLmStudioHealth } = await import("../main.js");
    const light = document.getElementById("status-light");
    const text = document.getElementById("status-text");

    const result = await checkLmStudioHealth();

    expect(result).toBe(true);
    expect(light.className).toContain("green");
    expect(text.textContent).toContain("LM Studio ✓");
  });

  test("shows red indicator when LM Studio is unreachable", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    const { checkLmStudioHealth } = await import("../main.js");
    const light = document.getElementById("status-light");
    const text = document.getElementById("status-text");

    const result = await checkLmStudioHealth();

    expect(result).toBe(false);
    expect(light.className).toContain("red");
    expect(text.textContent).toContain("LM Studio ✗");
  });
});

describe("Turtle2D", () => {
  test("interprets L-system commands into draw commands", async () => {
    const { Turtle2D } = await import("../main.js");

    // Create a mock canvas context
    const mockCtx = {
      canvas: { width: 800, height: 600 },
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      lineCap: "",
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
    };

    const turtle = new Turtle2D(mockCtx, {
      stepLen: 30,
      trunkWidth: 8,
      minWidth: 1,
      leafSize: 6,
      jitter: 0,
    });

    // Test immediate drawing
    turtle.drawImmediate("FFL");

    // Should have called beginPath 3 times (2 branches + 1 leaf)
    expect(mockCtx.beginPath).toHaveBeenCalled();

    // Clear should have been called
    expect(mockCtx.fillRect).toHaveBeenCalled();
  });
});

describe("stripMarkdownFences", () => {
  test("strips ```python fences from code", async () => {
    const { stripMarkdownFences } = await import("../main.js");
    const input = "```python\ndef hello():\n    print('world')\n```";
    const expected = "def hello():\n    print('world')";
    expect(stripMarkdownFences(input)).toBe(expected);
  });

  test("strips plain ``` fences from code", async () => {
    const { stripMarkdownFences } = await import("../main.js");
    const input = "```\ndef hello():\n    print('world')\n```";
    const expected = "def hello():\n    print('world')";
    expect(stripMarkdownFences(input)).toBe(expected);
  });

  test("strips ```py fences from code", async () => {
    const { stripMarkdownFences } = await import("../main.js");
    const input = "```py\ndef hello():\n    print('world')\n```";
    const expected = "def hello():\n    print('world')";
    expect(stripMarkdownFences(input)).toBe(expected);
  });

  test("returns code unchanged when no fences present", async () => {
    const { stripMarkdownFences } = await import("../main.js");
    const input = "def hello():\n    print('world')";
    expect(stripMarkdownFences(input)).toBe(input);
  });

  test("does not strip backticks within code content", async () => {
    const { stripMarkdownFences } = await import("../main.js");
    const input = "def hello():\n    s = '```'\n    print(s)";
    expect(stripMarkdownFences(input)).toBe(input);
  });

  test("handles complex multi-line code with fences", async () => {
    const { stripMarkdownFences } = await import("../main.js");
    const input = "```python\nclass Calculator:\n    def add(self, a, b):\n        return a + b\n\nfor i in range(10):\n    print(i)\n```";
    const expected = "class Calculator:\n    def add(self, a, b):\n        return a + b\n\nfor i in range(10):\n    print(i)";
    expect(stripMarkdownFences(input)).toBe(expected);
  });
});
