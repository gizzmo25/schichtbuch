// Ausfuehren: node --test tests/domain.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../js/domain.js");

const shift = (o) => ({ id: "11111111-1111-4111-8111-111111111111", date: "2026-10-10", start: "08:00", end: "16:00", breakMinutes: 0, rate: 27, type: "Basic", note: "", ...o });

test("durationHours: Tagschicht, Pause, Mitternacht", () => {
  assert.equal(D.durationHours("08:00", "16:30", 30), 8);
  assert.equal(D.durationHours("22:00", "06:00", 0), 8);
  assert.equal(D.durationHours("18:00", "18:00", 0), 24);
  assert.equal(D.durationHours("08:00", "09:00", 120), 0);
});

test("grossOf rundet auf Rappen", () => {
  assert.equal(D.grossOf(shift({ end: "16:20", rate: 26 })), 216.67);
  assert.equal(D.grossOf(shift({ start: "22:00", end: "06:00", rate: 28 })), 224);
});

test("isPlanned: geleistet erst ab Dienstende, auch ueber Mitternacht", () => {
  const day = shift({ date: "2026-10-11", start: "18:00", end: "23:30" });
  assert.equal(D.isPlanned(day, "2026-10-11T12:00"), true);  // vor Beginn
  assert.equal(D.isPlanned(day, "2026-10-11T20:00"), true);  // laeuft noch
  assert.equal(D.isPlanned(day, "2026-10-11T23:30"), false); // vorbei
  const night = shift({ date: "2026-10-11", start: "22:00", end: "06:00" });
  assert.equal(D.endStamp(night), "2026-10-12T06:00");
  assert.equal(D.isPlanned(night, "2026-10-12T05:59"), true);
  assert.equal(D.isPlanned(night, "2026-10-12T06:00"), false);
  assert.equal(D.endStamp(shift({ date: "2026-12-31", start: "22:00", end: "02:00" })), "2027-01-01T02:00");
});

test("nowStamp: lokales Datum und Uhrzeit", () => {
  assert.equal(D.nowStamp(new Date(2026, 0, 5, 7, 3)), "2026-01-05T07:03");
});

test("periodOf: Kalendermonat und versetzte Periode inkl. Jahreswechsel", () => {
  assert.deepEqual(D.periodOf("2026-02-14", 1), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(D.periodOf("2026-11-10", 11), { start: "2026-10-11", end: "2026-11-10" });
  assert.deepEqual(D.periodOf("2026-11-11", 11), { start: "2026-11-11", end: "2026-12-10" });
  assert.deepEqual(D.periodOf("2026-01-05", 11), { start: "2025-12-11", end: "2026-01-10" });
  assert.equal(D.shiftPeriodStart("2026-12-11", 1), "2027-01-11");
  assert.equal(D.shiftPeriodStart("2026-01-11", -1), "2025-12-11");
});

test("payDateOf: erster Auszahltag nach Periodenende", () => {
  assert.equal(D.payDateOf({ start: "2026-11-01", end: "2026-11-30" }, 10), "2026-12-10");
  assert.equal(D.payDateOf({ start: "2026-12-01", end: "2026-12-31" }, 10), "2027-01-10");
  assert.equal(D.payDateOf({ start: "2026-10-11", end: "2026-11-10" }, 10), "2026-12-10");
  assert.equal(D.payDateOf({ start: "2026-10-10", end: "2026-11-09" }, 10), "2026-11-10");
  assert.equal(D.payDateOf({ start: "2026-11-01", end: "2026-11-30" }, 0), null);
});

test("aggregatePeriod trennt geleistet und geplant nach Uhrzeit", () => {
  const p = D.periodOf("2026-10-11", 1);
  const a = D.aggregatePeriod([shift({ date: "2026-10-11" }), shift({ date: "2026-10-20" }), shift({ date: "2026-11-01" })], p, "2026-10-11T16:00");
  assert.deepEqual(a, { hours: 16, gross: 432, workedHours: 8, workedGross: 216, plannedHours: 8, plannedGross: 216 });
  const b = D.aggregatePeriod([shift({ date: "2026-10-11" })], p, "2026-10-11T15:59");
  assert.equal(b.plannedGross, 216); // Dienst laeuft noch -> geplant
});

test("forecastByPeriod: offene Schichten je Lohnperiode, mit bereits Geleistetem", () => {
  const shifts = [shift({ date: "2026-10-05" }), shift({ date: "2026-10-12" }), shift({ date: "2026-11-05" }), shift({ date: "2026-11-12" })];
  const f = D.forecastByPeriod(shifts, "2026-10-08T00:00", 11);
  // 05.10. ist am 08.10. bereits geleistet und faellt weg; 12.10.+05.11. bilden die Periode 11.10.-10.11.
  assert.deepEqual(f, [
    { start: "2026-10-11", end: "2026-11-10", hours: 16, gross: 432, count: 2, workedGross: 0 },
    { start: "2026-11-11", end: "2026-12-10", hours: 8, gross: 216, count: 1, workedGross: 0 },
  ]);
  const g = D.forecastByPeriod(shifts, "2026-10-20T00:00", 11);
  assert.deepEqual(g[0], { start: "2026-10-11", end: "2026-11-10", hours: 8, gross: 216, count: 1, workedGross: 216 });
});

test("validateInput", () => {
  assert.equal(D.validateInput(shift({})).ok, true);
  assert.equal(D.validateInput(shift({ date: "2026-02-30" })).ok, false);
  assert.equal(D.validateInput(shift({ end: "" })).ok, false);
  assert.equal(D.validateInput(shift({ rate: NaN })).ok, false);
  assert.equal(D.validateInput(shift({ breakMinutes: 480 })).ok, false);
  assert.equal(D.validateInput(shift({ breakMinutes: 1.5 })).ok, false);
});

test("normalizeShift: Altformat v1 und DB-Zeitformat", () => {
  const s = D.normalizeShift({ id: "abc", date: "2026-05-01", start: "22:00:00", end: "06:00:00", breakMinutes: "30", rate: "27.00", typeLabel: "Basic" });
  assert.deepEqual(s, { id: "abc", date: "2026-05-01", start: "22:00", end: "06:00", breakMinutes: 30, rate: 27, type: "Basic", note: "" });
  assert.equal(D.normalizeShift({ date: "kaputt" }), null);
  assert.equal(D.normalizeShift(null), null);
});

test("normalizeSettings faellt auf Standardwerte zurueck", () => {
  assert.deepEqual(D.normalizeSettings(null), D.defaultSettings());
  const s = D.normalizeSettings({ currency: "EUR", defaultBreak: 30, shiftTypes: [{ label: "X", rate: 30 }, { label: "", rate: 1 }] });
  assert.deepEqual(s, { currency: "EUR", defaultBreak: 30, shiftTypes: [{ label: "X", rate: 30 }], periodStartDay: 1, payDay: 10 });
  const t = D.normalizeSettings({ periodStartDay: 11, payDay: 0 });
  assert.equal(t.periodStartDay, 11);
  assert.equal(t.payDay, 0);
  assert.equal(D.normalizeSettings({ periodStartDay: 31, payDay: 30 }).periodStartDay, 1);
  assert.equal(D.normalizeSettings({ periodStartDay: 31, payDay: 30 }).payDay, 10);
});

test("toCsv: Trennzeichen, Quoting, Formel-Schutz", () => {
  const csv = D.toCsv([shift({ note: '=SUM(A1);"x"' })], "CHF", "2026-10-11T00:00");
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[1], '2026-10-10;08:00;16:00;0;Basic;8.00;27.00;216.00;CHF;geleistet;"\'=SUM(A1);""x"""');
});
