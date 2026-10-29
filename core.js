/* Poliklinik Defteri — çekirdek: şifreleme, birleştirme, doğrulama.
   Tarayıcıda window.PK olarak, Node'da module.exports olarak kullanılır. */
(function (root) {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const APP_ID = 'poliklinik-defteri';
  const AAD = enc.encode(APP_ID + ':v1');
  const ITER = 600000; // PBKDF2-SHA256, OWASP 2023 önerisi
  const cryptoObj = () => root.crypto || globalThis.crypto;

  /* ---------- base64 ---------- */
  function b64(buf) {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function randomBytes(n) {
    const u = new Uint8Array(n);
    cryptoObj().getRandomValues(u);
    return u;
  }
  function newSalt() { return b64(randomBytes(16)); }

  /* ---------- anahtar türetme ve AES-256-GCM ---------- */
  async function deriveKey(password, saltB64, iter) {
    const subtle = cryptoObj().subtle;
    const base = await subtle.importKey('raw', enc.encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: iter || ITER },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function seal(key, saltB64, iter, obj) {
    const iv = randomBytes(12);
    const ct = await cryptoObj().subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: AAD },
      key,
      enc.encode(JSON.stringify(obj))
    );
    return { app: APP_ID, v: 1, kdf: 'PBKDF2-SHA256', iter: iter || ITER, salt: saltB64, iv: b64(iv), ct: b64(ct), savedAt: Date.now() };
  }

  async function open(key, vault) {
    const pt = await cryptoObj().subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(vault.iv), additionalData: AAD },
      key,
      unb64(vault.ct)
    );
    return normalizeDB(JSON.parse(dec.decode(pt)));
  }

  function isVault(v) {
    return !!v && v.app === APP_ID && v.v === 1 && typeof v.salt === 'string' && typeof v.iv === 'string' && typeof v.ct === 'string';
  }

  /* Parola + tuz başına türetilmiş anahtarları tutar. Kilitlenince silinir. */
  class Keyring {
    constructor(password) { this.pw = password; this.keys = new Map(); }
    forSalt(saltB64, iter) {
      if (this.pw == null) return Promise.reject(new Error('Defter kilitli.'));
      const id = saltB64 + ':' + (iter || ITER);
      if (!this.keys.has(id)) this.keys.set(id, deriveKey(this.pw, saltB64, iter || ITER));
      return this.keys.get(id);
    }
    async openVault(vault) { return open(await this.forSalt(vault.salt, vault.iter), vault); }
    async sealWith(saltB64, iter, obj) { return seal(await this.forSalt(saltB64, iter), saltB64, iter || ITER, obj); }
    wipe() { this.pw = null; this.keys.clear(); }
  }

  /* ---------- veri modeli ve birleştirme ----------
     db = { schema:1, patients: { [id]: Patient } }
     Patient = { id, ad, soyad, tc, tel, createdAt, updatedAt, deleted?, visits: { [id]: Visit } }
     Visit = { id, tarih, sikayet, muayene, tani, icd, tedaviUygulanan, tedaviPlanlanan, plan, kontrol, onemliNot, createdAt, updatedAt, deleted? }
     Kimlik alanları hasta düzeyinde, vizitler kendi düzeyinde "son yazan kazanır" ile birleşir.
     Silinen kayıtlardan kişisel veri temizlenir; yalnızca kimliği ve silinme zamanı kalır. */
  function emptyDB() { return { schema: 1, patients: {}, keys: {} }; }

  function normalizeDB(db) {
    if (!db || typeof db !== 'object') return emptyDB();
    const out = { schema: 1, patients: {}, keys: Object.assign({}, db.keys || {}) };
    const src = db.patients || {};
    for (const id of Object.keys(src)) {
      const p = src[id];
      if (!p || !p.id) continue;
      out.patients[id] = Object.assign({}, p, { visits: Object.assign({}, p.visits || {}), images: Object.assign({}, p.images || {}) });
    }
    return out;
  }

  function lww(a, b) {
    if (!a) return b;
    if (!b) return a;
    const ta = a.updatedAt || 0, tb = b.updatedAt || 0;
    if (tb > ta) return b;
    if (tb < ta) return a;
    return b.deleted && !a.deleted ? b : a;
  }
  /* Silinen hastanın görüntü kimlikleri tutulur ki her cihaz şifreli görüntü dosyalarını da silebilsin. */
  function scrubPatient(p, imgs) {
    const images = {};
    for (const id of Object.keys(imgs || {})) images[id] = { id, deleted: true, updatedAt: p.updatedAt || Date.now() };
    return { id: p.id, deleted: true, updatedAt: p.updatedAt || Date.now(), visits: {}, images };
  }
  function scrubVisit(v) { return { id: v.id, deleted: true, updatedAt: v.updatedAt || Date.now() }; }
  function mergeMap(ma, mb) {
    ma = ma || {}; mb = mb || {};
    const out = {};
    for (const id of new Set(Object.keys(ma).concat(Object.keys(mb)))) {
      const w = lww(ma[id], mb[id]);
      out[id] = w.deleted ? scrubVisit(w) : Object.assign({}, w);
    }
    return out;
  }

  function mergeDB(a, b) {
    a = normalizeDB(a); b = normalizeDB(b);
    const out = emptyDB();
    // Görüntü anahtarları hiçbir zaman silinmez; iki cihazınkiler birleştirilir.
    out.keys = Object.assign({}, b.keys, a.keys);
    const ids = new Set(Object.keys(a.patients).concat(Object.keys(b.patients)));
    for (const id of ids) {
      const pa = a.patients[id], pb = b.patients[id];
      const top = lww(pa, pb);
      const images = mergeMap(pa && pa.images, pb && pb.images);
      if (top.deleted) { out.patients[id] = scrubPatient(top, images); continue; }
      const p = Object.assign({}, top);
      p.visits = mergeMap(pa && pa.visits, pb && pb.visits);
      p.images = images;
      out.patients[id] = p;
    }
    return out;
  }

  /* ---------- yardımcılar ---------- */
  function tcValid(s) {
    if (!/^[1-9]\d{10}$/.test(s || '')) return false;
    const d = s.split('').map(Number);
    const odd = d[0] + d[2] + d[4] + d[6] + d[8];
    const even = d[1] + d[3] + d[5] + d[7];
    const d10 = (((odd * 7 - even) % 10) + 10) % 10;
    if (d10 !== d[9]) return false;
    return d.slice(0, 10).reduce((x, y) => x + y, 0) % 10 === d[10];
  }

  function normPhone(raw) {
    const t = String(raw || '').trim();
    if (!t) return '';
    if (t.startsWith('+')) return '+' + t.slice(1).replace(/\D/g, '');
    let d = t.replace(/\D/g, '');
    if (d.startsWith('00')) return '+' + d.slice(2);
    if (d.length === 11 && d[0] === '0') return '+90' + d.slice(1);
    if (d.length === 10 && d[0] === '5') return '+90' + d;
    if (d.length === 12 && d.startsWith('90')) return '+' + d;
    return d;
  }
  function fmtPhone(raw) {
    const n = normPhone(raw);
    const m = n.match(/^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/);
    return m ? '0' + m[1] + ' ' + m[2] + ' ' + m[3] + ' ' + m[4] : String(raw || '').trim();
  }
  function maskTC(tc) {
    tc = String(tc || '');
    if (!tc) return '';
    if (tc.length < 6) return '•'.repeat(tc.length);
    return tc.slice(0, 2) + '•'.repeat(tc.length - 4) + tc.slice(-2);
  }
  /* Türkçe duyarsız arama: "sukru" → "Şükrü" bulur. */
  function fold(s) {
    return String(s || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  /* ---------- görüntüler için veri anahtarı (parola değişse de aynı kalır) ---------- */
  function newDataKey() { return b64(randomBytes(32)); }
  const dkCache = new Map();
  function importDataKey(k64) {
    if (!dkCache.has(k64)) dkCache.set(k64, cryptoObj().subtle.importKey('raw', unb64(k64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']));
    return dkCache.get(k64);
  }
  function clearDataKeys() { dkCache.clear(); }
  const IMG_AAD = enc.encode(APP_ID + ':img:v1');
  /* Biçim: "PKI1" (4 bayt) + iv (12 bayt) + şifreli veri.  İçerik: başlık uzunluğu (4 bayt) + JSON başlık + dosya baytları */
  async function sealBytes(k64, header, bytes) {
    const key = await importDataKey(k64);
    const h = enc.encode(JSON.stringify(header || {}));
    const plain = new Uint8Array(4 + h.length + bytes.length);
    new DataView(plain.buffer).setUint32(0, h.length);
    plain.set(h, 4); plain.set(bytes, 4 + h.length);
    const iv = randomBytes(12);
    const ct = new Uint8Array(await cryptoObj().subtle.encrypt({ name: 'AES-GCM', iv, additionalData: IMG_AAD }, key, plain));
    const out = new Uint8Array(16 + ct.length);
    out.set(enc.encode('PKI1'), 0); out.set(iv, 4); out.set(ct, 16);
    return out;
  }
  async function openBytes(k64, blob) {
    const u = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
    if (dec.decode(u.subarray(0, 4)) !== 'PKI1') throw new Error('Görüntü dosyası tanınmadı.');
    const key = await importDataKey(k64);
    const plain = new Uint8Array(await cryptoObj().subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(4, 16), additionalData: IMG_AAD }, key, u.subarray(16)));
    const hl = new DataView(plain.buffer).getUint32(0);
    return { header: JSON.parse(dec.decode(plain.subarray(4, 4 + hl))), bytes: plain.subarray(4 + hl) };
  }

  const PK = { APP_ID, ITER, b64, unb64, newSalt, deriveKey, seal, open, isVault, Keyring, emptyDB, normalizeDB, mergeDB, newDataKey, sealBytes, openBytes, clearDataKeys, tcValid, normPhone, fmtPhone, maskTC, fold };
  if (typeof module !== 'undefined' && module.exports) module.exports = PK;
  else root.PK = PK;
})(typeof self !== 'undefined' ? self : globalThis);
