/* Nutri · Equivalencias — app de una sola página */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let S = null;               // estado completo (viene de /api/state)
let CAT = {};               // categorías indexadas
let VIEW = 'plan';
let OPTION = 0;
let PLATOS = loadPlatos();   // platos libres guardados en el navegador
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

/** Grupo de un slot: usa el declarado o, si falta, el del alimento. */
function slotCat(slot) {
  if (slot && slot.category && CAT[slot.category]) return CAT[slot.category];
  const f = slot ? food(slot.foodId) : null;
  return cat(f ? f.category : (slot && slot.category));
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
      const k = slotCat(s);
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

function newPlate(name) {
  return {
    id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name || 'Plato',
    slots: [],
  };
}

function loadPlatos() {
  try {
    const raw = JSON.parse(localStorage.getItem('nutri.platos') || 'null');
    if (Array.isArray(raw) && raw.length) {
      return raw.map(p => ({
        id: p.id || newPlate(p.name).id,
        name: p.name || 'Plato',
        slots: Array.isArray(p.slots) ? p.slots : [],
      }));
    }
  } catch { /* datos corruptos: se reinicia */ }

  // migración del formato anterior (un solo plato)
  let migrated = [];
  try {
    const old = JSON.parse(localStorage.getItem('nutri.plato') || '[]');
    if (Array.isArray(old) && old.length) migrated = [{ ...newPlate('Mi plato'), slots: old }];
  } catch { /* nada que migrar */ }

  const plates = migrated.concat(['Desayuno', 'Colación', 'Comida', 'Cena'].map(newPlate));
  localStorage.setItem('nutri.platos', JSON.stringify(plates));
  localStorage.removeItem('nutri.plato');
  return plates;
}

function savePlatos() {
  localStorage.setItem('nutri.platos', JSON.stringify(PLATOS));
}

function grandTotals() {
  const total = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const plate of PLATOS) {
    const t = totalsOf([{ slots: plate.slots }]);
    total.kcal += t.kcal;
    total.p += t.p;
    total.c += t.c;
    total.f += t.f;
  }
  return total;
}

/** Total de un grupo de comidas sumando los subtotales ya redondeados. */
function mealsTotals(meals) {
  const total = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const meal of meals || []) {
    const t = totalsOf([meal]);
    total.kcal += t.kcal;
    total.p += t.p;
    total.c += t.c;
    total.f += t.f;
  }
  return total;
}

function normName(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Objetivos de macros: salen del plan del mes que estás siguiendo. */
function dayTargets() {
  const opt = currentOption();
  return opt ? mealsTotals(opt.meals) : null;
}

function plateTargets(plate) {
  const opt = currentOption();
  if (!opt) return null;
  const key = normName(plate.name);
  if (!key) return null;
  const meal = (opt.meals || []).find(m => {
    const mk = normName(m.name);
    return mk && (key === mk || key.startsWith(mk) || key.includes(mk));
  });
  return meal ? totalsOf([meal]) : null;
}

/** Rango de grasa entre las opciones del menú, si difieren bastante. */
function optionsFatSpread() {
  const month = activeMonth();
  const fats = (month?.options || []).map(o => mealsTotals(o.meals).f);
  if (fats.length < 2) return null;
  const min = Math.min(...fats);
  const max = Math.max(...fats);
  if (max - min <= Math.max(10, min * 0.25)) return null;
  return { min, max };
}

function budgetRow(label, value, target) {
  if (!target) {
    return `<div class="bud">
      <span class="bud-label">${esc(label)}</span>
      <span class="bud-bar"><i style="width:0"></i></span>
      <span class="bud-val"><b>${value}</b> g</span>
    </div>`;
  }
  const pct = Math.round((value / target) * 100);
  const cls = pct > 100 ? 'over' : (pct >= 90 ? 'warn' : '');
  const extra = value > target ? ` <em>+${value - target}</em>` : '';
  return `<div class="bud ${cls}">
    <span class="bud-label">${esc(label)}</span>
    <span class="bud-bar"><i style="width:${Math.min(100, pct)}%"></i></span>
    <span class="bud-val"><b>${value}</b> / ${target} g${extra}</span>
  </div>`;
}

function plateMacroLine(t, target) {
  if (!target) return `P ${t.p} g · C ${t.c} g · G ${t.f} g`;
  const pair = (value, goal) =>
    `<span class="${value > goal ? 'over' : ''}">${value}</span>/${goal}`;
  return `P ${pair(t.p, target.p)} · C ${pair(t.c, target.c)} · G ${pair(t.f, target.f)} g`;
}

/* --- bloqueo suave al pasarse de macros --- */

const MACRO_WARN_KEY = 'nutri.macroWarn';
const MACRO_LABEL = { p: 'proteína', c: 'carbohidratos', f: 'grasa' };

function macroWarnEnabled() {
  return localStorage.getItem(MACRO_WARN_KEY) !== '0';
}

function setMacroWarn(on) {
  localStorage.setItem(MACRO_WARN_KEY, on ? '1' : '0');
}

/** Macros que cruzan el objetivo del día con este cambio (antes -> después). */
function crossedTargets(before, after) {
  if (!macroWarnEnabled()) return [];
  const targets = dayTargets();
  if (!targets) return [];
  const out = [];
  for (const key of ['p', 'c', 'f']) {
    const goal = targets[key];
    if (!goal) continue;
    if (before[key] <= goal && after[key] > goal) {
      out.push({ label: MACRO_LABEL[key], value: after[key], target: goal });
    }
  }
  return out;
}

function confirmExcess(crossed) {
  const detail = crossed
    .map(c => `· ${c.label}: ${c.value} / ${c.target} g`)
    .join('\n');
  return confirm(`Con esto te pasas del objetivo del día:\n\n${detail}\n\n¿Agregarlo de todos modos?`);
}

/** Aplica un cambio ya hecho; si cruza un objetivo, pregunta y revierte si se cancela. */
function guardedChange(before, revert) {
  const crossed = crossedTargets(before, grandTotals());
  if (!crossed.length) return true;
  if (confirmExcess(crossed)) return true;
  revert();
  render();
  return false;
}

/* --- autocompletar --- */

function snapshotPlates() {
  return PLATOS.map(p => ({
    name: p.name,
    slots: (p.slots || []).map(s => ({ ...s })),
  }));
}

/** Totales sin redondear (para comparar y buscar el mejor ajuste). */
function rawTotalsOf(plates) {
  const out = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const plate of plates) {
    for (const s of plate.slots || []) {
      const k = slotCat(s);
      out.kcal += s.count * k.kcal;
      out.p += s.count * (k.macros?.p || 0);
      out.c += s.count * (k.macros?.c || 0);
      out.f += s.count * (k.macros?.f || 0);
    }
  }
  return out;
}

function roundedTotalsOf(plates) {
  const out = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const plate of plates) {
    const t = totalsOf([{ slots: plate.slots }]);
    out.kcal += t.kcal;
    out.p += t.p;
    out.c += t.c;
    out.f += t.f;
  }
  return out;
}

/** Error relativo cuadrático sobre los tres macros (kcal va implícita). */
function macroError(t, target) {
  let e = 0;
  for (const key of ['p', 'c', 'f']) {
    if (!target[key]) continue;
    const d = (t[key] - target[key]) / target[key];
    e += d * d;
  }
  return e;
}

const MAX_PORTION = 4;   // máximo de porciones al sugerir un alimento nuevo
const MAX_COUNT = 12;    // tope absoluto de porciones de un slot

function snapHalf(x) {
  return Math.min(MAX_COUNT, Math.max(0.5, Math.round(x * 2) / 2));
}

/** Qué tan lejos quedó del objetivo (0 = clavado, 0.05 = 5% de desvío). */
function targetDeviation(t, target) {
  let dev = 0;
  for (const key of ['p', 'c', 'f']) {
    if (!target[key]) continue;
    dev = Math.max(dev, Math.abs(t[key] - target[key]) / target[key]);
  }
  if (target.kcal) dev = Math.max(dev, Math.abs(t.kcal - target.kcal) / target.kcal);
  return dev;
}

function deviationSummary(t, target) {
  const diff = t.kcal - target.kcal;
  const note = Math.abs(diff) <= 10
    ? 'justo en el objetivo'
    : (diff < 0 ? `faltan ${-diff} kcal` : `te pasas ${diff} kcal`);
  const color = Math.abs(diff) <= 10 ? 'var(--accent-ink)' : (diff > 0 ? 'var(--danger)' : 'var(--warn)');
  return `<div class="big">${t.kcal} / ${target.kcal} kcal</div>
    <div class="small" style="color:${color}">${note}</div>`;
}

/** Sube/baja medias porciones de lo que ya hay hasta acercarse al objetivo. */
function refineQuantities(plates, targets, maxSteps = 24, maxShift = 1) {
  const shift = new Map();
  let err = macroError(rawTotalsOf(plates), targets);

  for (let n = 0; n < maxSteps; n++) {
    let best = null;
    plates.forEach((plate, pi) => {
      (plate.slots || []).forEach((slot, si) => {
        const key = pi + ':' + si;
        const used = shift.get(key) || 0;
        for (const delta of [0.5, -0.5]) {
          if (Math.abs(used + delta) > maxShift + 1e-9) continue;
          const next = slot.count + delta;
          if (next < 0.5 || next > MAX_COUNT) continue;
          const before = slot.count;
          slot.count = next;
          const e = macroError(rawTotalsOf(plates), targets);
          slot.count = before;
          if (e < err - 1e-9 && (!best || e < best.e)) {
            best = { pi, si, next, e, delta, key, used };
          }
        }
      });
    });
    if (!best) break;
    shift.set(best.key, best.used + best.delta);
    plates[best.pi].slots[best.si].count = best.next;
    err = best.e;
  }
}

/** Alimentos para rellenar: primero los del plan del mes (familiares y con sentido de comida). */
function fillCandidates() {
  const opt = currentOption();
  const ids = new Set();
  (opt?.meals || []).forEach(m => (m.slots || []).forEach(s => ids.add(s.foodId)));
  const all = S.foods || [];
  const fromPlan = all.filter(f => ids.has(f.id));
  const pool = fromPlan.length >= 4 ? fromPlan : all.slice();
  return pool.sort((a, b) => {
    const sa = a.source === 'tabla' ? 0 : 1;
    const sb = b.source === 'tabla' ? 0 : 1;
    return sa - sb || a.name.localeCompare(b.name, 'es');
  });
}

/** Elige alimentos para tapar lo que falta (máx. 6 alimentos, 4 porciones cada uno). */
function fillGreedy(plates, targets) {
  const chosen = [];
  let cur = rawTotalsOf(plates);
  let err = macroError(cur, targets);
  const foods = fillCandidates();

  for (let step = 0; step < 24; step++) {
    let best = null;
    for (const f of foods) {
      const picked = chosen.find(c => c.foodId === f.id);
      if (picked && picked.count >= MAX_PORTION) continue;
      if (!picked && chosen.length >= 6) continue;
      const k = cat(f.category);
      for (const inc of [1, 0.5]) {
        if (picked && picked.count + inc > MAX_PORTION) continue;
        const t = {
          p: cur.p + (k.macros?.p || 0) * inc,
          c: cur.c + (k.macros?.c || 0) * inc,
          f: cur.f + (k.macros?.f || 0) * inc,
        };
        const e = macroError(t, targets);
        if (e < err - 1e-9 && (!best || e < best.e)) best = { f, inc, e, t };
      }
    }
    if (!best) break;
    const picked = chosen.find(c => c.foodId === best.f.id);
    if (picked) picked.count += best.inc;
    else chosen.push({ foodId: best.f.id, count: best.inc });
    cur = best.t;
    err = best.e;
  }
  return chosen;
}

function autocomplete() {
  const targets = dayTargets();
  if (!targets) {
    toast('Necesitas el menú del mes para saber tus objetivos');
    return;
  }
  const cur = roundedTotalsOf(PLATOS);
  const missing = Math.max(0, targets.kcal - cur.kcal);
  openChoose({
    title: 'Autocompletar el día',
    hint: missing
      ? `Te faltan ${missing} kcal de ${targets.kcal}. ¿Cómo quieres llegar?`
      : `Ya estás en ${cur.kcal} de ${targets.kcal} kcal. ¿Cómo quieres cerrar el día?`,
    choices: [
      {
        label: 'Ajustar las cantidades de mis platos',
        desc: 'Sube o baja porciones de lo que ya tienes, sin alimentos nuevos.',
        onPick: () => runAdjust(targets),
      },
      {
        label: 'Agregar un plato para rellenar',
        desc: 'Deja tus platos como están y crea uno nuevo con lo que falta.',
        onPick: () => runFill(targets),
      },
    ],
  });
}

function runAdjust(targets) {
  const work = snapshotPlates();
  const empty = !work.some(p => (p.slots || []).length);
  if (empty) {
    toast('Primero agrega algún alimento a tus platos');
    return;
  }

  const cur = rawTotalsOf(work);
  if (cur.kcal > 0) {
    const factor = Math.min(4, Math.max(0.25, targets.kcal / cur.kcal));
    if (Math.abs(factor - 1) > 0.02) {
      for (const plate of work) {
        for (const slot of plate.slots) slot.count = snapHalf(slot.count * factor);
      }
    }
  }
  refineQuantities(work, targets);

  const lines = [];
  work.forEach((plate, pi) => {
    plate.slots.forEach((slot, si) => {
      const from = PLATOS[pi].slots[si].count;
      if (Math.abs(from - slot.count) < 1e-9) return;
      const f = food(slot.foodId);
      lines.push(
        `${esc(plate.name)} · ${esc(f?.name || '—')}: ` +
        `<b>${fmtCount(from)} → ${fmtCount(slot.count)}</b>`
      );
    });
  });

  if (!lines.length) {
    toast('Tus cantidades ya están en el objetivo');
    return;
  }

  const after = roundedTotalsOf(work);
  const far = targetDeviation(after, targets) > 0.05;
  openReview({
    title: 'Ajustar cantidades',
    hint: far
      ? `${lines.length} cambio(s). Con solo lo que ya tienes no se llega al objetivo:`
      : `${lines.length} cambio(s). Así queda tu día:`,
    lines,
    summary: `${deviationSummary(after, targets)}
      <div class="small">P ${after.p}/${targets.p} · C ${after.c}/${targets.c} · G ${after.f}/${targets.f} g</div>`,
    confirmLabel: 'Aplicar cambios',
    secondary: far
      ? { label: 'Mejor: agregar un plato para rellenar', onPick: () => runFill(targets) }
      : null,
    onConfirm: () => {
      work.forEach((plate, pi) => {
        PLATOS[pi].slots = plate.slots.map(s => ({ ...s }));
      });
      savePlatos();
      render();
      toast('Cantidades ajustadas');
    },
  });
}

function runFill(targets) {
  const cur = rawTotalsOf(PLATOS);
  if ((targets.p - cur.p) <= 1 && (targets.c - cur.c) <= 1 && (targets.f - cur.f) <= 1) {
    toast('Ya cumpliste tus objetivos');
    return;
  }

  const chosen = fillGreedy(PLATOS, targets);
  if (!chosen.length) {
    toast('No encontré alimentos para completarlo');
    return;
  }

  const slots = chosen.map(c => ({
    category: cat((food(c.foodId) || {}).category).id,
    foodId: c.foodId,
    count: c.count,
  }));

  const lines = chosen.map(c => {
    const f = food(c.foodId);
    const g = grams(c.count * ((f && f.grams) || 0));
    return `${esc(f?.name || '—')}: <b>${fmtCount(c.count)}</b> · ${g} g`;
  });

  const work = snapshotPlates();
  work.push({ name: 'Para completar', slots });
  const after = roundedTotalsOf(work);
  const far = targetDeviation(after, targets) > 0.05;
  const gapKcal = Math.max(0, targets.kcal - cur.kcal);

  openReview({
    title: 'Plato sugerido',
    hint: gapKcal > targets.kcal * 0.45
      ? `El hueco es grande (${gapKcal} kcal): esto llenará casi el día completo.`
      : (far
        ? 'Se agrega como plato nuevo; aun así queda algo lejos del objetivo.'
        : 'Se agrega como un plato nuevo; tus otros platos no cambian.'),
    lines,
    summary: `${deviationSummary(after, targets)}
      <div class="small">P ${after.p}/${targets.p} · C ${after.c}/${targets.c} · G ${after.f}/${targets.f} g</div>`,
    confirmLabel: 'Agregar «Para completar»',
    onConfirm: () => {
      PLATOS.push(newPlate('Para completar'));
      PLATOS[PLATOS.length - 1].slots = slots;
      savePlatos();
      render();
      toast('Plato agregado: «Para completar»');
    },
  });
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
  const k = slotCat(slot);
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

  const t = mealsTotals(opt.meals);
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

function plateSlotRow(pi, slot, si) {
  const f = food(slot.foodId);
  const g = gramsFor(slot);
  const k = slotCat(slot);
  return `
    <div class="slot">
      <div class="stepper">
        <button data-act="pl-minus" data-plate="${pi}" data-slot="${si}" aria-label="Menos">−</button>
        <span class="val">${esc(fmtCount(slot.count))}</span>
        <button data-act="pl-plus" data-plate="${pi}" data-slot="${si}" aria-label="Más">+</button>
      </div>
      <div class="slot-main">
        <div class="slot-name">${esc(f?.name || '—')}</div>
        <div class="slot-meta">${esc(k.short)} · 1 porción = ${f?.grams ? grams(f.grams) + ' g' : '—'}</div>
      </div>
      <div class="slot-right">
        <div class="grams">${g === null ? '—' : grams(g) + ' <small>g</small>'}</div>
        <button class="icon-btn" data-act="pl-del" data-plate="${pi}" data-slot="${si}" aria-label="Quitar">×</button>
      </div>
    </div>`;
}

function viewPlato() {
  const nutriKcal = monthKcal();
  const targets = dayTargets();
  const kcalGoal = targets ? targets.kcal : nutriKcal;
  const total = grandTotals();
  const opt = currentOption();
  const spread = optionsFatSpread();
  const pct = kcalGoal ? Math.min(100, Math.round((total.kcal / kcalGoal) * 100)) : 0;
  const gapNote = targets && nutriKcal && Math.abs(nutriKcal - targets.kcal) >= 10
    ? ` La meta de tu nutriólogo es ${nutriKcal} kcal; el menú suma ${targets.kcal}`
      + ' con la tabla de intercambios.'
    : '';

  const chips = PLATOS
    .filter(p => (p.slots || []).length)
    .map(p => `<span class="chip">${esc(p.name)} · ${totalsOf([{ slots: p.slots }]).kcal} kcal</span>`)
    .join('');

  const cards = PLATOS.map((plate, pi) => {
    const t = totalsOf([{ slots: plate.slots }]);
    const goal = plateTargets(plate);
    const rows = (plate.slots || []).map((s, si) => plateSlotRow(pi, s, si)).join('');
    return `
      <section class="card plate">
        <div class="card-head">
          <div>
            <button class="plate-name" data-act="pl-rename" data-plate="${pi}">${esc(plate.name)}</button>
            <div class="plate-macros">${plateMacroLine(t, goal)}</div>
          </div>
          <span class="right">${t.kcal}${goal ? ' / ' + goal.kcal : ''} kcal</span>
        </div>
        <div class="slots">${rows || '<div class="empty" style="padding:12px 0">Sin alimentos todavía.</div>'}</div>
        <div class="plate-add">
          <input id="quickp-${pi}" type="text" autocomplete="off" placeholder="pechuga con arroz y aguacate…">
          <button class="btn" data-act="pl-quick" data-plate="${pi}" aria-label="Agregar">＋</button>
        </div>
        <div class="plate-foot">
          <button class="link-btn" data-act="pl-add" data-plate="${pi}">Elegir de la lista</button>
          ${(plate.slots || []).length ? `<button class="link-btn" data-act="pl-clear" data-plate="${pi}">Vaciar</button>` : ''}
          ${PLATOS.length > 1 ? `<button class="link-btn danger" data-act="pl-delete" data-plate="${pi}">Eliminar</button>` : ''}
        </div>
      </section>`;
  }).join('');

  const budget = targets
    ? `<div class="budgets">
         ${budgetRow('Proteína', total.p, targets.p)}
         ${budgetRow('Carbohidratos', total.c, targets.c)}
         ${budgetRow('Grasa', total.f, targets.f)}
       </div>
       <p class="caption">Objetivo: tu plan de hoy${opt ? ' (' + esc(opt.name) + ')' : ''}.
         En cada plato verás <b>consumido / objetivo</b>.${esc(gapNote)}
         <button class="link-btn" data-act="pl-warn">${macroWarnEnabled() ? 'Aviso al pasarme: activado' : 'Aviso al pasarme: desactivado'}</button></p>
       ${spread ? `<p class="caption warn">⚠ Las opciones del menú no tienen los mismos macros:
         la grasa va de ${spread.min} g a ${spread.max} g según la opción.</p>` : ''}`
    : `<div class="macros">
         <span>Proteína <b>${total.p} g</b></span>
         <span>Carbohidratos <b>${total.c} g</b></span>
         <span>Grasa <b>${total.f} g</b></span>
       </div>`;

  return `
    <section class="card">
      <div class="card-head">
        <h2>Total de tus platos</h2>
        <span class="right">${total.kcal} / ${kcalGoal || '—'} kcal</span>
      </div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${budget}
      ${chips ? `<div class="chips" style="margin-top:10px">${chips}</div>` : ''}
      ${targets ? `<button class="ghost-btn" data-act="autocomplete" style="margin-top:12px">⚡ Autocompletar el día</button>` : ''}
    </section>

    ${cards}

    <button class="ghost-btn" data-act="pl-new">＋ Nuevo plato</button>`;
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

function openPrompt({ title, hint, placeholder, label, value, onSubmit }) {
  const sheet = $('#sheet');
  $('#sheetTitle').textContent = title;
  $('#sheetHint').textContent = hint || '';
  $('#sheetTabs').innerHTML = '';
  $('#sheetBody').innerHTML = `
    <input id="promptInput" type="text" autocomplete="off" value="${esc(value || '')}" placeholder="${esc(placeholder || '')}">
    <button class="btn" id="promptGo" style="width:100%;margin-top:10px">${esc(label || 'Aplicar')}</button>`;
  sheetPick = null;
  sheetState = null;
  sheet.dataset.open = 'true';
  sheet.setAttribute('aria-hidden', 'false');
  $('#backdrop').dataset.open = 'true';
  const go = () => {
    const text = $('#promptInput').value.trim();
    if (!text) { $('#promptInput').focus(); return; }
    closeSheet();
    onSubmit(text);
  };
  $('#promptGo').addEventListener('click', go);
  $('#promptInput').addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); go(); }
  });
  setTimeout(() => $('#promptInput')?.focus(), 220);
}

function openChoose({ title, hint, choices }) {
  const sheet = $('#sheet');
  $('#sheetTitle').textContent = title;
  $('#sheetHint').textContent = hint || '';
  $('#sheetTabs').innerHTML = '';
  $('#sheetBody').innerHTML = choices.map((c, i) => `
    <button class="pick-item" data-choice="${i}">
      <div class="grow">
        <div class="nm">${esc(c.label)}</div>
        <div class="ms">${esc(c.desc || '')}</div>
      </div>
      <div class="gr">›</div>
    </button>`).join('');
  sheetPick = null;
  sheetState = null;
  sheet.dataset.open = 'true';
  sheet.setAttribute('aria-hidden', 'false');
  $('#backdrop').dataset.open = 'true';
  $$('#sheetBody [data-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      const choice = choices[Number(btn.dataset.choice)];
      closeSheet();
      if (choice && typeof choice.onPick === 'function') choice.onPick();
    });
  });
}

function openReview({ title, hint, lines, summary, confirmLabel, onConfirm, secondary }) {
  const sheet = $('#sheet');
  $('#sheetTitle').textContent = title;
  $('#sheetHint').textContent = hint || '';
  $('#sheetTabs').innerHTML = '';
  $('#sheetBody').innerHTML = `
    <div class="review">${lines.map(l => `<div class="review-line">${l}</div>`).join('')}</div>
    ${summary ? `<div class="conv-out" style="margin-top:14px">${summary}</div>` : ''}
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn secondary" id="reviewCancel" style="flex:1">Cancelar</button>
      <button class="btn" id="reviewOk" style="flex:2">${esc(confirmLabel || 'Aplicar')}</button>
    </div>
    ${secondary ? `<button class="ghost-btn" id="reviewAlt" style="margin-top:8px">${esc(secondary.label)}</button>` : ''}`;
  sheetPick = null;
  sheetState = null;
  sheet.dataset.open = 'true';
  sheet.setAttribute('aria-hidden', 'false');
  $('#backdrop').dataset.open = 'true';
  $('#reviewCancel').addEventListener('click', closeSheet);
  $('#reviewOk').addEventListener('click', () => {
    closeSheet();
    onConfirm();
  });
  if (secondary) {
    $('#reviewAlt').addEventListener('click', () => {
      closeSheet();
      secondary.onPick();
    });
  }
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
  const pi = el.dataset.plate !== undefined ? Number(el.dataset.plate) : null;

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

  if (act === 'pl-add' || act === 'pl-quick') {
    const plate = PLATOS[pi];
    if (!plate) return;

    if (act === 'pl-add') {
      openSheet({
        title: 'Agregar a ' + plate.name,
        hint: 'Elige el grupo y luego el alimento.',
        categories: S.categories.map(c => c.id),
        onPick: (f) => {
          const before = grandTotals();
          plate.slots.push({ category: f.category, foodId: f.id, count: 1 });
          if (!guardedChange(before, () => plate.slots.pop())) return;
          savePlatos(); render();
        },
      });
      return;
    }

    const input = $('#quickp-' + pi);
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

    const before = grandTotals();
    const added = [];
    for (const it of found) {
      const slot = { category: it.category, foodId: it.foodId, count: 1 };
      plate.slots.push(slot);
      added.push(slot);
    }
    const keep = guardedChange(before, () => {
      for (const slot of added) {
        const idx = plate.slots.indexOf(slot);
        if (idx >= 0) plate.slots.splice(idx, 1);
      }
    });
    if (!keep) { toast('Se canceló: no se agregó nada'); return; }

    savePlatos(); render();
    if (!found.length) toast('No reconocí nada de eso');
    else if (missing.length) toast('Agregado a ' + plate.name + '. No reconocí: ' + missing.join(', '));
    else toast(found.length + (found.length === 1 ? ' alimento agregado' : ' alimentos agregados') + ' a ' + plate.name);
    return;
  }

  if (act === 'autocomplete') { autocomplete(); return; }

  if (act === 'pl-warn') {
    const on = !macroWarnEnabled();
    setMacroWarn(on);
    toast(on ? 'Te avisaré antes de pasarte de un macro' : 'Ya no te avisaré al pasarte');
    render();
    return;
  }

  if (act === 'pl-minus' || act === 'pl-plus') {
    const slot = PLATOS[pi]?.slots[si];
    if (!slot) return;
    const before = grandTotals();
    slot.count = Math.max(0.5, slot.count + (act === 'pl-plus' ? 0.5 : -0.5));
    if (!guardedChange(before, () => { slot.count = Math.max(0.5, slot.count - (act === 'pl-plus' ? 0.5 : -0.5)); })) return;
    savePlatos(); render(); return;
  }

  if (act === 'pl-del') {
    PLATOS[pi]?.slots.splice(si, 1);
    savePlatos(); render(); return;
  }

  if (act === 'pl-clear') {
    PLATOS[pi].slots = [];
    savePlatos(); render(); return;
  }

  if (act === 'pl-delete') {
    const plate = PLATOS[pi];
    if (!plate) return;
    if (!confirm(`¿Eliminar el plato «${plate.name}» y sus alimentos?`)) return;
    PLATOS.splice(pi, 1);
    savePlatos(); render(); return;
  }

  if (act === 'pl-rename') {
    const plate = PLATOS[pi];
    if (!plate) return;
    openPrompt({
      title: 'Nombre del plato',
      hint: 'Desayuno, Colación, Comida, Cena, Merienda…',
      placeholder: 'Merienda',
      value: plate.name,
      label: 'Guardar nombre',
      onSubmit: (name) => { plate.name = name; savePlatos(); render(); },
    });
    return;
  }

  if (act === 'pl-new') {
    openPrompt({
      title: 'Nuevo plato',
      hint: 'Ponle nombre para identificarlo.',
      placeholder: 'Merienda',
      label: 'Crear plato',
      onSubmit: (name) => { PLATOS.push(newPlate(name)); savePlatos(); render(); },
    });
    return;
  }

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
  if (e.key !== 'Enter') return;
  if (e.target.id === 'quick') {
    e.preventDefault();
    $('#view [data-act="quickadd"]')?.click();
    return;
  }
  if (e.target.id && e.target.id.startsWith('quickp-')) {
    e.preventDefault();
    const index = e.target.id.slice('quickp-'.length);
    $(`#view [data-act="pl-quick"][data-plate="${index}"]`)?.click();
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
