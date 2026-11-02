/* Poliklinik Defteri — Google Drive eşitleme.
   Yalnızca "drive.appdata" izni istenir: uygulama sadece kendi gizli klasörünü görür,
   Drive'daki diğer dosyalarınıza erişemez. Drive'a giden dosya her zaman şifrelidir. */
(function (root) {
  'use strict';

  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
  const CAL = 'https://www.googleapis.com/calendar/v3';
  const FILE = 'poliklinik-defteri.pkd';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

  let tokenClient = null, clientIdUsed = null;
  let token = null, tokenExp = 0, pending = null, loadP = null, calUsed = false, granted = '';

  function loadGis() {
    if (root.google && root.google.accounts && root.google.accounts.oauth2) return Promise.resolve();
    if (loadP) return loadP;
    loadP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => res();
      s.onerror = () => { loadP = null; s.remove(); rej(new Error('Google giriş hizmeti yüklenemedi. İnternet bağlantınızı kontrol edin.')); };
      document.head.appendChild(s);
    });
    return loadP;
  }

  /* Giriş penceresi yalnızca bir dokunuşla açılabildiği için hazırlık önceden yapılır. */
  async function prepare(clientId, withCalendar) {
    if (!clientId) { tokenClient = null; return false; }
    withCalendar = !!withCalendar;
    if (tokenClient && clientIdUsed === clientId && calUsed === withCalendar) return true;
    await loadGis();
    tokenClient = root.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: withCalendar ? SCOPE + ' ' + CAL_SCOPE : SCOPE,
      include_granted_scopes: true,
      callback: (r) => {
        const p = pending; pending = null;
        if (r.error) { p && p.rej(new Error('Google izni verilmedi (' + r.error + ').')); return; }
        token = r.access_token;
        granted = String(r.scope || '');
        tokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60000;
        p && p.res(token);
      },
      error_callback: (e) => {
        const p = pending; pending = null;
        const msg = e && e.type === 'popup_closed' ? 'Google giriş penceresi kapatıldı.'
          : e && e.type === 'popup_failed_to_open' ? 'Google giriş penceresi açılamadı. Tarayıcının açılır pencere engelini kontrol edin.'
          : 'Google girişi tamamlanamadı.';
        p && p.rej(new Error(msg));
      }
    });
    if (clientIdUsed === clientId && calUsed !== withCalendar && withCalendar) { token = null; tokenExp = 0; }
    clientIdUsed = clientId;
    calUsed = withCalendar;
    return true;
  }
  function hasCalendar() { return hasToken() && granted.split(/\s+/).indexOf(CAL_SCOPE) >= 0; }

  function isReady() { return !!tokenClient; }
  function hasToken() { return !!token && Date.now() < tokenExp; }

  /* Bir dokunuş olayının içinde, bekleme yapmadan çağrılmalıdır. */
  function signIn(firstTime) {
    return new Promise((res, rej) => {
      if (!tokenClient) { rej(new Error('Önce Ayarlar\'dan Google istemci kimliğini girin.')); return; }
      if (pending) pending.rej(new Error('Yeni giriş isteği başladı.'));
      pending = { res, rej };
      tokenClient.requestAccessToken({ prompt: firstTime ? 'select_account' : '' });
    });
  }

  function signOut() {
    if (token && root.google && root.google.accounts && root.google.accounts.oauth2) {
      try { root.google.accounts.oauth2.revoke(token, () => {}); } catch (e) { /* yok say */ }
    }
    token = null; tokenExp = 0; granted = '';
  }

  async function api(url, opts) {
    if (!hasToken()) { const e = new Error('Google oturumu yok. Eşitle düğmesine dokunun.'); e.status = 401; throw e; }
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + token });
    let r;
    try { r = await fetch(url, Object.assign({}, opts, { headers })); }
    catch (e) { const err = new Error('Google Drive\'a ulaşılamadı. İnternet bağlantınızı kontrol edin.'); err.status = 0; throw err; }
    if (r.status === 401) { token = null; const e = new Error('Google oturumunun süresi doldu. Eşitle düğmesine tekrar dokunun.'); e.status = 401; throw e; }
    if (!r.ok) { const e = new Error('Google Drive isteği başarısız oldu (kod ' + r.status + ').'); e.status = r.status; throw e; }
    return r;
  }

  async function findFile() {
    const q = encodeURIComponent("name='" + FILE + "' and trashed=false");
    const r = await api(API + '?spaces=appDataFolder&q=' + q + '&fields=files(id,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=5');
    const j = await r.json();
    return (j.files && j.files[0]) || null;
  }

  async function download(id) {
    const r = await api(API + '/' + encodeURIComponent(id) + '?alt=media');
    return r.json();
  }

  async function upload(id, vault) {
    const body = JSON.stringify(vault);
    if (id) {
      await api(UPLOAD + '/' + encodeURIComponent(id) + '?uploadType=media', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body
      });
      return id;
    }
    const boundary = 'pk' + Math.random().toString(36).slice(2);
    const meta = { name: FILE, parents: ['appDataFolder'], mimeType: 'application/json' };
    const multipart =
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n' +
      '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n' +
      '--' + boundary + '--';
    const r = await api(UPLOAD + '?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multipart
    });
    return (await r.json()).id;
  }

  /* ---------- görüntü dosyaları (her biri ayrı, şifreli) ---------- */
  async function listImages() {
    const out = new Map();
    let pageToken = '';
    do {
      const q = encodeURIComponent("name contains 'img-' and trashed=false");
      const r = await api(API + '?spaces=appDataFolder&q=' + q + '&fields=nextPageToken,files(id,name)&pageSize=1000' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
      const j = await r.json();
      for (const f of j.files || []) if (/^img-.+\.pki$/.test(f.name)) out.set(f.name, f.id);
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  }
  async function uploadBytes(name, bytes) {
    const boundary = 'pk' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/octet-stream' });
    const head = new TextEncoder().encode('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + boundary + '\r\nContent-Type: application/octet-stream\r\n\r\n');
    const tail = new TextEncoder().encode('\r\n--' + boundary + '--');
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
    const r = await api(UPLOAD + '?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
    });
    return (await r.json()).id;
  }
  async function downloadBytes(id) {
    const r = await api(API + '/' + encodeURIComponent(id) + '?alt=media');
    return new Uint8Array(await r.arrayBuffer());
  }
  async function remove(id) {
    try { await api(API + '/' + encodeURIComponent(id), { method: 'DELETE' }); }
    catch (e) { if (e.status !== 404) throw e; }
  }

  /* ---------- Google Takvim (yalnızca uygulamanın oluşturduğu takvim) ---------- */
  async function calJSON(method, url, body) {
    const opts = { method, headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    try {
      const r = await api(CAL + url, opts);
      return r.status === 204 ? null : r.json();
    } catch (e) {
      if (e.status === 403) e.message = 'Google Takvim izni yok veya Google Calendar API açık değil (kurulum kılavuzu, hatırlatma bölümü).';
      throw e;
    }
  }
  async function calEnsure(calId, summary, tz) {
    if (calId) {
      try { await calJSON('GET', '/calendars/' + encodeURIComponent(calId)); return { id: calId, created: false }; }
      catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
    }
    const c = await calJSON('POST', '/calendars', { summary, description: 'Poliklinik Defteri hatırlatmaları', timeZone: tz });
    return { id: c.id, created: true };
  }
  async function calUpsert(calId, evId, ev) {
    const base = '/calendars/' + encodeURIComponent(calId) + '/events';
    try { return await calJSON('PUT', base + '/' + encodeURIComponent(evId), Object.assign({ status: 'confirmed' }, ev)); }
    catch (e) {
      if (e.status !== 404 && e.status !== 410) throw e;
      return calJSON('POST', base, Object.assign({ id: evId }, ev));
    }
  }
  async function calDelete(calId, evId) {
    try { await calJSON('DELETE', '/calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(evId)); }
    catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
  }

  root.Drive = { prepare, isReady, hasToken, hasCalendar, signIn, signOut, findFile, download, upload, listImages, uploadBytes, downloadBytes, remove, calEnsure, calUpsert, calDelete };
})(self);
