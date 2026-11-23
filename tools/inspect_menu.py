import sys, json
sys.path.insert(0, ".")
from app.parse_menu import parse_pdf

res = parse_pdf("noviembre2026/Rodolfo García Escobar.pdf")
print("kcal target:", res["kcalTarget"])
for opt in res["options"]:
    print(f"\n===== {opt['name']} =====")
    for meal in opt["meals"]:
        print(f"  [{meal['name']}] {meal['title']}")
        for it in meal["items"]:
            print(f"     - {it['name']:<32} g={it['grams']}  {it['count']} {it['unit']}   ({it['text']})")
