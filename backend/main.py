"""
FastAPI backend for Code-to-Bonsai 3D Visualizer.

Accepts raw Python source code, parses it into an AST, and maps the
AST structure into an L-system string that the Three.js frontend can
render as an organic 3D bonsai tree.
"""

from __future__ import annotations

import ast
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="L-Bonsai API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# AST → L-system mapper
# ---------------------------------------------------------------------------

class BonsaiVisitor(ast.NodeVisitor):
    """
    Traverses a Python AST and emits L-system turtle commands.

    Mapping rules:
      FunctionDef / AsyncFunctionDef → branch segment + sub-branch
      ClassDef                       → major branch fork
      For / While / AsyncFor         → repeated branch loop
      If                             → conditional fork (two sub-branches)
      With / AsyncWith               → context branch
      Try / ExceptHandler            → recovery branch
      Import / ImportFrom            → thin decorative twig
      Assign / AugAssign / AnnAssign → leaf node
      Return / Yield / YieldFrom     → leaf with tip
      Expr (standalone call/etc.)    → short forward step + leaf
      Any other statement            → forward step
    """

    def __init__(self) -> None:
        self.commands: list[str] = []

    # ------------------------------------------------------------------
    # Helper emitters
    # ------------------------------------------------------------------

    def _branch(self, inner: str) -> None:
        """Wrap *inner* commands in a save/restore bracket pair."""
        self.commands.append("[")
        self.commands.append(inner)
        self.commands.append("]")

    def _forward(self, n: int = 1) -> None:
        self.commands.extend(["F"] * n)

    def _leaf(self) -> None:
        self.commands.append("L")

    def _turn_right(self) -> None:
        self.commands.append("+")

    def _turn_left(self) -> None:
        self.commands.append("-")

    # ------------------------------------------------------------------
    # Visitor methods
    # ------------------------------------------------------------------

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._forward()
        self._turn_right()
        self._branch(self._collect_body(node.body))
        self._forward()

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.visit_FunctionDef(node)  # type: ignore[arg-type]

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self._forward(2)
        self._turn_left()
        self._branch(self._collect_body(node.body))
        self._turn_right()
        self._branch(self._collect_body(node.body))
        self._forward()

    def visit_For(self, node: ast.For) -> None:
        for _ in range(3):
            self._forward()
            self._branch(self._collect_body(node.body))
        self._forward()

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
        self.visit_For(node)  # type: ignore[arg-type]

    def visit_While(self, node: ast.While) -> None:
        for _ in range(2):
            self._forward()
            self._branch(self._collect_body(node.body))
        self._forward()

    def visit_If(self, node: ast.If) -> None:
        self._forward()
        self._turn_left()
        self._branch(self._collect_body(node.body))
        if node.orelse:
            self._turn_right()
            self._branch(self._collect_body(node.orelse))
        self._forward()

    def visit_With(self, node: ast.With) -> None:
        self._forward()
        self._branch(self._collect_body(node.body))
        self._forward()

    def visit_AsyncWith(self, node: ast.AsyncWith) -> None:
        self.visit_With(node)  # type: ignore[arg-type]

    def visit_Try(self, node: ast.Try) -> None:
        self._forward()
        self._branch(self._collect_body(node.body))
        for handler in node.handlers:
            self._turn_right()
            body = handler.body if hasattr(handler, "body") else []
            self._branch(self._collect_body(body))
        if node.finalbody:
            self._branch(self._collect_body(node.finalbody))
        self._forward()

    def visit_Import(self, node: ast.Import) -> None:
        self._forward()
        self._leaf()

    visit_ImportFrom = visit_Import  # type: ignore[assignment]

    def visit_Assign(self, node: ast.Assign) -> None:
        self._forward()
        self._leaf()

    visit_AugAssign = visit_Assign  # type: ignore[assignment]
    visit_AnnAssign = visit_Assign  # type: ignore[assignment]

    def visit_Return(self, node: ast.Return) -> None:
        self._forward()
        self._leaf()
        self._leaf()

    visit_Yield = visit_Return  # type: ignore[assignment]
    visit_YieldFrom = visit_Return  # type: ignore[assignment]

    def visit_Expr(self, node: ast.Expr) -> None:
        self._forward()
        self._leaf()

    def generic_visit(self, node: ast.AST) -> None:
        """Emit a single forward step for any unrecognised node, then descend."""
        if isinstance(node, ast.stmt):
            self._forward()
        super().generic_visit(node)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _collect_body(self, stmts: list[Any]) -> str:
        """Visit a list of statements and return the accumulated commands."""
        saved = self.commands
        self.commands = []
        for stmt in stmts:
            self.visit(stmt)
        result = "".join(self.commands)
        self.commands = saved
        return result


def python_to_lsystem(source: str) -> str:
    """
    Parse *source* as Python code and return the L-system string.

    Raises ``ValueError`` on syntax errors.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise ValueError(f"Python syntax error: {exc}") from exc

    visitor = BonsaiVisitor()

    # Seed the trunk: a few unconditional forward steps
    visitor.commands = ["F", "F", "F"]
    for node in tree.body:
        visitor.visit(node)

    return "".join(visitor.commands)


# ---------------------------------------------------------------------------
# API models
# ---------------------------------------------------------------------------

class GenerateBonsaiRequest(BaseModel):
    code: str


class GenerateBonsaiResponse(BaseModel):
    lsystem: str
    node_count: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/generate-bonsai", response_model=GenerateBonsaiResponse)
async def generate_bonsai(body: GenerateBonsaiRequest) -> GenerateBonsaiResponse:
    """
    Accept raw Python source code, parse it into an AST, and return the
    corresponding L-system string together with the total AST node count.
    """
    if not body.code.strip():
        raise HTTPException(status_code=400, detail="No code provided.")

    try:
        lsystem = python_to_lsystem(body.code)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        tree = ast.parse(body.code)
        node_count = sum(1 for _ in ast.walk(tree))
    except SyntaxError:
        node_count = 0

    return GenerateBonsaiResponse(lsystem=lsystem, node_count=node_count)
