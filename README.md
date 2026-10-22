# Laborbuch

Ein schnelles, lokales Laborbuch für den Mac. Stand: **M3**, siehe [BAUPLAN.md](BAUPLAN.md).

## Was schon geht
- Mehrere Laborbücher: neu anlegen (⇧⌘N), öffnen (⌘O), im Finder zeigen. Ein Buch ist ein Paket `Name.laborbuch` und öffnet sich per Doppelklick; die App merkt sich das zuletzt geöffnete.
- Projekte: anlegen, umbenennen, archivieren; Einträge zuordnen oder verschieben, Filter „Alle“ / „Ohne Projekt“ / je Projekt
- Art je Eintrag: Experiment, Notiz, Protokoll
- Tags je Eintrag (mit Vorschlägen), Tag-Filter in der Seitenleiste, Suche findet auch Tags
- Verweise zwischen Einträgen: `[[` tippen und Eintrag wählen; ein Klick öffnet ihn, unten stehen die Rückverweise. Verweise zeigen immer den aktuellen Titel.
- Rechner als Block (🧮 in der Werkzeugleiste): Verdünnung C1·V1 = C2·V2, Einwaage (Masse = c · V · M), Mastermix mit Überschuss und Wasser auf Endvolumen, Einheiten umrechnen. Ein Feld leer lassen, es wird berechnet; Eingaben und Ergebnis stehen im Eintrag und in den Revisionen.
- Vorlagen: „Als Vorlage“ speichert den Eintrag als Vorlage; gleicher Name = neue Version, alte Versionen bleiben unverändert. Klick auf eine Vorlage links legt einen Eintrag daraus an (auch aus älteren Versionen); der Eintrag vermerkt Vorlage und Version.
- Ausführungsmodus („▶ Ausführen“): nummerierte Punkte oder Checklisten werden Schritt für Schritt abgearbeitet, mit Zeitstempel, Notiz je Schritt und Timern („5 min“ im Text wird erkannt; Ton und Dock-Hinweis, wenn er abläuft). Der Lauf übersteht Neustarts; am Ende hängt ein Ablaufprotokoll als Tabelle am Eintrag.
- Dateianhänge jeder Art bis 50 MB als Karte im Text: Öffnen (schreibgeschützte Kopie mit Originalnamen), Vorschau für PDF, CSV/TSV und Text
- Einträge anlegen, Titel, Liste mit Volltextsuche (⌘F), Suche im gewählten Projekt
- Block-Editor (TipTap): Überschriften, Listen, Checklisten, Tabellen, Code, Zitate, Bilder und Dateien per Drag & Drop, Einfügen oder Knopf
- Automatisches Speichern; unveränderliche Revisionen mit Hash-Kette (⌘S, beim Wechseln, alle 5 Min., beim Beenden), Verlauf mit Kettenprüfung; alte Fassungen ansehen (nur lesen) und als neuen Stand wiederherstellen, ohne dass alte Revisionen verloren gehen
- Bilder als Anhänge nach SHA-256

Das Standard-Buch liegt in `~/Library/Application Support/Laborbuch/Standard.laborbuch/` (SQLite + `files/`). Ältere Bücher werden beim Öffnen automatisch aktualisiert; vorher legt die App eine Kopie der Datenbank in `backups/` ab. Bücher aus einer neueren App-Version werden nicht angefasst.

## Bauen
```bash
./make-app.sh arm64 --no-dmg   # nur App
./make-app.sh all              # DMGs für Apple Silicon und Intel in dist/
```
Braucht die Xcode Command Line Tools. Der Editor ist fertig gebündelt in `web/vendor/tiptap.js`; neu bündeln nur bei Updates: `cd tools && npm install && npm run bundle`.

## Tests
```bash
swiftc app/Store.swift tests/main.swift -o /tmp/lb-tests && /tmp/lb-tests      # Speicher, Hash-Kette, Suche, Vorlagen, Läufe
node --test tests/calc.test.js                                                  # Rechner gegen Handrechnung
LABORBUCH_BOOK=/tmp/perf.laborbuch build/AppleSilicon/Laborbuch.app/Contents/MacOS/Laborbuch --perftest   # Editor-Leistung
LABORBUCH_BOOK=/tmp/self.laborbuch build/AppleSilicon/Laborbuch.app/Contents/MacOS/Laborbuch --selftest   # Anhänge, Verweise, Tags in der echten WebView
tests/make-mock.sh   # Oberfläche mit nachgebauter Brücke zum Testen im Browser
```

## Aufbau
| Pfad | Zweck |
| --- | --- |
| `app/main.swift` | Fenster, WebView, Schema `lab://`, Brücke JS ↔ Swift, Menü |
| `app/Store.swift` | SQLite, Revisionen mit Hash-Kette, Suche, Anhänge, Vorlagen, Läufe |
| `web/calc.js` | Laborrechner (reine Funktionen, getestet) |
| `web/calcblock.js` | Rechner als Editor-Block |
| `web/run.js` | Ausführungsmodus mit Timern und Ablaufprotokoll |
| `web/` | Oberfläche und Logik (JavaScript), Editor-Bündel |
| `tools/` | Bündeln des Editors, Icon-Erzeugung |
| `tests/` | Speicher-Tests, Browser-Testumgebung |
