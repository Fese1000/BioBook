#!/usr/bin/env python3
"""Führt Übersetzungen in web/lang/en.json zusammen.

Aufruf:  python3 tools/i18n-merge.py teil.json [teil2.json …]
Jede Teildatei ist ein Objekt  deutscher Text → englischer Text. Platzhalter ({0}, {2} …) dürfen die Nummern aus der
Vorlage behalten; sie werden hier nach der Reihenfolge im deutschen Text auf {0}, {1} … umgestellt (der englische Text
verweist mit denselben alten Nummern, darf die Reihenfolge aber ändern). Geprüft wird: gleiche Platzhalter links und rechts,
keine leeren Werte. Widersprüche zu vorhandenen Einträgen werden gemeldet und nicht überschrieben.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANG = os.path.join(ROOT, 'web', 'lang', 'en.json')
PH = re.compile(r'\{(\d+)\}')


def normalize(de, en):
    nums = []
    for m in PH.finditer(de):
        if m.group(1) not in nums: nums.append(m.group(1))
    # gleiche Nummer mehrfach im deutschen Text: nur das erste Vorkommen zählt (Muster hätten sonst zwei Gruppen)
    seen, parts, pos = set(), [], 0
    for m in PH.finditer(de):
        if m.group(1) in seen:
            raise ValueError('Platzhalter {%s} kommt mehrfach vor' % m.group(1))
        seen.add(m.group(1))
    idx = {n: i for i, n in enumerate(nums)}
    de2 = PH.sub(lambda m: '{%d}' % idx[m.group(1)], de)
    missing = set(PH.findall(en)) - set(nums)
    if missing: raise ValueError('englischer Text nutzt unbekannte Platzhalter %s' % sorted(missing))
    if set(nums) - set(PH.findall(en)): raise ValueError('Platzhalter fehlen im englischen Text')
    en2 = PH.sub(lambda m: '{%d}' % idx[m.group(1)], en)
    return de2, en2


def main():
    files = sys.argv[1:]
    if not files: print(__doc__); return 1
    cur = json.load(open(LANG, encoding='utf-8')) if os.path.exists(LANG) else {}
    added = changed = 0
    errors = []
    for f in files:
        for de, en in json.load(open(f, encoding='utf-8')).items():
            if not isinstance(en, str) or not en.strip(): errors.append('leer: %r' % de); continue
            try: de2, en2 = normalize(de, en)
            except ValueError as e: errors.append('%s: %r' % (e, de)); continue
            if de2 in cur and cur[de2] != en2: changed += 1; errors.append('Widerspruch (nicht überschrieben): %r: %r ≠ %r' % (de2, cur[de2], en2)); continue
            if de2 not in cur: added += 1
            cur[de2] = en2
    json.dump(dict(sorted(cur.items())), open(LANG, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('hinzugefügt: %d, gesamt: %d, Widersprüche: %d' % (added, len(cur), changed))
    for e in errors: print('  !', e)
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
