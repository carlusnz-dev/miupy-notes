async (page) => {
 const profileOnly = false;
 if (profileOnly) {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const base = 'http://127.0.0.1:5202/tests/profile-finance-harness.html';
  const totals = { currencies: [{ currency: 'BRL', incomeCents: 12000, expenseCents: 2000, balanceCents: 10000, count: 3 }] };
  const notes = { total: 0, words: 0, characters: 0, averageWords: 0, first: null, last: null, windowDays: 30, createdInWindow: 0, createdPerDay: [], tags: [], topNotes: [] };
  const evidence = [];
  for (const mode of ['notes-error', 'notes-pending', 'finance-error', 'profile-error', 'signed-out', 'preview']) {
   let notesCalls = 0, financeCalls = 0, releasePending;
   await page.unrouteAll({ behavior: 'ignoreErrors' });
   await page.route('**/v1/notes/summary**', async route => {
    notesCalls++;
    if (mode === 'notes-pending' || mode === 'finance-error') await new Promise(resolve => { releasePending = resolve; });
    await route.fulfill({ status: mode === 'notes-error' ? 500 : 200, contentType: 'application/json', body: JSON.stringify(mode === 'notes-error' ? { error: { code: 'INTERNAL_ERROR', message: 'Falha sintética de notas.' } } : notes) }).catch(() => {});
   });
   await page.route('**/v1/finance/summary', route => {
    financeCalls++;
    return route.fulfill({ status: mode === 'finance-error' ? 500 : 200, contentType: 'application/json', body: JSON.stringify(mode === 'finance-error' ? { error: { code: 'INTERNAL_ERROR', message: 'Falha sintética financeira.' } } : totals) });
   });
   await page.goto(base + '?mode=' + mode + (mode === 'preview' ? '&estado=lista' : ''));
   if (mode === 'signed-out' || mode === 'preview') {
    if (mode === 'signed-out') await page.getByText('Perfil indisponível no navegador', { exact: true }).waitFor();
    else await page.locator('.profile-identity').waitFor();
    await page.waitForTimeout(100);
    assert(financeCalls === 0, mode + ' não deve consultar finanças');
    assert(await page.locator('.profile-finance').count() === 0, mode + ' sem dados financeiros');
   } else {
    await page.getByRole('heading', { name: 'Finanças', exact: true }).waitFor();
    if (mode === 'finance-error') await page.getByText('Não foi possível carregar as métricas financeiras.', { exact: false }).waitFor();
    else await page.locator('.profile-finance').getByText('R$ 100,00', { exact: true }).waitFor();
    assert(financeCalls === 1 && notesCalls === 1, mode + ' consultas independentes');
    if (mode === 'notes-error' || mode === 'profile-error') await page.getByText('Não foi possível carregar o perfil.', { exact: true }).waitFor();
    if (mode === 'notes-pending') assert(await page.getByText('Carregando perfil', { exact: true }).count() === 1, 'Notas continuam pendentes enquanto finanças renderiza');
   }
   releasePending?.();
   evidence.push(mode);
  }
  return evidence;
 }

 const assert = (v,m) => { if(!v) throw Error(m); };
 const evidence=[];
 for (const width of [1440,390]) {
  await page.setViewportSize({width,height:900});
  await page.goto('http://127.0.0.1:5202/tests/finance-balances-harness.html');
  await page.getByRole('button',{name:'Novo lançamento'}).click();
  await page.locator('.modal-panel').waitFor();
  await page.waitForTimeout(350);
  const box = await page.locator('.modal-close').boundingBox();
  const panel = await page.locator('.modal-panel').boundingBox();
  assert(box.width>=44 && box.height>=44 && box.y>=0 && box.y+box.height<=panel.y, 'X externo acessível '+JSON.stringify({box,panel}));
  assert(await page.getByRole('dialog',{name:'Novo lançamento'}).count()===1,'Nome do dialog');
  await page.getByRole('button',{name:'Continuar'}).click();
  assert(await page.getByText('Etapa 1 de 2',{exact:false}).count()===1,'Validação etapa 1');
  await page.getByLabel('Título',{exact:true}).fill('Compra sintética');
  await page.getByLabel('Categoria',{exact:true}).fill('Casa');
  await page.getByLabel('Valor',{exact:true}).fill('120,00');
  await page.getByRole('button',{name:'Continuar'}).click();
  await page.getByText('Etapa 2 de 2',{exact:false}).waitFor();
  await page.getByLabel('Método de pagamento').selectOption('card');
  await page.getByLabel('Compra parcelada').check();
  await page.getByLabel('Número de parcelas').fill('3');
  await page.getByRole('button',{name:'Voltar',exact:true}).click();
  assert(await page.getByLabel('Título',{exact:true}).inputValue()==='Compra sintética','Título preservado');
  assert(await page.getByLabel('Valor total da compra').inputValue()==='120,00','Centavos preservados');
  await page.getByRole('button',{name:'Continuar'}).click();
  assert(await page.getByLabel('Número de parcelas').inputValue()==='3','Parcelas preservadas');
  await page.waitForTimeout(350);
  await page.screenshot({path:'/tmp/finance-step2-'+width+'.png'});
  await page.getByRole('button',{name:'Salvar lançamento'}).click();
  await page.waitForFunction(()=>document.querySelector('#saved').textContent.includes('Compra sintética'));
  const data=JSON.parse(await page.locator('#saved').textContent());
  assert(data.amountCents===12000 && data.installmentCount===3 && data.accountId===null,'Payload exato '+JSON.stringify(data));
  await page.waitForTimeout(250);
  assert(await page.locator('.modal-exit-backdrop').count()===0,'Limpeza animação saída');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Sem overflow '+width);
  await page.getByRole('button',{name:'Novo lançamento'}).click();
  await page.waitForTimeout(350);
  // Desmontagem síncrona pelo consumidor: saída deve sobreviver como cópia inerte.
  const exit = await page.evaluate(async()=>{
    document.querySelector('.modal-close').click();
    await new Promise(r=>requestAnimationFrame(r));
    const ghost=document.querySelector('.modal-exit-backdrop');
    return {exists:!!ghost,inert:ghost?.inert,hidden:ghost?.getAttribute('aria-hidden')};
  });
  assert(exit.exists && exit.inert && exit.hidden==='true','Saída sobrevivente '+JSON.stringify(exit));
  await page.waitForTimeout(250);
  assert(await page.locator('.modal-exit-backdrop').count()===0,'Cópia removida');
  if(width===1440) {
   assert(await page.getByRole('link',{name:'Finanças',exact:true}).count()===1,'Nome acessível da sidebar');
   await page.getByRole('button',{name:'Recolher menu'}).click();
   await page.waitForTimeout(700);
   assert(await page.getByRole('button',{name:'Expandir menu'}).count()===1,'Recolher animado');
   assert(await page.getByRole('link',{name:'Finanças',exact:true}).count()===1,'Nome preservado recolhido');
   await page.getByRole('button',{name:'Expandir menu'}).click();
   await page.waitForTimeout(900);
   assert(await page.locator('.sidebar-letter').first().evaluate(e=>getComputedStyle(e).opacity)==='1','Letras animadas visíveis');
  }
  evidence.push('formulário, parcelas, X, saída e overflow '+width);
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:'Novo lançamento'}).click();
 await page.waitForTimeout(50);
 assert(await page.locator('dialog.modal').evaluate(e=>getComputedStyle(e).opacity)==='1','Reduced entrada');
 await page.getByRole('button',{name:'Fechar janela'}).click();
 await page.waitForTimeout(30);
 assert(await page.locator('.modal-exit-backdrop').count()===0,'Reduced saída sem cópia');
 evidence.push('reduced-motion');
 await page.getByRole('button',{name:'Instituições',exact:true}).click();
 await page.getByRole('heading',{name:'Contas e saldos'}).waitFor();
 assert(await page.getByText('Calculado: R$ 80,00').count()===1,'Saldo calculado distinto da referência');
 await page.getByLabel('Nome da conta').fill('Conta devedora');
 await page.getByLabel('Saldo de referência em centavos').fill('-12345');
 await page.getByRole('button',{name:'Salvar conta',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#saved').textContent==='Conta salva');
 await page.getByRole('button',{name:'Fechar janela'}).click();
 evidence.push('referência negativa e saldo calculado');
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:900});
  await page.goto('http://127.0.0.1:5202/#/');
  await page.locator('.page-content h1').waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Home sem overflow '+width);
  await page.goto('http://127.0.0.1:5202/#/pagina-inexistente');
  await page.getByRole('heading',{name:'404.'}).waitFor();
  assert(await page.getByRole('link',{name:'Voltar ao início'}).count()===1,'404 com retorno '+width);
 }
 evidence.push('Home/404 desktop e mobile');
 return evidence;
}
