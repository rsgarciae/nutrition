/* Nutri · Equivalencias — app de una sola página */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let S = null;               // estado completo (viene de /api/state)
let CAT = {};               // categorías indexadas
let VIEW = 'plan';
let OPTION = 0;
let PLATO = loadPlato();    // plato libre guardado en el navegador
let saveTimer = null;
let sheetPick = null;
let sheetState = null;

const FRACTIONS = [[0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']];

/* ------------------------------------------------------------------ utils */

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function cat(id) {
  return CAT[id] || { id, name: id, short: id, kcal: 0, macros: { p: 0, c: 0, f: 0 }, color: '#888' };
}

function food(id) {
  return S ? S.foods.find(f => f.id === id) : null;
}

function fmtCount(n) {
  const whole = Math.floor(n + 1e-6);
  const frac = n - whole;
  if (Math.abs(frac) < 0.02) return String(whole);
  for (const [val, glyph] of FRACTIONS) {
    if (Math.abs(frac - val) < 0.03) return (whole ? whole : '') + glyph;
  }
  return n.toFixed(1);
}

function grams(n) {
  return Math.round(n);
}

function pluralize(n, sing, plur) {
  return Math.abs(n - 1) < 0.001 ? sing : plur;
}

function gramsFor(item) {
  const f = food(item.foodId);
  if (!f || !f.grams) return null;
  return item.count * f.grams;
}

function totalsOf(meals) {
  let kcal = 0, p = 0, c = 0, f = 0;
  for (const meal of meals) {
    for (const s of meal.slots || []) {
      const k = cat(s.category);
      kcal += s.count * k.kcal;
      p += s.count * (k.macros?.p || 0);
      c += s.count * (k.macros?.c || 0);
      f += s.count * (k.macros?.f || 0);
    }
  }
  return { kcal: Math.round(kcal), p: Math.round(p), c: Math.round(c), f: Math.round(f) };
}

function activeId() {
  return (S && S.meta && S.meta.activeMonth) || null;
}

function activeMonth() {
  const months = (S && S.months) || [];
  if (!months.length) return null;
  return months.find(m => m.id === activeId()) || months[months.length - 1];
}

function currentOption() {
  const month = activeMonth();
  if (!month?.options?.length) return null;
  return month.options[Math.min(OPTION, month.options.length - 1)];
}

function monthKcal() {
  const month = activeMonth();
  return (month && month.kcalTarget) || (S && S.meta && S.meta.kcalTarget) || 0;
}

function nextMonthName() {
  const month = activeMonth();
  if (!month || !month.id) return '';
  const [year, mon] = month.id.split('-').map(Number);
  if (!year || !mon) return '';
  const date = new Date(year, mon, 1); // el índice `mon` ya es el mes siguiente
  const names = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return names[date.getMonth()] + date.getFullYear();
}

function loadPlato() {
  try { return JSON.parse(localStorage.getItem('nutri.plato') || '[]'); } catch { return []; }
}
function savePlato() {
  localStorage.setItem('nutri.plato', JSON.stringify(PLATO));
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.dataset.show = 'true';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.dataset.show = 'false'; }, 2200);
}

function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const month = activeMonth();
    if (!month) return;
    try {
      await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: { id: month.id, options: month.options },
          kcalTarget: month.kcalTarget,
        }),
      });
    } catch { /* sin conexión: se queda en memoria */ }
  }, 700);
}

/* ------------------------------------------------------------------ carga */

async function load() {
  S = await (await fetch('/api/state')).json();
  CAT = Object.fromEntries((S.categories || []).map(c => [c.id, c]));
  refreshHeader();
  render();
}

function refreshHeader() {
  const month = activeMonth();
  $('#brandName').textContent = S.meta.patient || 'Mi plan';
  const bits = [];
  if (month?.label) bits.push(month.label);
  if (monthKcal()) bits.push(`${monthKcal()} kcal/día`);
  const count = (S.months || []).length;
  if (count > 1) bits.push(`${count} meses guardados`);
  $('#brandSub').textContent = bits.join(' · ') || 'Plan mensual';
  $('#kcalPill').textContent = monthKcal() ? `${monthKcal()} kcal` : '—';
}

/* ----------------------------------------------------------------- render */

function render() {
  $$('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === VIEW)));
  const v = $('#view');
  if (!S) { v.innerHTML = '<div class="empty">Cargando…</div>'; return; }
  if (VIEW === 'plan') v.innerHTML = viewPlan();
  else if (VIEW === 'plato') v.innerHTML = viewPlato();
  else if (VIEW === 'equiv') v.innerHTML = viewEquiv();
  else v.innerHTML = viewDatos();
}

/* --------------------------------------------------------------- vista plan */

function slotRow(slot, mi, si) {
  const f = food(slot.foodId);
  const g = gramsFor(slot);
  const k = cat(slot.category);
  const meta = f
    ? `1 porción = ${f.grams ? grams(f.grams) + ' g' : f.measure || '—'}${k.kcal ? ' · ' + k.short : ''}`
    : 'alimento no disponible';
  return `
    <div class="slot" data-meal="${mi}" data-slot="${si}">
      <div class="stepper">
        <button data-act="minus" data-meal="${mi}" data-slot="${si}" aria-label="Menos">−</button>
        <span class="val">${esc(fmtCount(slot.count))}</span>
        <button data-act="plus" data-meal="${mi}" data-slot="${si}" aria-label="Más">+</button>
      </div>
      <div class="slot-main" data-act="swap" data-meal="${mi}" data-slot="${si}">
        <div class="slot-name">${esc(f ? f.name : slot.foodId)}</div>
        <div class="slot-meta">${esc(meta)}</div>
      </div>
      <div class="slot-right">
        <div class="grams">${g === null ? '—' : grams(g) + ' <small>g</small>'}</div>
        <button class="icon-btn" data-act="swap" data-meal="${mi}" data-slot="${si}" aria-label="Cambiar alimento">⇄</button>
      </div>
    </div>`;
}

function viewPlan() {
  const month = activeMonth();
  const opt = currentOption();
  const monthPills = (S.months || []).length > 1
    ? `<div class="pills months">${(S.months || []).map(m => `
        <button data-act="month" data-id="${esc(m.id)}" aria-pressed="${m.id === activeId()}">${esc(m.label)}</button>`).join('')}</div>`
    : '';

  if (!opt) {
    return `${monthPills}
      <div class="warn">
        <b>Este mes todavía no tiene menú.</b>
        Ve a <b>Datos</b> y sube el PDF que dice tu nombre en la carpeta
        «${esc(month?.folder || 'mes')}».
      </div>`;
  }

  const pills = (month.options || []).map((o, i) => `
    <button data-act="option" data-i="${i}" aria-pressed="${i === OPTION}">${esc(o.name)}</button>`
  ).join('');

  const t = totalsOf(opt.meals);
  const target = monthKcal();
  const pct = target ? Math.min(100, Math.round((t.kcal / target) * 100)) : 0;

  const meals = opt.meals.map((meal, mi) => {
    const mt = totalsOf([meal]);
    const rows = (meal.slots || []).map((s, si) => slotRow(s, mi, si)).join('');
    const free = (meal.free || []).length
      ? `<div class="free-line">Libres / condimentos: ${esc(meal.free.join(', '))}</div>` : '';
    const missing = (meal.unmatched || []).length
      ? `<div class="free-line">Sin equivalencia asignada: ${esc(meal.unmatched.join(', '))}</div>` : '';
    return `
      <section class="card meal">
        <div class="card-head">
          <div>
            <div class="meal-title">${esc(meal.name)}</div>
            <div class="meal-dish">${esc(meal.title || '')}</div>
          </div>
          <div class="right">${mt.kcal} kcal</div>
        </div>
        <div class="slots">
          ${rows || '<div class="empty">Sin alimentos todavía.</div>'}
        </div>
        ${free}${missing}
        <button class="ghost-btn" data-act="adjust" data-meal="${mi}">↺ Ajustar a lo que voy a comer</button>
        <button class="ghost-btn" data-act="add" data-meal="${mi}">＋ Agregar alimento</button>
      </section>`;
  }).join('');

  return `
    ${monthPills}
    <div class="pills">${pills}</div>
    <section class="card totals">
      <div class="card-head">
        <h2>Total del día</h2>
        <span class="right">${t.kcal} / ${target || '—'} kcal</span>
      </div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="macros">
        <span>Proteína <b>${t.p} g</b></span>
        <span>Carbohidratos <b>${t.c} g</b></span>
        <span>Grasa <b>${t.f} g</b></span>
      </div>
    </section>
    ${meals}
    <p class="small" style="color:var(--muted);font-size:12px;text-align:center;margin:18px 0 0">
      Los gramos son peso del alimento tal como se sirve. Toca ⇄ para cambiar un alimento
      por otro del mismo grupo.
    </p>`;
}

/* -------------------------------------------------------------- vista plato */

function viewPlato() {
  const t = totalsOf([{ slots: PLATO }]);
  const target = monthKcal();
  const rows = PLATO.map((s, i) => {
    const f = food(s.foodId);
    const g = gramsFor(s);
    const k = cat(s.category);
    return `
      <div class="slot" data-meal="p" data-slot="${i}">
        <div class="stepper">
          <button data-act="pminus" data-slot="${i}">−</button>
          <span class="val">${esc(fmtCount(s.count))}</span>
          <button data-act="pplus" data-slot="${i}">+</button>
        </div>
        <div class="slot-main">
          <div class="slot-name">${esc(f?.name || '—')}</div>
          <div class="slot-meta">${esc(k.short)} · 1 porción = ${f?.grams ? grams(f.grams) + ' g' : '—'}</div>
        </div>
        <div class="slot-right">
          <div class="grams">${g === null ? '—' : grams(g) + ' <small>g</small>'}</div>
          <button class="icon-btn" data-act="pdel" data-slot="${i}" aria-label="Quitar">×</button>
        </div>
      </div>`;
  }).join('');

  return `
    <section class="card">
      <div class="card-head"><h2>¿Qué vas a comer?</h2></div>
      <p class="small" style="color:var(--muted);font-size:12.5px;margin:0 0 10px">
        Escríbelo como lo dirías: <i>«pechuga de pollo con arroz y aguacate»</i>.
      </p>
      <div style="display:flex;gap:8px">
        <input id="quick" type="text" autocomplete="off" placeholder="pechuga de pollo con arroz y aguacate">
        <button class="btn" data-act="quickadd">Agregar</button>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>Mi plato</h2>
        <span class="right">${t.kcal} kcal</span>
      </div>
      <div class="bar"><i style="width:${target ? Math.min(100, Math.round((t.kcal / target) * 100)) : 0}%"></i></div>
      <div class="macros">
        <span>Proteína <b>${t.p} g</b></span>
        <span>Carbohidratos <b>${t.c} g</b></span>
        <span>Grasa <b>${t.f} g</b></span>
      </div>
    </section>

    <section class="card">
      <div class="slots">${rows || '<div class="empty">Tu plato está vacío.</div>'}</div>
      <button class="ghost-btn" data-act="padd">＋ Agregar alimento</button>
      ${PLATO.length ? '<button class="ghost-btn" data-act="pclear">Vaciar plato</button>' : ''}
    </section>`;
}

/* ---------------------------------------------------------- vista equival. */

function viewEquiv() {
  const options = S.foods
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map(f => `<option value="${esc(f.id)}">${esc(f.name)} · ${esc(cat(f.category).short)}</option>`)
    .join('');

  const groups = (S.categories || []).map(c => {
    const items = S.foods.filter(f => f.category === c.id);
    if (!items.length) return '';
    const rows = items.map(f => `
      <div class="row">
        <div class="grow">
          <div class="name">${esc(f.name)}</div>
          <div class="meta">${esc(f.measure || '—')} · ${esc(c.short)}</div>
        </div>
        <div class="grams">${f.grams ? grams(f.grams) + ' <small>g</small>' : '—'}</div>
      </div>`).join('');
    return `
      <section class="card">
        <div class="card-head">
          <h2>${esc(c.name)}</h2>
          <span class="right">${c.kcal} kcal / porción</span>
        </div>
        ${rows}
      </section>`;
  }).join('');

  return `
    <section class="card">
      <div class="card-head"><h2>Convertidor</h2></div>
      <div class="field">
        <label for="convFood">Alimento</label>
        <select id="convFood">${options}</select>
      </div>
      <div class="grid2">
        <div class="field">
          <label for="convGrams">Gramos</label>
          <input id="convGrams" type="number" inputmode="decimal" min="0" step="1" value="100">
        </div>
        <div class="field">
          <label for="convPort">Porciones</label>
          <input id="convPort" type="number" inputmode="decimal" min="0" step="0.5" value="1">
        </div>
      </div>
      <div class="conv-out" id="convOut"></div>
    </section>
    ${groups}`;
}

function updateConv(source) {
  const sel = $('#convFood');
  if (!sel) return;
  const f = food(sel.value);
  const gIn = $('#convGrams');
  const pIn = $('#convPort');
  const out = $('#convOut');
  if (!f || !f.grams) {
    out.innerHTML = '<div class="small">Este alimento no tiene gramos registrados.</div>';
    return;
  }
  if (source === 'port') {
    const p = Math.max(0, parseFloat(pIn.value) || 0);
    gIn.value = Math.round(p * f.grams);
  } else if (source === 'grams') {
    const g = Math.max(0, parseFloat(gIn.value) || 0);
    pIn.value = Math.round((g / f.grams) * 100) / 100;
  }
  const g = Math.max(0, parseFloat(gIn.value) || 0);
  const p = Math.max(0, parseFloat(pIn.value) || 0);
  const k = cat(f.category);
  out.innerHTML = `
    <div class="big">${grams(g)} g</div>
    <div class="small">
      ≈ ${esc(fmtCount(Math.round(p * 100) / 100))} ${pluralize(p, 'porción', 'porciones')} · ${Math.round(p * k.kcal)} kcal
      <br>1 porción = ${grams(f.grams)} g${f.measure ? ' (' + esc(f.measure) + ')' : ''}
    </div>`;
}

/* -------------------------------------------------------------- vista datos */

function viewDatos() {
  const warnings = (S.warnings || []).filter(Boolean);
  const warnBox = warnings.length ? `
    <div class="warn">
      <b>Revisión de la importación</b>
      <ul>${warnings.slice(0, 12).map(w => `<li>${esc(w)}</li>`).join('')}</ul>
      ${warnings.length > 12 ? `<div style="margin-top:6px">… y ${warnings.length - 12} más.</div>` : ''}
    </div>` : '';

  const custom = S.foods.filter(f => f.source === 'custom' || f.source === 'extra');
  const customRows = custom.map(f => `
    <div class="row">
      <div class="grow">
        <div class="name">${esc(f.name)}</div>
        <div class="meta">${esc(cat(f.category).short)} · ${esc(f.measure || '—')}${f.source === 'extra' ? ' · sugerido' : ''}</div>
      </div>
      <div class="grams">${f.grams ? grams(f.grams) + ' <small>g</small>' : '—'}</div>
      <button class="icon-btn" data-act="delfood" data-id="${esc(f.id)}" aria-label="Eliminar">×</button>
    </div>`).join('');

  const catOptions = (S.categories || [])
    .map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');

  const freeBlocks = (S.freeFoods || []).map(g => `
    <div style="margin-bottom:12px">
      <div class="section-title" style="margin:0 0 8px">${esc(g.group)}</div>
      <div class="chips">${g.items.map(i => `<span class="chip">${esc(i)}</span>`).join('')}</div>
    </div>`).join('');

  const months = S.months || [];
  const monthOptions = months.map(m =>
    `<option value="${esc(m.folder)}"${m.id === activeId() ? ' selected' : ''}>${esc(m.label)} (${esc(m.folder)})</option>`).join('');
  const active = activeMonth();

  return `
    <section class="card">
      <div class="card-head"><h2>Documentos del mes</h2></div>
      <p style="font-size:12.5px;color:var(--muted);margin:0 0 12px">
        Cada mes es una carpeta dentro de <b>dietas/</b>. La tabla de intercambios se
        reutiliza del mes anterior, así que normalmente <b>basta con subir el menú</b>.
        <br>Tabla en uso: <b>${esc(S.meta.tableFile || '—')}</b>${S.meta.tableFolder ? ' (de ' + esc(S.meta.tableFolder) + ')' : ''}
      </p>
      <div class="field">
        <label for="uploadMonth">Mes al que pertenece el documento</label>
        <select id="uploadMonth">
          ${monthOptions}
          <option value="__new__">＋ Nuevo mes…</option>
        </select>
      </div>
      <div class="field hidden" id="newMonthWrap">
        <label for="uploadMonthNew">Nombre de la carpeta</label>
        <input id="uploadMonthNew" type="text" placeholder="${esc(nextMonthName() || 'diciembre2026')}" value="${esc(nextMonthName())}">
      </div>
      <div class="grid2">
        <div class="drop" id="dropMenu">
          <b>Menú del mes</b>
          PDF con Desayuno / Comida / Cena
          <div style="margin-top:8px"><input type="file" accept="application/pdf" data-upload="menu" class="hidden" id="fileMenu"><button class="btn" data-act="pickfile" data-target="fileMenu">Subir menú</button></div>
        </div>
        <div class="drop" id="dropTabla">
          <b>Tabla de intercambios</b>
          Solo si te dieron una nueva
          <div style="margin-top:8px"><input type="file" accept="application/pdf" data-upload="tabla" class="hidden" id="fileTabla"><button class="btn secondary" data-act="pickfile" data-target="fileTabla">Subir tabla</button></div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Dietas guardadas</h2><span class="right">${months.length}</span></div>
      ${months.map(m => {
        const tot = (m.options || []).reduce((acc, o) => acc + o.meals.reduce((a, x) => a + (x.slots || []).length, 0), 0);
        return `<div class="row">
          <div class="grow">
            <div class="name">${esc(m.label)}${m.id === activeId() ? ' · actual' : ''}</div>
            <div class="meta">${esc(m.folder)} · ${esc(m.menuFile || 'sin menú')} · ${(m.options || []).length} opciones · ${tot} porciones</div>
          </div>
          <button class="btn secondary" data-act="month" data-id="${esc(m.id)}">${m.id === activeId() ? 'Ver' : 'Abrir'}</button>
        </div>`;
      }).join('') || '<div class="empty">Todavía no hay meses.</div>'}
    </section>

    ${warnBox}

    <section class="card">
      <div class="card-head"><h2>Metas</h2></div>
      <div class="grid2">
        <div class="field">
          <label for="metaPatient">Paciente</label>
          <input id="metaPatient" type="text" value="${esc(S.meta.patient || '')}">
        </div>
        <div class="field">
          <label for="metaKcal">kcal al día</label>
          <input id="metaKcal" type="number" min="0" step="10" value="${esc(monthKcal() || '')}">
        </div>
      </div>
      <button class="btn" data-act="savemeta">Guardar metas</button>
    </section>

    <section class="card">
      <div class="card-head"><h2>Agregar mi alimento</h2></div>
      <p style="font-size:12.5px;color:var(--muted);margin:0 0 12px">
        Si comes algo que no está en la tabla, dímelo en gramos por porción y lo agrego al grupo que corresponda.
      </p>
      <div class="field">
        <label for="nfName">Nombre</label>
        <input id="nfName" type="text" placeholder="Ej. Pechuga de pollo cocida">
      </div>
      <div class="grid2">
        <div class="field">
          <label for="nfCat">Grupo</label>
          <select id="nfCat">${catOptions}</select>
        </div>
        <div class="field">
          <label for="nfGrams">Gramos por porción</label>
          <input id="nfGrams" type="number" min="1" step="1" placeholder="30">
        </div>
      </div>
      <div class="field">
        <label for="nfMeasure">Medida casera (opcional)</label>
        <input id="nfMeasure" type="text" placeholder="Ej. 1 pieza mediana">
      </div>
      <button class="btn" data-act="addfood">Agregar alimento</button>
    </section>

    <section class="card">
      <div class="card-head"><h2>Alimentos propios y sugeridos</h2><span class="right">${custom.length}</span></div>
      ${customRows || '<div class="empty">Todavía no has agregado alimentos.</div>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>Libres de calorías</h2></div>
      ${freeBlocks}
    </section>

    <section class="card">
      <div class="card-head"><h2>Respaldo</h2></div>
      <div class="btn-row">
        <a class="btn secondary" href="/api/export" download="plan-nutricional.json">Exportar JSON</a>
        <button class="btn danger" data-act="reset">Restablecer desde los PDF</button>
      </div>
    </section>`;
}

/* ------------------------------------------------------------------ sheet */

function openSheet({ title, hint, categories, onPick, currentId, extra }) {
  const sheet = $('#sheet');
  $('#sheetTitle').textContent = title || 'Elegir alimento';
  $('#sheetHint').textContent = hint || '';
  const tabs = $('#sheetTabs');
  const body = $('#sheetBody');
  let activeCat = categories[0] || null;

  function paintTabs() {
    if (categories.length <= 1) { tabs.innerHTML = ''; return; }
    tabs.innerHTML = categories.map(id => {
      const c = cat(id);
      return `<button data-cat="${esc(id)}" aria-pressed="${id === activeCat}">${esc(c.short)}</button>`;
    }).join('');
  }

  function paintList(filter = '') {
    const q = filter.trim().toLowerCase();
    let items = q
      ? S.foods.filter(f => f.name.toLowerCase().includes(q) || cat(f.category).short.toLowerCase().includes(q))
      : S.foods.filter(f => (activeCat ? f.category === activeCat : true));
    items = items.slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
    if (!items.length) {
      body.innerHTML = '<div class="empty">Sin alimentos en este grupo.</div>';
      return;
    }
    body.innerHTML = `
      <div class="field" style="position:sticky;top:0;background:var(--card);padding-top:2px;margin-bottom:8px;z-index:2">
        <input type="search" id="sheetSearch" placeholder="Buscar alimento…" value="${esc(filter)}">
      </div>
      ${items.map(f => `
        <button class="pick-item" data-food="${esc(f.id)}">
          <div class="grow">
            <div class="nm">${esc(f.name)}${f.id === currentId ? ' ✓' : ''}</div>
            <div class="ms">${esc(f.measure || '—')} · ${esc(cat(f.category).short)}</div>
          </div>
          <div class="gr">${f.grams ? grams(f.grams) + ' g' : '—'}</div>
        </button>`).join('')}
      ${extra ? `<div style="padding-top:10px">${extra}</div>` : ''}`;
    const search = $('#sheetSearch');
    search.addEventListener('input', ev => {
      const val = ev.target.value;
      const caret = ev.target.selectionStart;
      paintList(val);
      const s2 = $('#sheetSearch');
      if (s2) { s2.focus(); s2.setSelectionRange(caret, caret); }
    });
  }

  sheetPick = { onPick };
  sheetState = {
    setCat(id) { activeCat = id; paintTabs(); paintList(''); },
  };
  paintTabs();
  paintList('');
  sheet.dataset.open = 'true';
  sheet.setAttribute('aria-hidden', 'false');
  $('#backdrop').dataset.open = 'true';
  setTimeout(() => $('#sheetSearch')?.focus(), 220);
}

function closeSheet() {
  $('#sheet').dataset.open = 'false';
  $('#sheet').setAttribute('aria-hidden', 'true');
  $('#backdrop').dataset.open = 'false';
  sheetPick = null;
  sheetState = null;
}

function openPrompt({ title, hint, placeholder, label, onSubmit }) {
  const sheet = $('#sheet');
  $('#sheetTitle').textContent = title;
  $('#sheetHint').textContent = hint || '';
  $('#sheetTabs').innerHTML = '';
  $('#sheetBody').innerHTML = `
    <input id="promptInput" type="text" autocomplete="off" placeholder="${esc(placeholder || '')}">
    <button class="btn" id="promptGo" style="width:100%;margin-top:10px">${esc(label || 'Aplicar')}</button>`;
  sheetPick = null;
  sheetState = null;
  sheet.dataset.open = 'true';
  sheet.setAttribute('aria-hidden', 'false');
  $('#backdrop').dataset.open = 'true';
  const go = () => {
    const value = $('#promptInput').value.trim();
    if (!value) { $('#promptInput').focus(); return; }
    closeSheet();
    onSubmit(value);
  };
  $('#promptGo').addEventListener('click', go);
  $('#promptInput').addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); go(); }
  });
  setTimeout(() => $('#promptInput')?.focus(), 220);
}

/* ---------------------------------------------------------------- eventos */

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-view]');
  if (t) { VIEW = t.dataset.view; render(); return; }
});

$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  VIEW = b.dataset.view;
  window.scrollTo({ top: 0 });
  render();
  if (VIEW === 'equiv') setTimeout(() => updateConv('port'), 0);
});

$('#backdrop').addEventListener('click', closeSheet);

$('#sheetTabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-cat]');
  if (!b || !sheetState) return;
  sheetState.setCat(b.dataset.cat);
});

$('#sheetBody').addEventListener('click', e => {
  const b = e.target.closest('button[data-food]');
  if (!b || !sheetPick) return;
  const f = food(b.dataset.food);
  if (!f) return;
  sheetPick.onPick(f);
  closeSheet();
});

$('#view').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const opt = currentOption();

  const mi = el.dataset.meal !== undefined ? Number(el.dataset.meal) : null;
  const si = el.dataset.slot !== undefined ? Number(el.dataset.slot) : null;

  if (act === 'option') { OPTION = Number(el.dataset.i); render(); return; }

  if (act === 'month') {
    const id = el.dataset.id;
    if (!id || id === activeId()) return;
    const res = await fetch('/api/months/' + encodeURIComponent(id) + '/activate', { method: 'POST' });
    if (!res.ok) { toast('No se pudo abrir ese mes'); return; }
    S = await res.json();
    CAT = Object.fromEntries(S.categories.map(c => [c.id, c]));
    OPTION = 0;
    refreshHeader();
    render();
    return;
  }

  if (act === 'minus' || act === 'plus') {
    const slot = opt.meals[mi].slots[si];
    slot.count = Math.max(0.5, slot.count + (act === 'plus' ? 0.5 : -0.5));
    debouncedSave(); render(); return;
  }

  if (act === 'swap') {
    const slot = opt.meals[mi].slots[si];
    openSheet({
      title: 'Cambiar alimento',
      hint: `Grupo: ${cat(slot.category).name}. Los gramos se recalculan para ${fmtCount(slot.count)} ${pluralize(slot.count, 'porción', 'porciones')}.`,
      categories: [slot.category],
      currentId: slot.foodId,
      onPick: (f) => { slot.foodId = f.id; slot.category = f.category; debouncedSave(); render(); },
      extra: `<button class="btn danger" style="width:100%" data-act="delslot" data-meal="${mi}" data-slot="${si}">Quitar del plan</button>`,
    });
    return;
  }

  if (act === 'delslot') {
    const slot = opt.meals[Number(el.dataset.meal)].slots[Number(el.dataset.slot)];
    opt.meals[Number(el.dataset.meal)].slots = opt.meals[Number(el.dataset.meal)].slots.filter(s => s !== slot);
    closeSheet(); debouncedSave(); render(); return;
  }

  if (act === 'adjust') {
    const meal = opt.meals[mi];
    openPrompt({
      title: 'Ajustar ' + meal.name.toLowerCase(),
      hint: 'Escribe lo que vas a comer y cambio los alimentos de esta comida, conservando las porciones que te tocan.',
      placeholder: 'pechuga de pollo con arroz y aguacate',
      label: 'Ajustar comida',
      onSubmit: (text) => adjustMeal(meal, text),
    });
    return;
  }

  if (act === 'add') {
    openSheet({
      title: 'Agregar al ' + opt.meals[mi].name.toLowerCase(),
      hint: 'Elige el grupo y luego el alimento.',
      categories: S.categories.map(c => c.id),
      onPick: (f) => {
        opt.meals[mi].slots.push({ category: f.category, foodId: f.id, count: 1, note: '', original: {} });
        debouncedSave(); render();
      },
    });
    return;
  }

  if (act === 'padd') {
    openSheet({
      title: 'Agregar a mi plato',
      hint: 'Elige el grupo y luego el alimento.',
      categories: S.categories.map(c => c.id),
      onPick: (f) => {
        PLATO.push({ category: f.category, foodId: f.id, count: 1 });
        savePlato(); render();
      },
    });
    return;
  }

  if (act === 'quickadd') {
    const input = $('#quick');
    const text = (input?.value || '').trim();
    if (!text) { input?.focus(); return; }
    const res = await fetch('/api/interpret', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) { toast('No se pudo interpretar'); return; }
    const data = await res.json();
    const found = data.items.filter(i => i.matched);
    const missing = data.items.filter(i => !i.matched).map(i => i.text);
    for (const it of found) {
      PLATO.push({ category: it.category, foodId: it.foodId, count: 1 });
    }
    savePlato(); render();
    if (!found.length) toast('No reconocí nada de eso');
    else if (missing.length) toast('Agregado. No reconocí: ' + missing.join(', '));
    else toast(found.length + (found.length === 1 ? ' alimento agregado' : ' alimentos agregados'));
    return;
  }

  if (act === 'pminus' || act === 'pplus') {
    const item = PLATO[si];
    item.count = Math.max(0.5, item.count + (act === 'pplus' ? 0.5 : -0.5));
    savePlato(); render(); return;
  }

  if (act === 'pdel') { PLATO.splice(si, 1); savePlato(); render(); return; }
  if (act === 'pclear') { PLATO = []; savePlato(); render(); return; }

  if (act === 'pickfile') { $('#' + el.dataset.target).click(); return; }

  if (act === 'addfood') {
    const payload = {
      name: $('#nfName').value.trim(),
      category: $('#nfCat').value,
      grams: $('#nfGrams').value,
      measure: $('#nfMeasure').value.trim(),
    };
    if (!payload.name || !payload.grams) { toast('Escribe nombre y gramos'); return; }
    const res = await fetch('/api/foods', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) { toast((await res.json()).detail || 'No se pudo guardar'); return; }
    S = await res.json();
    CAT = Object.fromEntries(S.categories.map(c => [c.id, c]));
    toast('Alimento agregado'); render(); return;
  }

  if (act === 'delfood') {
    const res = await fetch('/api/foods/' + encodeURIComponent(el.dataset.id), { method: 'DELETE' });
    if (res.ok) {
      S = await res.json();
      CAT = Object.fromEntries(S.categories.map(c => [c.id, c]));
      toast('Eliminado'); render();
    }
    return;
  }

  if (act === 'savemeta') {
    const res = await fetch('/api/meta', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient: $('#metaPatient').value.trim(),
        kcalTarget: Number($('#metaKcal').value) || null,
        monthId: activeMonth()?.id,
      }),
    });
    if (res.ok) { S = await res.json(); refreshHeader(); toast('Metas guardadas'); render(); }
    return;
  }

  if (act === 'reset') {
    if (!confirm('¿Reconstruir TODOS los meses desde los PDF de dietas/? Se perderán los cambios manuales de los planes (tus alimentos propios se conservan).')) return;
    const res = await fetch('/api/reset', { method: 'POST' });
    S = await res.json();
    CAT = Object.fromEntries(S.categories.map(c => [c.id, c]));
    OPTION = 0;
    refreshHeader();
    toast('Todo reconstruido desde los PDF'); render(); return;
  }
});

$('#view').addEventListener('keydown', (e) => {
  if (e.target.id === 'quick' && e.key === 'Enter') {
    e.preventDefault();
    $('#view [data-act="quickadd"]')?.click();
  }
});

async function adjustMeal(meal, text) {
  const res = await fetch('/api/interpret', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) { toast('No se pudo interpretar'); return; }
  const data = await res.json();
  const items = data.items.filter(i => i.matched);
  const missing = data.items.filter(i => !i.matched).map(i => i.text);
  if (!items.length) { toast('No reconocí nada de eso'); return; }

  const used = new Set();
  let swapped = 0, added = 0;
  for (const it of items) {
    const idx = (meal.slots || []).findIndex((s, i) => !used.has(i) && s.category === it.category);
    if (idx >= 0) {
      used.add(idx);
      meal.slots[idx].foodId = it.foodId;
      swapped++;
    } else {
      meal.slots = meal.slots || [];
      meal.slots.push({ category: it.category, foodId: it.foodId, count: 1, note: '', original: {} });
      added++;
    }
  }
  debouncedSave();
  render();
  const parts = [];
  if (swapped) parts.push(`${swapped} cambiado(s)`);
  if (added) parts.push(`${added} agregado(s)`);
  toast(parts.join(' · ') + (missing.length ? '. No reconocí: ' + missing.join(', ') : ''));
}

$('#view').addEventListener('input', (e) => {
  if (e.target.id === 'convFood' || e.target.id === 'convGrams' || e.target.id === 'convPort') {
    if (e.target.id === 'convFood') updateConv('ponz');
    else if (e.target.id === 'convGrams') updateConv('grams');
    else updateConv('port');
  }
});
$('#view').addEventListener('change', (e) => {
  if (e.target.id === 'convFood') updateConv('ponz');
  if (e.target.id === 'uploadMonth') {
    $('#newMonthWrap')?.classList.toggle('hidden', e.target.value !== '__new__');
  }
  if (e.target.dataset?.upload) uploadFile(e.target);
});

async function uploadFile(input) {
  const kind = input.dataset.upload;
  const file = input.files?.[0];
  if (!file) return;

  const selector = $('#uploadMonth');
  let month = selector ? selector.value : '';
  if (month === '__new__') {
    month = ($('#uploadMonthNew')?.value || '').trim();
    if (!month) { toast('Escribe el nombre de la carpeta del mes'); return; }
  }

  toast('Procesando ' + file.name + '…');
  const fd = new FormData();
  fd.append('file', file);
  if (month && month !== '__new__') fd.append('month', month);
  const res = await fetch('/api/upload/' + kind, { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) { toast(data.detail || 'No se pudo procesar'); return; }
  S = data;
  CAT = Object.fromEntries(S.categories.map(c => [c.id, c]));
  OPTION = 0;
  refreshHeader();
  toast('¡Listo! Datos actualizados');
  render();
}

/* arranque */
load().then(() => {
  if (VIEW === 'equiv') updateConv('port');
}).catch(err => {
  $('#view').innerHTML = `<div class="warn">No se pudo cargar el estado: ${esc(err.message)}</div>`;
});
