import json, urllib.request, pathlib, shutil

BASE = "http://127.0.0.1:8000"
ROOT = pathlib.Path(__file__).resolve().parent.parent


def get(path):
    return json.load(urllib.request.urlopen(BASE + path))


def post(path, payload):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(req))


# 1) estado limpio
shutil.rmtree(ROOT / "dietas" / "diciembre2026", ignore_errors=True)
post("/api/reset", {})
state = get("/api/state")
print("1. meses:", [m["id"] for m in state["months"]])

# 2) editar el plan de noviembre a mano
nov = next(m for m in state["months"] if m["id"] == "2026-11")
slot = nov["options"][0]["meals"][0]["slots"][0]
print("2. antes:", slot["foodId"])
slot["foodId"] = "aoa_moderado/carnedeshebrada"
post("/api/plan", {"plan": {"id": "2026-11", "options": nov["options"]}, "kcalTarget": nov["kcalTarget"]})

# 3) aparece un mes nuevo en disco
dest = ROOT / "dietas" / "diciembre2026"
dest.mkdir(exist_ok=True)
shutil.copyfile(ROOT / "dietas/noviembre2026/Rodolfo García Escobar.pdf", dest / "Menu diciembre.pdf")

# 4) ¿se conservó la edición?
state2 = get("/api/state")
nov2 = next(m for m in state2["months"] if m["id"] == "2026-11")
print("3. meses:", [m["id"] for m in state2["months"]], "| activo:", state2["meta"]["activeMonth"])
print("4. después:", nov2["options"][0]["meals"][0]["slots"][0]["foodId"],
      "->", "CONSERVADO" if nov2["options"][0]["meals"][0]["slots"][0]["foodId"] == "aoa_moderado/carnedeshebrada" else "PERDIDO")

# limpieza
shutil.rmtree(dest, ignore_errors=True)
post("/api/reset", {})
print("5. limpio:", [m["id"] for m in get("/api/state")["months"]])
