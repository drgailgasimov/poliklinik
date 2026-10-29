/* Poliklinik Defteri — arayüz ve uygulama mantığı */
(function () {
  'use strict';

  const VERSION = '1.2.0';
  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');
  const $dlg = document.getElementById('dlg');

  /* ================= durum ================= */
  const S = {
    settings: {},
    vaultExists: false,
    unlocked: false,
    keyring: null,
    prevKeyring: null,       // parola değişince Drive'daki eski dosyayı açmak için
    localSalt: null,
    db: null,
    filter: 'all',
    query: '',
    reveal: new Set(),
    form: null,
    dirty: false,
    sync: { state: 'off', msg: '' },
    syncing: false,
    syncTimer: null,
    lastActive: Date.now(),
    failCount: 0,
    lockUntil: 0,
    setupMode: 'new',
    pendingVault: null,
    pendingDriveFileId: null,
    saveChain: Promise.resolve(),
    ignoreHash: false,
    currentHash: '',
    xl: { range: 'month', from: '', to: '', ids: true },
    imgUrls: new Map(),
    adv: { kisi: '', tani: '', icd: '', sikayet: '', muayene: '', tedavi: '', tedaviTur: 'all', plan: '', not: '', from: '', to: '', kontrol: '', gorsel: false },
    advTimer: null,
    imgBusy: false
  };

  const DEFAULT_SETTINGS = { lockMinutes: 5, autoSyncOnUnlock: true, clientId: '', driveConnected: false, driveFileId: '', lastSync: 0, lastBackup: 0 };

  /* ================= IndexedDB ================= */
  const idb = (() => {
    let p;
    function db() {
      return p || (p = new Promise((res, rej) => {
        const r = indexedDB.open('poliklinik-defteri', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }));
    }
    function run(mode, fn) {
      return db().then((d) => new Promise((res, rej) => {
        const tx = d.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => res(req && req.result);
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error || new Error('Kayıt iptal edildi'));
      }));
    }
    return {
      get: (k) => run('readonly', (s) => s.get(k)),
      set: (k, v) => run('readwrite', (s) => s.put(v, k)),
      del: (k) => run('readwrite', (s) => s.delete(k)),
      keys: () => run('readonly', (s) => s.getAllKeys()),
      clear: () => run('readwrite', (s) => s.clear())
    };
  })();

  async function saveSettings() { await idb.set('settings', Object.assign({}, S.settings)); }

  /* ================= yardımcılar ================= */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : PK.b64(crypto.getRandomValues(new Uint8Array(16))).replace(/[^a-z0-9]/gi, ''));
  const trim = (s) => String(s || '').trim();

  const fDay = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
  const fDayY = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
  const fFull = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  const fShort = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
  const fTime = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });

  function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function dayLabel(ts) {
    const t0 = startOfDay(Date.now()), d0 = startOfDay(ts);
    if (d0 === t0) return 'Bugün';
    if (d0 === t0 - 86400000) return 'Dün';
    if (d0 === t0 + 86400000) return 'Yarın';
    return new Date(ts).getFullYear() === new Date().getFullYear() ? fDay.format(ts) : fDayY.format(ts);
  }
  function toLocalInput(ts) {
    const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fromLocalInput(s) { const t = new Date(s).getTime(); return isNaN(t) ? Date.now() : t; }
  function kontrolTs(k) { if (!k) return NaN; return new Date(k + 'T00:00:00').getTime(); }
  function todayISO() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

  let toastT;
  function toast(msg, isErr) {
    $toast.textContent = msg;
    $toast.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toastT);
    toastT = setTimeout(() => { $toast.className = ''; }, isErr ? 6000 : 3200);
  }

  const IC = {
    phone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
    gear: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    lock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    sliders: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    search: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>'
  };

  const VISIT_FIELDS = ['sikayet', 'muayene', 'tani', 'icd', 'tedaviUygulanan', 'tedaviPlanlanan', 'plan', 'kontrol', 'onemliNot'];
  const TABS = [
    { id: 'sikayet', label: 'Şikayet', fields: ['sikayet'] },
    { id: 'muayene', label: 'Muayene', fields: ['muayene'] },
    { id: 'tani', label: 'Tanı', fields: ['tani', 'icd'] },
    { id: 'tedavi', label: 'Tedavi', fields: ['tedaviUygulanan', 'tedaviPlanlanan'] },
    { id: 'plan', label: 'Plan', fields: ['plan', 'kontrol'] },
    { id: 'not', label: 'Önemli not', fields: ['onemliNot'] }
  ];

  /* ================= veri erişimi ================= */
  function livePatients() {
    if (!S.db) return [];
    return Object.values(S.db.patients).filter((p) => !p.deleted).map((p) => {
      const vs = Object.values(p.visits || {}).filter((v) => !v.deleted).sort((a, b) => (b.tarih || 0) - (a.tarih || 0));
      const last = vs[0] || null;
      let kontrol = '';
      for (const v of vs) if (v.kontrol && (!kontrol || v.kontrol > kontrol)) kontrol = v.kontrol;
      const note = (vs.find((v) => trim(v.onemliNot)) || {}).onemliNot || '';
      return { p, vs, last, lastTime: last ? last.tarih : p.createdAt, kontrol, note: trim(note) };
    });
  }
  function getPatient(id) { const p = S.db && S.db.patients[id]; return p && !p.deleted ? p : null; }
  function fullName(p) { return (trim(p.ad) + ' ' + trim(p.soyad)).trim() || 'İsimsiz hasta'; }

  function haystack(x) {
    const p = x.p;
    const parts = [p.ad, p.soyad, p.tc, p.tel, PK.normPhone(p.tel)];
    for (const v of x.vs) for (const f of VISIT_FIELDS) parts.push(v[f]);
    for (const im of liveImages(p)) parts.push(im.note);
    return PK.fold(parts.join(' '));
  }

  /* ================= şifreli kalıcılık ================= */
  function persist() {
    S.saveChain = S.saveChain.then(async () => {
      if (!S.keyring || !S.db) return;
      const vault = await S.keyring.sealWith(S.localSalt, PK.ITER, S.db);
      await idb.set('vault', vault);
    });
    return S.saveChain;
  }
  async function markChanged() {
    S.dirty = true;
    await persist();
    refreshSyncState();
    scheduleSync();
  }
  async function currentVault() { await S.saveChain; return S.keyring.sealWith(S.localSalt, PK.ITER, S.db); }

  /* ================= eşitleme ================= */
  function refreshSyncState() {
    if (S.syncing) return setSync('busy');
    if (!S.settings.clientId) return setSync('off', 'Eşitleme kapalı');
    if (S.sync.state === 'error') return setSync('error', S.sync.msg);
    if (S.dirty || !Drive.hasToken()) return setSync('pending');
    setSync('ok');
  }
  function setSync(state, msg) {
    S.sync = { state, msg: msg || '' };
    const b = document.querySelector('.sync');
    if (!b) return;
    b.dataset.state = state;
    const label = state === 'off' ? 'Eşitleme kapalı'
      : state === 'busy' ? 'Eşitleniyor…'
      : state === 'error' ? 'Eşitlenemedi'
      : state === 'ok' ? 'Eşitlendi ' + (S.settings.lastSync ? fTime.format(S.settings.lastSync) : '')
      : 'Eşitle';
    b.querySelector('.sync-label').textContent = label;
    b.setAttribute('aria-label', label + (msg ? ': ' + msg : ''));
    b.title = msg || label;
    const st = document.getElementById('syncStatus');
    if (st) st.textContent = syncStatusText();
  }
  function syncStatusText() {
    if (!S.settings.clientId) return 'İstemci kimliği girilmedi.';
    const last = S.settings.lastSync ? 'Son eşitleme: ' + fFull.format(S.settings.lastSync) + ' ' + fTime.format(S.settings.lastSync) + '.' : 'Henüz eşitlenmedi.';
    const tok = Drive.hasToken() ? ' Google oturumu açık.' : ' Google oturumu kapalı; eşitlemek için düğmeye dokunun.';
    return last + tok + (S.sync.state === 'error' && S.sync.msg ? ' Son hata: ' + S.sync.msg : '');
  }
  function scheduleSync() {
    clearTimeout(S.syncTimer);
    if (!S.settings.clientId || !Drive.hasToken()) return;
    S.syncTimer = setTimeout(() => { syncNow().catch(() => {}); }, 4000);
  }

  async function openRemote(remote) {
    try { return await S.keyring.openVault(remote); }
    catch (e) {
      if (S.prevKeyring) { try { return await S.prevKeyring.openVault(remote); } catch (e2) { /* geç */ } }
      throw new Error('Drive\'daki defter farklı bir parolayla şifrelenmiş. Bu cihazın parolasını diğer cihazdakiyle aynı yapın (Ayarlar → Parolayı değiştir).');
    }
  }

  async function syncNow() {
    if (S.syncing || !S.unlocked) return;
    if (!navigator.onLine) { setSync('error', 'İnternet bağlantısı yok.'); return; }
    S.syncing = true; setSync('busy');
    try {
      let fileId = S.settings.driveFileId || '';
      let remote = null;
      if (fileId) {
        try { remote = await Drive.download(fileId); }
        catch (e) { if (e.status === 404) fileId = ''; else throw e; }
      }
      if (!fileId) {
        const f = await Drive.findFile();
        if (f) { fileId = f.id; remote = await Drive.download(f.id); }
      }
      if (remote) {
        if (!PK.isVault(remote)) throw new Error('Drive\'daki dosya tanınmadı.');
        const rdb = await openRemote(remote);
        const before = JSON.stringify(S.db);
        S.db = PK.mergeDB(S.db, rdb);
        await persist();
        if (JSON.stringify(S.db) !== before) rerenderAfterData();
      }
      if (!S.unlocked) return;
      const vault = await currentVault();
      S.settings.driveFileId = await Drive.upload(fileId, vault);
      await syncImages();
      S.settings.lastSync = Date.now();
      S.settings.driveConnected = true;
      S.prevKeyring = null;
      S.dirty = false;
      await saveSettings();
      S.syncing = false;
      S.sync = { state: 'ok', msg: '' };
      refreshSyncState();
    } catch (e) {
      S.syncing = false;
      setSync('error', e.message);
      throw e;
    } finally {
      S.syncing = false;
    }
  }

  /* Dokunuşla başlatılır: Google girişi gerekiyorsa pencere açılır. */
  function syncFromTap() {
    if (!S.settings.clientId) { go('#/ayarlar'); toast('Eşitleme için önce Google istemci kimliğini girin.'); return; }
    if (!Drive.isReady()) {
      Drive.prepare(S.settings.clientId).then(() => toast('Google hazır. Eşitle\'ye tekrar dokunun.')).catch((e) => toast(e.message, true));
      return;
    }
    const run = () => syncNow().then(() => toast('Eşitlendi.')).catch((e) => toast(e.message, true));
    if (Drive.hasToken()) { run(); return; }
    Drive.signIn(!S.settings.driveConnected).then(run).catch((e) => { setSync('error', e.message); toast(e.message, true); });
  }

  /* ================= görüntüler ================= */
  const MAX_FILE = 40 * 1024 * 1024;
  const MAX_EDGE = 2048, THUMB_EDGE = 360;
  function liveImages(p) {
    return Object.values((p && p.images) || {}).filter((m) => !m.deleted).sort((a, b) => (b.takenAt || b.createdAt || 0) - (a.takenAt || a.createdAt || 0));
  }
  const imgName = (id) => 'img-' + id + '.pki';
  function isHeic(file) { return /hei[cf]/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || ''); }
  function guessMime(file) {
    if (file.type) return file.type;
    const ext = (/\.([a-z0-9]+)$/i.exec(file.name || '') || [])[1] || '';
    return ({ heic: 'image/heic', heif: 'image/heif', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' })[ext.toLowerCase()] || 'application/octet-stream';
  }
  async function decodeImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* aşağıda dene */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch (e) { return null; }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  function drawTo(src, maxEdge) {
    const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
    const k = Math.min(1, maxEdge / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
    return c;
  }
  const canvasBytes = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => b ? b.arrayBuffer().then((a) => res(new Uint8Array(a)), rej) : rej(new Error('Görüntü kodlanamadı.')), type, q));

  /* Görüntü yeniden kodlanır: boyut küçülür, konum (GPS) gibi gizli bilgiler silinir. */
  async function prepareImage(file) {
    if (file.size > MAX_FILE) throw new Error((file.name || 'Dosya') + ' 40 MB\'tan büyük.');
    const mime = guessMime(file);
    const src = await decodeImage(file);
    if (!src) {
      if (!/^image\//.test(mime) && !isHeic(file)) throw new Error((file.name || 'Dosya') + ' bir görüntü dosyası değil.');
      return { full: new Uint8Array(await file.arrayBuffer()), thumb: new Uint8Array(0), mime, w: 0, h: 0, viewable: false };
    }
    const keepPng = mime === 'image/png' && file.size < 4 * 1024 * 1024;
    const big = drawTo(src, MAX_EDGE);
    const full = await canvasBytes(big, keepPng ? 'image/png' : 'image/jpeg', 0.86);
    const thumb = await canvasBytes(drawTo(big, THUMB_EDGE), 'image/jpeg', 0.78);
    if (src.close) src.close();
    return { full, thumb, mime: keepPng ? 'image/png' : 'image/jpeg', w: big.width, h: big.height, viewable: true };
  }
  async function ensureDataKey() {
    const ids = Object.keys(S.db.keys || {}).sort();
    if (ids.length) return ids[0];
    const kid = uid();
    S.db.keys = Object.assign({}, S.db.keys, { [kid]: PK.newDataKey() });
    return kid;
  }
  async function addImages(pid, files, note) {
    const p = getPatient(pid);
    if (!p || !files.length) return 0;
    const kid = await ensureDataKey();
    let n = 0;
    const errs = [];
    for (const file of files) {
      try {
        const im = await prepareImage(file);
        const id = uid();
        const payload = new Uint8Array(im.thumb.length + im.full.length);
        payload.set(im.thumb, 0); payload.set(im.full, im.thumb.length);
        const sealed = await PK.sealBytes(S.db.keys[kid], { v: 1, mime: im.mime, thumbLen: im.thumb.length }, payload);
        await idb.set('img:' + id, sealed);
        const now = Date.now();
        const cur = getPatient(pid);
        cur.images = Object.assign({}, cur.images, { [id]: {
          id, keyId: kid, mime: im.mime, origType: guessMime(file), w: im.w, h: im.h, size: im.full.length, viewable: im.viewable,
          note: trim(note), takenAt: file.lastModified || now, createdAt: now, updatedAt: now
        } });
        n++;
      } catch (e) { errs.push(e.message); }
    }
    if (n) await markChanged();
    if (errs.length) toast(errs[0], true);
    return n;
  }
  async function readImage(meta) {
    const blob = await idb.get('img:' + meta.id);
    if (!blob) return null;
    const key = S.db.keys && S.db.keys[meta.keyId];
    if (!key) throw new Error('Görüntü anahtarı bulunamadı. Eşitle\'ye dokunun.');
    const o = await PK.openBytes(key, blob);
    const tl = o.header.thumbLen || 0;
    return { mime: o.header.mime, thumb: o.bytes.subarray(0, tl), full: o.bytes.subarray(tl) };
  }
  async function imageUrls(meta) {
    if (S.imgUrls.has(meta.id)) return S.imgUrls.get(meta.id);
    const r = await readImage(meta);
    if (!r) return null;
    const u = {
      thumb: r.thumb.length ? URL.createObjectURL(new Blob([r.thumb], { type: 'image/jpeg' })) : '',
      full: URL.createObjectURL(new Blob([r.full], { type: r.mime })),
      mime: r.mime
    };
    S.imgUrls.set(meta.id, u);
    return u;
  }
  function revokeImageUrls() {
    for (const u of S.imgUrls.values()) { if (u.thumb) URL.revokeObjectURL(u.thumb); URL.revokeObjectURL(u.full); }
    S.imgUrls.clear();
  }
  async function hydrateThumbs() {
    const tiles = document.querySelectorAll('.img-tile[data-iid]');
    for (const t of tiles) {
      const p = getPatient(t.dataset.pid);
      const m = p && p.images && p.images[t.dataset.iid];
      if (!m || m.deleted) continue;
      try {
        const u = await imageUrls(m);
        const box = t.querySelector('.img-box');
        if (!box) continue;
        if (!u) { box.innerHTML = '<span class="img-ph">Drive\'dan bekleniyor</span>'; continue; }
        if (m.viewable && u.thumb) box.innerHTML = '<img src="' + u.thumb + '" alt="">';
        else box.innerHTML = '<span class="img-ph">' + esc(fmtLabel(m)) + '<br>indirip açın</span>';
      } catch (e) {
        const box = t.querySelector('.img-box');
        if (box) box.innerHTML = '<span class="img-ph">Açılamadı</span>';
      }
    }
  }
  function fmtLabel(m) {
    if (/hei[cf]/i.test(m.origType || m.mime || '')) return 'HEIC';
    const t = (m.origType || m.mime || '').split('/')[1] || 'dosya';
    return t.replace('jpeg', 'JPEG').toUpperCase();
  }
  function imgExt(mime) { return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp' })[mime] || 'bin'; }

  function imagesSection(p) {
    const ims = liveImages(p);
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const tiles = ims.map((m) =>
      '<li><button class="img-tile" type="button" data-act="openImage" data-pid="' + esc(p.id) + '" data-iid="' + esc(m.id) + '" aria-label="Görüntüyü aç' + (m.note ? ': ' + esc(m.note) : '') + '">' +
      '<span class="img-box"><span class="img-ph">Yükleniyor…</span></span>' +
      '<span class="img-cap"><b>' + esc(m.note || 'Açıklama yok') + '</b><span>' + esc(fFull.format(m.takenAt || m.createdAt)) + '</span></span></button></li>').join('');
    return '<section class="images" aria-labelledby="imgH">' +
      '<div class="visits-h"><h3 id="imgH">Görüntüler' + (ims.length ? ' <span class="count">' + ims.length + '</span>' : '') + '</h3>' +
      '<div class="img-actions">' +
        (coarse ? '<label class="btn ghost">Fotoğraf çek<input type="file" accept="image/*" capture="environment" data-change="addImages" data-id="' + esc(p.id) + '" hidden></label>' : '') +
        '<label class="btn ghost">Görüntü ekle<input type="file" accept="image/*,.heic,.heif" multiple data-change="addImages" data-id="' + esc(p.id) + '" hidden></label>' +
      '</div></div>' +
      (tiles ? '<ul class="img-grid">' + tiles + '</ul>' : '<p class="muted small">Röntgen, MR görüntüsü, yara fotoğrafı ya da belge ekleyebilirsiniz. JPEG, PNG, HEIC, WebP, GIF ve AVIF desteklenir.</p>') +
      '</section>';
  }

  async function openImageViewer(pid, iid) {
    const p = getPatient(pid);
    const m = p && p.images && p.images[iid];
    if (!m || m.deleted) return;
    let u = null, err = '';
    try { u = await imageUrls(m); } catch (e) { err = e.message; }
    const body = err ? '<p class="notice alert">' + esc(err) + '</p>'
      : !u ? '<p class="notice">Bu görüntü henüz bu cihaza inmedi. Üstteki Eşitle düğmesine dokunun.</p>'
      : m.viewable ? '<div class="viewer-img"><img src="' + u.full + '" alt="' + esc(m.note || 'Hasta görüntüsü') + '"></div>'
      : '<p class="notice">' + esc(fmtLabel(m)) + ' biçimi bu tarayıcıda gösterilemiyor. “İndir” ile kaydedip telefonun galerisinde açın.</p>';
    $dlg.classList.add('viewer');
    $dlg.innerHTML = '<form method="dialog" data-viewer>' +
      '<div class="viewer-h"><h3>' + esc(fullName(p)) + '</h3><button class="icon-btn" type="button" data-v="close" aria-label="Kapat">✕</button></div>' + body +
      '<p class="small muted">' + esc(fFull.format(m.takenAt || m.createdAt)) + (m.w ? ', ' + m.w + '×' + m.h + ' piksel' : '') + ', ' + Math.max(1, Math.round((m.size || 0) / 1024)) + ' KB</p>' +
      '<label class="field"><span>Açıklama</span><input name="note" value="' + esc(m.note || '') + '" placeholder="Örn. Sağ diz AP grafi" autocomplete="off"></label>' +
      '<div class="acts viewer-acts"><button class="btn danger" type="button" data-v="delete">Sil</button><span class="spacer"></span>' +
      (u ? '<button class="btn ghost" type="button" data-v="download">İndir</button>' : '') +
      '<button class="btn primary" type="submit">Açıklamayı kaydet</button></div></form>';
    const form = $dlg.querySelector('form');
    const close = () => { $dlg.close(); };
    $dlg.addEventListener('close', () => { $dlg.classList.remove('viewer'); }, { once: true });
    form.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      if (b.dataset.v === 'close') close();
      if (b.dataset.v === 'download' && u) {
        const a = document.createElement('a');
        a.href = u.full; a.download = 'goruntu-' + todayISO() + '.' + imgExt(u.mime);
        document.body.appendChild(a); a.click(); a.remove();
      }
      if (b.dataset.v === 'delete') {
        if (!confirm('Bu görüntü kalıcı olarak silinsin mi? Eşitlemeden sonra diğer cihazdan da silinir.')) return;
        const cur = getPatient(pid);
        cur.images = Object.assign({}, cur.images, { [iid]: { id: iid, deleted: true, updatedAt: Date.now() } });
        const uu = S.imgUrls.get(iid); if (uu) { if (uu.thumb) URL.revokeObjectURL(uu.thumb); URL.revokeObjectURL(uu.full); S.imgUrls.delete(iid); }
        await idb.del('img:' + iid);
        await markChanged();
        close(); renderMain(); toast('Görüntü silindi.');
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cur = getPatient(pid);
      const mm = cur && cur.images[iid];
      if (!mm) return close();
      cur.images = Object.assign({}, cur.images, { [iid]: Object.assign({}, mm, { note: trim(form.note.value), updatedAt: Date.now() }) });
      await markChanged();
      close(); renderMain(); toast('Açıklama kaydedildi.');
    });
    $dlg.showModal();
  }

  /* Drive'daki görüntü dosyalarını eşitler: eksikleri yükler, indirir; silinenleri kaldırır. */
  async function syncImages() {
    const metas = [];
    for (const p of Object.values(S.db.patients)) for (const m of Object.values(p.images || {})) metas.push({ m, live: !p.deleted && !m.deleted });
    if (!metas.length) return;
    const remote = await Drive.listImages();
    const local = new Set(((await idb.keys()) || []).filter((k) => typeof k === 'string' && k.startsWith('img:')).map((k) => k.slice(4)));
    let downloaded = 0;
    for (const { m, live } of metas) {
      if (!S.unlocked) return;
      const name = imgName(m.id);
      if (!live) {
        if (remote.has(name)) await Drive.remove(remote.get(name));
        if (local.has(m.id)) await idb.del('img:' + m.id);
        continue;
      }
      if (local.has(m.id) && !remote.has(name)) await Drive.uploadBytes(name, await idb.get('img:' + m.id));
      else if (!local.has(m.id) && remote.has(name)) { await idb.set('img:' + m.id, await Drive.downloadBytes(remote.get(name))); downloaded++; }
    }
    if (downloaded && !S.form) renderMain();
  }

  /* ================= kilit ================= */
  function lock(msg) {
    if (!S.unlocked) return;
    const draft = S.form && formHasContent() ? JSON.parse(JSON.stringify(S.form)) : null;
    const kr = S.keyring, salt = S.localSalt;
    const finish = () => {
      if (kr) kr.wipe();
      if (S.prevKeyring) S.prevKeyring.wipe();
      S.keyring = null; S.prevKeyring = null; S.db = null; S.form = null; S.unlocked = false;
      S.reveal.clear(); S.query = '';
      revokeImageUrls(); PK.clearDataKeys();
      clearTimeout(S.syncTimer);
      S.ignoreHash = true; location.hash = '#/'; S.currentHash = '#/';
      setTimeout(() => { S.ignoreHash = false; }, 0);
      renderLock(msg);
    };
    if (draft && kr) {
      kr.sealWith(salt, PK.ITER, { draft }).then((v) => idb.set('draft', v)).catch(() => {}).finally(finish);
    } else finish();
  }

  setInterval(checkIdle, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkIdle();
      if (S.unlocked && S.dirty && Drive.hasToken()) syncNow().catch(() => {});
    }
  });
  ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart'].forEach((ev) =>
    document.addEventListener(ev, () => { S.lastActive = Date.now(); }, { passive: true, capture: true }));
  function checkIdle() {
    if (!S.unlocked) return;
    const lim = (Number(S.settings.lockMinutes) || 5) * 60000;
    if (Date.now() - S.lastActive > lim) lock('Hareketsizlik nedeniyle defter kilitlendi.');
  }

  async function afterUnlock(tokenPromise) {
    S.unlocked = true; S.failCount = 0; S.lastActive = Date.now();
    renderShell();
    // kaydedilmemiş form varsa geri yükle
    try {
      const d = await idb.get('draft');
      if (d) {
        await idb.del('draft');
        const raw = await openDraft(d).catch(() => null);
        if (raw) {
          S.form = raw;
          S.ignoreHash = true; location.hash = raw.hash; S.currentHash = raw.hash;
          setTimeout(() => { S.ignoreHash = false; }, 0);
          renderMain();
          toast('Kilitlenmeden önce yazdığınız form geri yüklendi.');
        }
      }
    } catch (e) { /* taslak yoksa geç */ }
    if (S.settings.clientId && navigator.onLine && !Drive.isReady()) Drive.prepare(S.settings.clientId).catch(() => {});
    if (tokenPromise) tokenPromise.then((t) => { if (t && S.unlocked) syncNow().catch((e) => toast(e.message, true)); });
    refreshSyncState();
  }
  async function openDraft(vault) {
    // taslak, defterle aynı anahtarla { draft } olarak saklanır
    const key = await S.keyring.forSalt(vault.salt, vault.iter);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: PK.unb64(vault.iv), additionalData: new TextEncoder().encode(PK.APP_ID + ':v1') }, key, PK.unb64(vault.ct));
    const o = JSON.parse(new TextDecoder().decode(pt));
    return o && o.draft ? o.draft : null;
  }

  /* ================= ekranlar: kilit ve kurulum ================= */
  function brandBlock() {
    return '<img class="lock-logo" src="icons/logo-tam.png" alt="Gail Gasimov — Orthopaedy & Traumatology logosu" width="150" height="146">' +
      '<h1>Poliklinik Defteri</h1>' +
      '<div class="divider" aria-hidden="true"><i></i></div>' +
      '<p class="who">Op. Dr. Gail Gasimov<br>Ortopedi ve Travmatoloji Uzmanı</p>';
  }

  function renderLock(msg) {
    document.title = 'Poliklinik Defteri';
    $app.innerHTML =
      '<main class="lock"><div class="lock-card">' + brandBlock() +
      '<form data-form="unlock" autocomplete="off">' +
      (msg ? '<p class="notice">' + esc(msg) + '</p>' : '') +
      '<label class="field"><span>Parola</span><input type="password" name="pw" autocomplete="current-password" required autofocus></label>' +
      '<p class="err" id="lockErr"></p>' +
      '<button class="btn primary wide" type="submit">Defteri aç</button>' +
      '</form></div>' +
      '<p class="lock-foot">Kayıtlar bu cihazda AES-256 ile şifreli saklanır.</p></main>';
    const inp = $app.querySelector('input[name=pw]');
    setTimeout(() => inp && inp.focus(), 30);
    if (S.settings.clientId && S.settings.driveConnected && S.settings.autoSyncOnUnlock && navigator.onLine) {
      Drive.prepare(S.settings.clientId).catch(() => {});
    }
  }

  function renderSetup(err) {
    const m = S.setupMode;
    const choice = (id, t, d) => '<button type="button" data-act="setupMode" data-mode="' + id + '" aria-pressed="' + (m === id) + '"><b>' + t + '</b><span>' + d + '</span></button>';
    let body = '';
    if (S.pendingVault) {
      body = '<form data-form="openPending" autocomplete="off">' +
        '<p class="notice">Defter bulundu. Açmak için defterin parolasını girin.</p>' +
        '<label class="field"><span>Parola</span><input type="password" name="pw" required autofocus></label>' +
        '<p class="err" id="setupErr">' + esc(err || '') + '</p>' +
        '<button class="btn primary wide">Defteri aç</button>' +
        '<button class="link" type="button" data-act="cancelPending">Vazgeç</button></form>';
    } else if (m === 'new') {
      body = '<form data-form="create" autocomplete="off">' +
        '<label class="field"><span>Parola (en az 8 karakter)</span><input type="password" name="pw" minlength="8" required autocomplete="new-password"></label>' +
        '<label class="field"><span>Parola tekrar</span><input type="password" name="pw2" minlength="8" required autocomplete="new-password"></label>' +
        '<p class="hint">Parola unutulursa kayıtlar hiçbir yolla açılamaz. Parolanızı güvenli bir yere yazın.</p>' +
        '<p class="err" id="setupErr">' + esc(err || '') + '</p>' +
        '<button class="btn primary wide">Defteri oluştur</button></form>';
    } else if (m === 'drive') {
      const cid = S.settings.clientId || '';
      body = '<form data-form="setupClient" autocomplete="off">' +
        '<label class="field"><span>Google istemci kimliği (Client ID)</span><input name="cid" value="' + esc(cid) + '" placeholder="…apps.googleusercontent.com" spellcheck="false" required></label>' +
        '<button class="btn ghost wide" type="submit">Kimliği kaydet</button></form>' +
        '<p class="err" id="setupErr">' + esc(err || '') + '</p>' +
        '<button class="btn primary wide" type="button" data-act="setupDriveSignIn" ' + (Drive.isReady() ? '' : 'disabled') + '>Google ile giriş yap ve defteri bul</button>' +
        '<p class="hint">Bilgisayarınızda kullandığınız istemci kimliğinin aynısını girin. Kurulum kılavuzu, 4. adım.</p>';
    } else {
      body = '<label class="btn ghost wide">Yedek dosyası seç (.pkd)<input type="file" accept=".pkd,application/json" data-change="setupFile" hidden></label>' +
        '<p class="err" id="setupErr">' + esc(err || '') + '</p>';
    }
    if (m === 'drive' && !S.pendingVault && S.settings.clientId && !Drive.isReady() && !S._preparing) {
      S._preparing = true;
      Drive.prepare(S.settings.clientId).then(() => { S._preparing = false; if (!S.unlocked && S.setupMode === 'drive') renderSetup(); })
        .catch((e) => { S._preparing = false; const er = document.getElementById('setupErr'); if (er) er.textContent = e.message; });
    }
    $app.innerHTML = '<main class="lock"><div class="lock-card">' + brandBlock() +
      (S.pendingVault ? '' : '<div class="choice">' +
        choice('new', 'Yeni defter oluştur', 'İlk kurulum; genellikle bilgisayarda') +
        choice('drive', 'Google Drive\'daki defterimi aç', 'İkinci cihaz, örneğin telefon') +
        choice('file', 'Yedek dosyasından aç', 'Şifreli .pkd yedeğinden') + '</div>') +
      body + '</div><p class="lock-foot">Kayıtlar bu cihazda AES-256 ile şifreli saklanır.</p></main>';
    const f = $app.querySelector('input[type=password]');
    if (f) setTimeout(() => f.focus(), 30);
  }

  /* ================= ana kabuk ================= */
  function renderShell() {
    $app.innerHTML =
      '<header class="top">' +
        '<a class="brand" href="#/"><img class="brand-mark" src="icons/logo-amblem.png" alt="" width="38" height="38">' +
        '<span class="brand-txt"><span class="brand-title">Poliklinik Defteri</span><span class="brand-sub">Op. Dr. Gail Gasimov, Ortopedi ve Travmatoloji</span></span></a>' +
        '<div class="top-actions">' +
          '<button class="sync" type="button" data-act="sync" data-state="off"><span class="sync-dot"></span><span class="sync-label">Eşitle</span></button>' +
          '<a class="icon-btn" href="#/ayarlar" aria-label="Ayarlar" title="Ayarlar">' + IC.gear + '</a>' +
          '<button class="icon-btn" type="button" data-act="lock" aria-label="Defteri kilitle" title="Defteri kilitle">' + IC.lock + '</button>' +
        '</div>' +
      '</header>' +
      '<div class="panes" data-view="list">' +
        '<section class="pane list-pane" aria-label="Hasta listesi">' +
          '<div class="list-head">' +
            '<div class="list-head-row">' +
              '<label class="search">' + IC.search + '<input type="search" id="q" placeholder="İsim, TC, telefon, tanı ara" aria-label="Hasta ara" autocomplete="off" spellcheck="false"></label>' +
              '<a class="btn ghost adv-btn" href="#/arama" title="Detaylı arama (Alt+F)" aria-label="Detaylı arama">' + IC.sliders + '</a>' +
              '<a class="btn primary new-desk" href="#/yeni" title="Yeni hasta (Alt+N)">' + IC.plus + 'Yeni</a>' +
            '</div>' +
            '<div class="filters" id="filters" role="group" aria-label="Filtre"></div>' +
          '</div>' +
          '<div class="list" id="list"></div>' +
        '</section>' +
        '<section class="pane main-pane" id="main"></section>' +
      '</div>' +
      '<a class="fab" href="#/yeni">' + IC.plus + 'Yeni hasta</a>';
    const q = document.getElementById('q');
    q.value = S.query;
    q.addEventListener('input', () => { S.query = q.value; renderList(); });
    S.currentHash = location.hash || '#/';
    renderMain();
    renderList();
    refreshSyncState();
  }

  function route() {
    const h = (location.hash || '#/').replace(/^#/, '');
    const parts = h.split('/').filter(Boolean);
    if (!parts.length) return { name: 'home' };
    if (parts[0] === 'yeni') return { name: 'newPatient' };
    if (parts[0] === 'ayarlar') return { name: 'settings' };
    if (parts[0] === 'arama') return { name: 'search' };
    if (parts[0] === 'h' && parts[1]) {
      if (parts[2] === 'vizit' && parts[3]) return { name: 'editVisit', id: parts[1], vid: parts[3] };
      if (parts[2] === 'vizit') return { name: 'newVisit', id: parts[1] };
      if (parts[2] === 'kimlik') return { name: 'editPatient', id: parts[1] };
      return { name: 'patient', id: parts[1] };
    }
    return { name: 'home' };
  }

  function go(hash) { if (location.hash === hash) onHash(); else location.hash = hash; }
  function goBack() { go(S.form && S.form.patientId ? '#/h/' + S.form.patientId : '#/'); }

  function onHash() {
    if (!S.unlocked) return;
    if (S.ignoreHash) return;
    const next = location.hash || '#/';
    if (S.form && S.form.dirty && next !== S.form.hash) {
      if (!confirm('Kaydedilmemiş değişiklikler silinsin mi?')) {
        S.ignoreHash = true; location.hash = S.form.hash;
        setTimeout(() => { S.ignoreHash = false; }, 0);
        return;
      }
    }
    if (!S.form || next !== S.form.hash) S.form = null;
    S.currentHash = next;
    renderMain();
    renderList();
    const m = document.getElementById('main');
    if (m) m.scrollTop = 0;
  }
  window.addEventListener('hashchange', onHash);

  /* ---------- liste ---------- */
  function renderList() {
    const $f = document.getElementById('filters'), $l = document.getElementById('list');
    if (!$f || !$l) return;
    const all = livePatients();
    const t0 = startOfDay(Date.now());
    const in14 = t0 + 15 * 86400000;
    const isToday = (x) => x.lastTime >= t0;
    const isKontrol = (x) => { const k = kontrolTs(x.kontrol); return k >= t0 && k < in14; };
    const isNote = (x) => !!x.note;
    const counts = { all: all.length, today: all.filter(isToday).length, kontrol: all.filter(isKontrol).length, note: all.filter(isNote).length };
    const fl = [['all', 'Tümü'], ['today', 'Bugün'], ['kontrol', 'Kontrol'], ['note', 'Notlu']];
    $f.innerHTML = fl.map(([id, t]) => '<button type="button" data-act="filter" data-f="' + id + '" aria-pressed="' + (S.filter === id) + '">' + t + '<em>' + counts[id] + '</em></button>').join('');

    let items = all;
    if (S.filter === 'today') items = items.filter(isToday);
    if (S.filter === 'kontrol') items = items.filter(isKontrol);
    if (S.filter === 'note') items = items.filter(isNote);
    const toks = PK.fold(S.query).split(/\s+/).filter(Boolean);
    if (toks.length) items = items.filter((x) => { const hs = haystack(x); return toks.every((t) => hs.includes(t)); });

    const r = route();
    const curId = r.id || '';
    if (!items.length) {
      $l.innerHTML = all.length
        ? '<div class="empty"><p>Bu aramayla eşleşen hasta yok.</p></div>'
        : '<div class="empty"><h3>Defter boş</h3><p>İlk hastayı eklemek için “Yeni hasta”ya dokunun.</p></div>';
      return;
    }
    const row = (x, metaTop) => {
      const sub = trim(x.last && (x.last.tani || x.last.sikayet)) || 'Vizit bilgisi yok';
      const k = kontrolTs(x.kontrol);
      const chip = x.kontrol && k >= t0 ? '<span class="chip">Kontrol ' + fShort.format(k) + '</span>' : '';
      return '<a class="row" href="#/h/' + esc(x.p.id) + '"' + (curId === x.p.id ? ' aria-current="page"' : '') + '>' +
        '<span class="row-main"><span class="row-name">' + esc(fullName(x.p)) + '</span><span class="row-sub">' + esc(sub) + '</span></span>' +
        '<span class="row-meta"><span>' + esc(metaTop) + '</span>' + (x.note ? '<span class="flag" title="Önemli not var" aria-label="Önemli not var"></span>' : '') + chip + '</span></a>';
    };
    let html = '';
    if (S.filter === 'kontrol') {
      items.sort((a, b) => kontrolTs(a.kontrol) - kontrolTs(b.kontrol));
      let g = '';
      for (const x of items) {
        const k = kontrolTs(x.kontrol), lbl = dayLabel(k);
        if (lbl !== g) { g = lbl; html += '<h3 class="group-h">' + esc(lbl) + '</h3>'; }
        html += row(x, x.last ? fShort.format(x.last.tarih) : '');
      }
    } else {
      items.sort((a, b) => b.lastTime - a.lastTime);
      let g = '';
      const max = toks.length ? 400 : 600;
      for (const x of items.slice(0, max)) {
        const lbl = dayLabel(x.lastTime);
        if (lbl !== g) { g = lbl; html += '<h3 class="group-h">' + esc(lbl) + '</h3>'; }
        html += row(x, fTime.format(x.lastTime));
      }
      if (items.length > max) html += '<p class="empty small">Daha eski ' + (items.length - max) + ' kayıt için aramayı kullanın.</p>';
    }
    $l.innerHTML = html;
  }

  /* ---------- sağ bölme ---------- */
  function renderMain() {
    const $m = document.getElementById('main');
    const $p = document.querySelector('.panes');
    if (!$m || !$p) return;
    const r = route();
    let view = 'detail', html = '';
    switch (r.name) {
      case 'home':
        view = 'list';
        html = '<div class="empty"><h3>Hasta seçin</h3><p>Soldaki listeden bir hasta seçin ya da yeni hasta ekleyin.</p><p class="kbd">Kısayollar: Alt+N yeni hasta, / hızlı arama, Alt+F detaylı arama, Ctrl+Enter kaydet</p></div>';
        document.title = 'Poliklinik Defteri';
        break;
      case 'patient': {
        const p = getPatient(r.id);
        if (!p) { html = notFound(); break; }
        html = patientView(p);
        document.title = 'Hasta kartı · Poliklinik Defteri';
        break;
      }
      case 'newPatient': view = 'form'; html = formView(ensureForm('newPatient', null, null)); break;
      case 'newVisit': {
        if (!getPatient(r.id)) { html = notFound(); break; }
        view = 'form'; html = formView(ensureForm('newVisit', r.id, null)); break;
      }
      case 'editVisit': {
        const p = getPatient(r.id);
        if (!p || !p.visits[r.vid] || p.visits[r.vid].deleted) { html = notFound(); break; }
        view = 'form'; html = formView(ensureForm('editVisit', r.id, r.vid)); break;
      }
      case 'editPatient': {
        if (!getPatient(r.id)) { html = notFound(); break; }
        view = 'form'; html = formView(ensureForm('editPatient', r.id, null)); break;
      }
      case 'settings': view = 'settings'; html = settingsView(); document.title = 'Ayarlar · Poliklinik Defteri'; break;
      case 'search': view = 'search'; html = advView(); document.title = 'Detaylı arama · Poliklinik Defteri'; break;
    }
    $p.dataset.view = view;
    $m.innerHTML = '<div class="main-inner">' + html + '</div>';
    if (view === 'form') afterFormRender();
    if (r.name === 'patient') hydrateThumbs();
    if (r.name === 'search') advRender();
  }
  function notFound() {
    return '<div class="empty"><h3>Kayıt bulunamadı</h3><p>Bu kayıt silinmiş olabilir.</p><p><a class="btn ghost" href="#/">Listeye dön</a></p></div>';
  }
  function rerenderAfterData() {
    renderList();
    if (!S.form) renderMain();
  }

  function patientView(p) {
    const x = livePatients().find((y) => y.p.id === p.id);
    const tel = trim(p.tel);
    const shown = S.reveal.has(p.id);
    const tcHtml = p.tc
      ? '<span>TC <b>' + esc(shown ? p.tc : PK.maskTC(p.tc)) + '</b> <button class="link" type="button" data-act="revealTC" data-id="' + esc(p.id) + '">' + (shown ? 'Gizle' : 'Göster') + '</button></span>'
      : '<span>TC girilmemiş</span>';
    const call = tel
      ? '<a class="call" href="tel:' + esc(PK.normPhone(tel)) + '" aria-label="' + esc(fullName(p)) + ' hastasını ara"><span class="call-ic">' + IC.phone + '</span><span class="call-num">' + esc(PK.fmtPhone(tel)) + '</span></a>'
      : '<span class="no-tel">Telefon girilmemiş</span>';
    const visits = x.vs.map((v) => visitCard(p, v)).join('');
    return '<button class="btn ghost back" type="button" data-act="back">' + IC.back + 'Liste</button>' +
      '<div class="print-head"><img src="icons/logo-tam.png" alt="" width="90" height="88"><p><b>Op. Dr. Gail Gasimov</b><br>Ortopedi ve Travmatoloji Uzmanı<br>Liv Hospital Vadistanbul<br>+90 535 393 43 22, info@drgailgasimov.com, drgailgasimov.com</p></div>' +
      '<article class="patient">' +
      '<header class="p-head">' +
        '<h2 class="p-name">' + esc(fullName(p)) + '</h2>' +
        '<div class="p-ids">' + tcHtml + '<span>Kayıt ' + esc(fFull.format(p.createdAt || Date.now())) + '</span><span>' + x.vs.length + ' vizit</span></div>' +
        '<div class="p-actions">' + call +
          '<a class="btn primary" href="#/h/' + esc(p.id) + '/vizit">' + IC.plus + 'Yeni vizit</a>' +
          '<a class="btn ghost" href="#/h/' + esc(p.id) + '/kimlik">Kimliği düzenle</a>' +
        '</div>' +
      '</header>' +
      (x.note ? '<aside class="alert-box"><h4>Önemli not</h4><p>' + esc(x.note) + '</p></aside>' : '') +
      imagesSection(p) +
      '<div class="visits-h"><h3>Vizitler</h3></div>' +
      (visits ? '<ol class="visits">' + visits + '</ol>' : '<div class="empty"><p>Bu hastaya ait vizit yok.</p></div>') +
      '</article>';
  }

  function visitCard(p, v) {
    const row = (label, val, cls) => trim(val) ? '<dt>' + label + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + val + '</dd>' : '';
    const tani = trim(v.tani) || trim(v.icd) ? esc(v.tani) + (trim(v.icd) ? '<span class="icd">' + esc(v.icd) + '</span>' : '') : '';
    const k = kontrolTs(v.kontrol);
    const plan = [trim(v.plan) ? esc(v.plan) : '', v.kontrol ? '<span class="chip' + (k < startOfDay(Date.now()) ? ' late' : '') + '">Kontrol: ' + esc(fFull.format(k)) + '</span>' : ''].filter(Boolean).join('<br>');
    const body =
      row('Şikayet', esc(v.sikayet)) +
      row('Muayene bulgusu', esc(v.muayene)) +
      row('Tanı', tani) +
      row('Uygulanan tedavi', esc(v.tedaviUygulanan)) +
      row('Uygulanacak tedavi', esc(v.tedaviPlanlanan)) +
      row('Plan', plan) +
      row('Önemli not', esc(v.onemliNot), 'note');
    return '<li class="visit"><div class="visit-h"><h4><time datetime="' + esc(new Date(v.tarih).toISOString()) + '">' + esc(fFull.format(v.tarih)) + '<span>' + esc(fTime.format(v.tarih)) + '</span></time></h4>' +
      '<a class="link" href="#/h/' + esc(p.id) + '/vizit/' + esc(v.id) + '">Düzenle</a></div>' +
      (body ? '<dl>' + body + '</dl>' : '<p class="muted">Bu vizitte not girilmemiş.</p>') + '</li>';
  }

  /* ---------- form ---------- */
  function ensureForm(mode, pid, vid) {
    const hash = location.hash || '#/';
    if (S.form && S.form.hash === hash && S.form.mode === mode) return S.form;
    const f = { mode, hash, patientId: pid, visitId: vid, tab: 'sikayet', dirty: false, data: {} };
    if (mode === 'newPatient' || mode === 'newVisit') {
      f.data = { tarih: toLocalInput(Date.now()) };
    }
    if (mode === 'editVisit') {
      const v = getPatient(pid).visits[vid];
      f.data = Object.assign({}, v, { tarih: toLocalInput(v.tarih) });
    }
    if (mode === 'editPatient') {
      const p = getPatient(pid);
      f.data = { ad: p.ad || '', soyad: p.soyad || '', tc: p.tc || '', tel: p.tel || '' };
    }
    S.form = f;
    return f;
  }
  function formHasContent() {
    if (!S.form) return false;
    const d = S.form.data;
    return ['ad', 'soyad', 'tc', 'tel'].concat(VISIT_FIELDS).some((k) => trim(d[k]));
  }

  const inp = (name, label, attrs) => '<label class="field"><span>' + label + '</span><input name="' + name + '" data-f="' + name + '" value="' + esc(S.form.data[name] || '') + '" ' + (attrs || '') + '></label>';
  const ta = (name, label, ph) => '<label class="field"><span>' + label + '</span><textarea name="' + name + '" data-f="' + name + '" placeholder="' + esc(ph || '') + '">' + esc(S.form.data[name] || '') + '</textarea></label>';

  function identityCard(withDelete) {
    return '<div class="card"><p class="card-h">Hasta kimliği</p><div class="grid2">' +
      inp('ad', 'Ad', 'required autocomplete="off" spellcheck="false" autocapitalize="words"') +
      inp('soyad', 'Soyad', 'autocomplete="off" spellcheck="false" autocapitalize="words"') +
      '<div class="field"><label class="field"><span>TC kimlik no</span><input name="tc" data-f="tc" value="' + esc(S.form.data.tc || '') + '" inputmode="numeric" maxlength="20" autocomplete="off" spellcheck="false"></label><span class="hint" id="tcHint">Yabancı hastada pasaport numarası da yazılabilir.</span></div>' +
      inp('tel', 'Telefon', 'type="tel" inputmode="tel" autocomplete="off" placeholder="0532 123 45 67"') +
      '</div><div id="dupBox" class="dup"></div>' +
      (withDelete ? '<p style="margin:14px 0 0"><button class="btn danger" type="button" data-act="deletePatient">Hastayı ve tüm vizitlerini sil</button></p>' : '') +
      '</div>';
  }

  function visitCardForm() {
    const f = S.form;
    const tabs = TABS.map((t) => '<button type="button" role="tab" class="tab' + (t.id === 'not' ? ' note-tab' : '') + '" id="tab-' + t.id + '" data-act="tab" data-tab="' + t.id + '" aria-selected="' + (f.tab === t.id) + '" aria-controls="panel-' + t.id + '"><span class="dot" aria-hidden="true"></span>' + t.label + '</button>').join('');
    const panel = (id, inner) => '<div class="panel" role="tabpanel" id="panel-' + id + '" aria-labelledby="tab-' + id + '"' + (f.tab === id ? '' : ' hidden') + '>' + inner + '</div>';
    return '<div class="card">' +
      '<div class="grid2" style="margin-bottom:16px"><label class="field"><span>Vizit tarihi ve saati</span><input type="datetime-local" name="tarih" data-f="tarih" value="' + esc(f.data.tarih || '') + '"></label></div>' +
      '<div class="tabs" role="tablist" aria-label="Vizit bölümleri">' + tabs + '</div>' +
      panel('sikayet', ta('sikayet', 'Başvuru şikayeti', 'Örn. 3 aydır sağ diz ağrısı, merdivende artıyor')) +
      panel('muayene', ta('muayene', 'Muayenedeki en önemli bulgu', 'Örn. McMurray (+) medial, efüzyon yok')) +
      panel('tani', ta('tani', 'Tanı', 'Örn. Sağ diz medial menisküs yırtığı') + '<div class="grid2">' + inp('icd', 'ICD-10 kodu (isteğe bağlı)', 'autocomplete="off" spellcheck="false" placeholder="M23.2"') + '</div>') +
      panel('tedavi', ta('tedaviUygulanan', 'Uygulanan tedavi', 'Bugün yapılanlar: ilaç, enjeksiyon, atel…') + ta('tedaviPlanlanan', 'Uygulanacak tedavi', 'Planlanan tedavi, cerrahi…')) +
      panel('plan', ta('plan', 'Plan', 'Tetkikler, sevk, kontrol planı') + '<div class="grid2">' + '<label class="field"><span>Kontrol tarihi</span><input type="date" name="kontrol" data-f="kontrol" value="' + esc(f.data.kontrol || '') + '" min="2000-01-01"></label>' + '</div>') +
      panel('not', ta('onemliNot', 'Önemli not', 'Alerji, antikoagülan kullanımı, dikkat edilecek durum…') + '<p class="hint">Önemli not, hasta kartının en üstünde kırmızı kutuda gösterilir.</p>') +
      (f.mode === 'editVisit' ? '<p style="margin:16px 0 0"><button class="btn danger" type="button" data-act="deleteVisit">Bu viziti sil</button></p>' : '') +
      '</div>';
  }

  function formView(f) {
    let title = '', sub = '', body = '';
    if (f.mode === 'newPatient') {
      if (f.patientId) { f.mode = 'newVisit'; return formView(f); }
      title = 'Yeni hasta'; sub = 'Kimlik ve bugünkü vizit bilgilerini girin.';
      body = identityCard(false) + visitCardForm();
    } else if (f.mode === 'newVisit') {
      const p = getPatient(f.patientId);
      title = 'Yeni vizit'; sub = fullName(p);
      body = visitCardForm();
    } else if (f.mode === 'editVisit') {
      title = 'Viziti düzenle'; sub = fullName(getPatient(f.patientId));
      body = visitCardForm();
    } else if (f.mode === 'editPatient') {
      title = 'Kimliği düzenle'; sub = fullName(getPatient(f.patientId));
      body = identityCard(true);
    }
    document.title = title + ' · Poliklinik Defteri';
    const hasTabs = f.mode !== 'editPatient';
    return '<button class="btn ghost back" type="button" data-act="cancelForm">' + IC.back + 'Geri</button>' +
      '<form data-form="record" autocomplete="off" novalidate>' +
      '<h2 class="form-title">' + esc(title) + '</h2><p class="form-sub">' + esc(sub) + '</p>' + body +
      '<p class="err" id="formErr"></p>' +
      '<div class="form-bar">' +
        (hasTabs ? '<button class="btn ghost" type="button" data-act="tabStep" data-d="-1" aria-label="Önceki sekme">‹</button><button class="btn ghost" type="button" data-act="tabStep" data-d="1" aria-label="Sonraki sekme"><span class="hide-m">Sonraki sekme&nbsp;</span>›</button>' : '') +
        '<span class="spacer"></span><span class="kbd">Ctrl+Enter</span>' +
        '<button class="btn ghost hide-m" type="button" data-act="cancelForm">Vazgeç</button>' +
        '<button class="btn primary" type="submit">Kaydet</button>' +
      '</div></form>';
  }

  function afterFormRender() {
    updateTabDots();
    checkTC();
    const first = document.querySelector('#main input[name=ad]') || document.querySelector('#main .panel:not([hidden]) textarea');
    if (first && !trim(first.value) && window.matchMedia('(min-width: 900px)').matches) first.focus();
  }
  function updateTabDots() {
    if (!S.form) return;
    for (const t of TABS) {
      const el = document.getElementById('tab-' + t.id);
      if (el) el.classList.toggle('filled', t.fields.some((k) => trim(S.form.data[k])));
    }
  }
  function setTab(id) {
    if (!S.form) return;
    S.form.tab = id;
    for (const t of TABS) {
      const b = document.getElementById('tab-' + t.id), p = document.getElementById('panel-' + t.id);
      if (b) b.setAttribute('aria-selected', String(t.id === id));
      if (p) p.hidden = t.id !== id;
    }
    const ta1 = document.querySelector('#panel-' + id + ' textarea');
    if (ta1) ta1.focus({ preventScroll: true });
    const tb = document.getElementById('tab-' + id);
    if (tb) tb.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function checkTC() {
    const hint = document.getElementById('tcHint'), box = document.getElementById('dupBox');
    if (!hint || !S.form) return;
    const tc = trim(S.form.data.tc);
    if (/^\d{11}$/.test(tc) && !PK.tcValid(tc)) { hint.textContent = 'Bu TC kimlik numarası doğrulanamadı; rakamları kontrol edin.'; hint.className = 'hint warn'; }
    else { hint.textContent = 'Yabancı hastada pasaport numarası da yazılabilir.'; hint.className = 'hint'; }
    if (!box) return;
    box.innerHTML = '';
    if (S.form.mode !== 'newPatient' || tc.length < 6) return;
    const dup = livePatients().find((x) => trim(x.p.tc) === tc);
    if (dup) {
      box.innerHTML = '<p class="notice">Bu numarayla kayıtlı hasta var: <b>' + esc(fullName(dup.p)) + '</b>. ' +
        '<button class="link" type="button" data-act="useExisting" data-id="' + esc(dup.p.id) + '">Bu hastaya vizit olarak ekle</button></p>';
    }
  }

  async function saveForm() {
    const f = S.form;
    if (!f) return;
    const d = f.data;
    const err = document.getElementById('formErr');
    const now = Date.now();
    if ((f.mode === 'newPatient' || f.mode === 'editPatient') && !trim(d.ad) && !trim(d.soyad)) {
      err.textContent = 'Hastanın en az adını girin.';
      const a = document.querySelector('#main input[name=ad]'); if (a) a.focus();
      return;
    }
    let pid = f.patientId;
    const visitFrom = (base) => {
      const v = Object.assign({}, base || {});
      for (const k of VISIT_FIELDS) v[k] = trim(d[k]);
      v.tarih = fromLocalInput(d.tarih);
      v.updatedAt = now;
      if (!v.createdAt) v.createdAt = now;
      return v;
    };
    if (f.mode === 'newPatient') {
      pid = uid();
      const vid = uid();
      const v = visitFrom({ id: vid });
      S.db.patients[pid] = { id: pid, ad: trim(d.ad), soyad: trim(d.soyad), tc: trim(d.tc).replace(/\s/g, ''), tel: trim(d.tel), createdAt: now, updatedAt: now, visits: { [vid]: v } };
    } else if (f.mode === 'newVisit') {
      const p = getPatient(pid); const vid = uid();
      p.visits = Object.assign({}, p.visits, { [vid]: visitFrom({ id: vid }) });
    } else if (f.mode === 'editVisit') {
      const p = getPatient(pid);
      p.visits = Object.assign({}, p.visits, { [f.visitId]: visitFrom(p.visits[f.visitId]) });
    } else if (f.mode === 'editPatient') {
      const p = getPatient(pid);
      Object.assign(p, { ad: trim(d.ad), soyad: trim(d.soyad), tc: trim(d.tc).replace(/\s/g, ''), tel: trim(d.tel), updatedAt: now });
    }
    try {
      await markChanged();
    } catch (e) {
      err.textContent = 'Kayıt yazılamadı: ' + e.message;
      return;
    }
    S.form = null;
    toast(f.mode === 'editPatient' || f.mode === 'editVisit' ? 'Değişiklikler kaydedildi.' : 'Kaydedildi.');
    go('#/h/' + pid);
  }

  /* ---------- Excel'e aktarma ---------- */
  const XL_RANGES = [['month', 'Bu ay'], ['lastMonth', 'Geçen ay'], ['year', 'Bu yıl'], ['all', 'Tüm kayıtlar'], ['custom', 'Tarih aralığı seç']];
  function xlBounds() {
    const n = new Date(), y = n.getFullYear(), m = n.getMonth();
    switch (S.xl.range) {
      case 'month': return [new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime()];
      case 'lastMonth': return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()];
      case 'year': return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()];
      case 'custom': {
        const a = S.xl.from ? new Date(S.xl.from + 'T00:00:00').getTime() : -Infinity;
        const b = S.xl.to ? new Date(S.xl.to + 'T00:00:00').getTime() + 86400000 : Infinity;
        return [a, b];
      }
      default: return [-Infinity, Infinity];
    }
  }
  function xlSelection() {
    const [a, b] = xlBounds();
    const out = [];
    for (const x of livePatients()) {
      const vs = x.vs.filter((v) => v.tarih >= a && v.tarih < b);
      if (vs.length) out.push({ x, vs: vs.slice().sort((p, q) => p.tarih - q.tarih) });
    }
    return out;
  }
  function xlRangeLabel() {
    const fmt = (t) => new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(t);
    if (S.xl.range === 'all') return 'Tüm kayıtlar';
    if (S.xl.range === 'custom') {
      if (!S.xl.from && !S.xl.to) return 'Tüm kayıtlar';
      return (S.xl.from ? fmt(new Date(S.xl.from + 'T00:00:00')) : 'Başlangıç') + ' – ' + (S.xl.to ? fmt(new Date(S.xl.to + 'T00:00:00')) : 'bugün');
    }
    const [a, b] = xlBounds();
    return fmt(a) + ' – ' + fmt(b - 86400000);
  }
  function xlSummaryText() {
    const sel = xlSelection();
    const nv = sel.reduce((s, p) => s + p.vs.length, 0);
    return nv ? xlRangeLabel() + ': ' + sel.length + ' hasta, ' + nv + ' vizit.' : xlRangeLabel() + ': bu aralıkta vizit yok.';
  }
  function excelSection() {
    const o = XL_RANGES.map(([v, t]) => '<option value="' + v + '"' + (S.xl.range === v ? ' selected' : '') + '>' + t + '</option>').join('');
    return '<section class="set"><h3>Excel\'e aktar</h3>' +
      '<p class="muted">Kayıtları liste hâlinde Excel dosyası olarak indirir. Dosyada iki sayfa olur: her vizitin bir satır olduğu “Vizitler” ve her hastanın bir satır olduğu “Hastalar”.</p>' +
      '<div class="grid2"><label class="field"><span>Aralık</span><select data-change="xlRange">' + o + '</select></label><span></span>' +
      '<label class="field"' + (S.xl.range === 'custom' ? '' : ' hidden') + ' id="xlFromF"><span>Başlangıç</span><input type="date" data-change="xlFrom" value="' + esc(S.xl.from) + '"></label>' +
      '<label class="field"' + (S.xl.range === 'custom' ? '' : ' hidden') + ' id="xlToF"><span>Bitiş</span><input type="date" data-change="xlTo" value="' + esc(S.xl.to) + '"></label></div>' +
      '<label class="check"><input type="checkbox" data-change="xlIds"' + (S.xl.ids ? ' checked' : '') + '>TC kimlik no ve telefonu dahil et</label>' +
      '<p class="small" id="xlSummary">' + esc(xlSummaryText()) + '</p>' +
      '<p class="notice alert small">Excel dosyası şifresizdir. Hastane dışına göndermeyin, e-postayla paylaşmayın; işiniz bitince silin.</p>' +
      '<div class="row-btns"><button class="btn primary" type="button" data-act="exportExcel">Excel dosyasını indir</button></div>' +
      '</section>';
  }
  function refreshXl() {
    const f = document.getElementById('xlFromF'), t = document.getElementById('xlToF'), s = document.getElementById('xlSummary');
    if (f) f.hidden = S.xl.range !== 'custom';
    if (t) t.hidden = S.xl.range !== 'custom';
    if (s) s.textContent = xlSummaryText();
  }
  async function loadLogo() {
    try {
      const r = await fetch('icons/logo-amblem.png');
      if (!r.ok) return null;
      const png = new Uint8Array(await r.arrayBuffer());
      const dv = new DataView(png.buffer);
      const w = dv.getUint32(16), h = dv.getUint32(20);
      const H = 62;
      return { png, w: Math.round(H * w / h), h: H };
    } catch (e) { return null; }
  }
  async function exportExcel(selOverride, rangeOverride) {
    const sel = selOverride || xlSelection();
    const nv = sel.reduce((s, p) => s + p.vs.length, 0);
    if (!nv) { toast('Seçilen aralıkta vizit yok.', true); return; }
    const ids = S.xl.ids;
    const now = Date.now();
    const stamp = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(now);
    const letterhead = ['Op. Dr. Gail Gasimov', 'Ortopedi ve Travmatoloji Uzmanı, Liv Hospital Vadistanbul', '+90 535 393 43 22   info@drgailgasimov.com   drgailgasimov.com'];

    const vCols = [{ header: 'Vizit tarihi', width: 17, type: 'datetime' }, { header: 'Ad', width: 14 }, { header: 'Soyad', width: 16 }]
      .concat(ids ? [{ header: 'TC kimlik no', width: 14 }, { header: 'Telefon', width: 16 }] : [])
      .concat([
        { header: 'Şikayet', width: 34, type: 'wrap' }, { header: 'Muayene bulgusu', width: 34, type: 'wrap' },
        { header: 'Tanı', width: 30, type: 'wrap' }, { header: 'ICD-10', width: 9 },
        { header: 'Uygulanan tedavi', width: 30, type: 'wrap' }, { header: 'Uygulanacak tedavi', width: 30, type: 'wrap' },
        { header: 'Plan', width: 30, type: 'wrap' }, { header: 'Kontrol tarihi', width: 13, type: 'date' },
        { header: 'Önemli not', width: 30, type: 'alert' }
      ]);
    const vRows = [];
    for (const { x, vs } of sel) for (const v of vs) {
      vRows.push([v.tarih, x.p.ad || '', x.p.soyad || ''].concat(ids ? [x.p.tc || '', PK.fmtPhone(x.p.tel)] : [])
        .concat([v.sikayet, v.muayene, v.tani, v.icd, v.tedaviUygulanan, v.tedaviPlanlanan, v.plan, v.kontrol || '', v.onemliNot]));
    }
    vRows.sort((a, b) => a[0] - b[0]);

    const pCols = [{ header: 'Ad', width: 14 }, { header: 'Soyad', width: 16 }]
      .concat(ids ? [{ header: 'TC kimlik no', width: 14 }, { header: 'Telefon', width: 16 }] : [])
      .concat([
        { header: 'İlk vizit', width: 17, type: 'datetime' }, { header: 'Son vizit', width: 17, type: 'datetime' },
        { header: 'Vizit sayısı', width: 10, type: 'number' }, { header: 'Son tanı', width: 34, type: 'wrap' },
        { header: 'Son kontrol tarihi', width: 15, type: 'date' }, { header: 'Görüntü sayısı', width: 10, type: 'number' },
        { header: 'Önemli not', width: 34, type: 'alert' }
      ]);
    const coll = new Intl.Collator('tr-TR');
    const pRows = sel.slice().sort((a, b) => coll.compare(a.x.p.soyad || '', b.x.p.soyad || '') || coll.compare(a.x.p.ad || '', b.x.p.ad || ''))
      .map(({ x, vs }) => {
        const lastTani = (vs.slice().reverse().find((v) => trim(v.tani)) || {}).tani || '';
        let k = ''; for (const v of vs) if (v.kontrol && v.kontrol > k) k = v.kontrol;
        return [x.p.ad || '', x.p.soyad || ''].concat(ids ? [x.p.tc || '', PK.fmtPhone(x.p.tel)] : [])
          .concat([vs[0].tarih, vs[vs.length - 1].tarih, vs.length, lastTani, k, liveImages(x.p).length, x.note]);
      });

    const range = rangeOverride || xlRangeLabel();
    const bytes = XLSXW.build([
      { name: 'Vizitler', letterhead, caption: 'Poliklinik Defteri, vizit listesi. Aralık: ' + range + '. ' + vRows.length + ' vizit. Oluşturulma: ' + stamp + '.', columns: vCols, rows: vRows },
      { name: 'Hastalar', letterhead, caption: 'Poliklinik Defteri, hasta listesi. Aralık: ' + range + '. ' + pRows.length + ' hasta. Oluşturulma: ' + stamp + '.', columns: pCols, rows: pRows }
    ], { logo: await loadLogo(), title: 'Poliklinik Defteri', author: 'Op. Dr. Gail Gasimov' });

    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'poliklinik-defteri-' + todayISO() + '.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Excel dosyası indirildi: ' + pRows.length + ' hasta, ' + vRows.length + ' vizit.');
  }

  /* ---------- detaylı arama ---------- */
  const ADV_VISIT = ['tani', 'icd', 'sikayet', 'muayene', 'tedavi', 'plan', 'not', 'from', 'to'];
  /* "a b, c" → (a VE b) VEYA c */
  function qGroups(q) {
    return String(q || '').split(',').map((g) => PK.fold(g).split(/\s+/).filter(Boolean)).filter((g) => g.length);
  }
  function qMatch(text, groups) {
    if (!groups.length) return true;
    const t = PK.fold(text);
    return groups.some((g) => g.every((w) => t.includes(w)));
  }
  function advActive() {
    const a = S.adv;
    return ['kisi', 'tani', 'icd', 'sikayet', 'muayene', 'tedavi', 'plan', 'not', 'from', 'to', 'kontrol'].some((k) => trim(a[k])) || a.gorsel;
  }
  function advRun() {
    const a = S.adv;
    const G = {};
    for (const k of ['kisi', 'tani', 'sikayet', 'muayene', 'tedavi', 'plan', 'not']) G[k] = qGroups(a[k]);
    const icds = String(a.icd || '').split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    const from = a.from ? new Date(a.from + 'T00:00:00').getTime() : -Infinity;
    const to = a.to ? new Date(a.to + 'T00:00:00').getTime() + 86400000 : Infinity;
    const visitCrit = ADV_VISIT.some((k) => trim(a[k]));
    const t0 = startOfDay(Date.now());
    const out = [];
    for (const x of livePatients()) {
      const p = x.p;
      if (G.kisi.length && !qMatch([p.ad, p.soyad, p.tc, p.tel, PK.normPhone(p.tel)].join(' '), G.kisi)) continue;
      if (a.gorsel && !liveImages(p).length) continue;
      if (a.kontrol) {
        const k = kontrolTs(x.kontrol);
        if (!x.kontrol) continue;
        // Kontrolü veren vizitten sonra yeni bir vizit varsa hasta gelmiş sayılır.
        const src = x.vs.find((v) => v.kontrol === x.kontrol) || x.vs[0];
        const came = x.vs.some((v) => v.tarih > src.tarih);
        if (a.kontrol === 'yaklasan' && !(k >= t0 && k < t0 + 31 * 86400000)) continue;
        if (a.kontrol === 'gecmis' && !(k < t0 && !came)) continue;
      }
      let vs = x.vs;
      if (visitCrit) {
        vs = x.vs.filter((v) => {
          if (v.tarih < from || v.tarih >= to) return false;
          if (!qMatch(v.tani + ' ' + v.icd, G.tani)) return false;
          if (icds.length && !icds.some((c) => String(v.icd || '').toUpperCase().startsWith(c))) return false;
          if (!qMatch(v.sikayet, G.sikayet) || !qMatch(v.muayene, G.muayene) || !qMatch(v.plan, G.plan) || !qMatch(v.onemliNot, G.not)) return false;
          if (G.tedavi.length) {
            const tt = a.tedaviTur === 'uygulanan' ? v.tedaviUygulanan : a.tedaviTur === 'planlanan' ? v.tedaviPlanlanan : (v.tedaviUygulanan || '') + ' ' + (v.tedaviPlanlanan || '');
            if (!qMatch(tt, G.tedavi)) return false;
          }
          return true;
        });
        if (!vs.length) continue;
      }
      out.push({ x, vs });
    }
    out.sort((p, q) => ((q.vs[0] || {}).tarih || q.x.lastTime) - ((p.vs[0] || {}).tarih || p.x.lastTime));
    return out;
  }
  /* Defterdeki en sık değerler: öneri çipleri ve otomatik tamamlama için */
  function topValues(fields, n) {
    const cnt = new Map();
    for (const x of livePatients()) for (const v of x.vs) for (const f of fields) {
      const val = trim(v[f]);
      if (!val || val.length > 80) continue;
      const k = PK.fold(val);
      const e = cnt.get(k) || { val, n: 0 };
      e.n++; cnt.set(k, e);
    }
    return Array.from(cnt.values()).sort((a, b) => b.n - a.n || a.val.localeCompare(b.val, 'tr')).slice(0, n);
  }
  function chips(field, list) {
    if (!list.length) return '';
    return '<div class="chips" role="group" aria-label="Sık kullanılanlar">' + list.map((e) =>
      '<button type="button" class="chip-btn" data-act="advChip" data-field="' + field + '" data-val="' + esc(e.val) + '">' + esc(e.val) + ' <em>' + e.n + '</em></button>').join('') + '</div>';
  }
  function datalist(id, list) {
    return '<datalist id="' + id + '">' + list.map((e) => '<option value="' + esc(e.val) + '"></option>').join('') + '</datalist>';
  }
  function advView() {
    const a = S.adv;
    const f = (name, label, ph, extra) => '<label class="field"><span>' + label + '</span><input data-adv="' + name + '" value="' + esc(a[name]) + '" placeholder="' + esc(ph || '') + '" autocomplete="off" spellcheck="false"' + (extra || '') + '></label>';
    const topTani = topValues(['tani'], 12), topIcd = topValues(['icd'], 10), topTed = topValues(['tedaviUygulanan', 'tedaviPlanlanan'], 12);
    const sel = (name, opts) => '<select data-adv="' + name + '">' + opts.map(([v, t]) => '<option value="' + v + '"' + (a[name] === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>';
    return '<button class="btn ghost back" type="button" data-act="back">' + IC.back + 'Liste</button>' +
      '<h2 class="form-title">Detaylı arama</h2>' +
      '<p class="form-sub">Doldurduğunuz tüm ölçütler birlikte aranır. Vizit ölçütleri aynı vizitte eşleşmelidir. Bir kutuda virgülle ayırdığınız ifadelerden herhangi biri yeterlidir: <b>menisküs, kondromalazi</b>.</p>' +
      '<form class="adv" data-form="adv" autocomplete="off">' +
      '<div class="card"><p class="card-h">Tanı</p><div class="grid2">' +
        f('tani', 'Tanı içinde geçen', 'Örn. gonartroz, menisküs', ' list="dlTani"') +
        f('icd', 'ICD-10 kodu (başı yeterli)', 'Örn. M17 veya M23.2, S83', ' list="dlIcd"') +
      '</div>' + chips('tani', topTani) + chips('icd', topIcd) + '</div>' +
      '<div class="card"><p class="card-h">Tedavi</p><div class="grid2">' +
        f('tedavi', 'Tedavi içinde geçen', 'Örn. PRP, artroskopi, NSAİİ', ' list="dlTed"') +
        '<label class="field"><span>Hangi tedavi alanında</span>' + sel('tedaviTur', [['all', 'Uygulanan ve uygulanacak'], ['uygulanan', 'Yalnızca uygulanan'], ['planlanan', 'Yalnızca uygulanacak']]) + '</label>' +
      '</div>' + chips('tedavi', topTed) + '</div>' +
      '<div class="card"><p class="card-h">Vizit</p><div class="grid2">' +
        f('sikayet', 'Şikayet', 'Örn. bel ağrısı') +
        f('muayene', 'Muayene bulgusu', 'Örn. McMurray') +
        f('plan', 'Plan', 'Örn. MR, ameliyat') +
        f('not', 'Önemli not', 'Örn. varfarin, alerji') +
        '<label class="field"><span>Vizit tarihi: başlangıç</span><input type="date" data-adv="from" value="' + esc(a.from) + '"></label>' +
        '<label class="field"><span>Vizit tarihi: bitiş</span><input type="date" data-adv="to" value="' + esc(a.to) + '"></label>' +
      '</div></div>' +
      '<div class="card"><p class="card-h">Hasta</p><div class="grid2">' +
        f('kisi', 'Ad, soyad, TC veya telefon', '') +
        '<label class="field"><span>Kontrol durumu</span>' + sel('kontrol', [['', 'Fark etmez'], ['yaklasan', 'Kontrolü 30 gün içinde'], ['gecmis', 'Kontrol tarihi geçmiş, gelmemiş'], ['var', 'Kontrol tarihi verilmiş']]) + '</label>' +
      '</div><label class="check" style="margin-top:12px"><input type="checkbox" data-adv="gorsel"' + (a.gorsel ? ' checked' : '') + '>Yalnızca görüntüsü olan hastalar</label></div>' +
      datalist('dlTani', topValues(['tani'], 60)) + datalist('dlIcd', topValues(['icd'], 40)) + datalist('dlTed', topValues(['tedaviUygulanan', 'tedaviPlanlanan'], 60)) +
      '</form>' +
      '<div class="adv-bar"><p id="advCount" class="adv-count"></p><span class="spacer"></span>' +
        '<button class="btn primary" type="button" data-act="advJump" id="advJump" hidden>Sonuçları gör</button>' +
        '<button class="btn ghost" type="button" data-act="advClear">Temizle</button>' +
        '<button class="btn ghost" type="button" data-act="advExcel">Excel\'e aktar</button></div>' +
      '<div id="advResults" class="adv-results"></div>';
  }
  function advRender() {
    const box = document.getElementById('advResults'), cnt = document.getElementById('advCount');
    if (!box) return;
    if (!advActive()) {
      cnt.textContent = 'Arama ölçütü girin.';
      box.innerHTML = '';
      return;
    }
    const res = advRun();
    const nv = res.reduce((s, r) => s + r.vs.length, 0);
    cnt.textContent = res.length ? res.length + ' hasta, ' + nv + ' vizit bulundu.' : 'Eşleşen kayıt yok.';
    const j = document.getElementById('advJump'); if (j) j.hidden = !res.length;
    const fd = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const max = 200;
    box.innerHTML = res.slice(0, max).map(({ x, vs }) => {
      const p = x.p;
      const rows = vs.slice(0, 4).map((v) => '<li><time>' + esc(fd.format(v.tarih)) + '</time><span>' +
        esc(trim(v.tani) || trim(v.sikayet) || 'Tanı girilmemiş') + (trim(v.icd) ? ' <span class="icd">' + esc(v.icd) + '</span>' : '') +
        (trim(v.tedaviUygulanan) || trim(v.tedaviPlanlanan) ? '<small>' + esc([v.tedaviUygulanan, v.tedaviPlanlanan].map(trim).filter(Boolean).join(' / ')) + '</small>' : '') +
        '</span></li>').join('');
      return '<a class="adv-hit" href="#/h/' + esc(p.id) + '"><div class="adv-hit-h"><b>' + esc(fullName(p)) + '</b>' +
        (trim(p.tel) ? '<span>' + esc(PK.fmtPhone(p.tel)) + '</span>' : '') + (x.note ? '<span class="flag" title="Önemli not var"></span>' : '') +
        (vs.length > 4 ? '<span class="muted small">+' + (vs.length - 4) + ' vizit</span>' : '') + '</div><ul>' + rows + '</ul></a>';
    }).join('') + (res.length > max ? '<p class="muted small">İlk ' + max + ' hasta gösteriliyor. Ölçütleri daraltın.</p>' : '');
  }
  function advChanged() {
    clearTimeout(S.advTimer);
    S.advTimer = setTimeout(advRender, 120);
  }

  /* ---------- ayarlar ---------- */
  function settingsView() {
    const st = S.settings;
    const opt = (v) => '<option value="' + v + '"' + (Number(st.lockMinutes) === v ? ' selected' : '') + '>' + v + ' dakika</option>';
    const n = livePatients().length;
    return '<button class="btn ghost back" type="button" data-act="back">' + IC.back + 'Liste</button>' +
      '<h2 class="form-title">Ayarlar</h2><p class="form-sub">' + n + ' hasta kayıtlı.</p>' +
      '<section class="set"><h3>Google Drive eşitleme</h3>' +
        '<p class="muted">Defter, şifreli hâliyle Google Drive\'ınızda bu uygulamaya ayrılmış gizli bir klasöre kaydedilir. Google dosyanın içeriğini okuyamaz; uygulama da Drive\'daki diğer dosyalarınızı göremez.</p>' +
        '<form data-form="clientId" autocomplete="off"><label class="field"><span>Google istemci kimliği (Client ID)</span><input name="cid" value="' + esc(st.clientId || '') + '" placeholder="…apps.googleusercontent.com" spellcheck="false"></label></form>' +
        '<div class="row-btns"><button class="btn ghost" type="button" data-act="saveClientId">Kimliği kaydet</button>' +
        '<button class="btn primary" type="button" data-act="sync">' + (st.driveConnected ? 'Şimdi eşitle' : 'Google\'a bağlan ve eşitle') + '</button>' +
        (st.driveConnected ? '<button class="btn ghost" type="button" data-act="disconnect">Bağlantıyı kes</button>' : '') + '</div>' +
        '<label class="check"><input type="checkbox" data-change="autoSync"' + (st.autoSyncOnUnlock ? ' checked' : '') + '>Defteri açınca otomatik eşitle</label>' +
        '<p class="small muted" id="syncStatus">' + esc(syncStatusText()) + '</p>' +
      '</section>' +
      '<section class="set"><h3>Otomatik kilit</h3>' +
        '<label class="field"><span>Bu süre boyunca işlem yapılmazsa defter kilitlenir</span><select data-change="lockMinutes">' + [1, 3, 5, 10, 15, 30].map(opt).join('') + '</select></label>' +
      '</section>' +
      '<section class="set"><h3>Yedek</h3>' +
        '<p class="muted">Yedek dosyası da defter parolasıyla şifrelidir. Geri yükleme mevcut kayıtlarla birleştirilir, hiçbir kaydı silmez. Görüntüler bu dosyaya girmez; şifreli kopyaları Google Drive\'da durur.</p>' +
        '<div class="row-btns"><button class="btn ghost" type="button" data-act="exportBackup">Şifreli yedeği indir</button>' +
        '<label class="btn ghost">Yedekten geri yükle<input type="file" accept=".pkd,application/json" data-change="importBackup" hidden></label></div>' +
        '<p class="small muted">' + (st.lastBackup ? 'Son yedek: ' + esc(fFull.format(st.lastBackup)) : 'Henüz yedek alınmadı.') + '</p>' +
      '</section>' +
      excelSection() +
      '<section class="set"><h3>Parolayı değiştir</h3>' +
        '<form data-form="changePw" autocomplete="off">' +
        '<div class="grid2">' +
        '<label class="field"><span>Mevcut parola</span><input type="password" name="cur" required autocomplete="current-password"></label><span></span>' +
        '<label class="field"><span>Yeni parola (en az 8 karakter)</span><input type="password" name="pw" minlength="8" required autocomplete="new-password"></label>' +
        '<label class="field"><span>Yeni parola tekrar</span><input type="password" name="pw2" minlength="8" required autocomplete="new-password"></label>' +
        '</div><p class="err" id="pwErr"></p>' +
        '<p class="hint">Parolayı değiştirdikten sonra diğer cihazda da aynı yeni parolayı ayarlayın.</p>' +
        '<div class="row-btns"><button class="btn ghost" type="submit">Parolayı değiştir</button></div></form>' +
      '</section>' +
      '<section class="set"><h3>Bu cihazdaki defteri sil</h3>' +
        '<p class="muted">Cihazı başkasına verecekseniz kullanın. Google Drive\'daki şifreli kopya silinmez.</p>' +
        '<div class="row-btns"><button class="btn danger" type="button" data-act="wipeDevice">Bu cihazdan sil</button></div>' +
      '</section>' +
      '<section class="set about"><img src="icons/logo-tam.png" alt="Gail Gasimov logosu" width="110" height="107">' +
        '<p><b>Op. Dr. Gail Gasimov</b><br>Ortopedi ve Travmatoloji Uzmanı<br>Liv Hospital Vadistanbul<br>drgailgasimov.com<br>Poliklinik Defteri sürüm ' + VERSION + '</p></section>';
  }

  /* ================= diyaloglar ================= */
  function dialog(html) {
    return new Promise((resolve) => {
      $dlg.innerHTML = html;
      const form = $dlg.querySelector('form');
      const close = (val) => { $dlg.close(); resolve(val); };
      $dlg.querySelectorAll('[data-dlg-cancel]').forEach((b) => b.addEventListener('click', () => close(null)));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const need = form.dataset.confirm;
        if (need && fd.get('confirm') !== need) { const er = form.querySelector('.err'); if (er) er.textContent = '“' + need + '” yazın.'; return; }
        close(Object.fromEntries(fd.entries()));
      });
      $dlg.addEventListener('cancel', () => resolve(null), { once: true });
      $dlg.showModal();
      const f = $dlg.querySelector('input');
      if (f) f.focus();
    });
  }
  const confirmDlg = (title, text, okLabel, danger) => dialog(
    '<form method="dialog"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p><div class="acts">' +
    '<button class="btn ghost" type="button" data-dlg-cancel>Vazgeç</button>' +
    '<button class="btn ' + (danger ? 'danger' : 'primary') + '" type="submit">' + esc(okLabel) + '</button></div></form>');
  const passwordDlg = (text) => dialog(
    '<form method="dialog"><h3>Parola gerekli</h3><p>' + esc(text) + '</p>' +
    '<label class="field"><span>Parola</span><input type="password" name="pw" required autocomplete="off"></label><div class="acts">' +
    '<button class="btn ghost" type="button" data-dlg-cancel>Vazgeç</button><button class="btn primary" type="submit">Devam</button></div></form>');

  /* ================= olaylar ================= */
  const ACT = {
    setupMode(el) { S.setupMode = el.dataset.mode; renderSetup(); },
    cancelPending() { S.pendingVault = null; S.pendingDriveFileId = null; renderSetup(); },
    setupDriveSignIn() {
      const er = document.getElementById('setupErr');
      Drive.signIn(true).then(async () => {
        er.textContent = 'Defter aranıyor…';
        const f = await Drive.findFile();
        if (!f) throw new Error('Google Drive\'da defter bulunamadı. Önce bilgisayardaki defterde “Google\'a bağlan ve eşitle” adımını tamamlayın ve aynı Google hesabıyla giriş yaptığınızdan emin olun.');
        const remote = await Drive.download(f.id);
        if (!PK.isVault(remote)) throw new Error('Drive\'daki dosya tanınmadı.');
        S.pendingVault = remote; S.pendingDriveFileId = f.id;
        renderSetup();
      }).catch((e) => { er.textContent = e.message; });
    },
    sync() { syncFromTap(); },
    lock() { lock('Defter kilitlendi.'); },
    back() { go('#/'); },
    cancelForm() { goBack(); },
    filter(el) { S.filter = el.dataset.f; renderList(); },
    revealTC(el) { const id = el.dataset.id; if (S.reveal.has(id)) S.reveal.delete(id); else S.reveal.add(id); renderMain(); },
    tab(el) { setTab(el.dataset.tab); },
    tabStep(el) {
      const i = TABS.findIndex((t) => t.id === S.form.tab);
      const j = Math.max(0, Math.min(TABS.length - 1, i + Number(el.dataset.d)));
      setTab(TABS[j].id);
    },
    useExisting(el) {
      const f = S.form; if (!f) return;
      f.patientId = el.dataset.id; f.mode = 'newVisit'; f.hash = '#/h/' + el.dataset.id + '/vizit';
      ['ad', 'soyad', 'tc', 'tel'].forEach((k) => delete f.data[k]);
      S.ignoreHash = true; location.hash = f.hash; S.currentHash = f.hash;
      setTimeout(() => { S.ignoreHash = false; }, 0);
      renderMain(); renderList();
    },
    async deleteVisit() {
      const f = S.form;
      const ok = await confirmDlg('Vizit silinsin mi?', 'Bu vizitin tüm bilgileri kalıcı olarak silinir. Eşitlemeden sonra diğer cihazdan da silinir.', 'Viziti sil', true);
      if (!ok) return;
      const p = getPatient(f.patientId);
      p.visits = Object.assign({}, p.visits, { [f.visitId]: { id: f.visitId, deleted: true, updatedAt: Date.now() } });
      await markChanged();
      S.form = null; toast('Vizit silindi.'); go('#/h/' + f.patientId);
    },
    async deletePatient() {
      const f = S.form; const p = getPatient(f.patientId);
      const ok = await dialog('<form method="dialog" data-confirm="SİL"><h3>Hasta silinsin mi?</h3><p>' + esc(fullName(p)) + ' ve tüm vizitleri kalıcı olarak silinir. Eşitlemeden sonra diğer cihazdan da silinir. Onaylamak için SİL yazın.</p>' +
        '<label class="field"><span>Onay</span><input name="confirm" autocomplete="off" autocapitalize="characters"></label><p class="err"></p><div class="acts">' +
        '<button class="btn ghost" type="button" data-dlg-cancel>Vazgeç</button><button class="btn danger" type="submit">Hastayı sil</button></div></form>');
      if (!ok) return;
      const imgs = {};
      for (const iid of Object.keys(p.images || {})) { imgs[iid] = { id: iid, deleted: true, updatedAt: Date.now() }; await idb.del('img:' + iid).catch(() => {}); }
      S.db.patients[p.id] = { id: p.id, deleted: true, updatedAt: Date.now(), visits: {}, images: imgs };
      await markChanged();
      S.form = null; toast('Hasta silindi.'); go('#/');
    },
    saveClientId() { saveClientId(); },
    openImage(el) { openImageViewer(el.dataset.pid, el.dataset.iid); },
    advChip(el) {
      const f = el.dataset.field, v = el.dataset.val;
      const cur = trim(S.adv[f]);
      const parts = cur ? cur.split(',').map(trim) : [];
      if (!parts.some((p) => PK.fold(p) === PK.fold(v))) parts.push(v);
      S.adv[f] = parts.join(', ');
      const inp = document.querySelector('[data-adv="' + f + '"]');
      if (inp) inp.value = S.adv[f];
      advRender();
    },
    advJump() {
      const r = document.getElementById('advResults');
      if (r) r.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    },
    advClear() {
      S.adv = { kisi: '', tani: '', icd: '', sikayet: '', muayene: '', tedavi: '', tedaviTur: 'all', plan: '', not: '', from: '', to: '', kontrol: '', gorsel: false };
      renderMain();
    },
    advExcel(el) {
      if (!advActive()) { toast('Önce arama ölçütü girin.', true); return; }
      const res = advRun().map((r) => ({ x: r.x, vs: r.vs.slice().sort((a, b) => a.tarih - b.tarih) }));
      el.disabled = true;
      exportExcel(res, 'Detaylı arama sonucu').catch((e) => toast('Excel dosyası oluşturulamadı: ' + e.message, true)).finally(() => { el.disabled = false; });
    },
    exportExcel(el) {
      el.disabled = true;
      exportExcel().catch((e) => toast('Excel dosyası oluşturulamadı: ' + e.message, true)).finally(() => { el.disabled = false; });
    },
    async disconnect() {
      const ok = await confirmDlg('Google bağlantısı kesilsin mi?', 'Bu cihaz Drive ile eşitlemeyi bırakır. Drive\'daki şifreli kopya ve bu cihazdaki kayıtlar silinmez.', 'Bağlantıyı kes');
      if (!ok) return;
      Drive.signOut();
      Object.assign(S.settings, { driveConnected: false, driveFileId: '', lastSync: 0 });
      await saveSettings(); S.sync = { state: 'off', msg: '' }; refreshSyncState(); renderMain(); toast('Google bağlantısı kesildi.');
    },
    async exportBackup() {
      const v = await currentVault();
      const blob = new Blob([JSON.stringify(v)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'poliklinik-defteri-' + todayISO() + '.pkd';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      S.settings.lastBackup = Date.now(); await saveSettings(); renderMain();
      toast('Şifreli yedek indirildi.');
    },
    async wipeDevice() {
      const ok = await dialog('<form method="dialog" data-confirm="SİL"><h3>Bu cihazdaki defter silinsin mi?</h3><p>Bu cihazdaki tüm kayıtlar ve ayarlar silinir. Eşitlenmemiş değişiklikler kaybolur. Onaylamak için SİL yazın.</p>' +
        '<label class="field"><span>Onay</span><input name="confirm" autocomplete="off" autocapitalize="characters"></label><p class="err"></p><div class="acts">' +
        '<button class="btn ghost" type="button" data-dlg-cancel>Vazgeç</button><button class="btn danger" type="submit">Cihazdan sil</button></div></form>');
      if (!ok) return;
      Drive.signOut();
      await idb.clear();
      location.hash = ''; location.reload();
    }
  };

  async function saveClientId() {
    const el = document.querySelector('input[name=cid]');
    const cid = trim(el && el.value);
    if (cid && !/\.apps\.googleusercontent\.com$/.test(cid)) { toast('İstemci kimliği “.apps.googleusercontent.com” ile bitmeli.', true); return; }
    if (cid !== S.settings.clientId) { Drive.signOut(); S.settings.driveFileId = ''; S.settings.driveConnected = false; }
    S.settings.clientId = cid; await saveSettings();
    if (!cid) { refreshSyncState(); toast('İstemci kimliği silindi.'); return; }
    try { await Drive.prepare(cid); toast('Kaydedildi. Şimdi “Google\'a bağlan ve eşitle”ye dokunun.'); }
    catch (e) { toast(e.message, true); }
    refreshSyncState();
  }

  const FORMS = {
    async unlock(form) {
      const er = document.getElementById('lockErr');
      if (Date.now() < S.lockUntil) { er.textContent = Math.ceil((S.lockUntil - Date.now()) / 1000) + ' saniye bekleyin.'; return; }
      const pw = form.pw.value;
      // Google penceresi yalnızca dokunuş anında açılabilir; bu yüzden parola çözülmeden önce istenir.
      let tokenP = null;
      if (S.settings.clientId && S.settings.driveConnected && S.settings.autoSyncOnUnlock && Drive.isReady() && !Drive.hasToken() && navigator.onLine) {
        tokenP = Drive.signIn(false).catch(() => null);
      } else if (Drive.hasToken()) tokenP = Promise.resolve(true);
      const btn = form.querySelector('button'); btn.disabled = true; btn.textContent = 'Açılıyor…';
      try {
        const vault = await idb.get('vault');
        const kr = new PK.Keyring(pw);
        const db = await kr.openVault(vault);
        S.keyring = kr; S.localSalt = vault.salt; S.db = db; S.dirty = false;
        await afterUnlock(tokenP);
      } catch (e) {
        S.failCount++;
        if (S.failCount >= 3) S.lockUntil = Date.now() + Math.min(60, 2 ** (S.failCount - 2)) * 1000;
        btn.disabled = false; btn.textContent = 'Defteri aç';
        er.textContent = 'Parola yanlış.' + (S.failCount >= 3 ? ' Tekrar denemeden önce biraz bekleyin.' : '');
        form.pw.select();
      }
    },
    async create(form) {
      const pw = form.pw.value, pw2 = form.pw2.value;
      if (pw.length < 8) return renderSetup('Parola en az 8 karakter olmalı.');
      if (pw !== pw2) return renderSetup('Parolalar aynı değil.');
      const btn = form.querySelector('button'); btn.disabled = true; btn.textContent = 'Oluşturuluyor…';
      S.keyring = new PK.Keyring(pw); S.localSalt = PK.newSalt(); S.db = PK.emptyDB();
      await persist();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      S.vaultExists = true;
      await afterUnlock(null);
      toast('Defter oluşturuldu.');
    },
    async openPending(form) {
      const pw = form.pw.value;
      const kr = new PK.Keyring(pw);
      try {
        const db = await kr.openVault(S.pendingVault);
        S.keyring = kr; S.localSalt = S.pendingVault.salt; S.db = db;
        if (S.pendingDriveFileId) Object.assign(S.settings, { driveFileId: S.pendingDriveFileId, driveConnected: true, lastSync: Date.now() });
        await saveSettings();
        S.pendingVault = null; S.pendingDriveFileId = null;
        await persist();
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        S.vaultExists = true;
        await afterUnlock(null);
        toast('Defter açıldı.');
      } catch (e) { renderSetup('Parola yanlış.'); }
    },
    async setupClient(form) {
      const cid = trim(form.cid.value);
      if (!/\.apps\.googleusercontent\.com$/.test(cid)) return renderSetup('İstemci kimliği “.apps.googleusercontent.com” ile bitmeli.');
      S.settings.clientId = cid; await saveSettings();
      try { await Drive.prepare(cid); renderSetup(); }
      catch (e) { renderSetup(e.message); }
    },
    record() { saveForm(); },
    adv() { advRender(); },
    clientId() { saveClientId(); },
    async changePw(form) {
      const er = document.getElementById('pwErr');
      const cur = form.cur.value, pw = form.pw.value, pw2 = form.pw2.value;
      if (cur !== S.keyring.pw) { er.textContent = 'Mevcut parola yanlış.'; return; }
      if (pw.length < 8) { er.textContent = 'Yeni parola en az 8 karakter olmalı.'; return; }
      if (pw !== pw2) { er.textContent = 'Yeni parolalar aynı değil.'; return; }
      S.prevKeyring = S.keyring;
      S.keyring = new PK.Keyring(pw);
      S.localSalt = PK.newSalt();
      await markChanged();
      form.reset(); er.textContent = '';
      toast('Parola değişti. Diğer cihazda da aynı parolayı ayarlayın.');
    }
  };

  const CHANGES = {
    async setupFile(el) {
      const file = el.files && el.files[0]; if (!file) return;
      try {
        const v = JSON.parse(await file.text());
        if (!PK.isVault(v)) throw new Error();
        S.pendingVault = v; S.pendingDriveFileId = null; renderSetup();
      } catch (e) { renderSetup('Bu dosya bir Poliklinik Defteri yedeği değil.'); }
    },
    async importBackup(el) {
      const file = el.files && el.files[0]; el.value = ''; if (!file) return;
      let v;
      try { v = JSON.parse(await file.text()); if (!PK.isVault(v)) throw new Error(); }
      catch (e) { toast('Bu dosya bir Poliklinik Defteri yedeği değil.', true); return; }
      let other;
      try { other = await S.keyring.openVault(v); }
      catch (e) {
        const r = await passwordDlg('Bu yedek farklı bir parolayla şifrelenmiş. Yedeğin parolasını girin.');
        if (!r) return;
        try { other = await new PK.Keyring(r.pw).openVault(v); }
        catch (e2) { toast('Yedek parolası yanlış.', true); return; }
      }
      const before = livePatients().length;
      S.db = PK.mergeDB(S.db, other);
      await markChanged();
      const after = livePatients().length;
      renderList(); renderMain();
      toast('Yedek birleştirildi. ' + (after - before) + ' yeni hasta eklendi.');
    },
    async autoSync(el) { S.settings.autoSyncOnUnlock = el.checked; await saveSettings(); },
    async addImages(el) {
      const files = Array.from(el.files || []); el.value = '';
      if (!files.length) return;
      const r = await dialog('<form method="dialog"><h3>' + files.length + ' görüntü eklenecek</h3><p>İsterseniz kısa bir açıklama yazın. Sonra görüntüye dokunarak değiştirebilirsiniz.</p>' +
        '<label class="field"><span>Açıklama (isteğe bağlı)</span><input name="note" placeholder="Örn. Sağ diz AP grafi" autocomplete="off"></label><div class="acts">' +
        '<button class="btn ghost" type="button" data-dlg-cancel>Vazgeç</button><button class="btn primary" type="submit">Ekle</button></div></form>');
      if (!r) return;
      toast('Görüntüler hazırlanıyor…');
      const n = await addImages(el.dataset.id, files, r.note);
      if (n) { renderMain(); toast(n + ' görüntü eklendi.'); }
    },
    xlRange(el) { S.xl.range = el.value; refreshXl(); },
    xlFrom(el) { S.xl.from = el.value; refreshXl(); },
    xlTo(el) { S.xl.to = el.value; refreshXl(); },
    xlIds(el) { S.xl.ids = el.checked; },
    async lockMinutes(el) { S.settings.lockMinutes = Number(el.value); await saveSettings(); toast('Otomatik kilit: ' + el.value + ' dakika.'); }
  };

  $app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !$app.contains(el)) return;
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  $app.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const fn = FORMS[form.dataset.form];
    if (fn) fn(form);
  });
  $app.addEventListener('change', (e) => {
    if (e.target.dataset && e.target.dataset.adv) {
      S.adv[e.target.dataset.adv] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      advRender();
      return;
    }
    const el = e.target.closest('[data-change]');
    if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el);
  });
  $app.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.adv) {
      S.adv[el.dataset.adv] = el.type === 'checkbox' ? el.checked : el.value;
      advChanged();
      return;
    }
    if (!S.form || !el.dataset || !el.dataset.f) return;
    S.form.data[el.dataset.f] = el.value;
    S.form.dirty = true;
    if (el.dataset.f === 'tc') checkTC();
    updateTabDots();
  });
  document.addEventListener('keydown', (e) => {
    if (!S.unlocked) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && S.form) { e.preventDefault(); saveForm(); return; }
    if (e.altKey && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); go('#/yeni'); return; }
    if (e.altKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); go('#/arama'); return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && !$dlg.open) {
      const q = document.getElementById('q');
      if (q) { e.preventDefault(); if (location.hash && location.hash !== '#/' && !S.form) go('#/'); q.focus(); }
    }
  });
  window.addEventListener('online', () => { if (S.unlocked) refreshSyncState(); });
  window.addEventListener('beforeunload', (e) => { if (S.form && S.form.dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ================= açılış ================= */
  async function boot() {
    if (!window.crypto || !crypto.subtle || !window.indexedDB) {
      $app.innerHTML = '<main class="lock"><div class="lock-card">' + brandBlock() + '<p class="notice alert">Bu tarayıcı güvenli şifrelemeyi desteklemiyor. Uygulamayı https adresinden, güncel Chrome ile açın.</p></div></main>';
      return;
    }
    try {
      S.settings = Object.assign({}, DEFAULT_SETTINGS, (await idb.get('settings')) || {});
      const v = await idb.get('vault');
      S.vaultExists = !!v;
      if (v) renderLock(); else renderSetup();
    } catch (e) {
      $app.innerHTML = '<main class="lock"><div class="lock-card">' + brandBlock() + '<p class="notice alert">Yerel depolama açılamadı: ' + esc(e.message) + '. Gizli sekmede değilseniz tarayıcıyı yeniden başlatın.</p></div></main>';
    }
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      let reloaded = false;
      navigator.serviceWorker.register('sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return; reloaded = true;
        if (!S.unlocked) toast('Uygulama güncellendi.');
      });
    }
  }
  boot();
})();
