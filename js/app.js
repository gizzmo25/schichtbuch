/*
 * Schichtbuch — View: Rendering, Event-Wiring, Login und Sync-Steuerung.
 * Fachlogik liegt in domain.js, Persistenz/Sync in repository.js.
 */
(function () {
  "use strict";
  const D = globalThis.Domain;
  const log = {
    info: (...a) => console.info("[schichtbuch]", ...a),
    warn: (...a) => console.warn("[schichtbuch]", ...a),
    error: (...a) => console.error("[schichtbuch]", ...a),
  };
  const $ = (id) => document.getElementById(id);
  const LEGACY_KEY = "schichtbuch.v1";
  const LEGACY_DONE = "schichtbuch.v1.migrated";

  /* ---------- Infrastruktur ---------- */
  function safeStorage() {
    try {
      const k = "__sb_probe";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return localStorage;
    } catch (e) {
      log.warn("localStorage nicht verfügbar, arbeite ohne Offline-Cache", e);
      return null;
    }
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const storage = safeStorage();
  const repo = globalThis.Repository.createRepository({ storage, logger: console, uuid });
  let client = null;
  let user = null;
  let editingId = null;
  let syncError = null;
  const cursor = new Date();
  cursor.setDate(1);

  /* ---------- Formatierung ---------- */
  const money = (n) => new Intl.NumberFormat("de-CH", { style: "currency", currency: repo.settings.currency }).format(n);
  const hours = (n) => new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " h";
  const monthName = (ym) => new Date(ym + "-01T12:00:00").toLocaleDateString("de-CH", { month: "long", year: "numeric" });
  const dayLabel = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" });
  const cursorMonth = () => cursor.getFullYear() + "-" + String(cursor.getMonth() + 1).padStart(2, "0");

  let toastTimer = null;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
  }

  /* ---------- Screens ---------- */
  function showScreen(name) {
    for (const s of ["setup", "login", "app"]) $("screen-" + s).hidden = s !== name;
    $("tabs").hidden = name !== "app";
  }
  function showView(name) {
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
    document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    window.scrollTo(0, 0);
  }

  /* ---------- Rendering ---------- */
  function renderSyncState() {
    const el = $("syncState");
    const n = repo.pendingCount;
    el.className = "pill";
    if (!navigator.onLine) { el.textContent = n ? "offline · " + n + " offen" : "offline"; el.classList.add("wait"); }
    else if (syncError) { el.textContent = "Sync-Fehler · tippen"; el.classList.add("err"); }
    else if (n) { el.textContent = n + " offen"; el.classList.add("wait"); }
    else { el.textContent = "synchron"; el.classList.add("ok"); }
  }

  function renderLog() {
    const month = cursorMonth();
    const today = D.todayISO();
    const a = D.aggregateMonth(repo.shifts, month, today);
    $("monthLabel").textContent = monthName(month);
    $("mHours").textContent = hours(a.hours);
    $("mGross").textContent = money(a.gross);
    $("mWorked").textContent = money(a.workedGross);
    $("mPlanned").textContent = money(a.plannedGross);
    const rows = D.shiftsOfMonth(repo.shifts, month);
    $("logList").innerHTML = rows.length
      ? rows.map((s) => {
          const h = D.durationHours(s.start, s.end, s.breakMinutes);
          const meta = [s.start + "–" + s.end, s.type, s.breakMinutes ? s.breakMinutes + " Min. Pause" : "", s.note].filter(Boolean).map(esc).join(" · ");
          return '<button type="button" class="row" data-id="' + esc(s.id) + '">' +
            '<span class="bar-s' + (D.isPlanned(s, today) ? " planned" : "") + '"></span>' +
            '<span class="when"><div class="date">' + esc(dayLabel(s.date)) + '</div><div class="meta">' + meta + "</div></span>" +
            '<span class="amt"><div class="gross">' + esc(money(D.grossOf(s))) + '</div><div class="hrs">' + esc(hours(h)) + "</div></span></button>";
        }).join("")
      : '<div class="empty"><div class="big">Keine Schichten in diesem Monat</div>Über „Erfassen“ trägst du geleistete und geplante Schichten ein.</div>';
  }

  function renderForecast() {
    const rows = D.forecastByMonth(repo.shifts, D.todayISO());
    const total = rows.reduce((a, r) => a + r.gross, 0);
    const totalHours = rows.reduce((a, r) => a + r.hours, 0);
    const count = rows.reduce((a, r) => a + r.count, 0);
    $("fcTotal").textContent = money(total);
    $("fcNote").textContent = rows.length
      ? count + (count === 1 ? " Schicht" : " Schichten") + " · " + hours(totalHours) + " · brutto"
      : "Noch keine zukünftigen Schichten erfasst.";
    const max = Math.max(1, ...rows.map((r) => r.gross));
    $("fcList").innerHTML = rows.length
      ? rows.map((r) =>
          '<div class="fc-row"><div class="top"><span class="m">' + esc(monthName(r.month)) + '</span><span class="g">' + esc(money(r.gross)) + "</span></div>" +
          '<div class="track"><div style="width:' + ((r.gross / max) * 100).toFixed(1) + '%"></div></div>' +
          '<div class="h">' + esc(hours(r.hours)) + " · " + r.count + (r.count === 1 ? " Schicht" : " Schichten") + "</div></div>").join("")
      : '<div class="empty"><div class="big">Kein Forecast</div>Erfasse Schichten mit einem Datum in der Zukunft, um den erwarteten Verdienst zu sehen.</div>';
  }

  function renderTypeSelect(selected) {
    const types = repo.settings.shiftTypes;
    const known = types.some((t) => t.label === selected);
    const extra = selected && !known ? '<option value="' + esc(selected) + '">' + esc(selected) + "</option>" : "";
    $("fType").innerHTML = types.map((t) => '<option value="' + esc(t.label) + '">' + esc(t.label) + " · " + esc(money(t.rate)) + "/h</option>").join("") +
      extra + '<option value="">Andere (Satz manuell)</option>';
    $("fType").value = selected || "";
  }

  function renderSettings() {
    const s = repo.settings;
    $("typeList").innerHTML = s.shiftTypes.map((t) =>
      '<div class="typerow"><input class="tLabel" aria-label="Bezeichnung" maxlength="60" value="' + esc(t.label) + '">' +
      '<input class="tRate" aria-label="Stundensatz" type="number" inputmode="decimal" min="0" step="0.05" value="' + esc(t.rate) + '">' +
      '<button type="button" class="iconbtn tDel" aria-label="Schichtart entfernen">×</button></div>').join("");
    $("setBreak").value = String(s.defaultBreak);
    $("setCurrency").value = s.currency;
    $("accountInfo").textContent = "Angemeldet als " + (user ? user.email : "—") + ". " +
      (repo.lastSync ? "Letzter Abgleich: " + new Date(repo.lastSync).toLocaleString("de-CH") + "." : "Noch kein Abgleich.");
  }

  function renderAll() {
    renderLog();
    renderForecast();
    renderSettings();
    if (!editingId) renderTypeSelect($("fType").value);
    renderSyncState();
  }

  /* ---------- Formular ---------- */
  function showErr(id, msg) {
    $(id).textContent = msg || "";
    $(id).hidden = !msg;
  }
  function resetEntryForm() {
    editingId = null;
    const first = repo.settings.shiftTypes[0];
    $("entryTitle").textContent = "Schicht erfassen";
    $("cancelEdit").hidden = true;
    $("deleteShift").hidden = true;
    showErr("entryErr", "");
    $("fDate").value = D.todayISO();
    renderTypeSelect(first ? first.label : "");
    $("fStart").value = "";
    $("fEnd").value = "";
    $("fBreak").value = String(repo.settings.defaultBreak);
    $("fRate").value = first ? String(first.rate) : "";
    $("fNote").value = "";
    updatePreview();
  }
  function openEdit(id) {
    const s = repo.shifts.find((x) => x.id === id);
    if (!s) return;
    editingId = id;
    $("entryTitle").textContent = "Schicht bearbeiten";
    $("cancelEdit").hidden = false;
    $("deleteShift").hidden = false;
    showErr("entryErr", "");
    $("fDate").value = s.date;
    renderTypeSelect(s.type);
    $("fStart").value = s.start;
    $("fEnd").value = s.end;
    $("fBreak").value = String(s.breakMinutes);
    $("fRate").value = String(s.rate); // gespeicherter Satz, nicht der aktuelle Typ-Satz
    $("fNote").value = s.note;
    updatePreview();
    showView("entry");
  }
  function readForm() {
    const brk = $("fBreak").value.trim();
    const rate = $("fRate").value.trim();
    return {
      date: $("fDate").value,
      start: $("fStart").value,
      end: $("fEnd").value,
      breakMinutes: brk === "" ? 0 : Number(brk),
      rate: rate === "" ? NaN : Number(rate),
      type: $("fType").value,
      note: $("fNote").value.trim(),
    };
  }
  function updatePreview() {
    const f = readForm();
    if (!f.start || !f.end || !Number.isFinite(f.rate)) { $("previewBox").textContent = ""; return; }
    const h = D.durationHours(f.start, f.end, f.breakMinutes || 0);
    const cross = D.toMinutes(f.end) <= D.toMinutes(f.start) ? "  (über Mitternacht)" : "";
    $("previewBox").textContent = hours(h) + " × " + money(f.rate) + " = " + money(D.grossOf({ ...f, breakMinutes: f.breakMinutes || 0 })) + cross;
  }
  function onTypeChange() {
    const t = repo.settings.shiftTypes.find((x) => x.label === $("fType").value);
    if (t) $("fRate").value = String(t.rate);
    updatePreview();
  }
  function saveShift() {
    const f = readForm();
    const v = D.validateInput(f);
    if (!v.ok) { showErr("entryErr", v.msg); return; }
    try {
      const saved = repo.saveShift({ ...f, id: editingId || undefined });
      const [y, m] = saved.date.split("-").map(Number);
      cursor.setFullYear(y, m - 1, 1); // Log auf den Monat der Schicht springen lassen
      resetEntryForm();
      renderAll();
      showView("log");
      syncNow();
    } catch (e) {
      log.error("Speichern fehlgeschlagen", e);
      showErr("entryErr", "Die Schicht konnte nicht gespeichert werden.");
    }
  }
  function deleteShift() {
    if (!editingId || !confirm("Diese Schicht wirklich löschen?")) return;
    repo.deleteShift(editingId);
    resetEntryForm();
    renderAll();
    showView("log");
    syncNow();
  }

  /* ---------- Aufgebot aus dem Portal ---------- */
  const A = globalThis.Aufgebot;
  let aufgebotPlan = [];
  const STATUS_LABEL = { new: "neu", existing: "vorhanden", reserve: "Reserve", notime: "ohne Zeit", notype: "Schichtart?" };
  const STATUS_CLASS = { new: "new", existing: "existing", reserve: "reserve", notime: "warn", notype: "warn" };

  function checkAufgebot() {
    const text = $("aufgebotText").value;
    const entries = A.parse(text, repo.settings.shiftTypes);
    aufgebotPlan = A.plan(entries, repo.shifts, repo.settings, D.overlaps);
    const box = $("aufgebotResult");
    if (!entries.length) {
      box.innerHTML = '<p class="impsum">Keine Einsätze erkannt. Bitte den ganzen Seitentext der „Aufgebote“ kopieren.</p>';
      $("aufgebotApply").hidden = true;
      return;
    }
    const count = (st) => aufgebotPlan.filter((p) => p.status === st).length;
    const nNew = count("new");
    box.innerHTML =
      '<p class="impsum">' + entries.length + " erkannt: " + nNew + " neu, " + count("existing") + " vorhanden, " + count("reserve") + " Reserve" +
      (count("notime") + count("notype") ? ", " + (count("notime") + count("notype")) + " nicht übernehmbar" : "") + ".</p>" +
      aufgebotPlan.map((p) => {
        const e = p.entry;
        const time = e.start ? e.start + "–" + e.end : "";
        const extra = p.status === "existing" && p.match ? "Vorhanden: " + p.match.start + "–" + p.match.end + " · " :
          p.status === "notype" ? "Unbekannte Schichtart „" + e.roleLine + "“ – in den Einstellungen anlegen · " : "";
        const gross = p.status === "new" ? " · " + money(D.grossOf(p.shift)) : "";
        return '<div class="imp"><span class="t">' + esc(dayLabel(e.date) + " " + time) + esc(gross) + "</span>" +
          '<span class="badge ' + STATUS_CLASS[p.status] + '">' + STATUS_LABEL[p.status] + "</span>" +
          '<span class="o">' + esc(extra + e.order + (e.place ? " · " + e.place : "")) + "</span></div>";
      }).join("");
    $("aufgebotApply").hidden = nNew === 0;
    $("aufgebotApply").textContent = nNew === 1 ? "1 Einsatz übernehmen" : nNew + " Einsätze übernehmen";
  }

  function applyAufgebot() {
    // Erneut gegen den aktuellen Stand pruefen (ein Sync koennte inzwischen Daten geladen haben).
    const fresh = A.plan(aufgebotPlan.map((p) => p.entry), repo.shifts, repo.settings, D.overlaps).filter((p) => p.status === "new");
    let added = 0;
    for (const p of fresh) {
      try {
        repo.saveShift(p.shift);
        added++;
      } catch (e) {
        log.warn("Aufgebot-Eintrag nicht übernommen", p.entry, e);
      }
    }
    aufgebotPlan = [];
    $("aufgebotText").value = "";
    $("aufgebotResult").innerHTML = "";
    $("aufgebotApply").hidden = true;
    $("aufgebotBox").open = false;
    renderAll();
    showView("forecast");
    toast(added === 1 ? "1 Einsatz übernommen." : added + " Einsätze übernommen.");
    syncNow();
  }

  async function pasteAufgebot() {
    try {
      $("aufgebotText").value = await navigator.clipboard.readText();
      checkAufgebot();
    } catch (e) {
      log.warn("Zwischenablage nicht lesbar", e);
      toast("Zugriff auf die Zwischenablage nicht möglich. Bitte lang ins Feld tippen und „Einfügen“ wählen.");
    }
  }

  /* ---------- Einstellungen, Export, Import ---------- */
  function saveSettings() {
    const types = [...document.querySelectorAll("#typeList .typerow")].map((r) => ({
      label: r.querySelector(".tLabel").value.trim(),
      rate: Number(r.querySelector(".tRate").value),
    }));
    if (types.some((t) => !t.label || !Number.isFinite(t.rate) || t.rate < 0)) { toast("Jede Schichtart braucht eine Bezeichnung und einen Satz ≥ 0."); return; }
    if (new Set(types.map((t) => t.label)).size !== types.length) { toast("Schichtarten müssen unterschiedliche Bezeichnungen haben."); return; }
    if (!types.length) { toast("Mindestens eine Schichtart wird benötigt."); return; }
    repo.saveSettings({ shiftTypes: types, defaultBreak: Number($("setBreak").value) || 0, currency: $("setCurrency").value });
    if (!editingId) resetEntryForm();
    renderAll();
    toast("Einstellungen gespeichert.");
    syncNow();
  }
  function download(name, mime, text) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportCsv() {
    download("schichtbuch_" + D.todayISO() + ".csv", "text/csv;charset=utf-8", "﻿" + D.toCsv(repo.shifts, repo.settings.currency, D.todayISO()));
  }
  function exportJson() {
    download("schichtbuch_backup_" + D.todayISO() + ".json", "application/json", JSON.stringify(repo.exportBackup(), null, 2));
  }
  async function importJson(file) {
    try {
      const obj = JSON.parse(await file.text());
      if (!obj || !Array.isArray(obj.shifts)) throw new Error("Kein Schichtbuch-Backup");
      const res = repo.importShifts(obj.shifts);
      renderAll();
      toast(res.added + " importiert, " + res.skipped + " bereits vorhanden" + (res.invalid ? ", " + res.invalid + " ungültig" : "") + ".");
      syncNow();
    } catch (e) {
      log.error("Import fehlgeschlagen", e);
      toast("Die Datei ist kein lesbares Schichtbuch-Backup.");
    }
  }
  /**
   * Altbestand der Version ohne Login (gleicher Origin) einmalig uebernehmen.
   * Laeuft erst nach dem ersten Abgleich, damit Duplikate gegen den Serverstand erkannt werden.
   * @returns {boolean} true, wenn etwas uebernommen wurde
   */
  function migrateLegacy() {
    if (!storage || storage.getItem(LEGACY_DONE)) return false;
    let changed = false;
    try {
      const old = JSON.parse(storage.getItem(LEGACY_KEY) || "null");
      if (old && Array.isArray(old.shifts) && old.shifts.length) {
        const res = repo.importShifts(old.shifts);
        const untouched = JSON.stringify(repo.settings) === JSON.stringify(D.defaultSettings());
        if (untouched && old.settings && Array.isArray(old.settings.shiftTypes)) { repo.saveSettings({ ...repo.settings, ...old.settings }); changed = true; }
        log.info("Altbestand übernommen", res);
        if (res.added) { toast(res.added + " Schichten aus der alten Version übernommen."); changed = true; }
      }
      storage.setItem(LEGACY_DONE, new Date().toISOString());
    } catch (e) {
      log.warn("Altbestand konnte nicht gelesen werden", e);
    }
    return changed;
  }

  /* ---------- Sync ---------- */
  async function syncNow() {
    renderSyncState();
    if (!client || !user || !navigator.onLine) return;
    try {
      await repo.sync(client);
      if (migrateLegacy()) await repo.sync(client);
      syncError = null;
    } catch (e) {
      syncError = e;
      log.error("Synchronisation fehlgeschlagen", e);
    }
    renderLog();
    renderForecast();
    renderSettings();
    if (!editingId && !document.querySelector("#view-entry.active")) resetEntryForm();
    renderSyncState();
  }

  /* ---------- Login ---------- */
  function enterApp(u) {
    if (user && user.id === u.id) return;
    user = u;
    repo.load(u.id);
    showScreen("app");
    resetEntryForm();
    renderAll();
    showView("log");
    syncNow();
  }
  function leaveApp() {
    user = null;
    showScreen("login");
  }
  async function onLogin(ev) {
    ev.preventDefault();
    showErr("loginErr", "");
    $("loginBtn").disabled = true;
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: $("lEmail").value.trim(), password: $("lPass").value });
      if (error) throw error;
      $("lPass").value = "";
      enterApp(data.user);
    } catch (e) {
      log.warn("Login fehlgeschlagen", e);
      showErr("loginErr", navigator.onLine ? "Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen." : "Keine Verbindung. Für die Anmeldung wird Internet benötigt.");
    } finally {
      $("loginBtn").disabled = false;
    }
  }
  async function onLogout() {
    const n = repo.pendingCount;
    if (n && !confirm(n + " Änderung(en) sind noch nicht synchronisiert und gehen beim Abmelden verloren. Trotzdem abmelden?")) return;
    try {
      await client.auth.signOut();
    } catch (e) {
      log.warn("Abmelden beim Server fehlgeschlagen", e);
    }
    repo.clear();
    leaveApp();
  }

  /* ---------- Init ---------- */
  function wire() {
    document.querySelectorAll("nav.tabs button").forEach((b) => b.addEventListener("click", () => {
      const v = b.dataset.view;
      if (v === "entry" && !editingId) resetEntryForm();
      if (v !== "entry" && editingId) resetEntryForm();
      renderAll();
      showView(v);
    }));
    $("prevMonth").addEventListener("click", () => { cursor.setMonth(cursor.getMonth() - 1); renderLog(); });
    $("nextMonth").addEventListener("click", () => { cursor.setMonth(cursor.getMonth() + 1); renderLog(); });
    $("logList").addEventListener("click", (e) => { const r = e.target.closest(".row"); if (r) openEdit(r.dataset.id); });
    $("saveShift").addEventListener("click", saveShift);
    $("deleteShift").addEventListener("click", deleteShift);
    $("cancelEdit").addEventListener("click", () => { resetEntryForm(); showView("log"); });
    $("fType").addEventListener("change", onTypeChange);
    ["fStart", "fEnd", "fBreak", "fRate"].forEach((id) => $(id).addEventListener("input", updatePreview));
    $("typeList").addEventListener("click", (e) => { if (e.target.closest(".tDel")) e.target.closest(".typerow").remove(); });
    $("addType").addEventListener("click", () => {
      $("typeList").insertAdjacentHTML("beforeend", '<div class="typerow"><input class="tLabel" aria-label="Bezeichnung" maxlength="60" placeholder="Bezeichnung">' +
        '<input class="tRate" aria-label="Stundensatz" type="number" inputmode="decimal" min="0" step="0.05" placeholder="Satz">' +
        '<button type="button" class="iconbtn tDel" aria-label="Schichtart entfernen">×</button></div>');
    });
    $("aufgebotCheck").addEventListener("click", checkAufgebot);
    $("aufgebotApply").addEventListener("click", applyAufgebot);
    $("aufgebotPaste").addEventListener("click", pasteAufgebot);
    $("saveSettings").addEventListener("click", saveSettings);
    $("exportCsv").addEventListener("click", exportCsv);
    $("exportJson").addEventListener("click", exportJson);
    $("importJson").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importJson(f); });
    $("loginForm").addEventListener("submit", onLogin);
    $("logoutBtn").addEventListener("click", onLogout);
    $("syncState").addEventListener("click", syncNow);
    window.addEventListener("online", syncNow);
    window.addEventListener("offline", renderSyncState);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  }

  async function init() {
    const cfg = globalThis.SCHICHTBUCH_CONFIG || {};
    const configured = cfg.supabaseUrl && cfg.supabaseKey && !/DEIN/.test(cfg.supabaseUrl + cfg.supabaseKey);
    if (!configured || !globalThis.supabase) { showScreen("setup"); return; }
    wire();
    try {
      client = globalThis.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
      client.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") leaveApp();
        else if (session && session.user) setTimeout(() => enterApp(session.user), 0);
      });
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data.session) enterApp(data.session.user);
      else showScreen("login");
    } catch (e) {
      log.error("Initialisierung fehlgeschlagen", e);
      showScreen("login");
      showErr("loginErr", "Die Verbindung zur Datenbank konnte nicht aufgebaut werden.");
    }
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch((e) => log.warn("Service Worker nicht registriert", e)));
  }
  document.addEventListener("DOMContentLoaded", init);
})();
