// 금고 저장·암호화 계층. 모든 항목은 마스터 비밀번호에서 유도한 키(PBKDF2-SHA256 → AES-GCM 256)로
// 폰 안의 IndexedDB에만 암호화 저장됩니다. 외부 서버 호출 없음.
const Vault = (() => {
  const DB = "pwvault", ITER = 600000;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = u8 => btoa(String.fromCharCode(...u8));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));
  const VERIFY = "pwvault-ok";

  function open() {
    return new Promise((ok, no) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("meta", { keyPath: "k" });
        d.createObjectStore("entries", { keyPath: "id" });
      };
      r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
    });
  }
  async function tx(store, mode, fn) {
    const d = await open();
    return new Promise((ok, no) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => { d.close(); ok(out && out.result !== undefined ? out.result : out); };
      t.onerror = () => { d.close(); no(t.error); };
    });
  }
  const getAll = store => tx(store, "readonly", s => s.getAll());
  const put = (store, v) => tx(store, "readwrite", s => s.put(v));
  const del = (store, k) => tx(store, "readwrite", s => s.delete(k));
  const clear = store => tx(store, "readwrite", s => s.clear());

  async function derive(pw, salt, iter) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pw.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encrypt(key, obj) {
    const iv = rnd(12);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }
  async function decrypt(key, rec) {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(rec.iv) }, key, unb64(rec.ct));
    return JSON.parse(dec.decode(pt));
  }

  async function getMeta() { return (await getAll("meta")).find(m => m.k === "kdf") || null; }

  async function makeMeta(pw) {
    const salt = rnd(16), key = await derive(pw, salt, ITER);
    const v = await encrypt(key, VERIFY);
    return { key, meta: { k: "kdf", salt: b64(salt), iter: ITER, verifyIv: v.iv, verifyCt: v.ct, createdAt: Date.now() } };
  }
  async function keyFor(pw, meta) {
    const key = await derive(pw, unb64(meta.salt), meta.iter);
    try { if (await decrypt(key, { iv: meta.verifyIv, ct: meta.verifyCt }) !== VERIFY) return null; }
    catch { return null; }
    return key;
  }

  return {
    exists: async () => !!(await getMeta()),
    async create(pw) {
      const { key, meta } = await makeMeta(pw);
      await put("meta", meta);
      try { await navigator.storage?.persist?.(); } catch {}
      return key;
    },
    async unlock(pw) { const m = await getMeta(); return m ? keyFor(pw, m) : null; },
    async loadAll(key) {
      const out = [];
      for (const r of await getAll("entries")) {
        try { out.push({ ...(await decrypt(key, r)), id: r.id }); } catch { /* 손상 레코드는 건너뜀 */ }
      }
      return out;
    },
    async save(key, e) {
      const { id, ...data } = e;
      const c = await encrypt(key, data);
      await put("entries", { id, iv: c.iv, ct: c.ct, updatedAt: data.updatedAt || Date.now() });
    },
    remove: id => del("entries", id),
    async changeMaster(newPw, entries) {
      const { key, meta } = await makeMeta(newPw);
      const recs = [];
      for (const e of entries) { const { id, ...data } = e; const c = await encrypt(key, data); recs.push({ id, iv: c.iv, ct: c.ct, updatedAt: data.updatedAt || Date.now() }); }
      const d = await open();
      await new Promise((ok, no) => {
        const t = d.transaction(["meta", "entries"], "readwrite");
        t.objectStore("meta").put(meta);
        const s = t.objectStore("entries"); s.clear(); recs.forEach(r => s.put(r));
        t.oncomplete = () => { d.close(); ok(); }; t.onerror = () => { d.close(); no(t.error); };
      });
      return key;
    },
    async wipe() { await clear("entries"); await clear("meta"); },
    async exportBackup() {
      const meta = await getMeta(); if (!meta) return null;
      return { app: "pwvault", v: 1, exportedAt: new Date().toISOString(), kdf: meta, entries: await getAll("entries") };
    },
    // 백업 파일의 항목을 복호화해 돌려줌. 현재 키로 먼저 시도하고, 실패하면 askPw()로 백업 당시 마스터 비밀번호를 받음.
    async readBackup(obj, curKey, askPw) {
      if (!obj || obj.app !== "pwvault" || !obj.kdf || !Array.isArray(obj.entries)) throw new Error("비밀번호 금고 백업 파일이 아닙니다.");
      let key = null;
      if (curKey) { try { if (await decrypt(curKey, { iv: obj.kdf.verifyIv, ct: obj.kdf.verifyCt }) === VERIFY) key = curKey; } catch {} }
      if (!key) {
        const pw = await askPw(); if (pw == null) return null;
        key = await keyFor(pw, obj.kdf);
        if (!key) throw new Error("백업 파일의 마스터 비밀번호가 맞지 않습니다.");
      }
      const out = [];
      for (const r of obj.entries) { try { out.push({ ...(await decrypt(key, r)), id: r.id }); } catch {} }
      return out;
    },
  };
})();
