// Farbschemata: „System“ folgt macOS (hell/dunkel); die übrigen sind bekannte Paletten (Solarized, Nord, Dracula, Gruvbox, One Dark,
// Tokyo Night, Catppuccin, GitHub). Jedes setzt dieselben Farbvariablen; die Kontraste prüft tests/themes.test.js.
(function (root) {
  'use strict';
  const T = (name, dark, bg, side, ink, mut, line, acc, accfg, sel, code) => ({name, dark, vars: {'--bg': bg, '--side': side, '--ink': ink, '--mut': mut, '--line': line, '--acc': acc, '--accfg': accfg, '--sel': sel, '--code': code}});
  const THEMES = {
    system: {name: 'System (hell/dunkel automatisch)', vars: null},
    hell: T('Hell (Standard)', false, '#fbfaf7', '#f1efe9', '#1f1d1a', '#6b665f', '#dedad2', '#2f6f5e', '#ffffff', '#e3eee9', '#f1efe9'),
    dunkel: T('Dunkel (Standard)', true, '#1b1c1e', '#151617', '#e8e6e1', '#9a958d', '#33353a', '#6cc2a6', '#10261f', '#22332d', '#25272b'),
    'github-hell': T('GitHub hell', false, '#ffffff', '#f6f8fa', '#1f2328', '#59636e', '#d1d9e0', '#0969da', '#ffffff', '#ddf4ff', '#f6f8fa'),
    'github-dunkel': T('GitHub dunkel', true, '#0d1117', '#010409', '#e6edf3', '#8d96a0', '#30363d', '#58a6ff', '#0d1117', '#17283d', '#161b22'),
    'solarized-hell': T('Solarized hell', false, '#fdf6e3', '#eee8d5', '#073642', '#586e75', '#d8d0b8', '#1f6fa5', '#fdf6e3', '#e4ecde', '#eee8d5'),
    'solarized-dunkel': T('Solarized dunkel', true, '#002b36', '#00212b', '#a8b5b5', '#8a9c9e', '#0d4553', '#2aa198', '#002b36', '#073642', '#073642'),
    nord: T('Nord', true, '#2e3440', '#272c36', '#eceff4', '#a3adc0', '#3b4252', '#88c0d0', '#2e3440', '#3b4252', '#3b4252'),
    dracula: T('Dracula', true, '#282a36', '#21222c', '#f8f8f2', '#a3a9c4', '#44475a', '#bd93f9', '#282a36', '#44475a', '#343746'),
    'gruvbox-hell': T('Gruvbox hell', false, '#fbf1c7', '#f2e5bc', '#3c3836', '#665c54', '#d5c4a1', '#6e690c', '#fbf1c7', '#ebdbb2', '#f2e5bc'),
    'gruvbox-dunkel': T('Gruvbox dunkel', true, '#282828', '#1d2021', '#ebdbb2', '#a89984', '#3c3836', '#b8bb26', '#282828', '#3c3836', '#32302f'),
    'one-dark': T('One Dark', true, '#282c34', '#21252b', '#bcc3cf', '#8f97a5', '#3e4451', '#61afef', '#21252b', '#323844', '#2c313a'),
    'tokyo-night': T('Tokyo Night', true, '#1a1b26', '#16161e', '#c0caf5', '#8d96c0', '#292e42', '#7aa2f7', '#1a1b26', '#292e42', '#1f2335'),
    'catppuccin-latte': T('Catppuccin Latte', false, '#eff1f5', '#e6e9ef', '#40425a', '#5c5f77', '#ccd0da', '#8839ef', '#ffffff', '#dce0e8', '#e6e9ef'),
    'catppuccin-mocha': T('Catppuccin Mocha', true, '#1e1e2e', '#181825', '#cdd6f4', '#a6adc8', '#313244', '#cba6f7', '#1e1e2e', '#313244', '#313244'),
  };

  const lum = hex => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  /// WCAG-Kontrastverhältnis zweier Farben (#rrggbb)
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  root.Themes = {THEMES, contrast, ids: Object.keys(THEMES), valid: id => Object.prototype.hasOwnProperty.call(THEMES, id)};
  if (typeof module != 'undefined') module.exports = root.Themes;
})(typeof window != 'undefined' ? window : globalThis);
