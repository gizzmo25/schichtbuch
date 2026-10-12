/*
 * Schichtbuch — Parser fuer das Aufgebot aus dem DELTA-Mitarbeiterportal.
 * Eingabe: der per "Alles markieren + Kopieren" uebernommene Text der Seite "Aufgebote".
 * Reine Funktionen, ohne DOM; laeuft im Browser (globalThis.Aufgebot) und unter Node.
 *
 * Aufbau eines Eintrags im kopierten Text:
 *   15.10.2026
 *   (Donnerstag)<TAB>TH Konzert-Event - Jay Park      <- Auftrag
 *   ServX; Steward                                    <- Schichtart; Rolle
 *   Hoffnigstrasse 1, 8600 Duebendorf                 <- Auftragsort
 *   16. STAFFELUNG   bzw.   RESERVE
 *   von 18:00 bis ca 23:30
 *   Treffpunkt: ... / empfohlene Ankunftszeit: 17:45
 *   Tenue: ... Diverses: ...
 *   01.10.2026                                        <- Versanddatum (kein Eintragsbeginn)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Aufgebot = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const RE_DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
  const RE_WEEKDAY = /^\s*\([^)]*\)\s*/;
  const RE_TIME = /von\s+(\d{1,2}):(\d{2})\s+bis\s+(?:ca\.?\s*)?(\d{1,2}):(\d{2})/i;
  const RE_STAFFEL = /(\d+)\.\s*STAFFELUNG/i;
  const RE_ARRIVAL = /Ankunftszeit:\s*(\d{1,2}):(\d{2})/i;
  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = (h, m) => pad(Number(h)) + ":" + pad(Number(m));

  /**
   * Schichtart aus der Rollenzeile ("ServX; Steward | Aufsicht AGH", "BASIC").
   * Massgebend ist das erste Segment, verglichen ohne Gross-/Kleinschreibung.
   * @param {string} roleLine @param {{label: string, rate: number}[]} types
   */
  function matchType(roleLine, types) {
    const head = String(roleLine).split(/[;|]/)[0].trim().toLowerCase();
    return (types || []).find((t) => t.label.trim().toLowerCase() === head) || null;
  }

  /**
   * @typedef {Object} AufgebotEntry
   * @property {string} date       YYYY-MM-DD
   * @property {string} order      Auftrag
   * @property {string} roleLine   z. B. "ServX; Steward | Aufsicht AGH"
   * @property {string} place      Auftragsort
   * @property {boolean} reserve
   * @property {string|null} start HH:MM
   * @property {string|null} end   HH:MM
   * @property {string|null} staffel
   * @property {string|null} arrival HH:MM
   */

  /** @returns {AufgebotEntry} */
  function parseBlock(block, types) {
    const [, d, m, y] = block[0].trim().match(RE_DATE);
    const firstOrder = block[1].replace(RE_WEEKDAY, "").trim();
    const stop = block.findIndex((l) => /^\s*Ten(ü|ue):/i.test(l));
    const body = block.slice(2, stop < 0 ? block.length : stop).map((l) => l.trim()).filter(Boolean);

    // Rollenzeile = erste Zeile mit bekannter Schichtart; Zeilen davor gehoeren zum Auftrag
    // (falls der Auftrag beim Kopieren umbricht). Ohne Treffer: erste Zeile.
    let ri = body.findIndex((l) => matchType(l, types));
    if (ri < 0) ri = 0;
    const order = [firstOrder, ...body.slice(0, ri)].filter(Boolean).join(" ");
    const roleLine = body[ri] || "";
    const place = body[ri + 1] || "";
    const rest = body.slice(ri + 2).join("\n");
    const t = rest.match(RE_TIME);
    const st = rest.match(RE_STAFFEL);
    const ar = rest.match(RE_ARRIVAL);
    return {
      date: y + "-" + m + "-" + d,
      order, roleLine, place,
      reserve: body.slice(ri + 2).some((l) => /^RESERVE$/i.test(l)),
      start: t ? hhmm(t[1], t[2]) : null,
      end: t ? hhmm(t[3], t[4]) : null,
      staffel: st ? st[1] : null,
      arrival: ar ? hhmm(ar[1], ar[2]) : null,
    };
  }

  /**
   * Zerlegt den kopierten Seitentext in Eintraege.
   * Ein Eintrag beginnt mit einer Datumszeile, auf die "(Wochentag)" folgt;
   * Datumszeilen ohne Wochentag danach sind Versanddaten.
   * @returns {AufgebotEntry[]}
   */
  function parse(text, types) {
    const lines = String(text || "").replace(/\r/g, "").replace(/ /g, " ").split("\n");
    const starts = [];
    for (let i = 0; i < lines.length - 1; i++) {
      if (RE_DATE.test(lines[i].trim()) && RE_WEEKDAY.test(lines[i + 1]) && lines[i + 1].includes(")")) starts.push(i);
    }
    return starts.map((s, k) => parseBlock(lines.slice(s, k + 1 < starts.length ? starts[k + 1] : lines.length), types));
  }

  /** Notiz fuer die Schicht: Auftrag | Rolle | Ort | Staffelung, Ankunft */
  function noteOf(e) {
    const role = e.roleLine.split(";").slice(1).join(";").trim();
    const staff = [e.staffel ? pad(e.staffel) + ". Staffelung" : "", e.arrival ? "Ankunft " + e.arrival : ""].filter(Boolean).join(", ");
    return [e.order, role, e.place, staff].filter(Boolean).join(" | ").slice(0, 500);
  }

  /**
   * Abgleich mit den vorhandenen Schichten.
   * status: "new" | "existing" (Ueberschneidung am selben Tag) | "reserve" | "notime"
   * @param {AufgebotEntry[]} entries
   * @param {object[]} existing vorhandene Shifts
   * @param {{defaultBreak: number, shiftTypes: {label: string, rate: number}[]}} settings
   * @param {(s: object, t: object) => boolean} overlaps
   */
  function plan(entries, existing, settings, overlaps) {
    const taken = [...existing];
    return entries.map((e) => {
      if (e.reserve) return { entry: e, status: "reserve", shift: null, match: null };
      if (!e.start || !e.end) return { entry: e, status: "notime", shift: null, match: null };
      const type = matchType(e.roleLine, settings.shiftTypes);
      const shift = {
        date: e.date, start: e.start, end: e.end,
        breakMinutes: settings.defaultBreak || 0,
        rate: type ? type.rate : NaN,
        type: type ? type.label : "",
        note: noteOf(e),
      };
      const match = taken.find((s) => overlaps(s, shift)) || null;
      if (match) return { entry: e, status: "existing", shift, match };
      taken.push(shift); // Doppelte Eintraege innerhalb desselben Textes abfangen
      return { entry: e, status: type ? "new" : "notype", shift, match: null };
    });
  }

  return { parse, plan, matchType, noteOf };
});
