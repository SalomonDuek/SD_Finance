const KEY = 'finanzas.v1';
let S = { mov: [] };
try { const raw = localStorage.getItem(KEY); if (raw) S = JSON.parse(raw); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
const $ = id => document.getElementById(id);
const money = (n, c) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: c, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);
const ACC = { efec: 'Efectivo ARS', banco: 'Banco / virtual ARS' };
const CATS = ['Comida', 'Transporte', 'Facultad', 'Salidas', 'Hogar', 'Salud', 'Tecnología', 'Otros'];
const T = {
  sueldo: { label: 'Sueldo', name: 'Sueldo' },
  gasto: { label: 'Gasto', name: 'Gasto' },
  mover: { label: 'Mover pesos', name: 'Movimiento' },
  compra: { label: 'Compré USD', name: 'Compra de USD' },
  venta: { label: 'Vendí USD', name: 'Venta de USD' }
};
let tipo = 'sueldo';

/* ---- tema claro / oscuro con transición circular ---- */
const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion:reduce)');
function paintTheme(t) {
  root.dataset.theme = t;
  $('theme').setAttribute('aria-checked', t === 'dark');
  $('tc').content = t === 'dark' ? '#0f1820' : '#eef2f5';
}
function setTheme(t, x, y) {
  try { localStorage.setItem('finanzas.theme', t); } catch (e) {}
  if (reduce.matches) return paintTheme(t);
  if (document.startViewTransition) {
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const vt = document.startViewTransition(() => paintTheme(t));
    vt.ready.then(() => root.animate(
      { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)'] },
      { duration: 700, easing: 'cubic-bezier(.22,.8,.24,1)', pseudoElement: '::view-transition-new(root)' }
    ));
  } else {
    root.classList.add('fade'); paintTheme(t); setTimeout(() => root.classList.remove('fade'), 500);
  }
}
$('theme').onclick = e => {
  const b = e.currentTarget.getBoundingClientRect();
  setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', b.left + b.width / 2, b.top + b.height / 2);
};
matchMedia('(prefers-color-scheme:dark)').onchange = e => { try { if (!localStorage.getItem('finanzas.theme')) paintTheme(e.matches ? 'dark' : 'light'); } catch (x) {} };
paintTheme(root.dataset.theme);

/* ---- formulario ---- */
let editId = null;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const accSel = (id, lbl, v) => `<label>${lbl}<select id="${id}">${Object.entries(ACC).map(([k, n]) => `<option value="${k}"${k === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
/* montos con puntos de mil mientras escribís: punto = miles (automático), coma = decimales */
const fmtAmount = raw => {
  const s = String(raw).replace(/[^\d,]/g, ''), i = s.indexOf(',');
  let int = (i < 0 ? s : s.slice(0, i)).replace(/,/g, '');
  const dec = i < 0 ? null : s.slice(i + 1).replace(/,/g, '').slice(0, 2);
  int = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec === null ? int : (int || '0') + ',' + dec;
};
const parseAmount = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
function liveMoney(el) {
  const keep = el.value.slice(0, el.selectionStart).replace(/[^\d,]/g, '').length;
  el.value = fmtAmount(el.value);
  let n = 0, i = 0;
  while (i < el.value.length && n < keep) { if (/[\d,]/.test(el.value[i])) n++; i++; }
  el.setSelectionRange(i, i);
}
const num = (id, lbl, v) => `<label>${lbl}<input id="${id}" type="text" inputmode="decimal" autocomplete="off" data-money required value="${v == null ? '' : fmtAmount(String(v).replace('.', ','))}"></label>`;

const catOpts = sel => { const l = [...(S.cats || CATS)]; if (sel && !l.includes(sel)) l.push(sel); return l.map(c => `<option value="${esc(c)}"${c === sel ? ' selected' : ''}>${esc(c)}</option>`).join('') + '<option value="__new">＋ Agregar categoría…</option>'; };

function renderForm(d = {}) {
  let h = '';
  if (tipo === 'sueldo') h = num('ars', 'Pesos recibidos', d.ars) + accSel('to', 'Entra a', d.to);
  if (tipo === 'gasto') h = num('ars', 'Monto en pesos', d.ars) + `<div class="two">${accSel('from', 'Pagué con', d.from)}<label>Categoría<select id="cat">${catOpts(d.cat)}</select></label></div><label id="newcatw" hidden>Nueva categoría<input id="newcat" type="text" maxlength="30" placeholder="Ej. Mascotas"></label><label>Detalle<input id="note" type="text" placeholder="Opcional" value="${esc(d.note)}"></label>`;
  if (tipo === 'mover') h = num('ars', 'Pesos a mover', d.ars) + `<div class="two">${accSel('from', 'Desde', d.from)}${accSel('to', 'Hacia', d.to || 'banco')}</div>`;
  if (tipo === 'compra') h = `<div class="two">${num('ars', 'Pesos que di', d.ars)}${num('usd', 'Dólares que recibí', d.usd)}</div>${accSel('from', 'Pagué con', d.from)}<p class="mute" id="imp-rate" style="margin:0"></p>`;
  if (tipo === 'venta') h = `<div class="two">${num('usd', 'Dólares que di', d.usd)}${num('ars', 'Pesos que recibí', d.ars)}</div>${accSel('to', 'Recibí en', d.to)}<p class="mute" id="imp-rate" style="margin:0"></p>`;
  h += `<label>Fecha y hora<input id="ts" type="datetime-local" value="${d.ts || nowLocal()}" required></label><div class="tools"><button type="submit">${editId ? 'Guardar cambios' : 'Guardar ' + T[tipo].label.toLowerCase()}</button>${editId ? '<button type="button" class="ghost" id="cancelEdit">Cancelar</button>' : ''}</div>`;
  $('f').innerHTML = h;
  $('ftitle').textContent = editId ? 'Editar movimiento' : 'Cargar movimiento';
  if ($('ars') && $('usd')) { const u = () => { const a = parseAmount($('ars').value), d = parseAmount($('usd').value); $('imp-rate').textContent = a > 0 && d > 0 ? 'Cotización de esta operación: ' + money(a / d, 'ARS') + ' por dólar' : ''; }; $('ars').oninput = $('usd').oninput = u; u(); }
  if (editId) $('cancelEdit').onclick = () => { editId = null; renderForm(); };
  if ($('cat')) $('cat').onchange = () => { const n = $('cat').value === '__new'; $('newcatw').hidden = !n; if (n) $('newcat').focus(); };
  $('seg').innerHTML = Object.entries(T).map(([k, v]) => `<button type="button" aria-pressed="${k === tipo}" data-t="${k}"${editId && k !== tipo ? ' disabled' : ''}>${v.label}</button>`).join('');
}
$('seg').onclick = e => { const t = e.target.dataset.t; if (t) { tipo = t; renderForm(); } };
$('f').addEventListener('input', e => { if (e.target.dataset.money !== undefined) liveMoney(e.target); });

$('f').onsubmit = e => {
  e.preventDefault();
  const g = id => $(id) ? $(id).value : undefined;
  const m = { id: editId || Date.now() + Math.random().toString(36).slice(2, 6), type: tipo, ts: g('ts') };
  if ($('ars')) m.ars = parseAmount(g('ars'));
  if ($('usd')) m.usd = parseAmount(g('usd'));
  if ($('from')) m.from = g('from');
  if ($('to')) m.to = g('to');
  if (tipo === 'gasto') { m.cat = g('cat'); m.note = g('note'); }
  if (!(m.ars > 0) || ((tipo === 'compra' || tipo === 'venta') && !(m.usd > 0))) { alert('Ingresá un monto mayor a 0.'); return; }
  if (tipo === 'mover' && m.from === m.to) { alert('Elegí cuentas distintas.'); return; }
  if (m.cat === '__new') {
    const n = g('newcat').trim();
    if (!n) { alert('Escribí el nombre de la categoría.'); return; }
    const l = S.cats || (S.cats = [...CATS]), ex = l.find(c => c.toLowerCase() === n.toLowerCase());
    if (ex) m.cat = ex; else { l.push(n); m.cat = n; }
  }
  if (editId) S.mov = S.mov.map(x => x.id === editId ? m : x); else S.mov.push(m);
  editId = null; $('mes').value = m.ts.slice(0, 7);
  save(); renderForm(); render(); queueSync();
};

/* ---- cálculos y pantalla ---- */
function balances(list) {
  const b = { efec: 0, banco: 0, usd: 0 };
  list.forEach(m => {
    if (m.type === 'sueldo') b[m.to] += m.ars;
    if (m.type === 'gasto') b[m.from] -= m.ars;
    if (m.type === 'mover') { b[m.from] -= m.ars; b[m.to] += m.ars; }
    if (m.type === 'compra') { b[m.from] -= m.ars; b.usd += m.usd; }
    if (m.type === 'venta') { b.usd -= m.usd; b[m.to] += m.ars; }
  });
  return b;
}
const row = (l, v, cls, sub, k) => `<div class="${k || 'row'}"><div>${l}${sub ? `<div class="mute">${sub}</div>` : ''}</div><div class="big ${cls || ''}">${v}</div></div>`;
const stat = (l, v, cls, sub) => row(l, v, cls, sub, 'stat');
const MESES = Array.from({ length: 12 }, (_, i) => { const n = new Date(2026, i, 1).toLocaleString('es-AR', { month: 'long' }); return n[0].toUpperCase() + n.slice(1); });
const neto = m => m.type === 'sueldo' || m.type === 'venta' ? m.ars : m.type === 'gasto' || m.type === 'compra' ? -m.ars : 0;
const cierre = ym => S.mov.filter(m => m.ts.slice(0, 7) <= ym).reduce((a, m) => a + neto(m), 0);
const apertura = ym => S.mov.filter(m => m.ts.slice(0, 7) < ym).reduce((a, m) => a + neto(m), 0);
const sum = (t, k, l) => l.filter(m => m.type === t).reduce((a, m) => a + m[k], 0);
function shiftMes(n) {
  const [y, m] = ($('mes').value || nowLocal().slice(0, 7)).split('-').map(Number), d = new Date(y, m - 1 + n, 1);
  $('mes').value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); render();
}

function render() {
  const b = balances(S.mov);
  $('saldos').innerHTML =
    stat('Efectivo ARS', money(b.efec, 'ARS'), 'ars' + (b.efec < 0 ? ' neg' : '')) +
    stat('Banco / virtual ARS', money(b.banco, 'ARS'), 'ars' + (b.banco < 0 ? ' neg' : '')) +
    stat('Dólares en efectivo', money(b.usd, 'USD'), 'usd' + (b.usd < 0 ? ' neg' : '')) +
    stat('Total en pesos', money(b.efec + b.banco, 'ARS'), '');

  if (!$('mes').value) $('mes').value = nowLocal().slice(0, 7);
  const mes = $('mes').value, ms = S.mov.filter(m => m.ts.startsWith(mes));
  const ing = sum('sueldo', 'ars', ms), gas = sum('gasto', 'ars', ms);
  const cambiado = sum('compra', 'ars', ms) - sum('venta', 'ars', ms), usdNeto = sum('compra', 'usd', ms) - sum('venta', 'usd', ms);
  const ahorre = ing - gas, sobro = ahorre - cambiado, ape = apertura(mes), cie = ape + sobro;
  const bc = {}; ms.filter(m => m.type === 'gasto').forEach(m => bc[m.cat] = (bc[m.cat] || 0) + m.ars);
  const cs = Object.entries(bc).sort((a, c) => c[1] - a[1]);
  $('resumen').innerHTML =
    row('Saldo que traías', money(ape, 'ARS'), ape < 0 ? 'neg' : '', 'Lo que quedó de los meses anteriores') +
    row('Ingresos', money(ing, 'ARS')) +
    row('Gastado', money(gas, 'ARS'), 'neg') +
    row('Ahorré', money(ahorre, 'ARS'), ahorre < 0 ? 'neg' : '', 'Ingresos menos gastos') +
    row('Cambié a USD', money(cambiado, 'ARS'), 'usd', 'Neto: ' + money(usdNeto, 'USD')) +
    row('Me sobró este mes', money(sobro, 'ARS'), sobro < 0 ? 'neg' : 'ars', 'Ahorro menos lo que cambié') +
    row('Te queda para gastar', money(cie, 'ARS'), cie < 0 ? 'neg' : 'ars', 'Saldo que traías más lo que sobró', 'row fin') +
    (cs.length ? '<h3 class="sub">A dónde fue la plata</h3>' + cs.map(([c, v]) => { const p = Math.round(v / gas * 100); return `<div class="cat"><div class="ch"><span>${esc(c)} <span class="mute">${p}%</span></span><b>${money(v, 'ARS')}</b></div><div class="track"><i style="width:${p}%"></i></div></div>`; }).join('') : '');

  const lst = ms.slice().sort((a, c) => c.ts.localeCompare(a.ts));
  $('lista').innerHTML = lst.length ? lst.map(m => {
    const f = new Date(m.ts).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    let d = '', amt = '', cls = '';
    if (m.type === 'sueldo') { d = 'Entró a ' + ACC[m.to]; amt = '+' + money(m.ars, 'ARS'); cls = 'ars'; }
    if (m.type === 'gasto') { d = esc(m.cat) + (m.note ? ' · ' + esc(m.note) : '') + ' · ' + ACC[m.from]; amt = '-' + money(m.ars, 'ARS'); cls = 'neg'; }
    if (m.type === 'mover') { d = ACC[m.from] + ' a ' + ACC[m.to]; amt = money(m.ars, 'ARS'); }
    if (m.type === 'compra') { d = 'Di ' + money(m.ars, 'ARS') + ' a ' + money(m.ars / m.usd, 'ARS') + ' c/u'; amt = '+' + money(m.usd, 'USD'); cls = 'usd'; }
    if (m.type === 'venta') { d = 'Recibí ' + money(m.ars, 'ARS') + ' a ' + money(m.ars / m.usd, 'ARS') + ' c/u'; amt = '-' + money(m.usd, 'USD'); cls = 'usd'; }
    return `<div class="mov"><div><strong>${T[m.type].name}</strong><small>${f} · ${d}</small></div><div class="${cls}" style="font-weight:600">${amt}</div><button class="x" data-edit="${m.id}" aria-label="Editar movimiento">✎</button><button class="x" data-del="${m.id}" aria-label="Borrar movimiento">×</button></div>`;
  }).join('') : '<p class="mute" style="margin:0">No hay movimientos este mes. Cargá el primero.</p>';

  const y = mes.slice(0, 4), nowYM = nowLocal().slice(0, 7);
  const ys = MESES.map((n, i) => { const ym = y + '-' + String(i + 1).padStart(2, '0'), l = S.mov.filter(m => m.ts.startsWith(ym)); return { ym, n, has: l.length > 0, i: sum('sueldo', 'ars', l), g: sum('gasto', 'ars', l), u: sum('compra', 'usd', l) - sum('venta', 'usd', l), c: cierre(ym) }; });
  const TT = ys.reduce((a, x) => ({ i: a.i + x.i, g: a.g + x.g, u: a.u + x.u }), { i: 0, g: 0, u: 0 });
  $('anual').innerHTML = `<div class="yhead"><button class="ghost" data-y="-1" aria-label="Año anterior">‹</button><strong>${y}</strong><button class="ghost" data-y="1" aria-label="Año siguiente">›</button></div><div class="tbl"><table><thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Ahorré</th><th>USD netos</th><th>Saldo al cierre</th></tr></thead><tbody>${ys.map(x => `<tr${x.ym === mes ? ' class="sel"' : ''}><td><button class="lk" data-m="${x.ym}">${x.n}</button></td><td>${x.has ? money(x.i, 'ARS') : '—'}</td><td>${x.has ? money(x.g, 'ARS') : '—'}</td><td>${x.has ? money(x.i - x.g, 'ARS') : '—'}</td><td>${x.has ? money(x.u, 'USD') : '—'}</td><td>${x.has || x.ym <= nowYM ? money(x.c, 'ARS') : '—'}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total ${y}</td><td>${money(TT.i, 'ARS')}</td><td>${money(TT.g, 'ARS')}</td><td>${money(TT.i - TT.g, 'ARS')}</td><td>${money(TT.u, 'USD')}</td><td></td></tr></tfoot></table></div>`;
}
$('mes').onchange = render;
$('mp').onclick = () => shiftMes(-1);
$('mn').onclick = () => shiftMes(1);
$('anual').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.y) shiftMes(+b.dataset.y * 12);
  if (b.dataset.m) { $('mes').value = b.dataset.m; render(); $('mes').scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'center' }); }
};
$('lista').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.del && confirm('¿Borrar este movimiento?')) { if (editId === b.dataset.del) editId = null; S.mov = S.mov.filter(m => m.id !== b.dataset.del); S.del = (S.del || []).concat(b.dataset.del); save(); renderForm(); render(); queueSync(); }
  if (b.dataset.edit) { const m = S.mov.find(x => x.id === b.dataset.edit); if (!m) return; editId = m.id; tipo = m.type; renderForm(m); $('f').scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'center' }); }
};

$('exp').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ mov: S.mov.map(({ sync, ...m }) => m), cats: S.cats })], { type: 'application/json' })); a.download = 'finanzas-' + nowLocal().slice(0, 10) + '.json'; a.click(); };
$('impb').onclick = () => $('imp').click();
$('imp').onchange = async e => {
  try { const d = JSON.parse(await e.target.files[0].text()); if (!Array.isArray(d.mov)) throw 0; if (confirm('Esto reemplaza tus datos actuales. ¿Seguir?')) { const old = S.mov.map(m => m.id); S = { mov: d.mov.map(({ sync, ...m }) => m), cats: d.cats }; if (!S.cats) delete S.cats; S.del = old.filter(id => !S.mov.some(m => m.id === id)); editId = null; save(); renderForm(); render(); queueSync(); } } catch (x) { alert('El archivo no es válido.'); }
};

$('mes').value = nowLocal().slice(0, 7);
renderForm(); render();