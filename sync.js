/* sync.js: login obligatorio con Supabase y sincronización directa en la nube.
   Se carga DESPUÉS de script.js (usa sus variables: S, render, renderForm, esc, editId). */

const SB_URL = 'https://dfpajyofaogjjhdjljqs.supabase.co';
const SB_KEY = 'sb_publishable_wFk4k13ayy1HsjIMxoSJEQ_5-hHSh6j';
const AUTH_KEY = 'finanzas.auth';
let sess = null;
try { sess = JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) {}
if (!sess || !sess.access_token || !sess.user) sess = null;
const saveSess = s => { sess = s; try { s ? localStorage.setItem(AUTH_KEY, JSON.stringify(s)) : localStorage.removeItem(AUTH_KEY); } catch (e) {} };

const timeStr = () => new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

async function authReq(grant, body) {
  const r = await fetch(SB_URL + '/auth/v1/token?grant_type=' + grant, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error_description || j.msg || j.message || 'Error de acceso'), { status: r.status });
  saveSess({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: j.user ? { id: j.user.id, email: j.user.email } : sess.user
  });
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
  const r = await fetch(SB_URL + '/rest/v1/' + path, {
    method: o.method || 'GET',
    headers: Object.assign(
      { apikey: SB_KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      o.prefer ? { Prefer: o.prefer } : {}
    ),
    body: o.body ? JSON.stringify(o.body) : undefined
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(j.message || ('Error ' + r.status)), { status: r.status });
  }
  return r.status === 204 ? null : r.json().catch(() => null);
}

/* local -> tabla: type=tipo, from=origen, to=destino, note=nota */
const toRow = (m, uid) => ({
  user_id: uid,
  id: m.id,
  tipo: m.type,
  ts: String(m.ts).slice(0, 16),
  ars: m.ars ?? null,
  usd: m.usd ?? null,
  origen: m.from ?? null,
  destino: m.to ?? null,
  cat: m.cat ?? null,
  nota: m.note || null
});

const fromRow = r => {
  const m = { id: r.id, type: r.tipo, ts: r.ts, sync: true };
  if (r.ars != null) m.ars = +r.ars;
  if (r.usd != null) m.usd = +r.usd;
  if (r.origen) m.from = r.origen;
  if (r.destino) m.to = r.destino;
  if (r.cat) m.cat = r.cat;
  if (r.nota) m.note = r.nota;
  return m;
};

let syncing = false, again = false, statusTxt = 'Conectado a Supabase';
let deferredPrompt = null;

function setStatus(t) {
  statusTxt = t;
  const el = $('sstat');
  if (el) el.textContent = t;
}

function showGate(loading = false, err = '') {
  $('app').hidden = true;
  $('login-gate').hidden = false;
  $('gate-loading').hidden = !loading;
  $('lf').hidden = loading;
  $('lbtn').disabled = false;
  $('lerr').textContent = err;
}

function showApp() {
  $('login-gate').hidden = true;
  $('app').hidden = false;
  renderCuenta();
  renderForm();
  render();
}

async function saveMovement(m, newCat) {
  if (!sess) return;
  setStatus('Guardando en Supabase…');
  try {
    const uid = sess.user.id;
    await rest('movimientos?on_conflict=user_id,id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: [toRow(m, uid)]
    });
    if (newCat && Array.isArray(S.cats) && S.cats.length) {
      await rest('ajustes?on_conflict=user_id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: { user_id: uid, categorias: S.cats }
      });
    }
    m.sync = true;
    setStatus('Guardado · ' + timeStr());
  } catch (e) {
    m.sync = false;
    if (!sess) showGate(false, 'Tu sesión venció. Volvé a iniciar sesión.');
    else setStatus('No se pudo guardar (' + e.message + '). Tocá Sincronizar.');
  }
}

async function deleteMovement(id) {
  if (!sess) return;
  setStatus('Eliminando en Supabase…');
  try {
    const uid = sess.user.id;
    await rest('movimientos?user_id=eq.' + uid + '&id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
    setStatus('Guardado · ' + timeStr());
  } catch (e) {
    S.del = (S.del || []).concat(id);
    if (!sess) showGate(false, 'Tu sesión venció. Volvé a iniciar sesión.');
    else setStatus('No se pudo eliminar (' + e.message + '). Tocá Sincronizar.');
  }
}

async function replaceAllCloud(delIds) {
  if (!sess) return;
  setStatus('Subiendo respaldo a Supabase…');
  try {
    const uid = sess.user.id;
    for (const id of delIds) {
      await rest('movimientos?user_id=eq.' + uid + '&id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
    }
    for (let i = 0; i < S.mov.length; i += 200) {
      const chunk = S.mov.slice(i, i + 200);
      await rest('movimientos?on_conflict=user_id,id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: chunk.map(m => toRow(m, uid))
      });
      chunk.forEach(m => { m.sync = true; });
    }
    if (Array.isArray(S.cats) && S.cats.length) {
      await rest('ajustes?on_conflict=user_id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: { user_id: uid, categorias: S.cats }
      });
    }
    setStatus('Guardado · ' + timeStr());
  } catch (e) {
    if (!sess) showGate(false, 'Tu sesión venció. Volvé a iniciar sesión.');
    else setStatus('Error al subir (' + e.message + '). Tocá Sincronizar.');
  }
}

async function syncNow() {
  if (!sess) return false;
  if (syncing) { again = true; return true; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus('Sin conexión a internet');
    return false;
  }
  syncing = true;
  setStatus('Sincronizando…');
  try {
    const uid = sess.user.id;
    S.del = S.del || [];
    for (const id of [...S.del]) {
      await rest('movimientos?user_id=eq.' + uid + '&id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
      S.del = S.del.filter(x => x !== id);
    }
    const pend = S.mov.filter(m => !m.sync);
    for (let i = 0; i < pend.length; i += 200) {
      const chunk = pend.slice(i, i + 200);
      await rest('movimientos?on_conflict=user_id,id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: chunk.map(m => toRow(m, uid))
      });
      chunk.forEach(m => { m.sync = true; });
    }
    const cloud = [];
    for (let off = 0; ; off += 1000) {
      const rows = await rest('movimientos?select=*&order=ts.asc,id.asc&limit=1000&offset=' + off);
      cloud.push(...rows);
      if (rows.length < 1000) break;
    }
    S.mov = cloud.map(fromRow);

    const aj = await rest('ajustes?select=categorias');
    const cl = aj && aj[0] && Array.isArray(aj[0].categorias) ? aj[0].categorias : [];
    if (cl.length) S.cats = cl;
    else delete S.cats;

    if (!editId) renderForm();
    render();
    setStatus('Sincronizado · ' + timeStr());
    return true;
  } catch (e) {
    if (!sess) {
      showGate(false, 'Tu sesión venció. Volvé a iniciar sesión.');
    } else {
      setStatus('No se pudo sincronizar (' + e.message + ')');
    }
    return false;
  } finally {
    syncing = false;
    if (again) { again = false; syncNow(); }
  }
}

function renderCuenta() {
  if (!sess) return;
  const instBtn = deferredPrompt ? '<button class="ghost" type="button" data-act="inst">Instalar app</button>' : '';
  $('cuenta').innerHTML = `<div class="acct"><div style="flex:1 1 200px"><strong>${esc(sess.user.email)}</strong><div class="mute" id="sstat" role="status" aria-live="polite">${esc(statusTxt)}</div></div>${instBtn}<button type="button" data-act="sync">Sincronizar</button><button class="ghost" type="button" data-act="out">Salir</button></div>`;
}

$('lf').onsubmit = async e => {
  e.preventDefault();
  $('lbtn').disabled = true;
  $('lerr').textContent = '';
  try {
    await login($('lmail').value.trim(), $('lpass').value);
    showGate(true);
    const ok = await syncNow();
    if (ok) {
      $('lpass').value = '';
      showApp();
    } else if (sess) {
      showApp();
    }
  } catch (x) {
    $('lerr').textContent = x.status === 400 ? 'Mail o contraseña incorrectos.' : 'No pude conectar. Revisá tu internet.';
    $('lbtn').disabled = false;
  }
};

$('cuenta').onclick = async e => {
  const b = e.target.closest('button');
  if (!b || !b.dataset.act) return;
  if (b.dataset.act === 'sync') syncNow();
  if (b.dataset.act === 'out') logout();
  if (b.dataset.act === 'inst' && deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => {});
    deferredPrompt = null;
    renderCuenta();
  }
};

function logout() {
  if (S.mov.some(m => !m.sync) || (S.del || []).length) {
    if (!confirm('Hay cambios que todavía no se guardaron en Supabase. ¿Salir igual?')) return;
  }
  fetch(SB_URL + '/auth/v1/logout', {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + sess.access_token }
  }).catch(() => {});
  saveSess(null);
  S = { mov: [] };
  editId = null;
  statusTxt = 'Conectado a Supabase';
  showGate(false);
}

addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  renderCuenta();
});
addEventListener('appinstalled', () => {
  deferredPrompt = null;
  renderCuenta();
});

addEventListener('online', () => { if (sess) syncNow(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sess) syncNow(); });

(async function init() {
  if (!sess) {
    showGate(false);
    return;
  }
  showGate(true);
  const ok = await syncNow();
  if (ok) showApp();
  else if (sess) showApp();
})();
