#!/usr/bin/env python3
"""Sammelt die sichtbaren deutschen Texte aus web/*.js und web/index.html für web/lang/en.json.

Aufruf:  python3 tools/i18n-extract.py [--missing] [Ausgabedatei.json]
  ohne Option: alle Kandidaten; mit --missing: nur die, die noch nicht in web/lang/en.json stehen.

Wechselnde Teile (${…}) werden zu {0}, {1} …; HTML-Vorlagen werden in die Textstücke zwischen den Tags und in Attribute
(title, placeholder, aria-label, alt) zerlegt, so wie sie später als Textknoten im DOM stehen. Die Ausgabe ist eine
Arbeitsliste: Schlüssel → Fundstellen. Englische und technische Zeichenketten werden von Hand aussortiert.
"""
import glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATTR = re.compile(r'\b(?:title|placeholder|aria-label|alt|label)="([^"]*)"')
TAG = re.compile(r'<[^>]*>')
SKIP_FILES = {'assistant.js'}   # Regex-Literale und KI-Anweisungen: von Hand (siehe web/assistant.js)


def tokenize(src):
    """Liefert (Art, Inhalt, Zeile) für jede Zeichenkette; Inhalt hat ${…} als \x00n\x00."""
    out, i, n, line = [], 0, len(src), 1
    prev = ''   # letztes bedeutsames Zeichen (für Regex-Erkennung)
    nested = []   # Zeichenketten innerhalb von ${…}

    def string(q, i, line0):
        """Ab dem Zeichen nach der öffnenden Anführung lesen; gibt (inhalt, neues i, zeilen) zurück."""
        buf, k, lines, idx = [], i, 0, 0
        while k < n:
            c = src[k]
            if c == '\\' and k + 1 < n:
                nx = src[k + 1]
                buf.append({'n': '\n', 't': '\t'}.get(nx, nx)); k += 2; continue
            if c == q: return ''.join(buf), k + 1, lines
            if c == '\n':
                lines += 1
                if q != '`': return ''.join(buf), k, lines   # nicht abgeschlossen
            if q == '`' and c == '$' and k + 1 < n and src[k + 1] == '{':
                depth, k2 = 1, k + 2
                while k2 < n and depth:
                    d = src[k2]
                    if d in '\'"`':
                        _, k2, l2 = string(d, k2 + 1, 0); lines += l2; continue
                    if d == '{': depth += 1
                    elif d == '}': depth -= 1
                    elif d == '\n': lines += 1
                    k2 += 1
                inner = src[k + 2:k2 - 1]
                for kind2, s2, l2 in tokenize(inner): nested.append((kind2, s2, line0 + lines - inner.count('\n') + l2 - 1))
                buf.append('\x00%d\x00' % idx); idx += 1; k = k2; continue
            buf.append(c); k += 1
        return ''.join(buf), k, lines

    while i < n:
        c = src[i]
        if c == '\n': line += 1; i += 1; continue
        if c in ' \t\r': i += 1; continue
        if src.startswith('//', i):
            while i < n and src[i] != '\n': i += 1
            continue
        if src.startswith('/*', i):
            j = src.find('*/', i + 2); j = n if j < 0 else j + 2
            line += src.count('\n', i, j); i = j; continue
        if c in '\'"`':
            nested.clear()
            s, j, lines = string(c, i + 1, line)
            out.append((c, s, line)); out.extend(nested); nested.clear(); line += lines; i = j; prev = 'x'; continue
        if c == '/' and prev in ('', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '>', '+'):
            # Regex-Literal überspringen
            j, cls = i + 1, False
            while j < n and src[j] != '\n':
                if src[j] == '\\': j += 2; continue
                if src[j] == '[': cls = True
                elif src[j] == ']': cls = False
                elif src[j] == '/' and not cls: break
                j += 1
            i = j + 1; prev = 'x'; continue
        prev = c; i += 1
    return out


def norm(s):
    return re.sub(r'\s+', ' ', s).strip()


def pieces(kind, s):
    """Textstücke einer Zeichenkette: bei HTML die Texte zwischen den Tags und Attributwerte, sonst die ganze Zeichenkette."""
    res = []
    if '<' in s and '>' in s and TAG.search(s):
        for m in ATTR.finditer(s): res.append(m.group(1))
        res.extend(TAG.sub('\x01', s).split('\x01'))
    else:
        res.append(s)
    return res


def keyfor(p):
    p = norm(p)
    if not p: return None
    # Platzhalter durchnummerieren: \x00n\x00 → {n}
    p = re.sub(r'\x00(\d+)\x00', lambda m: '{%s}' % m.group(1), p)
    if not re.search(r'[A-Za-zÄÖÜäöüß]{2}', re.sub(r'\{\d+\}', '', p)): return None
    return p


def looks_code(p):
    plain = re.sub(r'\{\d+\}', '', p).strip()
    if not plain: return True
    if len(plain) > 400 or re.search(r'=>|\);|function |\bconst |\blet |\breturn |\.innerHTML|\$\{|\bawait |\bif \(', plain): return True   # Code-Reste
    if re.match(r'^[a-z][A-Za-z0-9_.#:/\[\]=,()\-]*$', plain): return True        # Bezeichner, Selektoren, Ereignisse
    if re.match(r'^(https?:|lab:|data:|[./#])', plain): return True
    if re.match(r'^[A-Za-z0-9_.\-]+\.(js|css|json|png|svg|csv|tsv|html|pdf|md|txt)$', plain): return True
    if re.match(r'^[#.&<>=/\\|{}()\[\]:;,%\d\s\-+*]+$', plain): return True
    return False


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    missing = '--missing' in sys.argv
    out = args[0] if args else None
    have = {}
    lang = os.path.join(ROOT, 'web', 'lang', 'en.json')
    if missing and os.path.exists(lang): have = json.load(open(lang, encoding='utf-8'))
    renum = lambda k: re.sub(r'\{\d+\}', lambda m, c=iter(range(99)): '{%d}' % next(c), k)
    have = {renum(k) for k in have}
    found = {}
    files = sorted(glob.glob(os.path.join(ROOT, 'web', '*.js')))
    for f in files:
        src = open(f, encoding='utf-8').read()
        name = os.path.basename(f)
        if name in SKIP_FILES: continue
        limit = None
        if name == 'app.js':   # der Selbsttest am Ende enthält nur Prüfmeldungen
            m = re.search(r'^(?:async )?function selfTest\b', src, re.M)
            if m: limit = src[:m.start()].count('\n') + 1
        for kind, s, line in tokenize(src):
            if limit and line >= limit: continue
            for p in pieces(kind, s):
                k = keyfor(p)
                if not k or looks_code(k) or renum(k) in have: continue
                found.setdefault(k, []).append('%s:%d' % (name, line))
    html = open(os.path.join(ROOT, 'web', 'index.html'), encoding='utf-8').read()
    body = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.S)
    for m in ATTR.finditer(body):
        k = keyfor(m.group(1))
        if k and not looks_code(k) and renum(k) not in have: found.setdefault(k, []).append('index.html')
    for t in TAG.sub('\x01', body).split('\x01'):
        k = keyfor(t)
        if k and not looks_code(k) and renum(k) not in have: found.setdefault(k, []).append('index.html')
    ordered = dict(sorted(found.items(), key=lambda kv: (kv[1][0].split(':')[0], int(kv[1][0].split(':')[1]) if ':' in kv[1][0] else 0)))
    if out: json.dump(ordered, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('%d Kandidaten' % len(ordered), file=sys.stderr)
    if not out: print(json.dumps(ordered, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
