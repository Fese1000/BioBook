// Markdown ↔ BioBook: Einträge (ProseMirror-JSON) als Markdown exportieren, Markdown für den Import in HTML umwandeln.
// Reine Funktionen ohne Oberfläche, getestet in tests/markdown.test.js.
(function (root) {
  'use strict';
  const escHTML = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

  // ---------- Export: JSON → Markdown ----------
  /// ctx: {file(sha, name, mime) → Pfad, entry(id, label) → Pfad, calc(kind, data) → Text}
  function toMarkdown(doc, ctx = {}) {
    const file = ctx.file || ((sha, name) => `files/${sha}`);
    const entry = ctx.entry || (id => `#${id}`);
    const calc = ctx.calc || ((kind) => kind);

    const inline = nodes => (nodes || []).map(n => {
      if (n.type == 'hardBreak') return '  \n';
      if (n.type == 'mention') return `[${n.attrs.label}](${entry(n.attrs.id, n.attrs.label)})`;
      if (n.type == 'cite') return `(${n.attrs.short})`;
      if (n.type != 'text') return '';
      let t = n.text.replace(/([\\`*_[\]#<>|])/g, '\\$1');
      for (const m of n.marks || []) {
        if (m.type == 'bold') t = `**${t}**`;
        else if (m.type == 'italic') t = `*${t}*`;
        else if (m.type == 'strike') t = `~~${t}~~`;
        else if (m.type == 'code') t = '`' + n.text + '`';
        else if (m.type == 'link') t = `[${t}](${m.attrs.href})`;
      }
      return t;
    }).join('');

    const cellText = c => (c.content || []).map(p => inline(p.content)).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ');

    function block(n, indent = '') {
      switch (n.type) {
        case 'paragraph': return indent + inline(n.content);
        case 'heading': return '#'.repeat(n.attrs.level) + ' ' + inline(n.content);
        case 'horizontalRule': return '---';
        case 'codeBlock': return '```' + (n.attrs?.language || '') + '\n' + (n.content || []).map(t => t.text).join('') + '\n```';
        case 'blockquote': return (n.content || []).map(c => block(c)).join('\n\n').split('\n').map(l => '> ' + l).join('\n');
        case 'bulletList': case 'orderedList': case 'taskList':
          return (n.content || []).map((li, i) => {
            const mark = n.type == 'orderedList' ? `${(n.attrs?.start || 1) + i}.` : n.type == 'taskList' ? `- [${li.attrs?.checked ? 'x' : ' '}]` : '-';
            const [first, ...rest] = li.content || [];
            const head = indent + mark + ' ' + (first ? block(first).trim() : '');
            const sub = rest.map(c => block(c, indent + '   ')).join('\n');
            return sub ? head + '\n' + sub : head;
          }).join('\n');
        case 'table': {
          const rows = n.content || [];
          if (!rows.length) return '';
          const head = rows[0].content.map(cellText), cols = head.length;
          return [`| ${head.join(' | ')} |`, `|${' --- |'.repeat(cols)}`, ...rows.slice(1).map(r => `| ${r.content.map(cellText).join(' | ')} |`)].join('\n');
        }
        case 'image': {
          const m = /^lab:\/\/files\/([0-9a-f]{64})$/.exec(n.attrs.src || '');
          const src = m ? file(m[1], n.attrs.alt || 'bild', 'image/') : n.attrs.src;
          const lanes = n.attrs.notes?.shapes?.find(s => s.t == 'lanes');
          const notes = (n.attrs.notes?.shapes || []).filter(s => s.t == 'text').map(s => s.s);
          const cap = [lanes ? 'Spuren: ' + lanes.xs.map((_, i) => (lanes.labels[i] || '').trim() || i + 1).join(', ') : '', ...notes].filter(Boolean).join(' · ');
          return `![${n.attrs.alt || ''}](${src})` + (cap ? `\n*${cap}*` : '');
        }
        case 'file': return `📎 [${n.attrs.name}](${n.attrs.link ? 'file://' + encodeURI(n.attrs.path) : file(n.attrs.sha, n.attrs.name, n.attrs.mime)})`
          + (n.attrs.link ? ` (verlinkt, SHA-256 ${n.attrs.sha})` : '');
        case 'calc': return '> 🧮 ' + calc(n.attrs.kind, n.attrs.data);
        case 'day': return [`## ${ctx.dayLabel ? ctx.dayLabel(n.attrs.date) : n.attrs.date}`, ...(n.content || []).map(c => block(c, indent))].join('\n\n');
        default: return (n.content || []).map(c => block(c, indent)).join('\n\n');
      }
    }
    return (doc?.content || []).map(n => block(n)).filter(s => s !== '').join('\n\n') + '\n';
  }

  // ---------- Import: Markdown → HTML ----------
  function inlineMD(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = escHTML(s)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`)
      .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\s][^_]*)_/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/\\([\\`*_[\]#<>|])/g, '$1');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escHTML(codes[i])}</code>`);
  }

  function fromMarkdown(md) {
    const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    const isTable = j => /^\s*\|.*\|\s*$/.test(lines[j] || '') && /^\s*\|?\s*:?-{3,}/.test(lines[j + 1] || '');
    const listRe = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*$/.test(l)) { i++; continue; }
      let m;
      if ((m = /^```\s*(\S*)/.exec(l))) {
        const body = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
        i++;
        out.push(`<pre><code${m[1] ? ` class="language-${escHTML(m[1])}"` : ''}>${escHTML(body.join('\n'))}</code></pre>`);
      } else if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) {
        const lv = Math.min(3, m[1].length); out.push(`<h${lv}>${inlineMD(m[2].replace(/\s#+\s*$/, ''))}</h${lv}>`); i++;
      } else if (/^\s*(---|\*\*\*|___)\s*$/.test(l)) { out.push('<hr>'); i++; }
      else if (/^>\s?/.test(l)) {
        const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
        out.push(`<blockquote>${fromMarkdown(q.join('\n'))}</blockquote>`);
      } else if (isTable(i)) {
        const cells = r => r.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => inlineMD(c.trim()));
        const head = cells(lines[i]); i += 2;
        const rows = []; while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push(`<table><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`);
      } else if (listRe.test(l)) {
        // Liste mit Unterpunkten über die Einrückung
        const items = [];
        while (i < lines.length && (listRe.test(lines[i]) || (/^\s+\S/.test(lines[i]) && items.length))) {
          const lm = listRe.exec(lines[i]);
          if (lm) items.push({ind: lm[1].length, ord: /\d/.test(lm[2]), task: lm[3], text: lm[4]});
          else items[items.length - 1].text += ' ' + lines[i].trim();
          i++;
        }
        out.push(renderList(items, 0, items.length));
      } else {
        const p = [];
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|```|>|\s*(---|\*\*\*)\s*$)/.test(lines[i]) && !listRe.test(lines[i]) && !isTable(i)) p.push(lines[i++]);
        out.push(`<p>${p.map(inlineMD).join(p.length > 1 ? '<br>' : '')}</p>`);
      }
    }
    return out.join('\n');
  }

  function renderList(items, from, to) {
    const base = items[from].ind, task = !!items[from].task, ord = items[from].ord;
    const tag = task ? 'ul data-type="taskList"' : ord ? 'ol' : 'ul';
    let html = `<${tag}>`;
    for (let k = from; k < to;) {
      const it = items[k];
      let end = k + 1;
      while (end < to && items[end].ind > base) end++;
      const sub = end > k + 1 ? renderList(items, k + 1, end) : '';
      html += task ? `<li data-type="taskItem" data-checked="${/x/i.test(it.task)}"><p>${inlineMD(it.text)}</p>${sub}</li>` : `<li><p>${inlineMD(it.text)}</p>${sub}</li>`;
      k = end;
    }
    return html + `</${tag.split(' ')[0]}>`;
  }

  const MD = {toMarkdown, fromMarkdown};
  if (typeof module != 'undefined' && module.exports) module.exports = MD; else root.MD = MD;
})(this);
