/* sync.js: login con Supabase y sincronización entre dispositivos.
   Se carga DESPUÉS de script.js (usa sus variables: S, save, render, renderForm, esc, editId). */

/* ---- supabase: login y sincronización ---- */
const SB_URL = 'https://dfpajyofaogjjhdjljqs.supabase.co';
const SB_KEY = 'sb_publishable_wFk4k13ayy1HsjIMxoSJEQ_5-hHSh6j';
const AUTH_KEY = 'finanzas.auth';
let sess = null;
try { sess = JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) {}
if (!sess || !sess.access_token || !sess.user) sess = null;
const saveSess = s => { sess = s; try { s ? localStorage.setItem(AUTH_KEY, JSON.stringify(s)) : localStorage.removeItem(AUTH_KEY); } catch (e) {} };

async function authReq(grant, body) {
  const r = await fetch(SB_URL + '/auth/v1/token?grant_type=' + grant, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error_description || j.msg || j.message || 'Error de acceso'), { status: r.status });
  saveSess({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: j.user ? { id: j.user.id, email: j.user.email } : sess.user });
}
const login = (email, password) => authReq('password', { email, password });
async function token() {
  if (!sess) throw Object.assign(new Error('Sin sesión'), { status: 401 });
  if (sess.expires_at - 60 < Date.now() / 1000) {
    try { await authReq('refresh_token', { refresh_token: sess.refresh_token }); }
    catch (e) { if ([400, 401, 403].includes(e.status)) saveSess(null); throw e; }
  }
  return sess.access_token;
}
async function rest(path, o = {}) {
  const t = await token();
  const r = await fetch(SB_URL + '/rest/v1/' + path, { method: o.method || 'GET', headers: Object.assign({ apikey: SB_KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, o.prefer ? { Prefer: o.prefer } : {}), body: o.body ? JSON.stringify(o.body) : undefined });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.message || ('Error ' + r.status)), { status: r.status }); }
  return r.status === 204 ? null : r.json().catch(() => null);
}
/* local -> tabla: type=tipo, from=origen, to=destino, note=nota */
const toRow = (m, uid) => ({ user_id: uid, id: m.id, tipo: m.type, ts: String(m.ts).slice(0, 16), ars: m.ars ?? null, usd: m.usd ?? null, origen: m.from ?? null, destino: m.to ?? null, cat: m.cat ?? null, nota: m.note || null });
const fromRow = r => { const m = { id: r.id, type: r.tipo, ts: r.ts, sync: true }; if (r.ars != null) m.ars = +r.ars; if (r.usd != null) m.usd = +r.usd; if (r.origen) m.from = r.origen; if (r.destino) m.to = r.destino; if (r.cat) m.cat = r.cat; if (r.nota) m.note = r.nota; return m; };

let syncing = false, again = false, syncTimer = null, statusTxt = 'Todavía no sincronizado';
function setStatus(t) { statusTxt = t; const el = $('sstat'); if (el) el.textContent = t; }
function queueSync(ms) { if (!sess) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, ms ?? 800); }
async function syncNow() {
  if (!sess) return;
  if (syncing) { again = true; return; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus('Sin conexión · los cambios se suben cuando vuelva'); return; }
  syncing = true; setStatus('Sincronizando…');
  try {
    const uid = sess.user.id;
    S.del = S.del || [];
    for (const id of [...S.del]) {
      await rest('movimientos?user_id=eq.' + uid + '&id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
      S.del = S.del.filter(x => x !== id); save();
    }
    const pend = S.mov.filter(m => !m.sync);
    for (let i = 0; i < pend.length; i += 200) {
      const chunk = pend.slice(i, i + 200);
      await rest('movimientos?on_conflict=user_id,id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: chunk.map(m => toRow(m, uid)) });
      chunk.forEach(m => { if (S.mov.includes(m)) m.sync = true; }); save();
    }
    const cloud = [];
    for (let off = 0; ; off += 1000) {
      const rows = await rest('movimientos?select=*&order=ts.asc,id.asc&limit=1000&offset=' + off);
      cloud.push(...rows); if (rows.length < 1000) break;
    }
    const keep = new Map(S.mov.filter(m => !m.sync).map(m => [m.id, m])), del = new Set(S.del);
    S.mov = cloud.filter(r => !keep.has(r.id) && !del.has(r.id)).map(fromRow).concat([...keep.values()]);
    const aj = await rest('ajustes?select=categorias');
    const cl = aj && aj[0] && Array.isArray(aj[0].categorias) ? aj[0].categorias : [];
    const merged = cl.slice(); (S.cats || []).forEach(c => { if (!merged.includes(c)) merged.push(c); });
    if (merged.length) {
      S.cats = merged;
      if (merged.length !== cl.length) await rest('ajustes?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { user_id: uid, categorias: merged } });
    }
    save(); render();
    setStatus('Sincronizado · ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    if (!sess) { renderCuenta(); if ($('lerr')) $('lerr').textContent = 'Tu sesión venció. Volvé a entrar.'; }
    else setStatus('No se pudo sincronizar (' + e.message + '). Tus datos siguen guardados en este dispositivo.');
  } finally { syncing = false; if (again) { again = false; queueSync(300); } }
}
/* ---- fin supabase ---- */

function renderCuenta() {
  $('cuenta').innerHTML = sess
    ? `<div class="acct"><div style="flex:1 1 200px"><strong>${esc(sess.user.email)}</strong><div class="mute" id="sstat" role="status" aria-live="polite">${esc(statusTxt)}</div></div><button class="ghost" type="button" data-act="sync">Sincronizar</button><button class="ghost" type="button" data-act="out">Salir</button></div>`
    : `<h2>Cuenta</h2><form class="acct" id="lf"><label>Mail<input id="lmail" type="email" autocomplete="username" required></label><label>Contraseña<input id="lpass" type="password" autocomplete="current-password" required></label><button id="lbtn" type="submit">Entrar</button></form><p id="lerr" class="neg" role="alert" style="margin:8px 0 0"></p><p class="mute" style="margin:8px 0 0">Entrá para sincronizar tus datos entre el celu y la compu. Sin cuenta, quedan solo en este navegador.</p>`;
}
$('cuenta').onsubmit = async e => {
  e.preventDefault();
  $('lbtn').disabled = true; $('lerr').textContent = '';
  try { await login($('lmail').value.trim(), $('lpass').value); renderCuenta(); syncNow(); }
  catch (x) { $('lerr').textContent = x.status === 400 ? 'Mail o contraseña incorrectos.' : 'No pude conectar. Revisá tu internet.'; $('lbtn').disabled = false; }
};
$('cuenta').onclick = e => {
  const b = e.target.closest('button'); if (!b || !b.dataset.act) return;
  if (b.dataset.act === 'sync') syncNow();
  if (b.dataset.act === 'out') logout();
};
function logout() {
  if (S.mov.some(m => !m.sync) || (S.del || []).length) { if (!confirm('Hay cambios que todavía no se subieron. Si salís ahora podrías perderlos. ¿Salir igual?')) return; }
  const wipe = confirm('¿Borrar también los datos guardados en este dispositivo? (siguen en la nube)');
  fetch(SB_URL + '/auth/v1/logout', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + sess.access_token } }).catch(() => {});
  saveSess(null);
  if (wipe) { S = { mov: [] }; save(); editId = null; renderForm(); render(); }
  renderCuenta();
}
addEventListener('online', () => queueSync(300));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') queueSync(300); });

renderCuenta();
syncNow();
