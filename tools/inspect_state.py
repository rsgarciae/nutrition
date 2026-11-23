"""Dump the generated state: months, plans, portions and warnings.

Usage:  python tools/inspect_state.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.store import build_state  # noqa: E402

state = build_state()
meta = state["meta"]

print(f"paciente : {meta['patient']}")
print(f"activo   : {meta['activeMonth']} ({meta['kcalTarget']} kcal)")
print(f"tabla    : {meta['tableFile']} (de {meta['tableFolder']})")
print(f"alimentos: {len(state['foods'])}")
print(f"meses    : {[m['id'] for m in state['months']]}")
print(f"avisos   : {len(state['warnings'])}")
for w in state["warnings"]:
    print("   -", w)

for month in state["months"]:
    print(f"\n===== {month['label']}  ({month['folder']}) =====")
    for opt in month["options"]:
        total = sum(len(meal["slots"]) for meal in opt["meals"])
        print(f"  {opt['name']} · {total} porciones")
        for meal in opt["meals"]:
            print(f"    {meal['name']}: {meal['title']}")
            for slot in meal["slots"]:
                print(
                    f"      {slot['count']:>4} x {slot['category']:<22}"
                    f" {slot['foodId']:<42} {slot['note']}"
                )
            if meal["free"]:
                print(f"      libres: {meal['free']}")
            if meal["unmatched"]:
                print(f"      SIN EQUIVALENCIA: {meal['unmatched']}")
