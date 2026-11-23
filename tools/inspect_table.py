import sys, json
sys.path.insert(0, ".")
from app.parse_table import parse_pdf
from app.categories import CATEGORY_ORDER

res = parse_pdf("noviembre2026/TABLA DE INTERCAMBIOS.pdf")
by_cat = {}
for f in res["foods"]:
    by_cat.setdefault(f["category"], []).append(f)

for cat in CATEGORY_ORDER:
    items = by_cat.get(cat, [])
    print(f"\n### {cat}  ({len(items)})")
    for f in items:
        print(f"   {f['name']:<32} | {f['measure']:<18} | {f['grams']} {f['unit']}")
print("\n--- warnings ---")
for w in res["warnings"]:
    print("  ", w)
unknown = [c for c in by_cat if c not in CATEGORY_ORDER]
print("\ncategorias desconocidas:", unknown)
