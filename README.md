# Nutri · Equivalencias

Turns your nutritionist's **food-exchange table** (tabla de intercambios) into **exact grams**,
and lets you build meals out of the food you actually eat.

Runs on Docker. No database, no build step — the whole state lives in a single JSON file.

**In plain terms:** the diet says "5½ protein exchanges, 2 cereal exchanges, 1½ fat exchanges".
This app answers *"so how many grams of chicken, rice and avocado is that?"* — and lets you
swap the menu items for the food you have at home without losing the numbers.

---

## Quick start

```bash
docker compose up --build -d
```

Open <http://localhost:8000>

Stop it with `docker compose down`. Everything you change is kept in `./data/state.json`
and `./dietas/`, both bind-mounted into the container, so rebuilding the image is safe.

---

## What it does

### 1. Plan — the month's menu, in grams

The app reads the menu PDF and splits it per meal (breakfast, snack, lunch, dinner), then
translates every ingredient into exchange portions and **grams**.

Each row shows:

| Portion count | Food | Grams to eat |
|---|---|---|
| `− 5½ +` | Pechuga de pollo | **165 g** |

You can:

- **swap** a food for another one in the *same* exchange group with `⇄` — grams are recalculated
  from the portion count, so the diet stays balanced;
- **adjust portions** with `−` / `+` (half-portion steps);
- **add or remove** foods;
- **adjust a whole meal** to what you're actually going to eat — type
  `pechuga de pollo con arroz y aguacate` and the app swaps the meal's foods while keeping the
  prescribed portions;
- see the day's total kcal / protein / carbs / fat against the target;
- switch between **saved months** with the month selector at the top.

### 2. Armar plato — build your own plates

Four plates come by default — **Desayuno, Colación, Comida, Cena** — and you can add, rename
or delete any of them (`＋ Nuevo plato`, or tap the ✎ next to a plate's name).

Inside a plate, type what you're about to eat, the way you'd say it:

> `pechuga de pollo cocida con arroz y aguacate`

and it comes back with *chicken 30 g, rice 47 g, avocado 31 g* (one exchange of each).
You can also pick foods from the list, adjust portions with `−` / `+`, and remove items.

**Every plate keeps its own kcal and macros**, and the card at the top adds them all up
against the daily target, with a per-plate breakdown (e.g. *Desayuno · 358 kcal,
Comida · 455 kcal*). Plates are stored in the browser (localStorage), so they survive
reloads without involving the server.

**Macro budget.** The card at the top also tracks protein, carbs and fat against the day
target implied by the plan option you're following (`consumed / target`), turning amber
near the limit and **red when exceeded** (`Grasa 72 / 65 g +7`). Each plate shows the same
as `consumed/target` for the meal it matches in the plan — e.g. `G 14/12 g` — so you can
spread the fat across the day instead of spending it all at dinner.

**Exceeding is allowed, but you're asked first.** Nothing is silently dropped: when an
addition would cross a macro target the app shows

```
Con esto te pasas del objetivo del día:

· grasa: 66 / 65 g

¿Agregarlo de todos modos?
```

and only adds the food if you accept. It doesn't nag once you're already over — it only
stops at the crossing point — and the check can be switched off from the link in that same
card.

**⚡ Autocompletar** fills the rest of the day. It always asks *how* first, so the outcome is
predictable:

1. **Ajustar las cantidades de mis platos** — scales every existing plate by the same factor
   and then nudges at most ±1 portion per item, without adding new foods. You see the exact
   list of changes (`Huevo: 3 → 4`) before applying. If the plates are too empty to reach the
   target, it says so and offers the second option.
2. **Agregar un plato para rellenar** — leaves your plates untouched and proposes a new
   *«Para completar»* plate built only from foods of the plan you're following, at most 4
   portions of each, with the resulting day totals.

Both show a preview (`1946 / 1934 kcal · P 137/137 · C 193/193 · G 70/69`) and only apply
when you confirm.

### 3. Equivalencias — the full table

Every food with its exchange group, household measure and grams per portion, plus a
two-way converter (grams ⇄ portions).

### 4. Datos — import, history and settings

- Upload the **menu** for a month (and the table only if you got a new one).
- Browse and reopen **previous diets**.
- Fix the targets (patient name, kcal/day).
- **Add your own foods** with grams per portion — they become available everywhere.
- Export a JSON backup, or rebuild everything from the PDFs.

---

## Monthly workflow

One folder per month inside `dietas/`. The folder name *is* the month:

```
dietas/
  noviembre2026/
    TABLA DE INTERCAMBIOS.pdf
    Rodolfo García Escobar.pdf
  diciembre2026/
    Menu diciembre.pdf            <- the menu alone is enough
```

Rules:

- **The folder name defines the month.** `noviembre2026`, `Noviembre 2026`, `2026-11`
  and `11-2026` are all understood. It drives ordering and the month label.
- **The exchange table is reused.** If a month has no table, the most recent one is used.
  That's why month-to-month you normally only upload the menu.
- **The newest month becomes active** when you open the app.

### Starting a new month

**From the app:** *Datos → Mes → **＋ Nuevo mes…***, accept the suggested folder name
(e.g. `diciembre2026`) and upload the menu. The folder is created for you.

**By hand:** create `dietas/diciembre2026/`, drop the menu PDF in, done. The app detects the
new folder on the next request — no restart needed (it compares a fingerprint of the folder
content; the first load after a change takes ~2 s while it re-parses).

### History and edits

- Planned months are kept and can be opened from the month selector on **Plan** or from
  *Datos → Dietas guardadas*.
- **Manual edits are preserved** when new months are added: only months whose menu PDF
  actually changed get re-parsed. Files are matched by name + modified time.
- *Datos → Restablecer desde los PDF* rebuilds **everything** from scratch (your custom foods
  are kept, plan edits are not).

---

## Exchange groups

The app understands the standard groups used by the table:

| Group | id | kcal / portion |
|---|---|---|
| Vegetables | `verduras` | 25 |
| Fruit | `frutas` | 115 |
| Cereals, no fat | `cereales_sin_grasa` | 70 |
| Cereals with fat | `cereales_con_grasa` | 115 |
| Legumes | `leguminosas` | 120 |
| Skim milk | `leche_descremada` | 95 |
| Semi-skimmed milk | `leche_semidescremada` | 110 |
| Whole milk | `leche_entera` | 150 |
| Animal protein · very low fat | `aoa_muy_bajo` | 40 |
| Animal protein · low fat | `aoa_bajo` | 55 |
| Animal protein · moderate fat | `aoa_moderado` | 75 |
| Animal protein · high fat | `aoa_alto` | 100 |
| Fats & oils, no protein | `grasas_sin_proteina` | 45 |
| Fats & oils, with protein | `grasas_con_proteina` | 75 |
| Sugars, no fat | `azucares` | 40 |

Per-group macros (protein / carbs / fat) live in `app/categories.py` and drive the day totals.

---

## How the PDFs are read

Both parsers are **template-aware**: they rebuild the tables from the coordinates of every
word rather than from the plain text stream, because the layout is multi-column.

**Exchange table** (`app/parse_table.py`)
- Detects table blocks by their `ALIMENTO / MEDIDA CASERA / GR.` header rows and derives the
  column boundaries from them.
- Assigns every food to a group from the section titles above each block
  (`VERDURAS`, `FRUTAS`, `CERALES CON GRASA`, `LECHE DESCREMADA`, `MUY BAJO APORTE EN GRASA`, …).
- Repairs the known quirks of this template:
  - words glued together in the PDF text (`Atúnenagua`, `Pandecaja`, `Pechugadepollo`) are
    restored from a canonical-name dictionary;
  - five rows in the cereal table have their **name rendered as an image** (no text at all) and
    are recovered by matching *household measure + grams*;
  - rows with `—` in the grams column fall back to a practical gram value so every food is
    usable.

**Menu** (`app/parse_menu.py`)
- Finds the meal headers (`DESAYUNO / COLACIÓN / COMIDA / CENA`) and uses their x position to
  split the page into one column per menu option.
- Inside each column it reads the dish title and then the ingredient lines, extracting grams,
  counts and units (`170 g`, `3 piezas`, `½ pieza`, `1 taza`, `¾ taza (80 g)`).
- The `1980 KCAL` badge becomes the daily target.

**Matching** (`app/matching.py`)
- Menu items are resolved to table foods through explicit aliases, then canonical keys, then a
  token-overlap fallback that requires the food to cover most of the written text (so
  "tostadas con carne deshebrada y aguacate" doesn't collapse into a single wrong food).
- Portions are computed as `grams / grams-per-portion` (or `count / portion-measure`) and
  snapped to half portions.
- Free foods (mustard, salsa, tea, water, spices…) are detected and listed separately instead of
  being counted.

**Free text** (`app/interpret.py`)
- Splits on commas, then on connectors (`con`, `y`, `+`) but only when both sides resolve to a
  real food — which is why `jugo de betabel y zanahoria` stays one item.

Anything the parser can't place shows up as a review warning under *Datos*, and the food can be
added by hand, so nothing is lost silently.

---

## Data model

`data/state.json` is the single source of truth:

```json
{
  "version": 2,
  "meta": {
    "patient": "Rodolfo García Escobar",
    "activeMonth": "2026-11",
    "kcalTarget": 1980,
    "tableFile": "TABLA DE INTERCAMBIOS.pdf",
    "tableFolder": "noviembre2026",
    "fingerprint": "…"
  },
  "categories": [ … ],
  "foods": [
    { "id": "aoa_muy_bajo/pechugadepollo", "name": "Pechuga de pollo",
      "category": "aoa_muy_bajo", "measure": "", "grams": 30, "source": "tabla" }
  ],
  "freeFoods": [ … ],
  "months": [
    {
      "id": "2026-11", "label": "Noviembre 2026", "folder": "noviembre2026",
      "menuFile": "Rodolfo García Escobar.pdf", "patient": "…", "kcalTarget": 1980,
      "options": [
        { "id": "opcion-1", "name": "Opción 1", "meals": [
          { "id": "desayuno-1", "name": "Desayuno", "title": "Huevo con tortilla, frijoles",
            "slots": [
              { "category": "aoa_moderado", "foodId": "aoa_moderado/huevo", "count": 3,
                "note": "Huevo entero, 3 piezas", "original": { "count": 3, "unit": "pieza" } }
            ],
            "free": [], "unmatched": [] }
        ]}
      ],
      "warnings": []
    }
  ],
  "warnings": []
}
```

`source` is one of `tabla` (parsed from the PDF), `extra` (built-in suggestions for foods that
appear in menus but not in the table) or `custom` (added by you).

The `fingerprint` is what makes the "drop a folder and it just works" behaviour cheap: it's a
hash of the month folders and (file name, mtime) of every PDF.

---

## API

All endpoints return the full state (except `interpret` and `health`), so the front-end never
needs to re-fetch after a write.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/state` | Current state (rebuilds if the PDFs changed) |
| `GET` | `/api/health` | Liveness check |
| `POST` | `/api/interpret` | `{ "text": "pollo con arroz y aguacate" }` → matched foods |
| `POST` | `/api/months/{month}/activate` | Set the active month (`2026-12`) |
| `POST` | `/api/plan` | `{ plan: { id, options }, kcalTarget }` — save a month's plan |
| `PATCH` | `/api/meta` | `{ patient?, kcalTarget?, monthId? }` |
| `POST` | `/api/upload/{tabla\|menu}` | Multipart: `file`, optional `month` (folder name) |
| `POST` | `/api/foods` | Add a custom food `{ name, category, grams, measure? }` |
| `PATCH` | `/api/foods/{id}` | Edit a food |
| `DELETE` | `/api/foods/{id}` | Remove a food |
| `POST` | `/api/reset` | Rebuild every month from the PDFs |
| `GET` | `/api/export` | Download the state as JSON |
| `POST` | `/api/import` | Restore a previously exported state |

Interactive docs are available at <http://localhost:8000/docs>.

---

## Project layout

```
app/
  categories.py     exchange groups: kcal and macros per portion
  normalize.py      canonical food names, aliases, un-glueing, fallback grams
  parse_table.py    exchange-table PDF parser
  parse_menu.py     menu PDF parser (one column per menu option)
  matching.py       food ↔ group matching, portion math, free-food detection
  interpret.py      free-text meal interpretation
  store.py          month discovery, state building, persistence, edits
  main.py           FastAPI app + static file mounting
static/
  index.html        single-page shell
  styles.css        light/dark theme, mobile-first
  app.js            all UI logic (no build step, no dependencies)
dietas/             one folder per month (table and/or menu PDFs)
data/               state.json (created on first run)
tools/              developer scripts (see below)
```

### Developer scripts

```bash
.venv/bin/python tools/inspect_table.py     # parsed exchange table, grouped
.venv/bin/python tools/inspect_menu.py      # parsed menu, per option and meal
.venv/bin/python tools/inspect_state.py     # full state: months, portions, warnings
.venv/bin/python tools/check_macros.py      # macro coherence by group and by meal
.venv/bin/python tools/check_months.py      # regression test: month detection + edit preservation
```

`check_months.py` talks to a running server on port 8000.

---

## Local development (without Docker)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Optional environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `NUTRI_DATA_DIR` | `./data` | Where `state.json` lives |
| `NUTRI_DIETAS_DIR` | `./dietas` | Root of the per-month folders |
| `NUTRI_PDF_FOLDER` | `./noviembre2026` | Legacy single-folder fallback |

---

## Known limitations

- **The PDFs must follow your nutritionist's template.** The parsers rely on the header rows and
  the meal headers described above. A different layout will produce warnings (visible in *Datos*)
  rather than wrong numbers — but it won't be parsed. Anything unparsed can be entered by hand.
- **The table's own numbers are respected as-is**, including odd ones (e.g. `Pulpa de res 25 g`
  per portion, `Pan molido 161 g`, `Salmón` listed under "very low fat"). These come from the
  document, not from the app. Fix them in *Datos* if your nutritionist updates them.
- **There are two kcal numbers, on purpose.** The nutritionist's target (1980 kcal) and the
  menu's own total (1934 kcal when computed with the exchange table) differ by ~2%, because the
  menu is built from exchange portions. **Plan** compares the menu against the prescription;
  **Armar plato** compares your plates against the menu, so kcal and macros always hit 100%
  together.
- **Macro values are calibrated to each group's kcal.** The protein/carbs/fat of every exchange
  group were adjusted by ≤0.35 g so that `4P + 4C + 9F` equals the group's published kcal
  exactly — otherwise reaching 100% of your macros still left ~50 kcal unaccounted for. The kcal
  printed in your table (25, 70, 115…) is unchanged. `tools/check_macros.py` verifies this.
- **The four menu options are not nutritionally equivalent.** They're all ~1980 kcal on paper,
  but their macro totals differ a lot — this month fat goes from **47 g to 106 g** depending on
  the option, because the exchange table maps some dishes to coarse groups (e.g. 150 g of
  shredded beef counts as 5 "moderate fat" protein exchanges). The macro budget is always
  measured against the option selected in **Plan**, and the app warns you when the spread is
  large. `tools/check_macros.py` prints the full per-option breakdown.
- **Gram values are the weight as served** (cooked for rice/pasta/meat, drained for legumes).
- Only the **first page** of the menu PDF is read, which is how these menus are laid out.

---

## License

Personal project, no license attached.
