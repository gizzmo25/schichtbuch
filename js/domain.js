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
  /** @typedef {{defaultBreak: number, currency: string, shiftTypes: ShiftType[], periodStartDay: number, payDay: number}} Settings
   *  periodStartDay: Tag, an dem die Lohnperiode beginnt (1 = Kalendermonat, max. 28)
   *  payDay:         Auszahltag (1-28); 0 = keine Anzeige */

  const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const RE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const MAX_NOTE = 500;

  /** @returns {Settings} */
  function defaultSettings() {
    return {
      defaultBreak: 0,
      currency: "CHF",
      periodStartDay: 1,
      payDay: 10,
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

  /** Kalendertage zu einem ISO-Datum addieren (UTC-Arithmetik, keine Zeitzonen-Spruenge). */
  function addDays(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.toISOString().slice(0, 10);
  }

  /** Lokaler Zeitstempel "YYYY-MM-DDTHH:MM", lexikografisch vergleichbar. */
  function nowStamp(now) {
    const d = now || new Date();
    return todayISO(d) + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  /** Ende des Dienstes als Zeitstempel; Ende <= Beginn liegt am Folgetag. */
  function endStamp(s) {
    const nextDay = toMinutes(s.end) <= toMinutes(s.start);
    return (nextDay ? addDays(s.date, 1) : s.date) + "T" + s.end;
  }

  /**
   * Geplant = Dienst noch nicht vorbei. Geleistet erst, wenn das Dienstende erreicht ist.
   * @param {Shift} s @param {string} now Zeitstempel aus nowStamp()
   */
  function isPlanned(s, now) {
    return endStamp(s) > now;
  }

  const monthKey = (iso) => iso.slice(0, 7);

  /**
   * Lohnperiode, in die ein Datum faellt.
   * Beginn am Tag startDay; liegt das Datum davor, gehoert es zur Periode des Vormonats.
   * startDay 1 entspricht dem Kalendermonat.
   * @returns {{start: string, end: string}} ISO-Daten, beide inklusive
   */
  function periodOf(iso, startDay) {
    const sd = Math.min(Math.max(Math.trunc(startDay) || 1, 1), 28);
    let [y, m, d] = iso.split("-").map(Number);
    if (d < sd) { m -= 1; if (m < 1) { m = 12; y -= 1; } }
    const start = y + "-" + String(m).padStart(2, "0") + "-" + String(sd).padStart(2, "0");
    return { start, end: addDays(shiftPeriodStart(start, 1), -1) };
  }

  /** Beginn der Periode n Perioden vor (n<0) bzw. nach (n>0) der gegebenen. */
  function shiftPeriodStart(start, n) {
    const [y, m, d] = start.split("-").map(Number);
    const t = y * 12 + (m - 1) + n;
    return Math.floor(t / 12) + "-" + String((t % 12) + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }

  /** Auszahlung: erster Auszahltag nach dem Periodenende. null, wenn payDay 0. */
  function payDateOf(period, payDay) {
    if (!payDay) return null;
    const [y, m] = period.end.split("-").map(Number);
    const same = y + "-" + String(m).padStart(2, "0") + "-" + String(payDay).padStart(2, "0");
    return same > period.end ? same : shiftPeriodStart(same, 1);
  }

  const inPeriod = (s, p) => s.date >= p.start && s.date <= p.end;

  /** Kennzahlen einer Lohnperiode, getrennt nach geleistet/geplant. */
  function aggregatePeriod(shifts, period, now) {
    const acc = { hours: 0, gross: 0, workedHours: 0, workedGross: 0, plannedHours: 0, plannedGross: 0 };
    for (const s of shifts) {
      if (!inPeriod(s, period)) continue;
      const h = durationHours(s.start, s.end, s.breakMinutes);
      const g = grossOf(s);
      acc.hours += h;
      acc.gross += g;
      if (isPlanned(s, now)) { acc.plannedHours += h; acc.plannedGross += g; }
      else { acc.workedHours += h; acc.workedGross += g; }
    }
    for (const k of Object.keys(acc)) acc[k] = round2(acc[k]);
    return acc;
  }

  /**
   * Erwarteter Verdienst je Lohnperiode, aufsteigend sortiert.
   * Enthaelt alle noch nicht geleisteten Schichten; ausgewiesen wird zusaetzlich,
   * was in derselben Periode bereits geleistet wurde (Erwartung fuer die Auszahlung).
   */
  function forecastByPeriod(shifts, now, startDay) {
    const map = new Map();
    for (const s of shifts) {
      if (!isPlanned(s, now)) continue;
      const p = periodOf(s.date, startDay);
      const row = map.get(p.start) || { start: p.start, end: p.end, hours: 0, gross: 0, count: 0, workedGross: 0 };
      row.hours += durationHours(s.start, s.end, s.breakMinutes);
      row.gross += grossOf(s);
      row.count += 1;
      map.set(p.start, row);
    }
    for (const s of shifts) {
      if (isPlanned(s, now)) continue;
      const row = map.get(periodOf(s.date, startDay).start);
      if (row) row.workedGross += grossOf(s);
    }
    return [...map.values()]
      .map((r) => ({ ...r, hours: round2(r.hours), gross: round2(r.gross), workedGross: round2(r.workedGross) }))
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  /** Schichten einer Lohnperiode, neueste zuerst. */
  function shiftsOfPeriod(shifts, period) {
    return shifts
      .filter((s) => inPeriod(s, period))
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

  /** Zeitfenster in Minuten ab Mitternacht des Schichtdatums; Ende nach Mitternacht -> +24 h. */
  function intervalOf(s) {
    const a = toMinutes(s.start);
    let b = toMinutes(s.end);
    if (b <= a) b += 1440;
    return [a, b];
  }

  /** Zwei Schichten am selben Datum, deren Zeitfenster sich ueberschneiden. */
  function overlaps(a, b) {
    if (a.date !== b.date) return false;
    const [a1, a2] = intervalOf(a);
    const [b1, b2] = intervalOf(b);
    return a1 < b2 && b1 < a2;
  }

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
    const dayIn = (v, min, fallback) => {
      const n = Math.trunc(Number(v));
      return Number.isFinite(n) && n >= min && n <= 28 ? n : fallback;
    };
    return {
      defaultBreak: Number.isFinite(brk) && brk >= 0 ? brk : d.defaultBreak,
      currency: raw.currency === "EUR" ? "EUR" : "CHF",
      shiftTypes: types && types.length ? types : d.shiftTypes,
      periodStartDay: dayIn(raw.periodStartDay, 1, d.periodStartDay),
      payDay: raw.payDay === undefined ? d.payDay : dayIn(raw.payDay, 0, d.payDay),
    };
  }

  /** CSV fuer Excel (Semikolon-getrennt). Felder werden gegen Formel-Injection entschaerft. */
  function toCsv(shifts, currency, now) {
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
        currency, isPlanned(s, now) ? "geplant" : "geleistet", s.note,
      ].map(cell).join(";"));
    return [head.join(";"), ...rows].join("\r\n") + "\r\n";
  }

  return {
    defaultSettings, toMinutes, todayISO, nowStamp, endStamp, addDays, isValidDate, durationHours, grossOf, isPlanned, monthKey,
    periodOf, shiftPeriodStart, payDateOf, aggregatePeriod, forecastByPeriod, shiftsOfPeriod,
    validateInput, normalizeShift, normalizeSettings,
    isUuid, naturalKey, overlaps, toCsv,
  };
});
