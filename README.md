# L-Bonsai — Code-to-Bonsai 3D Visualizer

Transform Python source code into an organic 3D bonsai tree by mapping
Abstract Syntax Tree (AST) nodes to L-system turtle commands, rendered
live in the browser with Three.js.

## Architecture

```
frontend/   — Vite + Three.js UI (three-pane layout)
backend/    — FastAPI server (AST → L-system)
```

## Quick Start

### 1. Start the Python backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2. Start the Vite frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 3. (Optional) LM Studio

For the "Send to Local LLM" feature, download and run
[LM Studio](https://lmstudio.ai/), load a model, and start the local
server at `http://localhost:1234`.

## Usage Flow

| Pane | Name | Action |
|------|------|--------|
| 1 | **Intent** | Paste `AGENT.md` requirements → click *Send to Local LLM* |
| 2 | **Execution** | Review/edit streamed Python code → click *Grow Bonsai* |
| 3 | **Visualization** | Interact with the 3D bonsai (orbit/zoom/pan) |

## AST → L-system Mapping

| Python construct | L-system command |
|-----------------|-----------------|
| `def` / `async def` | `F+[…]F` — upward branch |
| `class` | `FF-[…]+[…]F` — forked branch |
| `for` / `async for` | `F[…]F[…]F[…]F` — repeating loop |
| `while` | `F[…]F[…]F` — compact loop |
| `if` | `F-[…]+[…]F` — conditional fork |
| `with` | `F[…]F` — context branch |
| `try/except` | `F[…]+[…]F` — error branch |
| `import` | `FL` — twig with leaf |
| `=` / `:=` / `+=` | `FL` — assignment leaf |
| `return` / `yield` | `FLL` — tip with double leaf |
| Other statements | `F` — forward step |

## Tech Stack

- **Backend:** Python 3.11+, FastAPI, uvicorn
- **Frontend:** Vite, Three.js (OrbitControls), ES6 modules
- **Audio:** Web Audio API (procedural SFX + ambient drone)
- **LLM:** LM Studio (OpenAI-compatible local API)
