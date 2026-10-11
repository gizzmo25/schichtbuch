/*
 * Schichtbuch — Repository: Persistenz und Synchronisation.
 *
 * Quelle der Wahrheit ist die Supabase-Datenbank. Der Browser haelt nur
 *   - einen Cache (letzter bekannter Serverstand) fuer schnellen Start und Offline-Anzeige,
 *   - eine Outbox (pending) mit noch nicht uebertragenen Aenderungen.
 * Geht der Browserspeicher verloren, fehlen hoechstens nicht synchronisierte Aenderungen;
 * nach dem Login wird der Stand vollstaendig vom Server geladen.
 *
 * Sync = Outbox senden (Upsert auf Primaerschluessel, idempotent), dann Vollabzug laden.
 */
(function (root) {
  "use strict";
  const D = root.Domain;
  const CACHE_KEY = "schichtbuch.v2";
  const PAGE = 1000; // PostgREST liefert standardmaessig hoechstens 1000 Zeilen pro Abfrage

  /** DB-Zeile -> Shift */
  function fromRow(r) {
    return D.normalizeShift({
      id: r.id, date: r.shift_date, start: r.start_time, end: r.end_time,
      breakMinutes: r.break_minutes, rate: r.rate, type: r.shift_type, note: r.note,
    });
  }

  /** Shift -> DB-Zeile (user_id setzt die Datenbank per Default auth.uid()) */
  function toRow(s) {
    return {
      id: s.id, shift_date: s.date, start_time: s.start, end_time: s.end,
      break_minutes: s.breakMinutes, rate: s.rate, shift_type: s.type, note: s.note,
    };
  }

  /**
   * @param {{storage: Storage|null, logger: Console, uuid: () => string}} deps
   */
  function createRepository(deps) {
    const { storage, logger, uuid } = deps;
    let state = emptyState();
    let seq = 0;
    let syncing = null;

    function emptyState() {
      return { userId: null, shifts: [], settings: D.defaultSettings(), pending: {}, settingsDirty: false, lastSync: null };
    }

    function persist() {
      if (!storage) return;
      try {
        storage.setItem(CACHE_KEY, JSON.stringify(state));
      } catch (e) {
        logger.warn("[schichtbuch] Cache konnte nicht geschrieben werden", e);
      }
    }

    /** Cache laden. Ein Cache eines anderen Kontos wird verworfen. */
    function load(userId) {
      state = emptyState();
      state.userId = userId;
      if (!storage) return;
      try {
        const raw = JSON.parse(storage.getItem(CACHE_KEY) || "null");
        if (!raw || raw.userId !== userId) return;
        state.shifts = (raw.shifts || []).map(D.normalizeShift).filter(Boolean);
        state.settings = D.normalizeSettings(raw.settings);
        state.settingsDirty = Boolean(raw.settingsDirty);
        state.lastSync = raw.lastSync || null;
        for (const [id, p] of Object.entries(raw.pending || {})) {
          if (p && p.op === "delete") state.pending[id] = { op: "delete", seq: ++seq };
          else if (p && p.op === "upsert" && D.normalizeShift(p.shift)) state.pending[id] = { op: "upsert", shift: D.normalizeShift(p.shift), seq: ++seq };
        }
      } catch (e) {
        logger.warn("[schichtbuch] Cache unlesbar, starte leer", e);
      }
    }

    function clear() {
      state = emptyState();
      if (!storage) return;
      try { storage.removeItem(CACHE_KEY); } catch (e) { logger.warn("[schichtbuch] Cache konnte nicht geloescht werden", e); }
    }

    /** @param {object} input Formularwerte; ohne id wird eine neue Schicht angelegt */
    function saveShift(input) {
      const shift = D.normalizeShift({ ...input, id: D.isUuid(input.id) ? input.id : uuid() });
      if (!shift) throw new Error("Ungültige Schicht");
      state.shifts = state.shifts.filter((s) => s.id !== shift.id).concat(shift);
      state.pending[shift.id] = { op: "upsert", shift, seq: ++seq };
      persist();
      return shift;
    }

    function deleteShift(id) {
      state.shifts = state.shifts.filter((s) => s.id !== id);
      state.pending[id] = { op: "delete", seq: ++seq };
      persist();
    }

    function saveSettings(settings) {
      state.settings = D.normalizeSettings(settings);
      state.settingsDirty = true;
      persist();
    }

    /**
     * Schichten aus einem Backup uebernehmen. Bereits vorhandene (gleiche id oder
     * gleiches Datum+Beginn+Ende) werden uebersprungen -> wiederholter Import ist gefahrlos.
     * @returns {{added: number, skipped: number, invalid: number}}
     */
    function importShifts(rawShifts) {
      const ids = new Set(state.shifts.map((s) => s.id));
      const keys = new Set(state.shifts.map(D.naturalKey));
      const res = { added: 0, skipped: 0, invalid: 0 };
      for (const raw of Array.isArray(rawShifts) ? rawShifts : []) {
        const probe = D.normalizeShift(raw);
        if (!probe) { res.invalid++; continue; }
        if ((D.isUuid(probe.id) && ids.has(probe.id)) || keys.has(D.naturalKey(probe))) { res.skipped++; continue; }
        const s = saveShift(probe);
        ids.add(s.id);
        keys.add(D.naturalKey(s));
        res.added++;
      }
      return res;
    }

    async function pushPending(client) {
      const snapshot = Object.entries(state.pending).map(([id, p]) => ({ id, ...p }));
      const upserts = snapshot.filter((p) => p.op === "upsert");
      const deletes = snapshot.filter((p) => p.op === "delete");
      if (upserts.length) {
        const { error } = await client.from("shifts").upsert(upserts.map((p) => toRow(p.shift)), { onConflict: "id" });
        if (error) throw error;
      }
      if (deletes.length) {
        const { error } = await client.from("shifts").delete().in("id", deletes.map((p) => p.id));
        if (error) throw error;
      }
      // Nur bestaetigen, was seit dem Senden nicht erneut geaendert wurde.
      for (const p of snapshot) {
        if (state.pending[p.id] && state.pending[p.id].seq === p.seq) delete state.pending[p.id];
      }
      if (state.settingsDirty) {
        const sent = JSON.stringify(state.settings);
        const { error } = await client.from("settings").upsert({ user_id: state.userId, data: state.settings }, { onConflict: "user_id" });
        if (error) throw error;
        if (JSON.stringify(state.settings) === sent) state.settingsDirty = false;
      }
      persist();
    }

    async function pullAll(client) {
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await client.from("shifts").select("*").order("shift_date").order("id").range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < PAGE) break;
      }
      const { data: st, error: stErr } = await client.from("settings").select("data").maybeSingle();
      if (stErr) throw stErr;

      // Serverstand uebernehmen, lokal noch offene Aenderungen darueberlegen.
      const byId = new Map(rows.map(fromRow).filter(Boolean).map((s) => [s.id, s]));
      for (const [id, p] of Object.entries(state.pending)) {
        if (p.op === "delete") byId.delete(id);
        else byId.set(id, p.shift);
      }
      state.shifts = [...byId.values()];
      if (!state.settingsDirty) {
        if (st && st.data) state.settings = D.normalizeSettings(st.data);
        else state.settingsDirty = true; // Erststart: Standardwerte beim naechsten Sync hochladen
      }
      state.lastSync = new Date().toISOString();
      persist();
    }

    /** Senden + Laden. Parallele Aufrufe teilen sich denselben Lauf. */
    function sync(client) {
      if (syncing) return syncing;
      syncing = (async () => {
        try {
          await pushPending(client);
          await pullAll(client);
          if (state.settingsDirty) await pushPending(client);
        } finally {
          syncing = null;
        }
      })();
      return syncing;
    }

    return {
      load, clear, sync, saveShift, deleteShift, saveSettings, importShifts,
      get shifts() { return state.shifts; },
      get settings() { return state.settings; },
      get lastSync() { return state.lastSync; },
      get pendingCount() { return Object.keys(state.pending).length + (state.settingsDirty ? 1 : 0); },
      exportBackup() { return { version: 2, exportedAt: new Date().toISOString(), shifts: state.shifts, settings: state.settings }; },
    };
  }

  root.Repository = { createRepository, fromRow, toRow, CACHE_KEY };
})(typeof self !== "undefined" ? self : globalThis);
