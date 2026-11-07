// Konten in den Einstellungen: anlegen, Passwort ändern, löschen. Die Passwörter gehen nur an die Brücke und werden dort gehasht.
const PW_MIN = 8;

async function accountsHTML() {
  const names = await call('accounts').catch(() => []);
  return `<h4>Konten</h4>
    <p class="sub">Lokale Konten dieses BioBooks (Name + Passwort). Das Passwort wird nicht gespeichert, nur ein Hash mit eigenem Salz. Vergessene Passwörter lassen sich nicht wiederherstellen.</p>
    <div id="accList">${names.map(n => `<p class="row accrow" data-acc="${esc(n)}"><span style="flex:1">${esc(n)}</span>
      <button type="button" class="btn" data-accpw="${esc(n)}">Passwort ändern</button><button type="button" class="btn danger" data-accdel="${esc(n)}">Löschen</button></p>`).join('') || '<p class="sub">Noch kein Konto.</p>'}</div>
    <div id="accForm" class="row" style="flex-wrap:wrap;gap:6px"></div>
    <p class="sub bad" id="accMsg" role="alert"></p>
    <p class="row"><button type="button" class="btn" id="accNew">+ Konto anlegen</button></p>`;
}

/// Eingabezeile mit Passwortfeldern; Enter löst die Aktion aus, schließt aber nicht den Einstellungsdialog
function accountForm(title, fields, label, action) {
  const box = $('#accForm');
  box.innerHTML = `<b style="flex-basis:100%">${esc(title)}</b>${fields.map(([id, ph, type]) =>
    `<input id="${id}" type="${type}" placeholder="${esc(ph)}" autocomplete="off" style="flex:1;min-width:140px">`).join('')}
    <button type="button" class="btn on" id="accGo">${esc(label)}</button><button type="button" class="btn" id="accNo">Abbrechen</button>`;
  const go = async () => {
    $('#accMsg').textContent = '';
    try { await action(); await refreshAccounts(); }
    catch (e) { $('#accMsg').textContent = e.message || String(e); }
  };
  $('#accGo').onclick = go;
  $('#accNo').onclick = () => { box.innerHTML = ''; $('#accMsg').textContent = ''; };
  box.onkeydown = e => { if (e.key == 'Enter') { e.preventDefault(); go(); } };
  box.querySelector('input').focus();
}

async function refreshAccounts() {
  const html = await accountsHTML(), tmp = document.createElement('div');
  tmp.innerHTML = html;
  $('#accList').replaceWith(tmp.querySelector('#accList'));
  $('#accForm').innerHTML = '';
  bindAccountRows();
}

function bindAccountRows() {
  document.querySelectorAll('[data-accpw]').forEach(b => b.onclick = () => {
    const name = b.dataset.accpw;
    accountForm(`Passwort für ${name} ändern`, [['accOld', 'aktuelles Passwort', 'password'], ['accNew1', `neues Passwort (mind. ${PW_MIN} Zeichen)`, 'password'], ['accNew2', 'neues Passwort wiederholen', 'password']], 'Ändern', async () => {
      if ($('#accNew1').value != $('#accNew2').value) throw new Error('Die beiden neuen Passwörter sind verschieden');
      await call('changePassword', {name, old: $('#accOld').value, new: $('#accNew1').value});
      status(`Passwort für ${name} geändert`);
    });
  });
  document.querySelectorAll('[data-accdel]').forEach(b => b.onclick = () => {
    const name = b.dataset.accdel;
    accountForm(`Konto ${name} löschen – zur Bestätigung das Passwort eingeben`, [['accPw', 'Passwort', 'password']], 'Endgültig löschen', async () => {
      await call('deleteAccount', {name, password: $('#accPw').value});
      status(`Konto ${name} gelöscht`);
    });
  });
}

function bindAccounts() {
  $('#accNew').onclick = () => accountForm('Neues Konto', [['accName', 'Name', 'text'], ['accPw1', `Passwort (mind. ${PW_MIN} Zeichen)`, 'password'], ['accPw2', 'Passwort wiederholen', 'password']], 'Anlegen', async () => {
    if ($('#accPw1').value != $('#accPw2').value) throw new Error('Die beiden Passwörter sind verschieden');
    await call('createAccount', {name: $('#accName').value, password: $('#accPw1').value});
    status('Konto angelegt');
  });
  bindAccountRows();
}
