"""Parser del documento de menú (PDF con columnas: una opción por columna).

Cada columna tiene los encabezados DESAYUNO / COLACIÓN / COMIDA / CENA y debajo
el platillo y sus ingredientes.
"""

from __future__ import annotations

import re
from typing import Any

import pdfplumber

from .normalize import norm

ROW_TOL = 5.0

MEAL_HEADERS = {
    "desayuno": "Desayuno",
    "colacion": "Colación",
    "comida": "Comida",
    "cena": "Cena",
}

UNIT_WORDS = {
    "pieza": "pieza", "piezas": "pieza", "pza": "pieza", "pzas": "pieza",
    "taza": "taza", "tazas": "taza",
    "cucharada": "cucharada", "cucharadas": "cucharada",
    "cucharadita": "cucharadita", "cucharaditas": "cucharadita",
    "cdita": "cucharadita", "cdta": "cucharadita", "cditas": "cucharadita",
    "rebanada": "rebanada", "rebanadas": "rebanada",
    "scoop": "scoop", "sobre": "sobre",
}

FRACTIONS = {"¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125}

NUM = r"(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛])"


def _group_rows(words: list[dict], tol: float = ROW_TOL) -> list[list[dict]]:
    words = sorted(words, key=lambda w: (w["top"], w["x0"]))
    rows: list[list[dict]] = []
    for w in words:
        if rows and abs(w["top"] - rows[-1][0]["top"]) <= tol:
            rows[-1].append(w)
        else:
            rows.append([w])
    return [sorted(r, key=lambda w: w["x0"]) for r in rows]


def _to_number(token: str) -> float:
    token = token.strip()
    if token in FRACTIONS:
        return FRACTIONS[token]
    if re.fullmatch(r"\d+\s+\d+/\d+", token):
        a, b = token.split()
        n, d = b.split("/")
        return float(a) + float(n) / float(d)
    if re.fullmatch(r"\d+/\d+", token):
        n, d = token.split("/")
        return float(n) / float(d)
    return float(token.replace(",", "."))


def parse_item(text: str) -> dict | None:
    """Convierte "Papa cocida, 1 pieza (180 g)" en un dict estructurado."""
    raw = re.sub(r"^[o•\-]\s*", "", str(text or "")).strip()
    if not raw:
        return None

    grams = None
    m = re.search(rf"({NUM})\s*(g|gr|grms|gramos|ml)\b", raw, re.I)
    if m:
        grams = _to_number(m.group(1))
        if m.group(2).lower() == "ml":
            grams = grams  # 1 ml ≈ 1 g

    count = unit = None
    for mm in re.finditer(rf"({NUM})\s*([A-Za-zÁÉÍÓÚÑáéíóúñ]+)", raw):
        u = mm.group(2).lower()
        if u in UNIT_WORDS:
            count = _to_number(mm.group(1))
            unit = UNIT_WORDS[u]
            break

    # nombre: texto antes de la primera coma o del primer número
    name = raw
    m = re.match(r"^(.*?),\s*(.*)$", raw)
    if m:
        name = m.group(1)
    else:
        m = re.match(rf"^(.*?)\s+{NUM}\b.*$", raw)
        if m:
            name = m.group(1)
    name = name.strip(" ,.;")
    if not name or not re.match(r"^[A-Za-zÁÉÍÓÚÑáéíóúñ]", name):
        return None

    return {
        "text": raw,
        "name": name,
        "grams": grams,
        "count": count,
        "unit": unit,
    }


def parse_pdf(path: str) -> dict[str, Any]:
    with pdfplumber.open(path) as pdf:
        page = pdf.pages[0]
        words = page.extract_words(keep_blank_chars=False)
        text = page.extract_text() or ""
        rows = _group_rows(words)

        # Columnas: a partir de la x de los encabezados de comida
        header_xs: list[float] = []
        for row in rows:
            for w in row:
                if norm(w["text"]) in MEAL_HEADERS:
                    header_xs.append(w["x0"])
        if not header_xs:
            raise ValueError(
                "No se encontraron encabezados (DESAYUNO / COMIDA / CENA) en el PDF del menú."
            )
        header_xs = sorted(header_xs)
        centers: list[float] = []
        for x in header_xs:
            if centers and abs(x - centers[-1]) <= 60:
                continue
            centers.append(x)

        # meta: KCAL objetivo
        kcal_target = None
        for m in re.finditer(r"(\d{3,4})\s*(?:KCAL|kcal|Kcal)", text):
            kcal_target = int(m.group(1))
        if kcal_target is None:
            for m in re.finditer(r"(?:KCAL|kcal|Kcal)\s*(\d{3,4})", text):
                kcal_target = int(m.group(1))

        options = []
        for idx, cx in enumerate(centers):
            left = cx - 30 if idx > 0 else 0.0
            right = centers[idx + 1] - 30 if idx + 1 < len(centers) else page.width
            col_rows = []
            for row in rows:
                sel = [w for w in row if left <= w["x0"] < right]
                if sel:
                    col_rows.append(sel)
            option = _parse_column(col_rows, idx + 1)
            if option["meals"]:
                options.append(option)

    return {
        "kcalTarget": kcal_target,
        "options": options,
    }


def _parse_column(col_rows, index: int) -> dict:
    meals: list[dict] = []
    current = None
    has_title = False

    for row in col_rows:
        joined = " ".join(w["text"] for w in row).strip()
        if not joined:
            continue

        head = norm(joined)
        meal_key = None
        for k in MEAL_HEADERS:
            if head == k or head.startswith(k + " "):
                meal_key = k
                break
        # línea que empieza con el encabezado de comida (puede traer más texto)
        if meal_key and len(head.split()) <= 2:
            current = {
                "id": f"{meal_key}-{len(meals) + 1}",
                "name": MEAL_HEADERS[meal_key],
                "title": "",
                "items": [],
            }
            meals.append(current)
            has_title = False
            continue

        if current is None:
            continue

        item = parse_item(joined)
        if item is None:
            if not has_title:
                current["title"] = joined.strip()
                has_title = True
            continue

        if not has_title and item["grams"] is None and item["count"] is None:
            current["title"] = joined.strip()
            has_title = True
            continue
        has_title = True

        if item["grams"] is None and item["count"] is None:
            continue
        current["items"].append(item)

    return {"id": f"opcion-{index}", "name": f"Opción {index}", "meals": meals}
