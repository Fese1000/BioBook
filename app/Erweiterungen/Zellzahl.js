// Beispiel-Erweiterung für das BioBook: Zellzahl aus der Neubauer-Zählkammer.
// Erweiterungen laufen abgeschottet (kein Netz, keine Dateien, kein Zugriff auf das BioBook);
// sie bekommen nur die Werte ihrer Felder und liefern Ergebniszeilen zurück.
biobook.register({
  id: 'zellzahl',
  name: 'Zellzahl (Neubauer)',
  version: '1.0',
  blocks: [{
    id: 'neubauer',
    title: 'Zellzahl (Neubauer-Kammer)',
    icon: '🔬',
    fields: [
      {key: 'lebend', label: 'Lebende Zellen (Summe)', type: 'number'},
      {key: 'tot', label: 'Tote Zellen, blau (Summe)', type: 'number'},
      {key: 'quadrate', label: 'Gezählte Großquadrate', type: 'number', default: '4'},
      {key: 'verd', label: 'Verdünnung (inkl. Trypanblau)', type: 'number', default: '2'},
      {key: 'volumen', label: 'Volumen der Suspension', type: 'number', unit: 'ml'},
    ],
    compute(v) {
      const n = x => parseFloat(String(x ?? '').replace(',', '.'));
      const lebend = n(v.lebend), tot = n(v.tot) || 0, q = n(v.quadrate) || 4, verd = n(v.verd) || 1, vol = n(v.volumen);
      if (!(lebend >= 0) || !(q > 0)) return [];
      const konz = lebend / q * verd * 1e4;          // Zellen pro ml (Großquadrat = 0,1 µl)
      const rows = [{label: 'Lebende Zellen', value: konz, unit: 'Zellen/ml'},
                    {label: 'Viabilität', value: lebend + tot ? lebend / (lebend + tot) * 100 : null, unit: '%'}];
      if (vol > 0) rows.push({label: 'Gesamt', value: konz * vol, unit: 'Zellen'});
      return rows;
    },
  }],
});
