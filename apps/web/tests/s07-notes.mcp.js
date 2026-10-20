async (page) => {
  const base = __BASE_URL__;
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const errors = [];
  const requests = [];
  const output = [];
  const id = '00000000-0000-4000-8000-000000000071';
  const now = new Date().toISOString();
  let note = { id, title: 'Nota sintética', body: 'Texto inicial.', tags: ['teste'], folderId: null, createdAt: now, updatedAt: now, version: 1 };
  let failPatches = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // Apenas o transporte Tauri do teste; assinatura e autorização reais ficam fora deste cenário.
    const payload = btoa(JSON.stringify({ sub: 's07-browser-owner', name: 'Pessoa sintética', email: 'teste@example.invalid' }));
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      invoke: async command => command === 'auth_status' ? { signedIn: true }
        : command === 'auth_id_token' ? 'synthetic.' + payload + '.synthetic' : null,
    };
  });
  await page.route('**/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push(request.method() + ' ' + path);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/v1/notes/summary') return json({ total: 1, words: 2, characters: 14, averageWords: 2, first: now, last: now, windowDays: Number(new URL(request.url()).searchParams.get('days') || 30), createdInWindow: 1, createdPerDay: [{ date: now.slice(0, 10), count: 1 }], tags: [{ tag: 'teste', count: 1 }], topNotes: [{ title: note.title, words: 2 }] });
    if (path === '/v1/notes/metadata') { const { body, ...metadata } = note; return json({ items: [metadata], nextCursor: null }); }
    if (path === '/v1/folders') return json({ items: [] });
    if (path === '/v1/notes/' + id) {
      if (request.method() === 'PATCH') {
        if (failPatches) return route.abort('failed');
        const input = request.postDataJSON();
        if (input.version !== note.version) return json({ error: { code: 'CONFLICT', message: 'Conflito sintético.' } }, 409);
        note = { ...note, ...input, version: note.version + 1, updatedAt: new Date().toISOString() };
      }
      return json(note);
    }
    return json({ error: { code: 'NOT_FOUND', message: 'Rota não esperada no teste: ' + path } }, 404);
  });

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 1440) {
      await Promise.all([
        page.waitForResponse(response => response.url().includes('/notes/summary')),
        page.goto(base + '/#/'),
      ]);
    } else await page.goto(base + '/#/');
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.goto(base + '/#/profile');
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.goto(base + '/#/notes/' + id);
    await page.getByRole('textbox', { name: 'Título', exact: true }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Editor sem overflow ' + width);
    await page.getByRole('textbox', { name: 'Título', exact: true }).focus();
    assert(await page.getByRole('textbox', { name: 'Título', exact: true }).evaluate(el => document.activeElement === el), 'Título recebe foco');
    await page.screenshot({ path: '/tmp/miupy-s07-editor-' + width + '.png', fullPage: true });
    output.push('Home/Perfil/editor ' + width);
  }
  assert(!requests.some(value => value === 'GET /v1/notes'), 'Home/Perfil/árvore não consultam coleção com corpos');

  // IndexedDB real: gravação, revisão condicional e isolamento; os registros são só deste teste.
  const storeResult = await page.evaluate(async () => {
    const { createIndexedDbDraftStore } = await import('/src/lib/notes-draft-store-idb.ts');
    const store = createIndexedDbDraftStore();
    const baseNote = { id: 's07-store-note', title: 'Teste', body: 'Base', tags: [], folderId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 };
    const record = { ownerId: 's07-store-a', noteId: baseNote.id, base: baseNote, draft: { title: 'Teste', body: 'Local', tags: [] }, eol: '\r\n', revision: 2, sending: false, savedAt: Date.now() };
    await store.put(record);
    await store.remove(record.ownerId, record.noteId, 1);
    const retained = await store.get(record.ownerId, record.noteId);
    const other = await store.get('s07-store-b', record.noteId);
    await store.clearOwner(record.ownerId);
    return { retained: retained?.draft.body === 'Local' && retained.eol === '\r\n', isolated: other === null, cleared: (await store.listByOwner(record.ownerId)).length === 0 };
  });
  assert(storeResult.retained && storeResult.isolated && storeResult.cleared, 'Store IndexedDB: revisão/owner/limpeza');
  output.push('IndexedDB real: revisão, EOL, isolamento, limpeza');

  const savedTitle = 'Local durável após reload';
  failPatches = true;
  await page.getByRole('textbox', { name: 'Título', exact: true }).fill(savedTitle);
  await page.waitForFunction(async ({ id }) => {
    const { createIndexedDbDraftStore } = await import('/src/lib/notes-draft-store-idb.ts');
    const saved = await createIndexedDbDraftStore().get('s07-browser-owner', id);
    return saved?.draft.title === 'Local durável após reload';
  }, { id });
  const writesBeforeReload = requests.filter(value => value.startsWith('PATCH')).length;
  await page.reload();
  await page.waitForFunction(() => document.getElementById('editor-title')?.value === 'Local durável após reload');
  output.push('snapshot restaurado após reload antes de confirmação remota');
  // A rede volta: a fila reconcilia e envia o snapshot recuperado.
  failPatches = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent?.includes('Sincronizado'));
  assert(note.title === savedTitle, 'Servidor sintético recebe último snapshot');
  assert(requests.filter(value => value.startsWith('PATCH')).length > writesBeforeReload, 'PATCH após recuperação');
  output.push('reconciliação/reenvio e estado sincronizado');

  // Quota indisponível: a UI precisa anunciar risco e nenhum PATCH pode ultrapassar o disco.
  await page.evaluate(() => {
    window.__s07OriginalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'drafts') throw new DOMException('Quota sintética.', 'QuotaExceededError');
      return window.__s07OriginalPut.apply(this, args);
    };
  });
  const patchesBeforeQuota = requests.filter(value => value.startsWith('PATCH')).length;
  await page.getByRole('textbox', { name: 'Título', exact: true }).fill('Falha local sintética');
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent?.includes('Falha ao proteger localmente'));
  await page.waitForTimeout(2200);
  assert(requests.filter(value => value.startsWith('PATCH')).length === patchesBeforeQuota, 'Falha local impede PATCH');
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__s07OriginalPut; delete window.__s07OriginalPut; });
  await page.getByRole('textbox', { name: 'Título', exact: true }).fill('Proteção local recuperada');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent?.includes('Sincronizado'));
  output.push('quota local visível, zero PATCH até recuperar proteção');

  // Mesmo inválido, o último snapshot fica protegido; logout requer escolha e a limpeza deve concluir.
  await page.getByRole('textbox', { name: 'Título', exact: true }).fill('');
  await page.waitForFunction(async ({ id }) => {
    const { createIndexedDbDraftStore } = await import('/src/lib/notes-draft-store-idb.ts');
    return (await createIndexedDbDraftStore().get('s07-browser-owner', id))?.draft.title === '';
  }, { id });
  await page.goto(base + '/#/profile');
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.getByRole('dialog', { name: 'Sair com alterações não sincronizadas?' }).waitFor();
  await page.getByRole('button', { name: 'Continuar logado', exact: true }).click();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.getByRole('button', { name: 'Sair e descartar', exact: true }).click();
  await page.waitForFunction(async () => {
    const { notesSaver, sessionIdle } = await import('/src/lib/notes-saver.ts');
    const { createIndexedDbDraftStore } = await import('/src/lib/notes-draft-store-idb.ts');
    await sessionIdle();
    return notesSaver.ownerId() === null && (await createIndexedDbDraftStore().listByOwner('s07-browser-owner')).length === 0;
  });
  output.push('rascunho inválido protegido; logout confirmado limpa a conta');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/#/missing-s07');
    await page.getByRole('heading', { name: '404.' }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '404 sem overflow ' + width);
  }
  assert(errors.length === 0, 'Sem pageerror: ' + errors.join('; '));
  return output.concat('404/reduced motion; sem pageerror; sem GET coleção completa').join(' | ');
}
