# Laborbuch – Bauplan (Arbeitstitel)

Stand: 2026-10-22 · Zielgruppe: ich selbst · Plattform: nur Mac (Intel + Apple Silicon, macOS 13+) · Verteilung: DMG

## 1. Idee in einem Satz
Das schnelle, lokale Laborbuch für den Mac: eine Datei, die dir gehört, offline, sofortige Suche, unveränderliche Historie mit Signatur, gute Vorlagen und eingebaute Laborrechner.

## 2. Prinzipien
1. **Local-first.** Alles liegt in einer Datei auf dem Mac. Kein Konto, kein Server, keine Cloud-Pflicht.
2. **Schnell.** Start unter 1 s, Suche bei 10.000 Einträgen unter 100 ms, Tippen ohne Verzögerung.
3. **Daten gehören dir.** Offenes Format, vollständiger Export jederzeit (Markdown, JSON, `.eln`).
4. **Nichts geht verloren.** Jede Änderung ist eine neue Revision; abgeschlossene Einträge sind unveränderlich.
5. **Einfach.** Wenige Konzepte: Projekt → Eintrag → Blöcke. Alles andere ist ein Zusatz.

## 3. Nicht-Ziele (vorerst)
Mehrbenutzer/Sync, Rollen, 21 CFR Part 11-Zertifizierung, Windows/Linux, Web-Version, vollständiger Plasmid-Editor, LIMS-Funktionen.

## 4. Technik (entschieden: JavaScript + dünne Swift-Schicht; Editor wird in M0 validiert)
**Aufteilung:** Fast alles in JavaScript (Oberfläche, Editor, Logik, Rechner, Vorlagen, Export-Aufbereitung). Swift nur für das, was Apple-Schnittstellen braucht: Fenster, Datei- und SQLite-Zugriff, Signatur/Schlüsselbund, Touch ID, OCR (Vision), Spotlight, Quick Look, Kamera-Übernahme, Updates. Eine Hauptsprache, wenige Brücken.

**Verworfen:** Python wie bei HomebrUI (37 MB mehr, langsamerer Start, Mac-Funktionen bräuchten trotzdem Swift). Rust/Tauri (Vorteil wäre Windows/Linux, das ist kein Ziel; Mac-Funktionen in Rust umständlicher, langsamer zu entwickeln). Ein späterer Wechsel zu Tauri bleibt möglich, weil der Großteil JavaScript ist.

| Bereich | Entscheidung | Grund |
| --- | --- | --- |
| Hülle | Swift-App (AppKit/SwiftUI), dünn | nativ, Intel + ARM, kleiner als Python-Bundle, gleicher Weg wie bei HomebrUI |
| Logik | JavaScript (ohne Build-Schritt oder mit kleinem Bundler) | gleiche Sprache wie der Editor, schnelle Änderungen |
| Editor | WKWebView mit ProseMirror/TipTap (Blöcke) | Ein guter Block-Editor ist in SwiftUI sehr aufwendig; im Web gibt es ausgereifte Lösungen |
| Brücke | `WKScriptMessageHandler` (JS ↔ Swift), kleine feste Befehlsliste mit Promises | JS ruft z. B. `db.query`, `file.attach`, `sign`, `ocr` auf; Swift prüft jeden Befehl |
| Datenbank | SQLite (System-`libsqlite3`) mit FTS5 | Volltextsuche, eine Datei, robust |
| Anhänge | Ordner neben der DB, Dateiname = SHA-256 | Duplikate frei, Integrität prüfbar |
| Signatur | CryptoKit Ed25519, Schlüssel im Schlüsselbund | lokal, ohne Konto |
| Zeitstempel | optional RFC 3161 (externer Zeitstempeldienst) | belegt Datum gegenüber Dritten |
| PDF | WKWebView-Druck | gleiche Darstellung wie im Editor |
| Updates | wie HomebrUI: GitHub Releases, Prüfsumme, Selbst-Austausch | bereits erprobt |
| Build | `make-app.sh` + SwiftPM, ein DMG je Chip | bereits erprobt |

**Risiko:** Der Editor in WKWebView ist die wichtigste Entscheidung. M0 prüft das mit einem Wegwerf-Prototyp (Tippen, Bilder einfügen, Tabellen, 5.000 Wörter ohne Ruckeln). Fällt er durch, Plan B: native `NSTextView` mit eigenem Block-Modell.

## 5. Dateiformat
Ein Laborbuch ist ein Ordner (Paket) `Name.laborbuch`:
```
Name.laborbuch/
  db.sqlite          # alle Daten
  files/ab/abcdef…   # Anhänge nach SHA-256
  meta.json          # Formatversion, Anlagedatum, Buch-ID
```
Formatversion steht in `meta.json`; Migrationen laufen beim Öffnen, vorher automatische Sicherung.

## 6. Datenmodell (Kern)
- `project(id, name, color, archived, created)`
- `entry(id, project_id, title, kind[experiment|note|protocol], status[draft|signed], template_id, created, updated)`
- `revision(id, entry_id, no, content_json, text_plain, created, author, prev_hash, hash, signature)` **nur anfügen**; `hash = SHA-256(prev_hash + content_json + created)`
- `link(from_entry, to_entry, kind)` Verweise zwischen Einträgen
- `tag(id, name)`, `entry_tag(entry_id, tag_id)`
- `attachment(sha256, name, mime, size, entry_id, created, stored[copy|link], path, ocr_text)` kleine Dateien kopiert, große Rohdaten nur verlinkt (Pfad + Prüfsumme)
- `annotation(attachment_sha256, revision_id, shapes_json)` Pfeile/Beschriftungen auf Bildern, Original bleibt unverändert
- `template(id, name, version, content_json)` Vorlagen mit Versionen
- `run(id, entry_id, template_id, started, finished)`, `run_step(run_id, step_no, done_at, note)` Protokoll-Ausführung mit Zeitstempel je Schritt
- `witness(revision_id, name, signed_at, method[pdf|key], file_sha256)` Zeugen-Gegenzeichnung
- `search` (FTS5) auf dem Text der jeweils neuesten Revision und dem OCR-Text der Anhänge
- Phase 2: `schema(id, name, fields_json)` eigene Typen mit Feldern; `entity(id, schema_id, reg_id, name, fields_json)` Registry (Plasmid, Stamm, Zelllinie, Antikörper …) mit fortlaufender ID wie `PL-0042`; `item` (Bestand/Charge: entity_id, lot, expiry, amount, unit, min_amount, ghs, sds_url), `location` (Gefrierschrank › Box › Position), `item_use(entry_id, item_id, amount)`; `result_table(entry_id, schema_id, rows_json)` strukturierte Ergebnisse mit Einheiten; `passage(entity_id, no, date, notes)` Zellkultur; `device(id, name, location)`, `device_log(device_id, kind[wartung|kalibrierung|defekt], date, entry_id)`

## 7. Bildschirme
1. **Hauptfenster:** links Projekte/Filter/Suche, Mitte Eintragsliste, rechts Editor.
2. **Editor:** Blöcke (Text, Überschrift, Liste, Checkliste, Tabelle, Bild, Datei, Code, Formel, Rechner, Verweis auf Eintrag). `/` öffnet das Blockmenü.
3. **Verlauf:** alle Revisionen, Unterschied zur vorigen, Signatur- und Hash-Status.
4. **Suche (⌘K):** sofortiges Springen zu Einträgen, Tags, Projekten.
5. **Vorlagen:** erstellen, versionieren, „Eintrag aus Vorlage".
6. **Ausführungsmodus:** Protokoll Schritt für Schritt, große Schrift für den Labortisch, Abhaken mit Zeitstempel, Timer pro Schritt (mit Mitteilung), Notiz zu Abweichungen.
7. **Bild-Annotation:** Pfeile, Text, Rahmen, Spurenbelegung für Gele.
8. **Einstellungen:** Autorname, Schlüssel, Touch-ID-Sperre, Backup-Ordner, Export, Erscheinungsbild (Themes wie bei HomebrUI).
9. Phase 2: **Registry** (Liste je Typ mit eigenen Feldern), **Bestand** (Standorte, Chargen, Ablaufwarnungen), **Geräte**.

## 8. Funktionsumfang MVP (Phase 1)
- Projekte, Einträge, Tags, Verweise, Volltextsuche
- Block-Editor mit Bildern, Tabellen, Dateianhängen (Drag & Drop, Vorschau für Bild/PDF/CSV)
- Vorlagen mit Versionen
- Rechner als Blöcke: Verdünnung (C1V1=C2V2), Molarität/Masse, Mastermix, Einheitenumrechnung
- Revisionen mit Hash-Kette, „Eintrag abschließen und signieren", Prüfung der Kette
- Zeugen-Gegenzeichnung: Eintrag als PDF mit Hash ausgeben, unterschriebenes PDF wieder anhängen (für Patente/Nachweise)
- Protokoll-Ausführungsmodus mit Zeitstempeln und Timern
- Große Rohdaten verlinken statt kopieren (Pfad + SHA-256, Warnung wenn Datei fehlt oder verändert ist)
- Fotos direkt vom iPhone (Kamera-Übernahme von macOS) in den Eintrag
- Bilder annotieren (Gele, Mikroskopie), Original bleibt erhalten
- Suche auch in PDF-Text und per OCR in Bildern (Vision-Framework, lokal)
- Import: `.eln` (eLabFTW u. a.), Word/Markdown, gescannte Papierseiten (OCR)
- Touch-ID-Sperre; Hinweis auf FileVault statt eigener Verschlüsselung im MVP
- Automatische Sicherung (täglich, letzte N), Export des ganzen Buchs
- Export: PDF und PDF/A (Langzeitarchiv) je Eintrag, Markdown-Ordner, JSON, `.eln` (offenes Austauschformat)
- Mac-Einbindung: Spotlight, Quick Look, mehrere Fenster/Tabs
- Selbst-Update, Icon, DMG je Chip

## 9. Spätere Phasen
**2 Registry und Bestand:** eigene Typen mit Feldern (Plasmid, Stamm, Zelllinie, Antikörper, Primer …) mit fortlaufenden IDs und Verlinkung überall; strukturierte Ergebnistabellen mit Einheiten (Auswertung über viele Experimente); Bestand mit Standorten, Chargen, Ablaufdatum, Mindestbestand-Warnung, GHS-Gefahren und Sicherheitsdatenblättern; QR-Etiketten; Verbrauch in Einträgen verbuchen; Plattenlayouts; Bestellliste; Zellkultur (Passagen, Mycoplasma-Tests, Einfrierlisten); Gerätebuch (Wartung, Kalibrierung).
**3 Bio und Auswertung:** GenBank/FASTA-Viewer, Primer-Rechner, Restriktionsschnitte, Datenbank-Links (NCBI, UniProt); Diagramme aus Tabellen, Standardkurven, einfache Statistik.
**4 Komfort:** Literatur (DOI-Verweise, Zotero-Anbindung), Chemie (Strukturformeln zeichnen), Gerätedateien importieren, Kalender/Aufgaben, Kurzbefehle/AppleScript, Import aus Benchling/OneNote, lokaler KI-Assistent (eigener Schlüssel), Plugin-Schnittstelle.
**5 (nur bei Bedarf):** Team-Sync über eigenen Server oder geteilten Ordner, Rollen, Workflows.

## 10. Meilensteine
**Stand 2026-10-23: Phase 1 (M0–M7) abgeschlossen, Version 1.0, vorerst nur Apple Silicon. Phase 2 (M8–M13) und Phase 3 (M14–M17) abgeschlossen.**

| M | Inhalt | Fertig, wenn … |
| --- | --- | --- |
| M0 ✅ | Prototyp Editor in WKWebView + SQLite-Speichern | 5.000 Wörter + 20 Bilder ohne Ruckeln; Entscheidung Editor. **Erledigt 2026-10-22:** WebKit, Tippen Median 1 ms / max 2 ms, Laden 15 ms → Plan A (TipTap) |
| M1 ✅ | Datenmodell, Projekte/Einträge, Revisionen, Speichern/Öffnen | Eintrag anlegen, ändern, Verlauf sehen, App neu starten ohne Datenverlust. **Erledigt 2026-10-22:** mehrere Bücher (Neu/Öffnen/Doppelklick), Projekte, Art, alte Revisionen ansehen/wiederherstellen, Migration mit Sicherung |
| M2 ✅ | Suche, Tags, Verweise, Anhänge | Suche < 100 ms bei 10.000 Testeinträgen. **Erledigt 2026-10-22:** Suche 0,1 ms bei 10.000; Tags, Verweise mit [[ und Rückverweise, Dateianhänge mit Vorschau |
| M3 ✅ | Vorlagen, Rechner-Blöcke, Ausführungsmodus mit Timern | Mastermix-Vorlage anlegen, als Lauf ausführen, Schritte mit Zeitstempel im Eintrag; Rechner gegen Handrechnung getestet. **Erledigt 2026-10-22:** 14 Rechner-Tests gegen Handrechnung; Vorlagen mit Versionen; Lauf mit Zeitstempeln, Notizen, Timern und Ablaufprotokoll |
| M4 ✅ | Signieren, Hash-Kette, Zeugen-PDF, Touch-ID-Sperre | Manipulierter Eintrag wird erkannt (Test); Zeugen-PDF trägt den Hash und lässt sich wieder anhängen. **Erledigt 2026-10-23:** Ed25519-Signatur, Fälschungen erkannt (Test), Zeugen-PDF mehrseitig mit Hash, wieder anhängbar; Touch-ID-Sperre |
| M5 ✅ | Bilder: iPhone-Fotos, Annotation, OCR-Suche; Rohdaten verlinken | Gelbild mit Spurenbelegung; Text aus gescanntem Protokoll ist suchbar; geänderte Rohdatei wird gemeldet. **Erledigt 2026-10-23:** Gel mit Spurenbelegung, OCR-Text durchsuchbar, geänderte/fehlende Rohdatei gemeldet; iPhone-Übernahme ohne echtes iPhone ungetestet |
| M6 ✅ | Import (.eln, Word/Markdown, Scan) und Export (PDF, PDF/A, Markdown, JSON, .eln), Backup | Buch exportieren und ohne die App lesen; eLabFTW-Export importieren. **Erledigt 2026-10-23:** Export ohne App lesbar, .eln-Export und Re-Import, Import Markdown/RTF/Scan; PDF/A nur mit Ghostscript; Import einer echten eLabFTW-Datei ungetestet |
| M7 ✅ | Mac-Einbindung (Spotlight, Quick Look, Fenster/Tabs), Verpacken: Icon, DMG je Chip, Selbst-Update, README | Frische Installation und Update von 1.0 auf 1.1 getestet. **Erledigt 2026-10-23:** Fenster/Tabs, Spotlight, Quick Look, Selbst-Update (Test 1.0 → 1.1 bestanden, falsche Prüfsumme und fremder Download abgelehnt), DMG nur Apple Silicon, frische Installation getestet |

## 10b. Meilensteine Phase 2 (Registry und Bestand)
| M | Inhalt | Fertig, wenn … |
| --- | --- | --- |
| M8 ✅ | Registry: eigene Typen mit Feldern, Objekte mit fortlaufender ID (z. B. `PL-0042`), Änderungsverlauf, Standardtypen (Plasmid, Primer, Stamm, Zelllinie, Antikörper, Chemikalie), Verweis im Eintrag mit `@` | Plasmid anlegen, im Eintrag mit `@PL-0001` verweisen, im Plasmid „Verwendet in“ sehen; eigener Typ mit eigenen Feldern. **Erledigt 2026-10-23:** 18 Speicher-Tests, 6 Selbsttests in der App; Verlauf unveränderlich |
| M9 ✅ | Bestand: Standorte (Gefrierschrank › Regal › Box › Position), Chargen mit Menge, Einheit, Ablaufdatum, Mindestbestand, GHS-Gefahren, Sicherheitsdatenblatt; Verbrauch im Eintrag verbuchen; Warnungen | Charge anlegen, in Box A3 einlagern, im Eintrag 2 µl verbrauchen, Bestand sinkt; abgelaufene/knappe Chargen werden gemeldet. **Erledigt 2026-10-23:** 21 Speicher-Tests, 7 Selbsttests (Box A3, Verbrauch 500 → 498 µl, Storno, Umrechnung ml→µl, Warnungen) |
| M10 ✅ | QR-Etiketten drucken, Etikett per Kamera scannen öffnet das Objekt; Plattenlayout-Block (96/384) | Etikett für eine Charge gedruckt (PDF), Scan öffnet sie; 96er-Platte mit Proben belegt. **Erledigt 2026-10-23:** QR aus dem PDF lesbar, Scan-Code öffnet Charge, Handscanner im Suchfeld; Kamera-Fenster ohne echte Kamera ungetestet |
| M11 ✅ | Strukturierte Ergebnisse: Ergebnistabellen mit festen Feldern und Einheiten; Auswertung über viele Einträge mit Diagramm | „Ausbeute aller Plasmid-Präps“ als Tabelle und Diagramm über Einträge hinweg **Erledigt 2026-10-23:** Formelfelder rechnen live, Auswertung mit Kennzahlen, Zeit- und Streudiagramm, CSV-Export |
| M12 ✅ | Zellkultur (Passagen, Mycoplasma-Tests, Einfrierlisten) und Gerätebuch (Wartung, Kalibrierung, fällige Termine) | Passage 12 → 13 verbucht; fällige Kalibrierung wird gemeldet. **Erledigt 2026-10-23:** Passage im Eintrag gebucht, Einfrieren als Bestandscharge, Auftauen, Mycoplasma- und Gerätewarnungen in der Seitenleiste; Einträge mit Buchungen bleiben im Papierkorb statt endgültig gelöscht zu werden |
| M13 ✅ | Bestellliste aus knappen Chargen, Bestellstatus, Wareneingang legt Charge an | Knappes Reagenz auf Bestellliste, Eingang verbucht neue Charge. **Erledigt 2026-10-23:** Vorschläge, Status mit Verlauf, Eingang mit Chargennr./Ablauf/Standort, CSV; „knapp“ über alle gleichartigen Chargen |

## 10c. Meilensteine Phase 3 (Bio und Auswertung)
Alles läuft lokal und offline; nur M16 fragt auf Klick bei NCBI/UniProt an. Rechenkerne als reine Funktionen in `web/bio.js` bzw. `web/stats.js`, getestet gegen Referenzwerte (node --test).

| M | Inhalt | Fertig, wenn … |
| --- | --- | --- |
| M14 ✅ | Sequenzen: GenBank/FASTA importieren und exportieren, Sequenz-Viewer (lineare und Ring-Karte mit Features, Basen mit Übersetzung, GC-Gehalt, Länge), Motivsuche auf beiden Strängen, Revers-Komplement, ORF-Suche; Sequenz-Block im Eintrag und am Registry-Objekt | pUC19 (NCBI L09137) eingelesen: 2686 bp, ringförmig; ORF-Suche findet bla (286 aa); Motivsuche findet GAATTC einmal; Features aus GenBank (complement, join) auf der Karte; Export als FASTA/GenBank wieder einlesbar. **Erledigt 2026-10-23:** L09137 enthält selbst keine Features, daher Feature-Test mit eigener GenBank-Datei; 7 Sequenz-Tests (node), 8 Speicher-Tests, 9 Selbsttests |
| M15 ✅ | Primer und Restriktion: Primer-Rechner (Tm nach Nearest-Neighbor, GC, Länge, Selbstkomplementarität), Primer auf der Vorlage finden; Restriktionsenzyme (häufige Enzyme mit Erkennungsstelle), Schnittstellen auf der Karte, virtueller Verdau mit Fragmentgrößen und virtuellem Gel | Tm stimmt auf ±1 °C mit Referenzwerten; pUC19 × EcoRI + HindIII ergibt 2635 + 51 bp. **Erledigt 2026-10-23:** Tm auf 0,05 °C gleich Primer3 (primer3-py, mit und ohne Mg²⁺); pUC19: EcoRI + HindIII 2635 + 51, PvuII 2364 + 322; Typ IIS in beiden Richtungen; Gel und Einzelschneider in der App |
| M16 ✅ | Datenbank-Verweise: Kennungen (GenBank/RefSeq, UniProt, PubMed, Addgene) im Text werden Links; auf Klick Sequenz bzw. Eintrag von NCBI/UniProt holen und als Registry-Objekt anlegen | „NM_000546“ im Text wird Link; Abruf von L09137 legt ein Plasmid mit Sequenz an (ohne Netz: verständliche Meldung). **Erledigt 2026-10-23:** Selbsttest mit hinterlegten Antworten; echte Abfragen geprüft: NM_000546 (69 Features, CDS übersetzt zu p53 mit 393 aa) und UniProt P04637 (TP53, 393 aa); Editor-Bündel exportiert dafür zusätzlich Extension/Plugin/Decoration |
| M17 ✅ | Diagramme und Statistik: Diagramm-Block aus einer Tabelle im Eintrag (Punkte, Linie, Balken mit Fehlerbalken), Standardkurve mit linearer Regression und Berechnung unbekannter Proben, Kennzahlen, t-Test | Bradford-Standardkurve mit R², unbekannte Proben gegen Handrechnung; t-Test-p-Wert stimmt mit Referenz. **Erledigt 2026-10-23:** Regression und t-Tests (Welch, Student, gepaart) auf ~1e−12 gleich scipy 1.17; Standardkurve „aus Tabelle darüber“, Proben mit Verdünnung, Diagramm im Export |

## 11. Tests
Unit-Tests für Hash-Kette, Migrationen, Rechner, Suche, Export; Gegenprobe mit großen Testdaten (10.000 Einträge, 2.000 Anhänge); Absturztest (Prozess während des Speicherns beenden → DB bleibt konsistent, SQLite WAL).

## 12. Offene Entscheidungen
1. Name und Icon.
2. Editor-Plan A (Web) oder B (nativ) – entscheidet M0.
3. Kostenlos/Open Source oder verkaufen? (Beeinflusst Lizenz und Signierung/Notarisierung.)
4. Apple-Developer-Account (99 $/Jahr) für Signatur und Notarisierung?
5. Sprache der Oberfläche: nur Deutsch/Englisch oder wie HomebrUI 8 Sprachen?

## 13. Risiken
- Umfang wächst: Phase 1 ist durch die Ergänzungen schon deutlich größer (M0–M7). Wenn es zu lange dauert, zuerst M0–M4 als nutzbare Version 0.1 veröffentlichen, M5–M7 danach. Erst nach Phase 1 Registry/Bestand.
- Datenverlust: Backups, Schreiben nur per Transaktion, Format-Migrationen mit Vorab-Sicherung.
- Rechtliches: Signatur und Zeitstempel sind **Nachweise, keine Zertifizierung**. Für regulierte Labore (GLP/Part 11) reicht das nicht, das steht klar in der App und im README.
- Sequenzwerkzeuge (Benchlings Stärke) sind sehr aufwendig: erst Viewer, Editor später oder über Bibliotheken.
