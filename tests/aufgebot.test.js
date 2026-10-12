// Ausfuehren: node --test tests/aufgebot.test.js
// Fixture ist synthetisch (keine echten Personal- oder Einsatzdaten), Aufbau wie der kopierte Portaltext.
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../js/domain.js");
const A = require("../js/aufgebot.js");

const T = "\t";
const FIXTURE = [
  "Date: 01.11.2030   Time: 10:00:00" + T + "Eingeloggt als: 00000",
  "Datum" + T + "Auftrag" + T + "Auftragsort" + T + "Treffpunkt - Einsatzzeit" + T + "Diverses" + T + "Versand",
  "04.11.2030", "(Montag)" + T + "Test-Event A", "BASIC", "Teststrasse 1, 8000 Zürich", "RESERVE",
  "Treffpunkt: Eingang", "empfohlene Ankunftszeit: ", "Tenü:" + T, "Diverses:" + T + "05. Staf. |", "20.10.2030",
  "05.11.2030", "(Dienstag)" + T + "Test-Event B", "ServX; Steward | Aufsicht", "Teststrasse 2, 8000 Zürich", "16. STAFFELUNG",
  "von 18:00 bis ca 23:30", "Treffpunkt: Portierloge", "empfohlene Ankunftszeit: 17:45", "Tenü:" + T + "Polo", "Diverses:" + T + "x |", "21.10.2030",
  "06.11.2030", "(Mittwoch)" + T + "Test-Event C mit sehr", "langem Namen", "Basic AT", "Teststrasse 3, 8000 Zürich", "02. STAFFELUNG",
  "von 22:00 bis ca 06:00", "Treffpunkt: Tor", "empfohlene Ankunftszeit: 21:45", "Tenü:" + T, "22.10.2030",
  "07.11.2030", "(Donnerstag)" + T + "Test-Event D", "Spezial; Ordner", "Teststrasse 4, 8000 Zürich", "01. STAFFELUNG",
  "von 08:00 bis 12:00", "Tenü:" + T, "23.10.2030",
  "O = Offen   G = Geschlossen    S = Storniert",
].join("\r\n");

const types = D.defaultSettings().shiftTypes;

test("parse: Eintraege, Versanddaten werden nicht als Beginn gezaehlt", () => {
  const e = A.parse(FIXTURE, types);
  assert.equal(e.length, 4);
  assert.deepEqual(e.map((x) => x.date), ["2030-11-04", "2030-11-05", "2030-11-06", "2030-11-07"]);
});

test("parse: Felder eines bestaetigten Einsatzes", () => {
  const b = A.parse(FIXTURE, types)[1];
  assert.deepEqual(b, {
    date: "2030-11-05", order: "Test-Event B", roleLine: "ServX; Steward | Aufsicht", place: "Teststrasse 2, 8000 Zürich",
    reserve: false, start: "18:00", end: "23:30", staffel: "16", arrival: "17:45",
  });
});

test("parse: RESERVE, umbrochener Auftrag, Zeit ohne 'ca'", () => {
  const [a, , c, d] = A.parse(FIXTURE, types);
  assert.equal(a.reserve, true);
  assert.equal(a.start, null);
  assert.equal(c.order, "Test-Event C mit sehr langem Namen");
  assert.equal(c.roleLine, "Basic AT");
  assert.equal(d.start + "-" + d.end, "08:00-12:00");
});

test("matchType: erstes Segment, ohne Gross-/Kleinschreibung, Basic vs. Basic AT", () => {
  assert.equal(A.matchType("BASIC", types).label, "Basic");
  assert.equal(A.matchType("Basic AT", types).label, "Basic AT");
  assert.equal(A.matchType("ServX; Steward | Aufsicht AGH", types).rate, 26);
  assert.equal(A.matchType("Spezial; Ordner", types), null);
});

test("plan: Status neu / vorhanden / Reserve / unbekannte Schichtart", () => {
  const settings = D.defaultSettings();
  const existing = [{ date: "2030-11-05", start: "17:45", end: "23:00" }]; // ueberschneidet sich mit B
  const p = A.plan(A.parse(FIXTURE, types), existing, settings, D.overlaps);
  assert.deepEqual(p.map((x) => x.status), ["reserve", "existing", "new", "notype"]);
  const c = p[2].shift;
  assert.equal(c.type, "Basic AT");
  assert.equal(c.rate, 28);
  assert.equal(D.grossOf({ ...c }), 224); // 22:00-06:00 = 8 h x 28
  assert.equal(c.note, "Test-Event C mit sehr langem Namen | Teststrasse 3, 8000 Zürich | 02. Staffelung, Ankunft 21:45");
  assert.equal(D.normalizeShift({ ...c, id: "x" }) !== null, true);
});

test("plan: wiederholter Import erkennt alles als vorhanden", () => {
  const settings = D.defaultSettings();
  const first = A.plan(A.parse(FIXTURE, types), [], settings, D.overlaps).filter((x) => x.status === "new").map((x) => x.shift);
  const second = A.plan(A.parse(FIXTURE, types), first, settings, D.overlaps);
  assert.equal(second.filter((x) => x.status === "new").length, 0);
});

test("overlaps: gleicher Tag, Beruehrung ist keine Ueberschneidung, Mitternacht", () => {
  const s = (date, start, end) => ({ date, start, end });
  assert.equal(D.overlaps(s("2030-01-01", "08:00", "12:00"), s("2030-01-01", "11:00", "13:00")), true);
  assert.equal(D.overlaps(s("2030-01-01", "08:00", "12:00"), s("2030-01-01", "12:00", "13:00")), false);
  assert.equal(D.overlaps(s("2030-01-01", "22:00", "06:00"), s("2030-01-01", "23:00", "23:30")), true);
  assert.equal(D.overlaps(s("2030-01-01", "08:00", "12:00"), s("2030-01-02", "08:00", "12:00")), false);
});
