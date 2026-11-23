"""Servidor web: API + front-end estático."""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .interpret import interpret
from .matching import build_index
from .store import (
    DIETAS_DIR,
    add_food,
    build_state,
    classify_pdf,
    delete_food,
    load_state,
    month_dir,
    reset_state,
    save_month_plan,
    save_state,
    set_active,
    update_food,
)

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"

app = FastAPI(title="Nutri · Equivalencias", version="2.0")


@app.get("/api/state")
def get_state():
    return load_state()


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/interpret")
def interpret_text(payload: dict = Body(...)):
    text = (payload or {}).get("text", "")
    state = load_state()
    index = build_index(state["foods"])
    return {"items": interpret(text, index)}


@app.post("/api/reset")
def post_reset():
    return reset_state()


@app.post("/api/months/{month}/activate")
def activate_month(month: str):
    state = load_state()
    try:
        return set_active(state, month)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@app.get("/api/export")
def export_state():
    state = load_state()
    return JSONResponse(
        content=json.loads(json.dumps(state, ensure_ascii=False)),
        headers={"Content-Disposition": 'attachment; filename="plan-nutricional.json"'},
    )


@app.post("/api/import")
def import_state(payload: dict = Body(...)):
    if "foods" not in payload or "categories" not in payload:
        raise HTTPException(400, "El archivo no parece un respaldo válido.")
    save_state(payload)
    return payload


@app.post("/api/plan")
def save_plan(payload: dict = Body(...)):
    state = load_state()
    try:
        return save_month_plan(state, payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.patch("/api/meta")
def patch_meta(payload: dict = Body(...)):
    state = load_state()
    month = payload.get("monthId") or state["meta"].get("activeMonth")
    target = next((m for m in state.get("months", []) if m["id"] == month), None)
    if target is None:
        raise HTTPException(404, "Mes no encontrado.")
    if "patient" in payload:
        state["meta"]["patient"] = payload["patient"]
        target["patient"] = payload["patient"]
    if "kcalTarget" in payload:
        target["kcalTarget"] = payload["kcalTarget"]
        if state["meta"].get("activeMonth") == month:
            state["meta"]["kcalTarget"] = payload["kcalTarget"]
    save_state(state)
    return state


@app.post("/api/foods")
def post_food(payload: dict = Body(...)):
    state = load_state()
    try:
        return add_food(state, payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.patch("/api/foods/{food_id:path}")
def patch_food(food_id: str, payload: dict = Body(...)):
    state = load_state()
    try:
        return update_food(state, food_id, payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.delete("/api/foods/{food_id:path}")
def remove_food(food_id: str):
    state = load_state()
    return delete_food(state, food_id)


@app.post("/api/upload/{kind}")
async def upload(
    kind: str,
    file: UploadFile = File(...),
    month: str | None = Form(None),
):
    """Sube la tabla o el menú. `month` es el nombre de la carpeta (ej. diciembre2026).

    Si no se indica, se usa el mes activo.
    """
    if kind not in ("tabla", "menu"):
        raise HTTPException(400, "Tipo de documento inválido.")

    state = load_state()
    folder_name = (month or "").strip()
    if not folder_name:
        active = state["meta"].get("activeMonth")
        entry = next((m for m in state.get("months", []) if m["id"] == active), None)
        folder_name = (entry or {}).get("folder") or "mes-actual"

    suffix = Path(file.filename or "doc.pdf").suffix or ".pdf"
    tmp = Path(tempfile.mkstemp(suffix=suffix)[1])
    tmp.write_bytes(await file.read())
    try:
        detected = classify_pdf(tmp)
        if detected != kind:
            raise HTTPException(
                400,
                "El PDF no corresponde a "
                + (
                    "la tabla de intercambios."
                    if kind == "tabla"
                    else "un menú con DESAYUNO / COMIDA / CENA."
                ),
            )
        DIETAS_DIR.mkdir(parents=True, exist_ok=True)
        try:
            destination_dir = month_dir(folder_name)
        except ValueError as exc:
            raise HTTPException(400, str(exc))

        target = destination_dir / Path(file.filename or "documento.pdf").name
        shutil.copyfile(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)

    from .store import month_id

    new_state = build_state(
        active=month_id(destination_dir.name), refresh=[month_id(destination_dir.name)]
    )
    save_state(new_state)
    return new_state


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
