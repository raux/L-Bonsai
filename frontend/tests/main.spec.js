import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

class Vector3Mock {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  clone() {
    return new Vector3Mock(this.x, this.y, this.z);
  }

  addScaledVector(vec, scale) {
    this.x += vec.x * scale;
    this.y += vec.y * scale;
    this.z += vec.z * scale;
    return this;
  }

  sub(vec) {
    this.x -= vec.x;
    this.y -= vec.y;
    this.z -= vec.z;
    return this;
  }

  normalize() {
    return this;
  }

  lerp(vec, t) {
    this.x += (vec.x - this.x) * t;
    this.y += (vec.y - this.y) * t;
    this.z += (vec.z - this.z) * t;
    return this;
  }

  applyAxisAngle() {
    return this;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(vec) {
    this.x = vec.x;
    this.y = vec.y;
    this.z = vec.z;
    return this;
  }
}

const threeMock = {
  MathUtils: { degToRad: (deg) => (deg * Math.PI) / 180 },
  PCFSoftShadowMap: "pcf-soft-shadow",
  Vector3: Vector3Mock,
  WebGLRenderer: class {
    constructor(opts = {}) {
      this.domElement = opts.canvas ?? { width: 0, height: 0 };
      this.shadowMap = { enabled: false, type: null };
    }

    setPixelRatio() {}
    setSize(width, height) {
      this.domElement.width = width;
      this.domElement.height = height;
    }
    render() {}
  },
  Scene: class {
    constructor() {
      this.objects = [];
    }
    add(obj) {
      this.objects.push(obj);
    }
  },
  Color: class {
    constructor(value) {
      this.value = value;
    }
  },
  Fog: class {
    constructor(color, near, far) {
      this.color = color;
      this.near = near;
      this.far = far;
    }
  },
  PerspectiveCamera: class {
    constructor() {
      this.position = new Vector3Mock();
      this.aspect = 1;
    }
    updateProjectionMatrix() {}
  },
  AmbientLight: class {},
  DirectionalLight: class {
    constructor() {
      this.position = new Vector3Mock();
      this.shadow = { mapSize: { width: 0, height: 0 } };
    }
  },
  CircleGeometry: class {},
  MeshLambertMaterial: class {
    constructor(opts) {
      this.opts = opts;
    }
  },
  DoubleSide: "double-side",
  Mesh: class {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.castShadow = false;
      this.position = new Vector3Mock();
      this.rotation = { set: vi.fn() };
      this.quaternion = { setFromUnitVectors: vi.fn() };
    }
  },
  Group: class {
    constructor() {
      this.children = [];
    }
    add(obj) {
      this.children.push(obj);
    }
    clear() {
      this.children = [];
    }
  },
  CylinderGeometry: class {},
  SphereGeometry: class {},
  PlaneGeometry: class {},
};

vi.mock("three", () => threeMock);

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => {
  class OrbitControlsMock {
    constructor() {
      this.target = new Vector3Mock();
      this.enableDamping = false;
      this.dampingFactor = 0;
      this.minDistance = 0;
      this.maxDistance = 0;
    }
    update() {}
  }
  return { OrbitControls: OrbitControlsMock };
});

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
  canvas.getContext = vi.fn();
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

describe("Turtle3D", () => {
  test("interprets L-system commands into scene nodes", async () => {
    const { Turtle3D } = await import("../main.js");
    const THREE = await import("three");
    const turtle = new Turtle3D(new THREE.Scene(), {
      stepLen: 1,
      trunkR: 0.1,
      minR: 0.01,
      leafSize: 0.05,
      jitter: 0,
    });

    turtle.interpret("FFL");
    expect(turtle._group.children).toHaveLength(3);

    turtle.interpret("L");
    expect(turtle._group.children).toHaveLength(1);
  });
});
