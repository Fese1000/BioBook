# Laborbuch

Ein schnelles, lokales Laborbuch für den Mac. Stand: **1.0** (Phase 1, M0–M7) plus **M8** aus Phase 2 (noch nicht veröffentlicht); vorerst nur für Apple Silicon, siehe [BAUPLAN.md](BAUPLAN.md).

## Installieren
`Laborbuch-AppleSilicon.dmg` öffnen und die App nach „Programme“ ziehen (macOS 13 oder neuer, Apple Silicon). Die App ist nur ad hoc signiert: Beim ersten Start einer heruntergeladenen Kopie fragt macOS nach. Ab macOS 15 einmal öffnen, dann Systemeinstellungen › Datenschutz & Sicherheit › „Trotzdem öffnen“; unter macOS 13/14 Rechtsklick › Öffnen.

Updates: Einstellungen (⌘,) › „Nach Updates suchen“. Die App lädt das DMG der neuesten Version von GitHub (`Fese1000/Laborbuch`), prüft SHA-256, Bundle-ID, Version und Signatur, tauscht sich aus und startet neu. Bei einem Fehler bleibt die alte Version.

## Was schon geht
- Registry (Seitenleiste „Registry“): Typen wie Plasmid, Primer, Stamm, Zelllinie, Antikörper, Chemikalie – oder eigene mit eigenen Feldern (Text, Zahl, Datum, Auswahl, Sequenz, Ja/Nein, Link). Jedes Objekt bekommt eine fortlaufende ID wie `PL-0042`; jede Änderung landet im Verlauf. Sequenzfelder zeigen Länge, GC-Anteil und Tm. Im Eintrag verweist `@` auf ein Objekt; das Objekt zeigt „Verwendet in“.
- Löschen mit Papierkorb (🗑 im Eintrag oder Ablage › „In den Papierkorb“): Gelöschte Einträge verschwinden aus Listen, Suche, Spotlight und „Verwendet in“, lassen sich wiederherstellen und erst im Papierkorb endgültig löschen (mit Rückfrage, samt Revisionen). Signierte Einträge lassen sich nicht löschen.
- Mehrere Fenster (⌥⌘N) und Tabs (⌘T); ⌘-Klick auf einen Eintrag öffnet ihn in einem neuen Tab. Speichert ein Fenster, sehen die anderen den neuen Stand.
- Spotlight findet Einträge (Titel, Text, Tags); ein Klick öffnet Buch und Eintrag. Quick Look (Leertaste im Finder) zeigt bei einem `.laborbuch` die letzten Einträge, der Finder ein Vorschaubild.
- Mehrere Laborbücher: neu anlegen (⇧⌘N), öffnen (⌘O), im Finder zeigen. Ein Buch ist ein Paket `Name.laborbuch` und öffnet sich per Doppelklick; die App merkt sich das zuletzt geöffnete.
- Projekte: anlegen, umbenennen, archivieren; Einträge zuordnen oder verschieben, Filter „Alle“ / „Ohne Projekt“ / je Projekt
- Art je Eintrag: Experiment, Notiz, Protokoll
- Tags je Eintrag (mit Vorschlägen), Tag-Filter in der Seitenleiste, Suche findet auch Tags
- Verweise zwischen Einträgen: `[[` tippen und Eintrag wählen; ein Klick öffnet ihn, unten stehen die Rückverweise. Verweise zeigen immer den aktuellen Titel.
- Rechner als Block (🧮 in der Werkzeugleiste): Verdünnung C1·V1 = C2·V2, Einwaage (Masse = c · V · M), Mastermix mit Überschuss und Wasser auf Endvolumen, Einheiten umrechnen. Ein Feld leer lassen, es wird berechnet; Eingaben und Ergebnis stehen im Eintrag und in den Revisionen.
- Vorlagen: „Als Vorlage“ speichert den Eintrag als Vorlage; gleicher Name = neue Version, alte Versionen bleiben unverändert. Klick auf eine Vorlage links legt einen Eintrag daraus an (auch aus älteren Versionen); der Eintrag vermerkt Vorlage und Version.
- Ausführungsmodus („▶ Ausführen“): nummerierte Punkte oder Checklisten werden Schritt für Schritt abgearbeitet, mit Zeitstempel, Notiz je Schritt und Timern („5 min“ im Text wird erkannt; Ton und Dock-Hinweis, wenn er abläuft). Der Lauf übersteht Neustarts; am Ende hängt ein Ablaufprotokoll als Tabelle am Eintrag.
- Abschließen und signieren („🔏 Abschließen“): der aktuelle Stand wird als Revision gesichert und mit deinem persönlichen Ed25519-Schlüssel signiert (Name, Zeitpunkt und Revisions-Hash sind mit signiert). Danach ist der Eintrag schreibgeschützt; Ergänzungen kommen in einen „Nachtrag“, der auf ihn verweist. Der Verlauf prüft Hash-Kette und Signaturen und zeigt den Schlüssel-Fingerabdruck.
- Zeugen-Gegenzeichnung: „Zeugen-PDF erstellen“ erzeugt ein mehrseitiges PDF mit Revisions-Hash (im Text und in den Metadaten) und Feldern für Name, Datum, Unterschrift. Das unterschriebene PDF wird wieder angehängt; die App prüft, ob der Hash darin steht (bei reinen Scans ohne Text nicht möglich, dann gibt es einen Hinweis).
- Sperre mit Touch ID oder Anmeldepasswort (Einstellungen, ⌘,): beim Start, wenn der Mac schläft und nach einstellbarer Zeit ohne Eingabe; ⌘L sperrt sofort.
- Bilder beschriften (Doppelklick aufs Bild oder „✎ Beschriften“): Pfeile, Rahmen, Text und Spurenbelegung für Gele (auf die Spuren klicken, Belegung z. B. „M, 1, 2, NK“). Das Originalbild bleibt unverändert; die Beschriftung steht im Eintrag, in den Revisionen und im Zeugen-PDF.
- Texterkennung: Text in Bildern und gescannten PDFs wird im Hintergrund lokal erkannt (Vision-Framework, Deutsch und Englisch) und ist durchsuchbar, ebenso Dateinamen.
- Große Rohdaten verlinken („🔗 Rohdaten“): Dateien bleiben am Ort, das Laborbuch speichert Pfad und SHA-256. Beim Öffnen des Eintrags wird geprüft, ob sie verändert wurden oder fehlen.
- Fotos und Scans vom iPhone: Ablage › „Vom iPhone oder iPad importieren“ (Kamera-Übernahme von macOS).
- Export (Ablage › „Laborbuch exportieren …“, ⇧⌘E): ein Ordner, der ohne die App lesbar ist – `index.html` als Übersicht, jeder Eintrag als HTML und Markdown (mit Kopfdaten), alle Anhänge mit Originalnamen, `data/book.json` mit allen Revisionen, Hashes und Signaturen, dazu `<Buch>.eln` (RO-Crate) für andere Laborbücher wie eLabFTW.
- Eintrag als PDF (⌘P); als PDF/A nur, wenn Ghostscript installiert ist (`brew install ghostscript`), sonst kommt ein Hinweis.
- Import (⇧⌘I): `.eln`-Archive (eLabFTW u. a.), Markdown, Word/RTF/ODT, HTML sowie gescannte PDFs und Bilder (Text wird erkannt und in den Eintrag geschrieben). Fremdes HTML wird entschärft: keine Skripte, keine Bilder aus dem Netz.
- Automatische Sicherung: täglich eine Kopie der Datenbank (die letzten 14 bleiben) und neue Anhänge, standardmäßig nach `~/Library/Application Support/Laborbuch/Sicherungen/`; Ordner (z. B. externe Platte) und „Jetzt sichern“ in den Einstellungen.
- Dateianhänge jeder Art bis 50 MB als Karte im Text: Öffnen (schreibgeschützte Kopie mit Originalnamen), Vorschau für PDF, CSV/TSV und Text
- Einträge anlegen, Titel, Liste mit Volltextsuche (⌘F), Suche im gewählten Projekt
- Block-Editor (TipTap): Überschriften, Listen, Checklisten, Tabellen, Code, Zitate, Bilder und Dateien per Drag & Drop, Einfügen oder Knopf
- Automatisches Speichern; unveränderliche Revisionen mit Hash-Kette (⌘S, beim Wechseln, alle 5 Min., beim Beenden), Verlauf mit Kettenprüfung; alte Fassungen ansehen (nur lesen) und als neuen Stand wiederherstellen, ohne dass alte Revisionen verloren gehen
- Bilder als Anhänge nach SHA-256

Der private Signaturschlüssel liegt im macOS-Schlüsselbund („Laborbuch Signaturschlüssel“), im Laborbuch nur der öffentliche Teil. Weil die App nur ad hoc signiert ist, fragt macOS nach einem Update einmal nach dem Anmeldepasswort, bevor die neue Version den Schlüssel benutzen darf („Immer erlauben“). Fehler beim Abschließen stehen mit Grund in `~/Library/Logs/Laborbuch/app.log`. Zum Arbeiten die installierte App aus „Programme“ benutzen, nicht `build/` – die wird beim Entwickeln laufend ersetzt. Signatur und Zeitstempel sind Nachweise, keine Zertifizierung nach GLP oder 21 CFR Part 11.

Wiederherstellen aus einer Sicherung: App beenden, im Sicherungsordner die gewünschte `db-….sqlite` als `db.sqlite` zusammen mit `files/` und `meta.json` in einen Ordner `Name.laborbuch` kopieren und diesen öffnen.

Das Standard-Buch liegt in `~/Library/Application Support/Laborbuch/Standard.laborbuch/` (SQLite + `files/`). Ältere Bücher werden beim Öffnen automatisch aktualisiert; vorher legt die App eine Kopie der Datenbank in `backups/` ab. Bücher aus einer neueren App-Version werden nicht angefasst.

## Bauen und veröffentlichen
```bash
./make-app.sh arm64 --no-dmg   # nur App
./make-app.sh arm64            # dist/Laborbuch-AppleSilicon.dmg
```
Neue Version: `VERSION` hochzählen, DMG bauen, als Release `v<VERSION>` mit der Datei `Laborbuch-AppleSilicon.dmg` bei GitHub (`Fese1000/Laborbuch`) hochladen; GitHub liefert die SHA-256-Prüfsumme mit, ohne sie verweigert die App das Update. (Das Repo gibt es noch nicht.) Intel-Builds (`./make-app.sh x86_64`) sind vorbereitet, aber noch nicht vorgesehen.
Braucht die Xcode Command Line Tools. Der Editor ist fertig gebündelt in `web/vendor/tiptap.js`; neu bündeln nur bei Updates: `cd tools && npm install && npm run bundle`.

## Tests
```bash
swiftc app/Store.swift app/Registry.swift tests/main.swift -o /tmp/lb-tests && /tmp/lb-tests      # Speicher, Hash-Kette, Suche, Vorlagen, Läufe
node --test tests/calc.test.js tests/markdown.test.js                           # Rechner gegen Handrechnung, Markdown hin und zurück
LABORBUCH_BOOK=/tmp/perf.laborbuch build/AppleSilicon/Laborbuch.app/Contents/MacOS/Laborbuch --perftest   # Editor-Leistung
LABORBUCH_BOOK=/tmp/self.laborbuch LABORBUCH_KEYFILE=/tmp/self.key LABORBUCH_TESTOUT=/tmp LABORBUCH_BACKUPDIR=/tmp/backup build/AppleSilicon/Laborbuch.app/Contents/MacOS/Laborbuch --selftest   # 53 Prüfungen
# Update-Test 1.0 → 1.1: alte App mit --updatetest und LABORBUCH_UPDATE_API/LABORBUCH_UPDATE_PREFIX/LABORBUCH_NO_RELAUNCH gegen eine lokale Release-Beschreibung starten   # Anhänge, Verweise, Rechner, Läufe, Signatur, Zeugen-PDF in der echten WebView (nie mit echtem Schlüsselbund)
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
| `web/sign.js` | Abschließen, Nachtrag, Zeugen-PDF, Einstellungen |
| `app/Keys.swift` | Signaturschlüssel im Schlüsselbund, persönliche Einstellungen |
| `app/Witness.swift` | Zeugen-PDF erzeugen und prüfen |
| `app/Lock.swift` | Sperre mit Touch ID |
| `app/OCR.swift` | Texterkennung in Bildern und PDFs |
| `web/annotate.js` | Bilder beschriften, Spurenbelegung |
| `web/markdown.js` | Markdown-Export und -Import (getestet) |
| `web/io.js` | Export (HTML, Markdown, .eln), PDF, Import |
| `app/Export.swift` | Schreiben, Zippen, Dokumente lesen, PDF/A |
| `app/Backup.swift` | Automatische Sicherung |
| `app/Spotlight.swift` | Einträge in der Spotlight-Suche |
| `app/QuickLook.swift` | Vorschau und Vorschaubild für .laborbuch |
| `app/Updater.swift` | Selbst-Update über GitHub-Releases |
| `app/Registry.swift` | Registry: Typen, Objekte, Verlauf |
| `web/registry.js` | Registry-Oberfläche, Typ-Editor |
| `web/` | Oberfläche und Logik (JavaScript), Editor-Bündel |
| `tools/` | Bündeln des Editors, Icon-Erzeugung |
| `tests/` | Speicher-Tests, Browser-Testumgebung |
