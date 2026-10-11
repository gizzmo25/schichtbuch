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

test("isPlanned: heute zaehlt als geleistet", () => {
  assert.equal(D.isPlanned(shift({ date: "2026-10-11" }), "2026-10-11"), false);
  assert.equal(D.isPlanned(shift({ date: "2026-10-12" }), "2026-10-11"), true);
});

test("aggregateMonth trennt geleistet und geplant", () => {
  const a = D.aggregateMonth([shift({}), shift({ date: "2026-10-20" }), shift({ date: "2026-11-01" })], "2026-10", "2026-10-11");
  assert.deepEqual(a, { hours: 16, gross: 432, workedHours: 8, workedGross: 216, plannedHours: 8, plannedGross: 216 });
});

test("forecastByMonth: nur Zukunft, sortiert", () => {
  const f = D.forecastByMonth([shift({ date: "2026-12-01" }), shift({ date: "2026-11-05" }), shift({ date: "2026-11-06" }), shift({})], "2026-10-11");
  assert.deepEqual(f, [{ month: "2026-11", hours: 16, gross: 432, count: 2 }, { month: "2026-12", hours: 8, gross: 216, count: 1 }]);
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
  assert.deepEqual(s, { currency: "EUR", defaultBreak: 30, shiftTypes: [{ label: "X", rate: 30 }] });
});

test("toCsv: Trennzeichen, Quoting, Formel-Schutz", () => {
  const csv = D.toCsv([shift({ note: '=SUM(A1);"x"' })], "CHF", "2026-10-11");
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[1], '2026-10-10;08:00;16:00;0;Basic;8.00;27.00;216.00;CHF;geleistet;"\'=SUM(A1);""x"""');
});
