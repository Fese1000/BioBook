# Laborbuch

Ein schnelles, lokales Laborbuch für den Mac. Stand: **1.0** (Phase 1, M0–M7) plus **Phase 2 (M8–M13)** und **Phase 3 (M14–M17)** und **Phase 4 (M18–M24)**, dazu **Phase 4b (M25–M29)** (noch nicht veröffentlicht); vorerst nur für Apple Silicon, siehe [BAUPLAN.md](BAUPLAN.md).

## Installieren
`Laborbuch-AppleSilicon.dmg` öffnen und die App nach „Programme“ ziehen (macOS 13 oder neuer, Apple Silicon). Die App ist nur ad hoc signiert: Beim ersten Start einer heruntergeladenen Kopie fragt macOS nach. Ab macOS 15 einmal öffnen, dann Systemeinstellungen › Datenschutz & Sicherheit › „Trotzdem öffnen“; unter macOS 13/14 Rechtsklick › Öffnen.

Updates: Einstellungen (⌘,) › „Nach Updates suchen“. Die App lädt das DMG der neuesten Version von GitHub (`Fese1000/Laborbuch`), prüft SHA-256, Bundle-ID, Version und Signatur, tauscht sich aus und startet neu. Bei einem Fehler bleibt die alte Version.

## Was schon geht
- Registry (Seitenleiste „Registry“): Typen wie Plasmid, Primer, Stamm, Zelllinie, Antikörper, Chemikalie – oder eigene mit eigenen Feldern (Text, Zahl, Datum, Auswahl, Sequenz, Ja/Nein, Link). Jedes Objekt bekommt eine fortlaufende ID wie `PL-0042`; jede Änderung landet im Verlauf. Sequenzfelder zeigen Länge, GC-Anteil und Tm. Im Eintrag verweist `@` auf ein Objekt; das Objekt zeigt „Verwendet in“.
- Bestand (Seitenleiste „📦 Bestand“): Standorte als Baum (Raum › Gerät › Regal › Box mit Raster), Chargen mit Menge, Einheit, Chargennummer, Ablaufdatum, Mindestbestand, GHS-Gefahren und Sicherheitsdatenblatt. Jede Mengenänderung ist eine unveränderliche Buchung. Im Eintrag bucht der Block „📦 Verbrauch“ eine Menge ab (mit Einheitenumrechnung, stornierbar); die Buchung verweist auf den Eintrag. Abgelaufene, bald ablaufende und knappe Chargen werden gemeldet.
- Strukturierte Ergebnisse (Block „📊 Ergebnisse“): Tabellen nach festen Schemata mit Feldern, Einheiten und berechneten Feldern per Formel (z. B. Ausbeute = konz × volumen / 1000); mitgeliefert sind Plasmid-Präp, Proteinbestimmung und qPCR, eigene Schemata lassen sich anlegen. Die „📈 Auswertung“ sammelt alle Zeilen eines Schemas über Einträge hinweg (Filter nach Projekt und Zeitraum), zeigt Kennzahlen, ein Diagramm über die Zeit oder gegen ein anderes Feld und exportiert CSV.
- Sequenzen: Sequenzfelder in der Registry (z. B. Plasmid) lassen sich aus GenBank- oder FASTA-Dateien füllen; Features und „ringförmig“ werden übernommen. Darunter: Ring- bzw. lineare Karte mit Features, Basen mit Positionen und Übersetzung (Rahmen +1 bis +3), Motivsuche auf beiden Strängen (IUPAC, über den Ursprung), ORF-Suche (≥ 100 aa, als Feature übernehmen), Revers-Komplement, Export als FASTA oder GenBank. „✎ Bearbeiten“ fügt ein, löscht oder ersetzt Basen (Features wandern mit), „+ Feature“ setzt Features von Hand. „Sanger (.ab1) ausrichten“ liest eine Sequenzierdatei, richtet sie auf beiden Strängen gegen die Sequenz aus und zeigt Abweichungen im gut lesbaren Bereich mit Qualität und Chromatogramm. „🧪 Klonierung“ simuliert Restriktion/Ligation (Insert-Richtung wird anhand der Enden gewählt), Gibson und Golden Gate (BsaI, BsmBI, SapI) und legt das Ergebnis samt übernommener Features als neues Plasmid an. Restriktion: gut 50 gängige Enzyme (auch Typ IIS wie BsaI), Einzelschneider auf einen Klick, Schnitte auf der Karte, virtueller Verdau mit Fragmenten und virtuellem Gel. Primer: Tm nach Nearest-Neighbor (SantaLucia, mit Mg²⁺ – gleiche Werte wie Primer3), GC, Hinweise (3'-Ende, Wiederholungen, Selbstbindung) und Bindestellen auf der Vorlage, auch mit 5'-Überhang; Primer-Objekte in der Registry zeigen dieselbe Tm. Im Eintrag zeigt der Block „🧬 Sequenz“ die Karte eines Objekts. Wird die Sequenz später geändert, gelten die Features als veraltet.
- Einträge verwalten: Status (laufend, fertig, fehlgeschlagen, pausiert) mit Farbpunkt in der Liste, 📌 Anheften, ⧉ Duplizieren (ohne Signatur und Revisionen; Verbrauch und Passagen gelten in der Kopie als noch nicht verbucht). Über der Liste: Sortieren (geändert, geöffnet, erstellt, Zeitraum, Titel), Filter nach Art, Status und Zeitraum, ☆ Suche merken (erscheint links unter „Gespeicherte Suchen“) und ☑ Mehrfachauswahl (Projekt, Tag, Status, Papierkorb für viele auf einmal). In der Vorschau einer alten Revision zeigt „Änderungen zum aktuellen Stand“ eingefügte und gelöschte Wörter. Vor dem Abschließen weist das Laborbuch auf Unverbuchtes, leere Ergebnistabellen, leere Tage und offene Aufgaben hin.
- Editor: Fett, Kursiv, Unterstrichen, Durchgestrichen, Hoch- und Tiefstellen (H₂O, 10⁶), Textfarbe und Textmarker, Links (⌘K), Trennlinie, Zellen verbinden. Formeln in LaTeX (im Text `$x^2$` oder über das Einfügemenü; Klick bearbeitet), im PDF und Export als MathML. Suchen & Ersetzen im Eintrag (⌥⌘F). „＋ Einfügen“ sammelt alle Blöcke (Datei, Excel/CSV als Tabelle, Formel, Rechner, Diagramm, Platte, Sequenz …); dieselben Befehle gibt es mit „/“ im Text. ⌘? zeigt alle Tastenkürzel.
- Reiter am Eintrag: „Notizen“, „Metadaten“ (eigene Felder wie Organismus oder Stamm, mit Vorschlägen aus anderen Einträgen), „Verknüpft“ (Registry-Objekte, verbrauchte Chargen, Kulturen, Geräte, Verweise hin und zurück, Literatur, Ergebnisse, Dateien) und je Protokoll ein Reiter. „+ Protokoll“ hängt ein Protokoll (Eintrag der Art „Protokoll“, auch neu aus einer Vorlage) an und schreibt „nach [[…]]“ in den Text; ein Klick auf den Reiter zeigt es rechts neben dem Eintrag. Im Text verlinkte Protokolle erscheinen automatisch als Reiter.
- Laufendes Laborbuch: „📅 Heute“ (⇧⌘D) legt im Eintrag einen Tagesabschnitt wie „Dienstag, 30.6.2026“ an oder springt hin; Tage lassen sich einklappen (⌥-Klick: alle). Die Liste zeigt den Zeitraum des Eintrags (z. B. „📅 30.06.–15.10.2026“). Ein Klick auf einen Suchtreffer oder eine Aufgabe in „Fällig“ springt an die Stelle und klappt den Tag auf. Im PDF und im Markdown-Export steht jeder Tag als Überschrift.
- Erweiterungen: eigene Rechner-Blöcke als .js-Datei im Ordner „Erweiterungen“ (Einstellungen › Erweiterungen: Ordner öffnen, Beispiel „Zellzahl (Neubauer)“ installieren, ein- und ausschalten). Eine Erweiterung bekommt nur die Werte ihrer Felder und liefert Ergebniszeilen; sie läuft in einem eigenen Faden in einem abgeschotteten Rahmen ohne Netz, Dateien oder Zugriff auf das Laborbuch, hängende Rechnungen werden nach 1,5 s abgebrochen. Das Ergebnis steht im Eintrag und bleibt, auch wenn die Erweiterung später fehlt.
- KI-Assistent (nur mit eigenem Anthropic-API-Schlüssel, Einstellungen › KI-Assistent; der Schlüssel liegt im Schlüsselbund): „✨ Zusammenfassen“ fasst den Eintrag zusammen, „✨ Protokoll“ macht aus Stichpunkten (markiert oder ganzer Eintrag) einen Protokoll-Entwurf mit markierten Ergänzungen, „✨ Fragen“ in der Seitenleiste beantwortet Fragen anhand der gefundenen Einträge mit Verweisen [E12]. Vor jedem Senden zeigt eine Vorschau genau, was an Anthropic geht; übernommen wird nur auf Klick und als „bitte prüfen“ markiert. Modell: Claude Opus 5.5. Ohne Schlüssel ist davon nichts zu sehen.
- Kurzbefehle und AppleScript: Links `laborbuch://new?title=…&text=…` (neuer Eintrag), `laborbuch://append?id=…&text=…` (Text anhängen, mit Rückfrage) und `laborbuch://search?q=…` lassen sich in der Kurzbefehle-App mit „URL öffnen“ nutzen. AppleScript: `tell application "Laborbuch" to create entry titled "PCR" with text "…"`, `append text "…" to entry 12`, `find entries "Taq"`, `entry text 12`. Im Dienste-Menü jeder App macht „Neuer Laborbuch-Eintrag“ aus markiertem Text einen Eintrag. Abgeschlossene Einträge bleiben unverändert.
- Chemie (Block „⚗️ Struktur“): SMILES eingeben → Strukturbild, Summenformel (Hill) und Molmasse (IUPAC-Atomgewichte); „→ Einwaage“ fügt den Einwaage-Rechner mit der Molmasse ein. Chemikalien in der Registry haben ein SMILES-Feld, zeigen ihre Struktur und übernehmen die Molmasse per Knopf.
- Gerätedateien: Im Plattenblock übernimmt „📥 Messwerte“ den Export eines Plattenlesers (Raster mit Kopfzeilen wie bei Tecan/BMG oder Liste „A01; Wert“, Komma oder Punkt) und zeigt ihn als Heatmap mit Skala; je Probe stehen Mittelwert ± SD darunter und im PDF. Im Ergebnisblock füllt „📥 NanoDrop-Export“ eine Plasmid-Präp-Tabelle, „📥 qPCR-Export“ (Bio-Rad CFX, QuantStudio) eine qPCR-Tabelle mit gemittelten Replikaten und dem Referenzgen (GAPDH, ACTB … werden erkannt) für ΔCt.
- Fälligkeiten (Seitenleiste „📅 Fällig“): Checklisten-Punkte mit Datum („bis Freitag“, „morgen“, „30.10.“, „2026-11-02“) werden im Text markiert (überfällig rot) und erscheinen zusammen mit fälligen Geräteaufgaben, Mycoplasma-Tests und ablaufenden Chargen in einer Übersicht (überfällig, heute, diese Woche, später); ein Klick öffnet das Objekt. „Als Kalender (.ics) speichern“ erzeugt ganztägige Termine für Apple Kalender; ein erneuter Import aktualisiert statt zu verdoppeln.
- Literatur (Seitenleiste „📚 Literatur“): Quellen per DOI (Crossref) oder PMID (PubMed) holen, BibTeX/RIS/CSL-JSON importieren, als BibTeX exportieren, aus einer laufenden Zotero-App übernehmen (lokale Schnittstelle). Doppelte Quellen werden an DOI/PMID erkannt. Im Eintrag fügt „📚 Quelle“ ein Kurzzitat wie (Sanger et al. 1977) ein; darunter und in PDF, Zeugen-PDF und Export steht automatisch die Literaturliste. Zitate tragen ihren Text selbst, damit abgeschlossene Einträge unverändert bleiben. DOI/PMID im Text: „📚 in die Literatur“.
- Diagramme und Statistik (Block „📈 Diagramm“): Standardkurve mit linearer Regression, Gleichung und R², unbekannte Proben samt Verdünnung (Werte außerhalb der Standards werden markiert); Gruppenvergleich mit Mittelwert ± SD, Einzelwerten und t-Test (Welch, Student oder gepaart; p-Werte wie scipy); x/y-Diagramm mit Ausgleichsgerade. Daten aus Excel einfügen oder „aus Tabelle darüber“ übernehmen; das Ergebnis steht im Text (durchsuchbar) und das Diagramm im PDF/HTML-Export.
- Datenbank-Verweise: Kennungen im Text (GenBank/RefSeq wie L09137 oder NM_000546, UniProt wie P04637, PMID, DOI, Addgene) werden unterstrichen; ⌘-Klick öffnet die Datenbank im Browser. Unter dem Eintrag stehen sie als Liste; „📥 in die Registry“ holt eine Sequenz von NCBI (samt Features, Typ wählbar) bzw. ein Protein von UniProt (Typ „Protein“ wird angelegt). Das ist die einzige Stelle, an der die App von sich aus ins Netz geht – und nur auf Klick.
- Bestellungen (Seitenleiste „🛒 Bestellungen“): knappe oder leere Chargen ohne offene Bestellung erscheinen als Vorschlag; „+ Auf die Liste“ oder „🛒 Nachbestellen“ an der Charge übernimmt Lieferant und Katalognummer. Status offen → bestellt → geliefert (oder storniert) mit unveränderlichem Verlauf; der Wareneingang legt eine neue Charge mit Chargennummer, Ablauf und Standort an. Die offene Liste lässt sich als CSV speichern. „Knapp“ zählt alle gleichartigen Chargen zusammen.
- Zellkultur (Seitenleiste „🧫 Zellkultur“): Kulturen mit Zelllinie, Passage, Gefäß und Medium. Passage, Mediumwechsel, Mycoplasma-Test, Einfrieren, Korrektur und Beenden sind unveränderliche Ereignisse; im Eintrag bucht der Block „↻ Passage“ (z. B. P12 → P13, Split 1:10) mit Verweis auf den Eintrag. Einfrieren legt eine Charge (Röhrchen) im Bestand an; die Einfrierliste zeigt alle Röhrchen mit Passage und Platz, Auftauen startet daraus eine neue Kultur. Gemeldet werden fällige oder positive Mycoplasma-Tests und das Erreichen der Höchstpassage.
- Gerätebuch (Seitenleiste „🔧 Geräte“): Geräte mit wiederkehrenden Aufgaben (Wartung, Kalibrierung, Prüfung, Reinigung) im festen Intervall; „Erledigt“ trägt ins unveränderliche Protokoll ein und rechnet die nächste Fälligkeit aus. Überfällige und bald fällige Aufgaben sowie defekte Geräte (Störung/Reparatur) werden in der Seitenleiste gemeldet.
- Etiketten mit QR-Code („🏷 Etikett“ bei Charge, Registry-Objekt, Standort, Kultur, Gerät; eine Box druckt sich samt Inhalt): PDF für A4-Bögen 3 × 8 oder 4 × 11. Der QR-Code enthält einen `laborbuch://`-Link; Scannen öffnet das Objekt – mit der Kamera (Ablage › „Etikett scannen …“, ⇧⌘K), mit einem Handscanner ins Suchfeld oder per Link aus einer anderen App.
- Plattenlayout (🧫 in der Werkzeugleiste): 96 oder 384 Wells, Proben mit Farbe, Wells per Klick oder Ziehen belegen; die Belegung steht als Text im Eintrag und als Tabelle im PDF.
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
swiftc app/Store.swift app/Registry.swift app/Stock.swift app/Results.swift app/Culture.swift app/Orders.swift app/Sequences.swift app/References.swift app/Agenda.swift app/AutomationStore.swift app/EntryExtras.swift app/EntryManage.swift app/Account.swift tests/main.swift -o /tmp/lb-tests && /tmp/lb-tests      # Speicher, Hash-Kette, Suche, Vorlagen, Läufe
node --test tests/*.test.js                                                           # Rechner gegen Handrechnung, Markdown, Sequenzen und Verdau (pUC19 aus NCBI L09137), Tm gegen Primer3, Kennungen, Statistik gegen scipy, Literaturformate (echte Crossref-/PubMed-Antworten), Termine und iCalendar, Gerätedateien, Summenformeln und Molmassen, Prompts des Assistenten, Tage, Excel/CSV, Versionsvergleich, .ab1 (gegen Biopython) und Klonierung
LABORBUCH_BOOK=/tmp/perf.laborbuch build/AppleSilicon/Laborbuch.app/Contents/MacOS/Laborbuch --perftest   # Editor-Leistung (gibt die Messwerte aus und beendet sich)
LABORBUCH_BOOK=/tmp/self.laborbuch LABORBUCH_KEYFILE=/tmp/self.key LABORBUCH_TESTOUT=/tmp LABORBUCH_BACKUPDIR=/tmp/backup build/AppleSilicon/Laborbuch.app/Contents/MacOS/Laborbuch --selftest   # 222 Prüfungen, darunter: keine unbehandelten JS-Fehler im ganzen Lauf
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
| `app/Stock.swift` | Bestand: Standorte, Chargen, Buchungen, Warnungen |
| `web/stock.js` | Bestand-Oberfläche, Boxen-Raster, Verbrauch-Block |
| `app/QR.swift` | QR-Codes erzeugen und erkennen, Kamera-Scanner |
| `web/labels.js` | Etiketten-PDF, Öffnen per Code |
| `web/plate.js` | Plattenlayout-Block |
| `web/sidebar.js`, `web/sidecal.js` | Seitenleiste: Abschnitte einklappbar (Zustand bleibt), Monatskalender mit Markierung für Einträge und Fälliges, Klick auf einen Tag filtert die Liste |
| `app/Account.swift`, `web/accounts.js` | Lokale Konten (Name + Passwort, PBKDF2 mit eigenem Salz); anlegen, Passwort ändern, löschen unter Einstellungen |
| `app/Results.swift` | Ergebnis-Schemata und -Zeilen, Abfrage über Einträge |
| `web/results.js` | Ergebnis-Block, Auswertung mit Diagramm und CSV |
| `app/Culture.swift` | Zellkultur (Kulturen, Ereignisse, Einfrieren/Auftauen) und Gerätebuch (Aufgaben, Protokoll) |
| `web/culture.js` | Zellkultur- und Geräte-Ansicht, Passage-Block im Eintrag |
| `app/Orders.swift` | Bestellvorschläge, Bestellliste mit Statusverlauf, Wareneingang |
| `web/orders.js` | Bestellungen-Ansicht, Wareneingang, CSV |
| `app/Automation.swift`, `app/AutomationStore.swift`, `app/Laborbuch.sdef` | AppleScript-Wörterbuch und -Befehle, laborbuch://-Aktionen, Dienst |
| `app/Extensions.swift`, `web/extensions.js`, `app/Erweiterungen/` | Erweiterungen laden (Worker im Sandbox-Rahmen), Erweiterungs-Block, Beispiel |
| `app/Assistant.swift`, `web/assistant.js` | KI-Assistent: Schlüssel im Schlüsselbund, Anfrage an die Claude API, Prompts, Vorschau, Antworten mit Quellen |
| `web/chem.js` | SMILES lesen, Summenformel, Molmasse; Struktur-Block |
| `web/vendor/smiles-drawer.min.js` | Strukturbilder (SmilesDrawer 2.4.1, MIT, offline gebündelt; `cd tools && npm run chem`) |
| `web/devfiles.js` | Plattenleser-, NanoDrop- und qPCR-Exporte lesen |
| `app/Agenda.swift`, `web/agenda.js` | Termine erkennen, Übersicht „Fällig“, Kalenderexport |
| `app/References.swift`, `web/refs.js` | Literatur-Bibliothek; BibTeX/RIS/Crossref/PubMed lesen und schreiben, Zitate, Literaturliste |
| `app/EntryExtras.swift`, `web/entrytabs.js` | Angehängte Protokolle, Metadaten, „Verknüpft“; Reiter und Ansicht daneben |
| `app/EntryManage.swift`, `web/manage.js` | Status, Anheften, Duplizieren, Filter, gespeicherte Suchen, Mehrfachauswahl, Versionsvergleich, Prüfung vor dem Abschließen |
| `web/editorplus.js`, `web/xlsx.js` | Formatierung, Formeln, Suchen & Ersetzen, Einfügemenü und „/“, Excel/CSV als Tabelle, Tastenkürzel |
| `web/days.js` | Tagesabschnitte, „+ Heute“, Zeitraum, Springen zur Fundstelle |
| `web/stats.js`, `web/chart.js` | Regression, t-Tests, Tabellen lesen; Diagramm-Block |
| `web/dblinks.js` | Kennungen erkennen, Links im Editor, Abruf von NCBI/UniProt |
| `web/bio.js` | Sequenz-Funktionen: GenBank/FASTA, Motivsuche, ORFs, Übersetzung, Tm, Primer, Enzyme, Verdau |
| `web/molbio.js`, `web/molbio-ui.js` | Sequenz bearbeiten, .ab1 lesen und ausrichten, Klonierung (Restriktion/Ligation, Gibson, Golden Gate) |
| `app/Sequences.swift`, `web/seqview.js` | Sequenz-Anmerkungen (Ring, Features); Karte, Basenansicht, Sequenz-Block |
| `web/` | Oberfläche und Logik (JavaScript), Editor-Bündel |
| `tools/` | Bündeln des Editors, Icon-Erzeugung |
| `tests/` | Speicher-Tests, Browser-Testumgebung |
