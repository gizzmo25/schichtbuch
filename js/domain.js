/*
 * Schichtbuch — Domaene: reine, seiteneffektfreie Funktionen.
 * Laeuft im Browser (globalThis.Domain) und unter Node (module.exports) fuer Tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Domain = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  /** @typedef {Object} Shift
   *  @property {string} id            UUID
   *  @property {string} date          ISO-Datum YYYY-MM-DD
   *  @property {string} start         HH:MM
   *  @property {string} end           HH:MM
   *  @property {number} breakMinutes  Pause in Minuten (>= 0)
   *  @property {number} rate          Stundensatz (>= 0)
   *  @property {string} type          Schichtart-Label (leer = keine)
   *  @property {string} note          Freitext
   */
  /** @typedef {{label: string, rate: number}} ShiftType */
  /** @typedef {{defaultBreak: number, currency: string, shiftTypes: ShiftType[]}} Settings */

  const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const RE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const MAX_NOTE = 500;

  /** @returns {Settings} */
  function defaultSettings() {
    return {
      defaultBreak: 0,
      currency: "CHF",
      shiftTypes: [
        { label: "ServX", rate: 26 },
        { label: "Basic", rate: 27 },
        { label: "Basic AT", rate: 28 },
      ],
    };
  }

  /** @param {string} hhmm @returns {number} Minuten seit Mitternacht */
  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  /** Lokales Datum als YYYY-MM-DD (nicht UTC, sonst kippt der Tag um Mitternacht). */
  function todayISO(now) {
    const d = now || new Date();
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function isValidDate(iso) {
    if (!RE_DATE.test(iso)) return false;
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  /**
   * Netto-Arbeitszeit in Stunden. Ende <= Beginn gilt als Schicht ueber Mitternacht.
   * @returns {number} nie negativ
   */
  function durationHours(start, end, breakMinutes) {
    let span = toMinutes(end) - toMinutes(start);
    if (span <= 0) span += 24 * 60;
    return Math.max(0, span - (breakMinutes || 0)) / 60;
  }

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  /** @param {Shift} s @returns {number} Bruttobetrag, auf Rappen gerundet */
  function grossOf(s) {
    return round2(durationHours(s.start, s.end, s.breakMinutes) * s.rate);
  }

  /** Geplant = Datum strikt nach heute. Eine Schicht heute zaehlt als geleistet. */
  function isPlanned(s, today) {
    return s.date > today;
  }

  const monthKey = (iso) => iso.slice(0, 7);

  /** Kennzahlen eines Monats (YYYY-MM), getrennt nach geleistet/geplant. */
  function aggregateMonth(shifts, month, today) {
    const acc = { hours: 0, gross: 0, workedHours: 0, workedGross: 0, plannedHours: 0, plannedGross: 0 };
    for (const s of shifts) {
      if (monthKey(s.date) !== month) continue;
      const h = durationHours(s.start, s.end, s.breakMinutes);
      const g = grossOf(s);
      acc.hours += h;
      acc.gross += g;
      if (isPlanned(s, today)) { acc.plannedHours += h; acc.plannedGross += g; }
      else { acc.workedHours += h; acc.workedGross += g; }
    }
    for (const k of Object.keys(acc)) acc[k] = round2(acc[k]);
    return acc;
  }

  /** Erwarteter Verdienst aus zukuenftigen Schichten je Monat, aufsteigend sortiert. */
  function forecastByMonth(shifts, today) {
    const map = new Map();
    for (const s of shifts) {
      if (!isPlanned(s, today)) continue;
      const k = monthKey(s.date);
      const row = map.get(k) || { month: k, hours: 0, gross: 0, count: 0 };
      row.hours += durationHours(s.start, s.end, s.breakMinutes);
      row.gross += grossOf(s);
      row.count += 1;
      map.set(k, row);
    }
    return [...map.values()]
      .map((r) => ({ ...r, hours: round2(r.hours), gross: round2(r.gross) }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  /** Schichten eines Monats, neueste zuerst. */
  function shiftsOfMonth(shifts, month) {
    return shifts
      .filter((s) => monthKey(s.date) === month)
      .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
  }

  /** @returns {{ok: true} | {ok: false, msg: string}} */
  function validateInput(f) {
    if (!isValidDate(f.date || "")) return { ok: false, msg: "Bitte ein gültiges Datum wählen." };
    if (!RE_TIME.test(f.start || "")) return { ok: false, msg: "Bitte eine Beginnzeit angeben." };
    if (!RE_TIME.test(f.end || "")) return { ok: false, msg: "Bitte eine Endzeit angeben." };
    if (!Number.isInteger(f.breakMinutes) || f.breakMinutes < 0) return { ok: false, msg: "Die Pause muss 0 oder mehr Minuten betragen." };
    if (!Number.isFinite(f.rate) || f.rate < 0) return { ok: false, msg: "Der Stundensatz muss 0 oder höher sein." };
    if (f.rate > 100000) return { ok: false, msg: "Der Stundensatz ist unplausibel hoch." };
    let span = toMinutes(f.end) - toMinutes(f.start);
    if (span <= 0) span += 1440;
    if (f.breakMinutes >= span) return { ok: false, msg: "Die Pause ist länger als die Schicht." };
    if ((f.note || "").length > MAX_NOTE) return { ok: false, msg: "Die Notiz ist zu lang (max. " + MAX_NOTE + " Zeichen)." };
    return { ok: true };
  }

  /**
   * Defensives Einlesen eines Datensatzes (Cache, Backup, Altformat v1).
   * @returns {Shift|null} null, wenn der Datensatz unbrauchbar ist
   */
  function normalizeShift(raw) {
    if (!raw || typeof raw !== "object") return null;
    const s = {
      id: typeof raw.id === "string" ? raw.id.toLowerCase() : "",
      date: String(raw.date || ""),
      start: String(raw.start || "").slice(0, 5),
      end: String(raw.end || "").slice(0, 5),
      breakMinutes: Math.trunc(Number(raw.breakMinutes) || 0),
      rate: Number(raw.rate),
      type: String(raw.type ?? raw.shiftType ?? raw.typeLabel ?? "").slice(0, 60),
      note: String(raw.note || "").slice(0, MAX_NOTE),
    };
    if (!validateInput(s).ok) return null;
    return s;
  }

  const isUuid = (v) => typeof v === "string" && RE_UUID.test(v);

  /** Fachlicher Schluessel zur Duplikaterkennung beim Import. */
  const naturalKey = (s) => s.date + "|" + s.start + "|" + s.end;

  /** @param {unknown} raw @returns {Settings} */
  function normalizeSettings(raw) {
    const d = defaultSettings();
    if (!raw || typeof raw !== "object") return d;
    const types = Array.isArray(raw.shiftTypes)
      ? raw.shiftTypes
          .map((t) => ({ label: String((t && t.label) || "").trim().slice(0, 60), rate: Number(t && t.rate) }))
          .filter((t) => t.label && Number.isFinite(t.rate) && t.rate >= 0)
      : null;
    const brk = Math.trunc(Number(raw.defaultBreak));
    return {
      defaultBreak: Number.isFinite(brk) && brk >= 0 ? brk : d.defaultBreak,
      currency: raw.currency === "EUR" ? "EUR" : "CHF",
      shiftTypes: types && types.length ? types : d.shiftTypes,
    };
  }

  /** CSV fuer Excel (Semikolon-getrennt). Felder werden gegen Formel-Injection entschaerft. */
  function toCsv(shifts, currency, today) {
    const cell = (v) => {
      let t = String(v);
      if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t)) t = "'" + t;
      return /[";\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const num = (n) => n.toFixed(2);
    const head = ["Datum", "Beginn", "Ende", "Pause_Min", "Schichtart", "Stunden", "Stundensatz", "Brutto", "Waehrung", "Status", "Notiz"];
    const rows = [...shifts]
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
      .map((s) => [
        s.date, s.start, s.end, s.breakMinutes, s.type,
        num(durationHours(s.start, s.end, s.breakMinutes)), num(s.rate), num(grossOf(s)),
        currency, isPlanned(s, today) ? "geplant" : "geleistet", s.note,
      ].map(cell).join(";"));
    return [head.join(";"), ...rows].join("\r\n") + "\r\n";
  }

  return {
    defaultSettings, toMinutes, todayISO, isValidDate, durationHours, grossOf, isPlanned, monthKey,
    aggregateMonth, forecastByMonth, shiftsOfMonth, validateInput, normalizeShift, normalizeSettings,
    isUuid, naturalKey, toCsv,
  };
});
