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
  function emptyDB() { return { schema: 1, patients: {} }; }

  function normalizeDB(db) {
    if (!db || typeof db !== 'object') return emptyDB();
    const out = { schema: 1, patients: {} };
    const src = db.patients || {};
    for (const id of Object.keys(src)) {
      const p = src[id];
      if (!p || !p.id) continue;
      out.patients[id] = Object.assign({}, p, { visits: Object.assign({}, p.visits || {}) });
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
  function scrubPatient(p) { return { id: p.id, deleted: true, updatedAt: p.updatedAt || Date.now(), visits: {} }; }
  function scrubVisit(v) { return { id: v.id, deleted: true, updatedAt: v.updatedAt || Date.now() }; }

  function mergeDB(a, b) {
    a = normalizeDB(a); b = normalizeDB(b);
    const out = emptyDB();
    const ids = new Set(Object.keys(a.patients).concat(Object.keys(b.patients)));
    for (const id of ids) {
      const pa = a.patients[id], pb = b.patients[id];
      const top = lww(pa, pb);
      if (top.deleted) { out.patients[id] = scrubPatient(top); continue; }
      const va = (pa && pa.visits) || {}, vb = (pb && pb.visits) || {};
      const visits = {};
      for (const vid of new Set(Object.keys(va).concat(Object.keys(vb)))) {
        const w = lww(va[vid], vb[vid]);
        visits[vid] = w.deleted ? scrubVisit(w) : Object.assign({}, w);
      }
      const p = Object.assign({}, top);
      p.visits = visits;
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

  const PK = { APP_ID, ITER, b64, unb64, newSalt, deriveKey, seal, open, isVault, Keyring, emptyDB, normalizeDB, mergeDB, tcValid, normPhone, fmtPhone, maskTC, fold };
  if (typeof module !== 'undefined' && module.exports) module.exports = PK;
  else root.PK = PK;
})(typeof self !== 'undefined' ? self : globalThis);
