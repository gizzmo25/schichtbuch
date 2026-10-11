# Schichtbuch

Stunden- und Verdiensttracker für Schichtarbeit mit Forecast. Web-App (PWA) mit Login;
die Daten liegen in einer Postgres-Datenbank bei Supabase und sind von jedem Gerät aus abrufbar.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `index.html` | Oberfläche (Log, Erfassen, Forecast, Einstellungen, Login) |
| `js/config.js` | Projekt-URL und Publishable Key (einzige Datei, die du anpassen musst) |
| `js/domain.js` | Reine Fachlogik: Dauer, Brutto, Monatssummen, Forecast, Validierung, CSV |
| `js/repository.js` | Lokaler Cache, Outbox und Synchronisation mit Supabase |
| `js/app.js` | Rendering, Formulare, Login, Sync-Steuerung |
| `vendor/supabase.js` | supabase-js 2.117.3 (lokal eingebunden, kein CDN nötig) |
| `sw.js`, `manifest.json`, `icon-*.png` | Installierbarkeit und Offline-Start |
| `supabase/schema.sql` | Tabellen, Row Level Security, Keepalive-Funktion |
| `.github/workflows/keepalive.yml` | Täglicher Ping gegen die Pausierung des Gratis-Projekts |
| `tests/domain.test.js` | Unit-Tests der Fachlogik (`node --test tests/domain.test.js`) |

## Einrichtung

### 1. Supabase-Projekt anlegen
1. Auf supabase.com ein Konto und ein neues Projekt anlegen, Region **Central EU (Frankfurt)** oder **Zürich**, falls angeboten.
2. **SQL Editor → New query**: Inhalt von `supabase/schema.sql` einfügen und ausführen.
3. **Authentication → Users → Add user → Create new user**: deine E-Mail und ein starkes Passwort eintragen, „Auto Confirm User“ aktivieren.
4. **Authentication → Sign In / Providers**: „Allow new users to sign up“ **ausschalten**. Damit kann sich niemand sonst ein Konto anlegen.

### 2. App konfigurieren
Im Dashboard unter **Project Settings → API Keys** den **Publishable key** (`sb_publishable_…`) kopieren,
die Projekt-URL (`https://<ref>.supabase.co`) steht unter **Project Settings → Data API**.
Beide Werte in `js/config.js` eintragen.

Der Publishable Key darf öffentlich im Repository stehen. Niemals den **Secret Key** eintragen.

### 3. Auf GitHub Pages veröffentlichen
Alle Dateien und Ordner (inklusive `.github`) in das Wurzelverzeichnis des Repositorys hochladen.
**Settings → Pages → Deploy from a branch → main / (root)**.

Wenn du dasselbe Repository wie bei der alten Version verwendest, bleibt die Adresse gleich. Dann übernimmt
die App die auf dem jeweiligen Gerät noch vorhandenen Schichten der alten Version beim ersten Login automatisch.

### 4. Alte Daten übernehmen
- Automatisch: siehe oben (gleiche Adresse, Daten noch im Browser vorhanden).
- Von Hand: **Einstellungen → Backup importieren** und die alte `schichtbuch_backup_*.json` wählen.
  Der Import überspringt vorhandene Schichten (gleiche ID oder gleiches Datum + Beginn + Ende) und kann gefahrlos wiederholt werden.

### 5. Auf dem Handy installieren
Adresse in Chrome öffnen → Menü → **App installieren**, dann anmelden.

## Verhalten

- **Quelle der Wahrheit** ist die Datenbank. Der Browser hält nur eine Kopie und eine Liste noch nicht gesendeter Änderungen.
- **Browserdaten gelöscht:** neu anmelden, der Stand wird vollständig geladen. Verloren gehen höchstens Änderungen, die noch nicht gesendet waren (Anzeige „n offen“).
- **Offline:** Erfassen und Bearbeiten funktionieren, gesendet wird beim nächsten Verbindungsaufbau. Die Anmeldung selbst braucht Internet.
- **Mehrere Geräte:** Bei gleichzeitiger Bearbeitung derselben Schicht gewinnt die zuletzt gesendete Version.
- **Forecast:** „Geplant“ ist jede Schicht mit Datum nach heute; eine Schicht von heute zählt als geleistet. Beträge sind brutto.

## Betriebshinweise

- **Pausierung:** Supabase pausiert Gratis-Projekte bei zu wenig Datenbankaktivität über 7 Tage. Regelmässige Nutzung oder der
  Keepalive-Workflow verhindern das; garantiert ist es nicht. Ein pausiertes Projekt lässt sich im Dashboard wieder starten, die Daten bleiben erhalten.
- **Backups:** Der Gratis-Plan enthält keine automatischen Datenbank-Backups. Gelegentlich **Backup (.json)** exportieren.
- **Updates der App:** Geänderte Dateien ins Repository hochladen. Der Service Worker lädt bei bestehender Verbindung immer die aktuelle Version.
