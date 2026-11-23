"""Parser de la "TABLA DE INTERCAMBIOS" (PDF en formato de tablas).

Cada página tiene varias tablas con las columnas ALIMENTO / MEDIDA CASERA / GR.
Se reconstruyen a partir de las coordenadas de las palabras.
"""

from __future__ import annotations

import re
from typing import Any

import pdfplumber

from .normalize import CANONICAL, canonical, fallback_grams, key, norm

ROW_TOL = 5.0

UNITS = (
    "tazas", "taza", "piezas", "pieza", "pzas", "pza", "cucharadas",
    "cucharada", "cucharaditas", "cucharadita", "cditas", "cdita", "cdta",
    "rebanadas", "rebanada", "segundos", "gramos", "sobre", "scoop", "ml", "g",
)

NUMBER_RE = re.compile(r"^\d+(?:[.,]\d+)?$")

# Filas cuyos nombres vienen como imagen (sin texto) en la plantilla del PDF.
# Se reparan por (categoría, medida, gramos).
NAME_REPAIRS = {
    ("cereales_sin_grasa", "14taza", 16): "Amaranto tostado natural",
    ("cereales_sin_grasa", "14taza", 47): "Arroz cocido",
    ("cereales_sin_grasa", "13taza", 65): "Arroz integral",
    ("cereales_sin_grasa", "34taza", 164): "Avena cocida",
    ("cereales_sin_grasa", "34taza", 75): "Camote cocido",
}

SECTION_PATTERNS = [
    ("azucares", ("azucares sin grasa",)),
    ("leguminosas", ("leguminosas",)),
    ("aoa_muy_bajo", ("muy bajo aporte",)),
    ("aoa_bajo", ("bajo aporte",)),
    ("aoa_moderado", ("moderado aporte",)),
    ("aoa_alto", ("alto aporte",)),
    ("leche_semidescremada", ("semidescremada",)),
    ("leche_descremada", ("leche descremada",)),
    ("leche_entera", ("leche entera",)),
    ("verduras", ("verduras",)),
    ("frutas", ("frutas",)),
    ("cereales_con_grasa", ("con grasa",)),
    ("cereales_sin_grasa", ("sin grasa",)),
    ("grasas_sin_proteina", ("sin proteina",)),
    ("grasas_con_proteina", ("con proteina",)),
    ("azucares", ("azucares",)),
]


def _group_rows(words: list[dict], tol: float = ROW_TOL) -> list[list[dict]]:
    words = sorted(words, key=lambda w: (w["top"], w["x0"]))
    rows: list[list[dict]] = []
    for w in words:
        if rows and abs(w["top"] - rows[-1][0]["top"]) <= tol:
            rows[-1].append(w)
        else:
            rows.append([w])
    return [sorted(r, key=lambda w: w["x0"]) for r in rows]


def _resolve_section(text: str) -> str | None:
    low = norm(text)
    if not low:
        return None
    for category, patterns in SECTION_PATTERNS:
        for p in patterns:
            if p in low:
                return category
    return None


def _parse_measure(text: str):
    text = str(text or "").replace("—", " ").strip()
    if not text:
        return None
    tokens = text.split()
    qty = 0.0
    unit = None
    idx = 0
    while idx < len(tokens):
        tok = tokens[idx].lower()
        if re.fullmatch(r"\d+/\d+", tok):
            num, den = tok.split("/")
            qty += float(num) / float(den)
            idx += 1
            continue
        if NUMBER_RE.match(tok):
            if idx + 1 < len(tokens) and re.fullmatch(r"\d+/\d+", tokens[idx + 1]):
                qty += float(tok)
                idx += 1
                continue
            qty = qty + float(tok) if qty else float(tok)
            idx += 1
            continue
        if unit is None and tok in UNITS:
            unit = tok
        idx += 1
    if unit is None:
        return None
    return (qty or 1.0, unit)


def _num(text: str):
    text = str(text or "").replace(",", ".").strip()
    m = re.search(r"\d+(?:\.\d+)?", text)
    return float(m.group(0)) if m else None


def _is_header_row(row: list[dict]) -> bool:
    ups = [w["text"].upper() for w in row]
    has_alimento = any(u.startswith("ALIMENTO") for u in ups)
    has_cols = any(u.startswith("MEDIDA") for u in ups) or any(
        u.startswith("CASERA") for u in ups
    )
    return has_alimento and has_cols


def _header_columns(row: list[dict]):
    measure_x = grams_x = None
    unit_label = "g"
    for w in row:
        up = w["text"].upper()
        if up.startswith("MEDIDA") and measure_x is None:
            measure_x = w["x0"] - 12
        if up.startswith("CASERA"):
            nxt = [x for x in row if x["x0"] > w["x0"] + 1]
            if nxt:
                grams_x = nxt[0]["x0"] - 8
                unit_label = "ml" if nxt[0]["text"].upper().startswith("ML") else "g"
        elif up.startswith("GR"):
            grams_x = w["x0"] - 8
            unit_label = "g"
    return measure_x, grams_x, unit_label


def _cells(row, measure_x, grams_x):
    name = " ".join(w["text"] for w in row if w["x0"] < measure_x)
    measure = " ".join(w["text"] for w in row if measure_x <= w["x0"] < grams_x)
    grams = " ".join(w["text"] for w in row if w["x0"] >= grams_x)
    return name.strip(), measure.strip(), grams.strip()


def _is_data_row(row, measure_x, grams_x) -> bool:
    if measure_x is None or grams_x is None:
        return False
    name, measure, grams = _cells(row, measure_x, grams_x)
    if name and not re.match(r"^[A-Za-zÁÉÍÓÚÑáéíóúñ]", name):
        return False
    low = norm(name)
    if "porcion" in low or "tamano" in low or "kcal" in low:
        return False
    # los títulos de sección van en MAYÚSCULAS ("LECHE DESCREMADA")
    if name and name == name.upper():
        return False
    if _parse_measure(measure) is not None:
        return True
    if _num(grams) is not None and norm(measure) in ("", "-"):
        return bool(name) and key(name) in CANONICAL
    return False


def parse_pdf(path: str) -> dict[str, Any]:
    foods: list[dict] = []
    warnings: list[str] = []
    seen: set[tuple[str, str]] = set()

    with pdfplumber.open(path) as pdf:
        for page_no, page in enumerate(pdf.pages, 1):
            words = page.extract_words(keep_blank_chars=False)
            if not words:
                continue
            rows = _group_rows(words)

            header_xs: list[float] = []
            for row in rows:
                for w in row:
                    if w["text"].upper().startswith("ALIMENTO"):
                        header_xs.append(w["x0"])
            if not header_xs:
                continue

            header_xs.sort()
            centers: list[float] = []
            for x in header_xs:
                if centers and abs(x - centers[-1]) <= 70:
                    continue
                centers.append(x)

            bands: list[tuple[float, float]] = []
            for i, cx in enumerate(centers):
                left = max(0.0, cx - 40)
                right = centers[i + 1] - 40 if i + 1 < len(centers) else page.width
                bands.append((left, right))

            for band_left, band_right in bands:
                band_rows = []
                for row in rows:
                    sel = [w for w in row if band_left <= w["x0"] < band_right]
                    if sel:
                        band_rows.append(sel)
                if band_rows:
                    _parse_band(band_rows, foods, seen, warnings, page_no)

    return {"foods": foods, "warnings": warnings}


def _parse_band(band_rows, foods, seen, warnings, page_no):
    category = None
    measure_x = grams_x = None
    unit_label = "g"
    pending_title: list[str] = []
    in_table = False

    for row in band_rows:
        joined = " ".join(w["text"] for w in row).strip()

        if _is_header_row(row):
            measure_x, grams_x, unit_label = _header_columns(row)
            if measure_x is None:
                measure_x = min(w["x0"] for w in row) + 150
            if grams_x is None:
                grams_x = measure_x + 90
            found = _resolve_section(" ".join(pending_title))
            if found:
                category = found
            pending_title = []
            in_table = True
            continue

        if not in_table:
            pending_title.append(joined)
            continue

        if not _is_data_row(row, measure_x, grams_x):
            section = _resolve_section(joined)
            if section:
                category = section
            pending_title.append(joined)
            continue

        if category is None:
            warnings.append(
                f"Página {page_no}: se ignoró «{joined[:50]}» (sin grupo de intercambio)."
            )
            continue

        name_cell, measure_cell, grams_cell = _cells(row, measure_x, grams_x)
        measure = _normalize_measure_text(measure_cell)
        grams = _num(grams_cell)

        name = canonical(name_cell)
        if not name:
            repair = NAME_REPAIRS.get((category, key(measure), grams))
            if repair:
                name = repair
            else:
                warnings.append(
                    f"Página {page_no}: fila sin nombre ({measure or 's/medida'}, "
                    f"{grams if grams is not None else 's/gramos'}) en «{category}»."
                )
                continue

        if "porcion" in norm(name) or "tamano" in norm(name):
            continue

        if grams is None:
            grams = fallback_grams(name)

        parsed_measure = _parse_measure(measure)
        if parsed_measure is None:
            m = re.search(r"\s(\d+(?:/\d+)?)$", name)
            if m:
                moved = f"{m.group(1)} {measure}".strip()
                if _parse_measure(moved) is not None:
                    measure = moved
                    parsed_measure = _parse_measure(moved)
                    name = canonical(name[: m.start()].strip())

        if grams is None and parsed_measure is None:
            warnings.append(f"Página {page_no}: «{name}» sin gramos ni medida.")
            continue

        dedupe = (category, key(name))
        if dedupe in seen:
            continue
        seen.add(dedupe)

        entry = {
            "id": f"{category}/{key(name)}",
            "name": name,
            "category": category,
            "measure": measure,
            "grams": grams,
            "unit": unit_label,
            "source": "tabla",
        }
        if parsed_measure:
            entry["measureQty"] = parsed_measure[0]
            entry["measureUnit"] = parsed_measure[1]
        if grams is None:
            warnings.append(
                f"Página {page_no}: «{name}» sin gramos en la tabla; usa la medida casera."
            )
        foods.append(entry)


def _normalize_measure_text(text: str) -> str:
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    return "" if set(text) <= {"-", "—", "–", "/"} else text
