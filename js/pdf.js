/*
 * Schichtbuch — PDF-Berichte (Lohnperiode, Jahresuebersicht) mit jsPDF + AutoTable.
 * Reine Aufbereitung: erhaelt Daten und Formatierer, liefert ein jsPDF-Dokument.
 * Laeuft im Browser (globalThis.Reports) und unter Node (Tests).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Reports = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const INK = [33, 37, 41];
  const MUTED = [110, 117, 128];
  const ACCENT = [245, 165, 36];
  const MARGIN = 14;

  /**
   * @typedef {Object} Fmt
   * @property {(n: number) => string} money
   * @property {(n: number) => string} hours
   * @property {(iso: string) => string} date    TT.MM.JJJJ
   * @property {(iso: string) => string} day     Wochentag, TT.MM.
   * @property {string} createdAt               Erstellungszeitpunkt, formatiert
   */

  function header(doc, title, subtitle, meta) {
    doc.setFillColor(...ACCENT);
    doc.rect(MARGIN, 12, 3, 13, "F");
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(title, MARGIN + 6, 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(subtitle, MARGIN + 6, 24);
    if (meta) doc.text(meta, doc.internal.pageSize.getWidth() - MARGIN, 18, { align: "right" });
    doc.setTextColor(...INK);
    return 32;
  }

  /** Kennzahlen als Zeile aus Kaesten. */
  function keyFigures(doc, y, items) {
    const w = (doc.internal.pageSize.getWidth() - 2 * MARGIN - (items.length - 1) * 4) / items.length;
    items.forEach(([label, value], i) => {
      const x = MARGIN + i * (w + 4);
      doc.setDrawColor(220, 223, 228);
      doc.roundedRect(x, y, w, 16, 2, 2, "S");
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(label.toUpperCase(), x + 3, y + 5.5);
      doc.setFontSize(11.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...INK);
      doc.text(value, x + 3, y + 12.5);
      doc.setFont("helvetica", "normal");
    });
    return y + 22;
  }

  function footer(doc, note, createdAt) {
    const n = doc.getNumberOfPages();
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(note + " · Erstellt " + createdAt, MARGIN, h - 8);
      doc.text("Seite " + i + " / " + n, w - MARGIN, h - 8, { align: "right" });
    }
  }

  const tableTheme = {
    theme: "plain",
    margin: { left: MARGIN, right: MARGIN, bottom: 16 },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 1.8, bottom: 1.8, left: 1.5, right: 1.5 }, textColor: INK, lineColor: [228, 231, 235], lineWidth: { bottom: 0.2 } },
    headStyles: { fontStyle: "bold", fontSize: 7.5, textColor: MUTED, lineWidth: { bottom: 0.4 }, lineColor: [180, 185, 192] },
    footStyles: { fontStyle: "bold", lineWidth: { top: 0.4 }, lineColor: [180, 185, 192] },
  };
  const right = (...cols) => Object.fromEntries(cols.map((c) => [c, { halign: "right" }]));

  /**
   * PDF einer Lohnperiode.
   * @param {Function} JsPDF jsPDF-Konstruktor mit AutoTable-Plugin
   * @param {{label: string, payLabel: string, summary: object, shifts: object[]}} data
   * @param {object} D Domain-Modul
   * @param {Fmt} fmt
   * @param {string} now Zeitstempel fuer den Status
   */
  function periodReport(JsPDF, data, D, fmt, now) {
    const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    let y = header(doc, "Schichtbuch · Lohnperiode", data.label, data.payLabel);
    const a = data.summary;
    y = keyFigures(doc, y, [
      ["Schichten", String(data.shifts.length)],
      ["Stunden", fmt.hours(a.hours)],
      ["Geleistet", fmt.money(a.workedGross)],
      ["Geplant", fmt.money(a.plannedGross)],
      ["Total", fmt.money(a.gross)],
    ]);
    const rows = [...data.shifts].sort((p, q) => (p.date + p.start).localeCompare(q.date + q.start));
    doc.autoTable({
      ...tableTheme,
      startY: y,
      head: [["Datum", "Zeit", "Pause", "Schichtart", "Stunden", "Satz", "Brutto", "Status", "Notiz"]],
      body: rows.map((s) => [
        fmt.day(s.date), s.start + "–" + s.end, s.breakMinutes ? s.breakMinutes + " Min." : "", s.type,
        fmt.hours(D.durationHours(s.start, s.end, s.breakMinutes)), fmt.money(s.rate), fmt.money(D.grossOf(s)),
        D.isPlanned(s, now) ? "geplant" : "geleistet", s.note,
      ]),
      foot: rows.length ? [["Total", "", "", "", fmt.hours(a.hours), "", fmt.money(a.gross), "", ""]] : undefined,
      columnStyles: { ...right(4, 5, 6), 0: { cellWidth: 24 }, 1: { cellWidth: 22 }, 2: { cellWidth: 15 }, 3: { cellWidth: 22 }, 4: { cellWidth: 19, halign: "right" },
        5: { cellWidth: 22, halign: "right" }, 6: { cellWidth: 25, halign: "right" }, 7: { cellWidth: 17 } },
      didParseCell: (c) => { if (c.section !== "body" && [4, 5, 6].includes(c.column.index)) c.cell.styles.halign = "right"; },
    });
    if (!rows.length) {
      doc.setFontSize(10);
      doc.setTextColor(...MUTED);
      doc.text("Keine Schichten in dieser Lohnperiode.", MARGIN, doc.lastAutoTable.finalY + 8);
    }
    footer(doc, "Bruttobeträge, berechnet aus den erfassten Zeiten", fmt.createdAt);
    return doc;
  }

  /**
   * PDF der Jahresuebersicht: alle Jahre, danach je Jahr die Lohnperioden.
   * @param {{basis: string, years: object[]}} overview Ergebnis von Domain.yearOverview
   * @param {(p: {start: string, end: string}) => string} periodLabel
   */
  function yearReport(JsPDF, overview, fmt, periodLabel) {
    const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const basisText = overview.basis === "pay" ? "Jahr nach Auszahldatum" : "Jahr nach Einsatzdatum";
    let y = header(doc, "Schichtbuch · Jahresübersicht", "Alle Jahre · " + basisText);
    const sum = (k) => overview.years.reduce((acc, r) => acc + r[k], 0);
    y = keyFigures(doc, y, [
      ["Verdient (geleistet)", fmt.money(sum("workedGross"))],
      ["Noch offen", fmt.money(sum("plannedGross"))],
      ["Stunden", fmt.hours(sum("hours"))],
      ["Schichten", String(sum("count"))],
    ]);
    const yearRow = (r) => [String(r.count), fmt.hours(r.hours), fmt.money(r.workedGross), fmt.money(r.plannedGross), fmt.money(r.workedGross + r.plannedGross)];
    doc.autoTable({
      ...tableTheme,
      startY: y,
      head: [["Jahr", "Schichten", "Stunden", "Geleistet", "Offen", "Total"]],
      body: overview.years.map((r) => [String(r.year), ...yearRow(r)]),
      foot: overview.years.length > 1 ? [["Alle Jahre", String(sum("count")), fmt.hours(sum("hours")), fmt.money(sum("workedGross")), fmt.money(sum("plannedGross")),
        fmt.money(sum("workedGross") + sum("plannedGross"))]] : undefined,
      columnStyles: right(1, 2, 3, 4, 5),
      didParseCell: (c) => { if (c.section !== "body" && c.column.index > 0) c.cell.styles.halign = "right"; },
    });
    for (const yr of overview.years) {
      let top = doc.lastAutoTable.finalY + 10;
      if (top > doc.internal.pageSize.getHeight() - 50) { doc.addPage(); top = 20; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(...INK);
      doc.text(String(yr.year), MARGIN, top);
      doc.setFont("helvetica", "normal");
      doc.autoTable({
        ...tableTheme,
        startY: top + 3,
        head: [["Lohnperiode", "Auszahlung", "Schichten", "Stunden", "Geleistet", "Offen", "Total"]],
        body: yr.periods.map((p) => [periodLabel(p), p.pay ? fmt.date(p.pay) : "", ...yearRow(p)]),
        foot: [["Total " + yr.year, "", ...yearRow(yr)]],
        columnStyles: right(2, 3, 4, 5, 6),
        didParseCell: (c) => { if (c.section !== "body" && c.column.index > 1) c.cell.styles.halign = "right"; },
      });
    }
    if (!overview.years.length) {
      doc.setFontSize(10);
      doc.setTextColor(...MUTED);
      doc.text("Noch keine Schichten erfasst.", MARGIN, doc.lastAutoTable.finalY + 8);
    }
    footer(doc, "Bruttobeträge, berechnet aus den erfassten Zeiten", fmt.createdAt);
    return doc;
  }

  return { periodReport, yearReport };
});
