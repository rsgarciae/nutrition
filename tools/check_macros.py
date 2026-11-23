"""Verifica la coherencia de los macros por grupo de intercambio y por comida.

Uso:  python tools/check_macros.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.categories import CATEGORIES  # noqa: E402
from app.store import build_state  # noqa: E402

CAL = {"p": 4, "c": 4, "f": 9}


def kcal_from_macros(m):
    return m["p"] * 4 + m["c"] * 4 + m["f"] * 9


print("== 1. Coherencia por grupo: kcal declaradas vs kcal de los macros ==")
problems = 0
for c in CATEGORIES:
    derived = kcal_from_macros(c["macros"])
    diff = derived - c["kcal"]
    tolerance = max(8, round(c["kcal"] * 0.08))
    ok = abs(diff) <= tolerance
    problems += 0 if ok else 1
    print(
        f"  {'OK ' if ok else 'REV'} {c['name']:<44} {c['kcal']:>3} kcal"
        f" | P{c['macros']['p']:>2} C{c['macros']['c']:>2} G{c['macros']['f']:>2}"
        f" -> {derived:>3} kcal ({diff:+d})"
    )
print(f"  grupos fuera de tolerancia: {problems}\n")

state = build_state()
month = next((m for m in state["months"] if m["id"] == state["meta"]["activeMonth"]), None)
if not month:
    raise SystemExit("Sin meses cargados.")

cats = {c["id"]: c for c in state["categories"]}


def totals(slots):
    out = {"kcal": 0, "p": 0, "c": 0, "f": 0}
    for s in slots:
        k = cats[s["category"]]
        out["kcal"] += s["count"] * k["kcal"]
        for macro in ("p", "c", "f"):
            out[macro] += s["count"] * k["macros"][macro]
    return {k: round(v) for k, v in out.items()}


print(f"== 2. {month['label']}: macros por comida y suma del día ==")
for opt in month["options"]:
    day = totals([s for meal in opt["meals"] for s in meal["slots"]])
    acc = {"kcal": 0, "p": 0, "c": 0, "f": 0}
    print(f"  {opt['name']}")
    for meal in opt["meals"]:
        t = totals(meal["slots"])
        for key in acc:
            acc[key] += t[key]
        print(
            f"    {meal['name']:<10} {t['kcal']:>4} kcal"
            f" | P {t['p']:>3} g  C {t['c']:>3} g  G {t['f']:>3} g"
        )
    same = all(abs(acc[k] - day[k]) <= 1 for k in day)
    print(
        f"    {'-' * 62}\n"
        f"    {'TOTAL':<10} {day['kcal']:>4} kcal"
        f" | P {day['p']:>3} g  C {day['c']:>3} g  G {day['f']:>3} g"
        f"   [suma por comida {'OK' if same else 'NO CUADRA'}]"
    )
    kcal_macros = day["p"] * 4 + day["c"] * 4 + day["f"] * 9
    print(
        f"    kcal desde macros: {kcal_macros} vs {day['kcal']} mostradas"
        f" ({kcal_macros - day['kcal']:+d})\n"
    )

print("== 3. Reparto de grasa por comida (objetivo del plan) ==")
opt = month["options"][0]
fat_total = totals([s for meal in opt["meals"] for s in meal["slots"]])["f"]
for meal in opt["meals"]:
    fat = totals(meal["slots"])["f"]
    share = round(100 * fat / fat_total) if fat_total else 0
    print(f"  {meal['name']:<10} G {fat:>3} g  = {share:>3}% del día")
print(f"  {'TOTAL':<10} G {fat_total:>3} g")
