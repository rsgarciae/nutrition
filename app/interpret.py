"""Interpretación de texto libre: «pechuga de pollo con arroz y aguacate»."""

from __future__ import annotations

import re

from .matching import match_food

CONNECTORS = {"con", "y", "e", "mas", "más", "+", "&", "/"}


def _split_match(chunk: str, index: dict, depth: int = 0):
    chunk = chunk.strip(" .;")
    if not chunk:
        return []
    toks = chunk.split()
    if depth < 4:
        for i, tok in enumerate(toks):
            if tok.lower() in CONNECTORS and 0 < i < len(toks) - 1:
                left = " ".join(toks[:i])
                right = " ".join(toks[i + 1:])
                left_food, _ = match_food(left, index)
                if not left_food:
                    continue
                rest = _split_match(right, index, depth + 1)
                if rest and all(r["food"] for r in rest):
                    return [{"text": left, "food": left_food, "how": "split"}] + rest
    food, reason = match_food(chunk, index)
    return [{"text": chunk, "food": food, "how": reason}]


def interpret(text: str, index: dict) -> list[dict]:
    out: list[dict] = []
    for chunk in re.split(r"[,;\n]|\s\+\s", text or ""):
        if not chunk or not chunk.strip():
            continue
        out.extend(_split_match(chunk, index))
    results = []
    for item in out:
        food = item["food"]
        results.append(
            {
                "text": item["text"],
                "matched": bool(food),
                "foodId": food["id"] if food else None,
                "name": food["name"] if food else item["text"],
                "category": food["category"] if food else None,
                "grams": food.get("grams") if food else None,
                "measure": food.get("measure") if food else None,
            }
        )
    return results
