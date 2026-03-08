import asyncio
import ast
import unittest

from fastapi import HTTPException

from backend.main import (
    GenerateBonsaiRequest,
    generate_bonsai,
    python_to_lsystem,
)


class PythonToLSystemTests(unittest.TestCase):
    def test_python_to_lsystem_maps_function_body(self) -> None:
        code = "def foo():\n    x = 1\n    return x\n"
        result = python_to_lsystem(code)
        self.assertEqual(result, "FFFF+[FLFLL]F")

    def test_python_to_lsystem_rejects_invalid_syntax(self) -> None:
        with self.assertRaises(ValueError):
            python_to_lsystem("def broken(:\n    pass")


class GenerateBonsaiTests(unittest.TestCase):
    def test_generate_bonsai_returns_lsystem_and_node_count(self) -> None:
        code = "a = 1\nif a:\n    def inner():\n        return a\n"
        request = GenerateBonsaiRequest(code=code)
        result = asyncio.run(generate_bonsai(request))

        expected_tree = ast.parse(code)
        expected_node_count = sum(1 for _ in ast.walk(expected_tree))

        self.assertEqual(result.lsystem, python_to_lsystem(code))
        self.assertEqual(result.node_count, expected_node_count)

    def test_generate_bonsai_rejects_empty_code(self) -> None:
        request = GenerateBonsaiRequest(code="   ")
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(generate_bonsai(request))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, "No code provided.")

    def test_generate_bonsai_reports_syntax_error(self) -> None:
        request = GenerateBonsaiRequest(code="if True print('oops')")
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(generate_bonsai(request))
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("Python syntax error", ctx.exception.detail)


if __name__ == "__main__":
    unittest.main()
