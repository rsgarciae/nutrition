"""Construcción, persistencia y edición del estado de la aplicación.

Un mes = una carpeta dentro de `dietas/` (por ejemplo `dietas/noviembre2026/`).
Cada carpeta puede traer la tabla de intercambios y/o el menú. La tabla más
reciente se reutiliza para todos los meses, así que al mes siguiente basta con
subir el menú.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
from pathlib import Path

from .categories import CATEGORIES, CATEGORY_ORDER
from .matching import build_index, exchanges_for, is_free, match_food, snap
from .normalize import EXTRA_FOODS, key, norm, strip_accents
from .parse_menu import parse_pdf as parse_menu_pdf
from .parse_table import parse_pdf as parse_table_pdf

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("NUTRI_DATA_DIR", ROOT / "data"))
DIETAS_DIR = Path(os.environ.get("NUTRI_DIETAS_DIR", ROOT / "dietas"))
LEGACY_FOLDER = Path(os.environ.get("NUTRI_PDF_FOLDER", ROOT / "noviembre2026"))
STATE_FILE = DATA_DIR / "state.json"

STATE_VERSION = 2

MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}
MES_NOMBRE = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril", 5: "Mayo", 6: "Junio",
    7: "Julio", 8: "Agosto", 9: "Septiembre", 10: "Octubre", 11: "Noviembre",
    12: "Diciembre",
}

FREE_FOODS = [
    {
        "group": "Bebidas",
        "items": [
            "Agua natural", "Agua mineral", "Té natural o de sobre sin azúcar",
            "Café americano sin azúcar", "Agua de sabor sin azúcar (Zuko, Tank, Clight, Frutevia, Kool-aid, Sabifrut)",
            "Endulzantes: Stevia, Splenda, Monk Fruit", "Refrescos y bebidas dietéticas sin kcal",
            "Bebida con electrolitos sin azúcar (Suerox, Electrolit sin azúcar)",
            "Agua de jamaica", "Limonada y té helado ligeramente endulzado",
            "Caldo vegetal o desgrasado",
        ],
    },
    {
        "group": "Verduras libres",
        "items": [
            "Acelga", "Arúgula", "Apio", "Brócoli", "Berro", "Espinaca",
            "Flor de calabaza", "Germen de soya", "Germen de alfalfa", "Lechuga",
            "Nopal", "Pepino", "Rábano", "Chiles (jalapeño, habanero, árbol, seco, piquín)",
            "Limón",
        ],
    },
    {
        "group": "Condimentos y especias",
        "items": [
            "Ajo", "Cebolla", "Pimienta", "Orégano", "Tajín", "Salsa picante",
            "Cilantro", "Clavo", "Comino", "Laurel", "Hinojo", "Perejil",
            "Romero", "Menta", "Salsa Maggi sin azúcar", "Canela", "Mostaza",
            "Vainilla",
        ],
    },
    {
        "group": "Postres y otros",
        "items": ["Gelatina light", "Chicles sin azúcar (Trident, Orbit)"],
    },
]


# --------------------------------------------------------------------------
# nombres de mes
# --------------------------------------------------------------------------


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", norm(text)).strip("-")
    return s or "alimento"


def parse_month(name: str):
    """'noviembre2026' / 'Noviembre 2026' / '2026-11' -> (2026, 11)."""
    n = re.sub(r"\s+", "", strip_accents(str(name)).lower())
    m = re.fullmatch(r"([a-z]+)[-_]?(\d{4})", n)
    if m and m.group(1) in MESES:
        return (int(m.group(2)), MESES[m.group(1)])
    m = re.fullmatch(r"(\d{4})[-_]?(\d{1,2})", n)
    if m and 1 <= int(m.group(2)) <= 12:
        return (int(m.group(1)), int(m.group(2)))
    m = re.fullmatch(r"(\d{1,2})[-_](\d{4})", n)
    if m and 1 <= int(m.group(1)) <= 12:
        return (int(m.group(2)), int(m.group(1)))
    return None


def month_id(folder: str) -> str:
    parsed = parse_month(folder)
    return f"{parsed[0]:04d}-{parsed[1]:02d}" if parsed else slug(folder)


def month_label(folder: str) -> str:
    parsed = parse_month(folder)
    if parsed:
        return f"{MES_NOMBRE[parsed[1]]} {parsed[0]}"
    return folder.replace("_", " ").replace("-", " ").title()


# --------------------------------------------------------------------------
# detección de documentos
# --------------------------------------------------------------------------


def classify_pdf(path: Path) -> str | None:
    """Devuelve 'tabla', 'menu' u otra cosa, mirando el texto del PDF."""
    import pdfplumber

    try:
        with pdfplumber.open(path) as pdf:
            text = "\n".join((p.extract_text() or "") for p in pdf.pages[:4])
    except Exception:
        return None
    up = text.upper()
    if "DESAYUNO" in up and "COMIDA" in up:
        return "menu"
    if "MEDIDA" in up and "ALIMENTO" in up:
        return "tabla"
    return None


def _month_dirs() -> list[Path]:
    """Carpetas que representan un mes."""
    dirs: list[Path] = []
    if DIETAS_DIR.is_dir():
        dirs = [d for d in DIETAS_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")]
        if not dirs and any(DIETAS_DIR.glob("*.pdf")):
            dirs = [DIETAS_DIR]
    if not dirs and LEGACY_FOLDER.is_dir():
        dirs = [LEGACY_FOLDER]
    return dirs


def discover_months() -> list[dict]:
    """Lista de meses (carpetas) ordenada del más antiguo al más reciente."""
    months: list[dict] = []
    for folder in _month_dirs():
        pdfs = sorted(p for p in folder.glob("*.pdf") if p.is_file())
        if not pdfs:
            continue
        tables, menus = [], []
        for pdf in pdfs:
            kind = classify_pdf(pdf)
            if kind == "tabla":
                tables.append(pdf)
            elif kind == "menu":
                menus.append(pdf)
        tables.sort(key=lambda p: p.stat().st_mtime)
        menus.sort(key=lambda p: p.stat().st_mtime)
        parsed = parse_month(folder.name)
        sort_key = (0, parsed[0], parsed[1], 0.0) if parsed else (
            1, 0, 0, max(p.stat().st_mtime for p in pdfs)
        )
        menu = menus[-1] if menus else None
        months.append(
            {
                "id": month_id(folder.name),
                "label": month_label(folder.name),
                "folder": folder.name,
                "path": str(folder),
                "table": tables[-1] if tables else None,
                "menu": menu,
                "stamp": (
                    f"{menu.name}@{int(menu.stat().st_mtime)}" if menu else None
                ),
                "_sort": sort_key,
            }
        )
    months.sort(key=lambda m: m["_sort"])
    return months


def month_dir(name: str) -> Path:
    """Carpeta destino para un mes (la crea si hace falta)."""
    clean = re.sub(r"[^A-Za-z0-9 _\-]", "", (name or "").strip())[:40]
    if not clean:
        raise ValueError("Nombre de mes inválido.")
    folder = DIETAS_DIR / clean
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _fingerprint() -> str:
    """Huella del contenido de `dietas/` para detectar cambios en disco."""
    parts = []
    for folder in sorted(_month_dirs(), key=lambda p: p.name):
        pdfs = sorted(p for p in folder.glob("*.pdf") if p.is_file())
        if not pdfs:
            continue
        items = ",".join(f"{p.name}@{int(p.stat().st_mtime)}" for p in pdfs)
        parts.append(f"{folder.name}:[{items}]")
    return "|".join(parts)


# --------------------------------------------------------------------------
# construcción
# --------------------------------------------------------------------------


def _extra_food_rows() -> list[dict]:
    rows = []
    for name, category, grams, measure in EXTRA_FOODS:
        rows.append(
            {
                "id": f"{category}/{key(name)}",
                "name": name,
                "category": category,
                "measure": measure,
                "grams": float(grams),
                "unit": "g",
                "source": "extra",
            }
        )
    return rows


def build_foods(table_path: Path | None, previous: dict | None):
    warnings: list[str] = []
    foods: list[dict] = []

    if table_path is not None:
        try:
            res = parse_table_pdf(str(table_path))
            foods.extend(res["foods"])
            warnings.extend(f"{table_path.name}: {w}" for w in res["warnings"])
        except Exception as exc:  # pragma: no cover
            warnings.append(f"No se pudo leer {table_path.name}: {exc}")

    if not foods and previous:
        # sin tabla nueva: se conserva la del mes anterior
        foods = [f for f in previous.get("foods", []) if f.get("source") in ("tabla", "extra")]
        if foods:
            warnings.append(
                "No hay tabla de intercambios nueva: se reutiliza la última guardada."
            )

    existing = {key(f["name"]) for f in foods}
    for row in _extra_food_rows():
        if key(row["name"]) not in existing:
            foods.append(row)
            existing.add(key(row["name"]))

    if previous:
        for f in previous.get("foods", []):
            if f.get("source") == "custom" and key(f["name"]) not in existing:
                foods.append(f)
                existing.add(key(f["name"]))

    order = {cid: i for i, cid in enumerate(CATEGORY_ORDER)}
    foods.sort(key=lambda f: (order.get(f["category"], 99), key(f["name"])))
    return foods, warnings


def build_month(month: dict, foods: list[dict]) -> dict:
    index = build_index(foods)
    result = {
        "id": month["id"],
        "label": month["label"],
        "folder": month["folder"],
        "menuFile": month["menu"].name if month["menu"] else None,
        "menuStamp": month.get("stamp"),
        "patient": None,
        "kcalTarget": None,
        "options": [],
        "warnings": [],
    }
    if month["menu"] is None:
        result["warnings"].append(
            f"La carpeta «{month['folder']}» no tiene un menú (PDF con Desayuno/Comida/Cena)."
        )
        return result

    result["patient"] = re.sub(r"\.pdf$", "", month["menu"].name, flags=re.I).strip()
    try:
        raw = parse_menu_pdf(str(month["menu"]))
    except Exception as exc:
        result["warnings"].append(f"No se pudo leer el menú: {exc}")
        return result

    result["kcalTarget"] = raw.get("kcalTarget")
    for opt in raw["options"]:
        meals = []
        for meal in opt["meals"]:
            slots, free, unmatched = [], [], []
            for item in meal["items"]:
                if is_free(item["name"]):
                    free.append(item["text"])
                    continue
                food, _reason = match_food(item["name"], index)
                if food is None:
                    unmatched.append(item["text"])
                    continue
                count = snap(exchanges_for(item, food))
                if count <= 0:
                    continue
                slots.append(
                    {
                        "category": food["category"],
                        "foodId": food["id"],
                        "count": count,
                        "note": item["text"],
                        "original": {
                            "grams": item.get("grams"),
                            "count": item.get("count"),
                            "unit": item.get("unit"),
                        },
                    }
                )
            meals.append(
                {
                    "id": meal["id"],
                    "name": meal["name"],
                    "title": meal["title"],
                    "slots": slots,
                    "free": free,
                    "unmatched": unmatched,
                }
            )
            for text in unmatched:
                result["warnings"].append(
                    f"{meal['name']}: sin equivalencia «{text}»."
                )
        options = result["options"]
        options.append({"id": opt["id"], "name": opt["name"], "meals": meals})
    return result


def build_state(active: str | None = None, keep_edits: bool = True,
                refresh: list[str] | None = None) -> dict:
    previous = _read_state()
    months_meta = discover_months()
    refresh_ids = set(refresh or [])
    prev_months = {m.get("id"): m for m in (previous or {}).get("months", []) if m}

    table_path = None
    for m in months_meta:  # ordenados del más viejo al más nuevo
        if m["table"] is not None:
            table_path = m["table"]

    foods, warnings = build_foods(table_path, previous)

    months = []
    for meta in months_meta:
        if meta["menu"] is None:
            continue
        built = build_month(meta, foods)
        prev = prev_months.get(built["id"])
        unchanged = (
            prev is not None
            and prev.get("menuStamp")
            and prev.get("menuStamp") == built.get("menuStamp")
        )
        if keep_edits and unchanged and built["id"] not in refresh_ids and prev.get("options"):
            # el menú no cambió: se conservan los ajustes hechos a mano
            built["options"] = prev["options"]
            built["kcalTarget"] = prev.get("kcalTarget") or built["kcalTarget"]
            built["patient"] = prev.get("patient") or built["patient"]
            built["warnings"] = prev.get("warnings", [])
        months.append(built)
    if not months:
        months = [build_month(m, foods) for m in months_meta]

    ids = [m["id"] for m in months]
    if active in ids:
        active_month = active
    elif previous and previous.get("activeMonth") in ids:
        active_month = previous["activeMonth"]
    else:
        active_month = ids[-1] if ids else None

    active_data = next((m for m in months if m["id"] == active_month), None)
    patient = None
    for m in reversed(months):
        if m.get("patient"):
            patient = m["patient"]
            break

    month_warnings = []
    for m in months:
        month_warnings.extend(f"[{m['label']}] {w}" for w in m["warnings"])

    return {
        "version": STATE_VERSION,
        "meta": {
            "patient": patient or "Paciente",
            "activeMonth": active_month,
            "kcalTarget": (active_data or {}).get("kcalTarget"),
            "builtAt": dt.datetime.now().isoformat(timespec="seconds"),
            "dietasDir": str(DIETAS_DIR),
            "tableFile": table_path.name if table_path else None,
            "tableFolder": table_path.parent.name if table_path else None,
            "menuFile": (active_data or {}).get("menuFile"),
            "fingerprint": _fingerprint(),
        },
        "categories": CATEGORIES,
        "foods": foods,
        "freeFoods": FREE_FOODS,
        "months": months,
        "warnings": warnings + month_warnings,
    }


# --------------------------------------------------------------------------
# persistencia
# --------------------------------------------------------------------------


def _read_state() -> dict | None:
    if not STATE_FILE.exists():
        return None
    try:
        data = json.loads(STATE_FILE.read_text("utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def save_state(state: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), "utf-8")


def load_state() -> dict:
    data = _read_state()
    fresh = data and data.get("version") == STATE_VERSION and isinstance(data.get("months"), list)
    if fresh and data.get("meta", {}).get("fingerprint") == _fingerprint():
        return data
    # se agregó/cambió algún PDF en `dietas/`: se reconstruye conservando ajustes
    state = build_state()
    save_state(state)
    return state


def reset_state() -> dict:
    state = build_state(keep_edits=False)
    save_state(state)
    return state


def set_active(state: dict, month: str) -> dict:
    ids = [m["id"] for m in state.get("months", [])]
    if month not in ids:
        raise ValueError("Mes no encontrado.")
    state["meta"]["activeMonth"] = month
    active = next(m for m in state["months"] if m["id"] == month)
    state["meta"]["kcalTarget"] = active.get("kcalTarget")
    state["meta"]["menuFile"] = active.get("menuFile")
    save_state(state)
    return state


def save_month_plan(state: dict, payload: dict) -> dict:
    """Guarda los cambios hechos en el plan de un mes."""
    plan = payload.get("plan") or {}
    month_ref = plan.get("id") or payload.get("monthId") or state["meta"].get("activeMonth")
    target = next((m for m in state.get("months", []) if m["id"] == month_ref), None)
    if target is None:
        raise ValueError("Mes no encontrado.")
    if "options" in plan:
        target["options"] = plan["options"]
    if payload.get("kcalTarget") is not None:
        target["kcalTarget"] = payload["kcalTarget"]
    if state["meta"].get("activeMonth") == month_ref:
        state["meta"]["kcalTarget"] = target.get("kcalTarget")
    save_state(state)
    return state


# --------------------------------------------------------------------------
# alimentos
# --------------------------------------------------------------------------


def add_food(state: dict, payload: dict) -> dict:
    name = (payload.get("name") or "").strip()
    category = payload.get("category")
    if not name:
        raise ValueError("Falta el nombre del alimento.")
    if category not in CATEGORY_ORDER:
        raise ValueError("Grupo de intercambio inválido.")
    grams = payload.get("grams")
    try:
        grams = float(grams) if grams not in (None, "") else None
    except (TypeError, ValueError):
        raise ValueError("Los gramos deben ser un número.")
    if not grams or grams <= 0:
        raise ValueError("Indica los gramos que equivalen a una porción.")

    food_id = f"custom/{slug(name)}"
    state["foods"] = [f for f in state["foods"] if f["id"] != food_id]
    state["foods"].append(
        {
            "id": food_id,
            "name": name,
            "category": category,
            "measure": (payload.get("measure") or "").strip() or f"{grams:g} g",
            "grams": grams,
            "unit": "g",
            "source": "custom",
        }
    )
    save_state(state)
    return state


def update_food(state: dict, food_id: str, payload: dict) -> dict:
    for food in state["foods"]:
        if food["id"] != food_id:
            continue
        if payload.get("name"):
            food["name"] = payload["name"].strip()
        if payload.get("measure") is not None:
            food["measure"] = str(payload["measure"]).strip()
        if payload.get("category") in CATEGORY_ORDER:
            food["category"] = payload["category"]
        if payload.get("grams") not in (None, ""):
            food["grams"] = float(payload["grams"])
        food["source"] = food.get("source") or "custom"
        save_state(state)
        return state
    raise ValueError("Alimento no encontrado.")


def delete_food(state: dict, food_id: str) -> dict:
    state["foods"] = [f for f in state["foods"] if f["id"] != food_id]
    save_state(state)
    return state
