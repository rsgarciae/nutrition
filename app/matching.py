"""Emparejamiento de los platillos del menú con la tabla de intercambios."""

from __future__ import annotations

from .normalize import ALIASES, EXTRA_FOODS, NOISE_WORDS, key, norm

FREE_KEYWORDS = {
    "mostaza", "salsa", "salsas", "sal", "limon", "te", "cafe", "agua",
    "endulzante", "stevia", "splenda", "vinagre", "especia", "especias",
    "condimento", "condimentos", "chile", "pimienta", "oregano", "canela",
    "cilantro", "ajo", "cebolla en polvo", "jamaica", "gelatina light",
    "salsa picante", "salsa maggi", "tajin", "vainilla",
}

UNIT_FAMILY = {
    "pieza": "pieza", "piezas": "pieza", "pza": "pieza", "pzas": "pieza",
    "taza": "taza", "tazas": "taza",
    "cucharada": "cucharada", "cucharadas": "cucharada",
    "cucharadita": "cucharadita", "cucharaditas": "cucharadita",
    "cdita": "cucharadita", "cdta": "cucharadita", "cditas": "cucharadita",
    "rebanada": "rebanada", "rebanadas": "rebanada",
}


def _tokens(text: str) -> list[str]:
    return [t for t in norm(text).split() if t]


def build_index(foods: list[dict]) -> dict:
    by_key = {}
    for f in foods:
        by_key.setdefault(key(f["name"]), f)
    extra = {}
    for name, category, grams, measure in EXTRA_FOODS:
        extra[key(name)] = {
            "id": f"{category}/{key(name)}",
            "name": name,
            "category": category,
            "grams": grams,
            "measure": measure,
            "unit": "g",
            "source": "extra",
        }
    return {"by_key": by_key, "extra": extra}


def is_free(text: str) -> bool:
    toks = _tokens(text)
    if not toks:
        return False
    if "gusto" in toks:
        return True
    joined = " ".join(toks)
    if "sin azucar" in joined or "sin grasa" in joined and "totopos" not in joined:
        pass
    for kw in FREE_KEYWORDS:
        if kw in toks or joined.startswith(kw + " ") or joined == kw:
            return True
    return False


def match_food(name: str, index: dict):
    """Devuelve (alimento, motivo). `alimento` puede ser None."""
    n = norm(name)
    if not n:
        return None, "vacío"

    # 1) alias exacto
    alias = ALIASES.get(n)
    if alias:
        food = _lookup(alias, index)
        if food:
            return food, "alias"

    # 2) quitar palabras finales ("pechuga de pollo asada" -> "pechuga de pollo")
    toks = n.split()
    for i in range(len(toks) - 1, 0, -1):
        cand = " ".join(toks[:i])
        alias = ALIASES.get(cand)
        if alias:
            food = _lookup(alias, index)
            if food:
                return food, "alias-parcial"

    # 3) quitar palabras de relleno y buscar por clave
    filtered = [t for t in toks if t not in NOISE_WORDS]
    for size in (len(filtered), max(1, len(filtered) - 1)):
        cand = " ".join(filtered[:size])
        if not cand:
            continue
        food = index["by_key"].get(key(cand)) or index["extra"].get(key(cand))
        if food:
            return food, "clave"

    # 4) coincidencia por tokens contra nombres de la tabla / extras
    best = None
    best_score = 0.0
    target = set(filtered)
    for pool in (index["by_key"].values(), index["extra"].values()):
        for f in pool:
            ftoks = set(_tokens(f["name"]))
            if not ftoks:
                continue
            inter = len(target & ftoks)
            # se exige que el alimento cubra la mayor parte de lo escrito
            score = inter / max(len(target), 1)
            if inter and score > best_score:
                best, best_score = f, score
    if best is not None and best_score > 0.5:
        return best, "difuso"

    return None, "sin coincidencia"


def _lookup(name: str, index: dict):
    if not name:
        return None
    k = key(name)
    return index["extra"].get(k) or index["by_key"].get(k)


def _family(unit: str | None) -> str | None:
    if not unit:
        return None
    return UNIT_FAMILY.get(unit.lower(), unit.lower())


def exchanges_for(item: dict, food: dict) -> float:
    grams = food.get("grams")
    qty = food.get("measureQty")
    unit = _family(food.get("measureUnit"))

    if item.get("grams") and grams:
        return item["grams"] / grams
    if item.get("count") and qty:
        if unit and _family(item.get("unit")) == unit:
            return item["count"] / qty
        # unidades distintas: aproximación por gramos por unidad
        return item["count"] / qty
    return 1.0


def snap(count: float) -> float:
    if not count or count <= 0:
        return 0.0
    return max(0.5, round(count * 2) / 2)
