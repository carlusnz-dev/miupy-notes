"""Teste de MoneyInput, DatePicker e campos condicionais do formulário financeiro
(tests/finance-harness.html, API interceptada) pelo Playwright MCP de .mcp.json.

Uso: python3 apps/web/tests/finance-inputs.mcp.py http://127.0.0.1:1450
O Vite deve estar ativo sem arquivos .env (envDir vazio); só dados sintéticos e nenhum login.
"""
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
config = json.loads((root / '.mcp.json').read_text())['mcpServers']['playwright']
server = subprocess.Popen([config['command'], *config['args']], cwd=root,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
request_id = 0


def rpc(method, params):
    global request_id
    request_id += 1
    server.stdin.write(json.dumps(dict(jsonrpc='2.0', id=request_id, method=method, params=params)) + '\n')
    server.stdin.flush()
    for line in server.stdout:
        try:
            response = json.loads(line)
        except json.JSONDecodeError:
            continue
        if response.get('id') == request_id:
            if 'error' in response:
                raise RuntimeError(response['error'])
            return response['result']
    raise RuntimeError('Playwright MCP encerrou antes de responder.')


def call(name, arguments):
    result = rpc('tools/call', dict(name=name, arguments=arguments))
    if result.get('isError'):
        raise RuntimeError(result['content'])
    return result


try:
    rpc('initialize', dict(protocolVersion='2024-11-05', capabilities={},
                           clientInfo=dict(name='finance-inputs-test', version='1')))
    server.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    server.stdin.flush()
    names = {tool['name'] for tool in rpc('tools/list', {})['tools']}
    run_code = 'browser_run_code' if 'browser_run_code' in names else 'browser_run_code_unsafe'
    base_url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:1450'
    code = r"""async (page) => {
      const base = %s;
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const out = [];
      const sent = [];
      await page.route('**/v1/finance/transactions**', async (route) => {
        const request = route.request();
        const body = request.postDataJSON();
        sent.push({ method: request.method(), body });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...body, id: '33333333-3333-4333-8333-333333333333', bankTitle: null, createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', version: 4 }) });
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(base + '/tests/finance-harness.html');
      await page.locator('#new').click();
      const amount = page.getByLabel('Valor', { exact: true });
      const value = () => amount.inputValue();
      const paste = (text) => amount.evaluate((el, text) => { const data = new DataTransfer(); data.setData('text', text); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }, text);
      const error = () => page.locator('.money-error').textContent().catch(() => '');

      // MoneyInput: digitação, centavos, backspace, caret, colagem, erro.
      await amount.click();
      await page.keyboard.type('1234567,59');
      assert(await value() === '1.234.567,59', 'Formata ao vivo: ' + await value());
      await page.keyboard.type('7');
      assert(await value() === '1.234.567,59' && (await error()).includes('duas casas'), 'Terceira casa recusada com erro');
      for (let i = 0; i < 2; i++) await page.keyboard.press('Backspace');
      assert(await value() === '1.234.567,' , 'Backspace nas casas: ' + await value());
      await page.keyboard.type('a');
      assert(await value() === '1.234.567,' && (await error()).includes('números'), 'Letra gera erro e não altera');
      await amount.fill('');
      await page.keyboard.type('1234');
      await page.keyboard.press('Home');
      await page.keyboard.type('5');
      assert(await value() === '51.234' && await amount.evaluate(el => el.selectionStart) === 1, 'Caret após inserir no início: ' + await value());
      await page.keyboard.type('6');
      assert(await value() === '561.234' && await amount.evaluate(el => el.selectionStart) === 2, 'Caret após milhar reformatado');
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Backspace');
      assert(await value() === '56.234', 'Backspace logo após o ponto de milhar apaga o dígito anterior: ' + await value());
      await amount.selectText();
      await page.keyboard.type('9');
      assert(await value() === '9', 'Seleção substituída');
      await paste('R$ 1.234,56');
      assert(await value() === '1.234,56', 'Colagem pt-BR: ' + await value());
      await paste('1234.5');
      assert(await value() === '1.234,5', 'Colagem com ponto decimal');
      await paste('-3,00');
      assert(await value() === '1.234,5' && (await error()).includes('negativos'), 'Colagem negativa recusada');
      await amount.fill('');
      await page.keyboard.type('0,01');
      assert(await value() === '0,01', 'Um centavo');
      await amount.fill(''); await amount.click(); await page.keyboard.type('0'); await page.locator('input[name=title]').click();
      assert(await value() === '0,00' && await amount.evaluate(el => el.validationMessage) === 'Informe um valor maior que zero.', 'Zero é inválido com mensagem');
      await amount.fill(''); await amount.click(); await page.keyboard.type('67'); await page.locator('input[name=title]').click();
      assert(await value() === '67,00', 'Completa casas ao sair');

      // Moeda e prefixo.
      const prefix = () => page.locator('.money-prefix').textContent();
      assert(await prefix() === 'R$', 'Prefixo BRL');
      await page.getByLabel('Moeda', { exact: true }).selectOption('EUR');
      assert(await prefix() === '€' && await value() === '67,00', 'Prefixo EUR sem perder o valor');
      await page.getByLabel('Moeda', { exact: true }).selectOption('USD');
      assert((await prefix()).includes('$') && await prefix() !== 'R$', 'Prefixo USD');
      await page.getByLabel('Moeda', { exact: true }).selectOption('BRL');

      // Campos condicionais.
      const method = page.getByLabel('Método de pagamento');
      assert(await method.count() === 1, 'Método visível em saída');
      await page.getByLabel('Tipo', { exact: true }).selectOption('income');
      assert(await method.count() === 0, 'Método some em entrada');
      await page.getByLabel('Tipo', { exact: true }).selectOption('expense');
      assert(await method.count() === 1, 'Método volta em saída');
      assert(await page.getByLabel('Mês de referência').count() === 0, 'Mês oculto sem vínculo');
      await page.getByLabel('Vínculo', { exact: true }).selectOption('salary');
      assert(await page.getByLabel('Mês de referência').count() === 1 && await page.getByLabel('Ano de referência').count() === 1, 'Mês visível com vínculo');
      await page.getByLabel('Vínculo', { exact: true }).selectOption('none');
      assert(await page.getByLabel('Mês de referência').count() === 0, 'Mês some sem vínculo');
      out.push('money+condicionais');

      // DatePicker: máscara, validade, calendário por teclado, Esc, clique fora.
      const date = page.getByLabel('Data', { exact: true });
      await date.fill('');
      await date.click();
      await page.keyboard.type('29022026');
      assert(await date.inputValue() === '29/02/2026' && await date.evaluate(el => el.validationMessage) !== '' && await page.locator('.date-error').count() === 1, 'Data inexistente recusada');
      await date.fill('');
      await page.keyboard.type('29022024');
      assert(await date.inputValue() === '29/02/2024' && await date.evaluate(el => el.validationMessage) === '', 'Ano bissexto aceito');
      await page.getByRole('button', { name: /Abrir calendário/ }).click();
      const popover = page.getByRole('dialog', { name: /Escolher data/ });
      await popover.waitFor();
      assert(await page.getByRole('grid', { name: 'Fevereiro de 2024' }).count() === 1, 'Grade do mês');
      assert(await page.getByRole('gridcell', { selected: true }).count() === 1, 'Dia selecionado marcado');
      assert(await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === '29 de fevereiro de 2024', 'Foco no dia selecionado');
      await page.keyboard.press('ArrowRight');
      assert(await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === '1 de março de 2024', 'Seta cruza o mês');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Home');
      assert(await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === '3 de março de 2024', 'Início da semana');
      await page.keyboard.press('PageDown');
      assert(await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === '3 de abril de 2024', 'PageDown muda de mês');
      await page.keyboard.press('Escape');
      await popover.waitFor({ state: 'detached' });
      assert(await page.locator('dialog.finance-modal').count() === 1, 'Esc fecha só o calendário');
      assert(await page.evaluate(() => document.activeElement.id !== '' && document.activeElement.matches('.date-control input')), 'Foco volta ao campo');
      await page.getByRole('button', { name: /Abrir calendário/ }).click();
      await popover.waitFor();
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Enter');
      await popover.waitFor({ state: 'detached' });
      assert(await date.inputValue() === '28/02/2024', 'Enter seleciona: ' + await date.inputValue());
      await page.getByRole('button', { name: /Abrir calendário/ }).click();
      await popover.waitFor();
      await page.getByLabel('Ano', { exact: true }).selectOption('2025');
      await page.getByLabel('Mês', { exact: true }).selectOption('3');
      await page.getByRole('button', { name: '15 de março de 2025' }).click();
      assert(await date.inputValue() === '15/03/2025', 'Mês/ano e clique');
      await page.getByRole('button', { name: /Abrir calendário/ }).click();
      await popover.waitFor();
      await page.locator('.finance-modal h2').click();
      await popover.waitFor({ state: 'detached' });
      assert(await page.locator('dialog.finance-modal').count() === 1, 'Clique fora fecha só o calendário');
      out.push('datepicker');

      // Envio: centavos exatos e ISO; saída com método, sem mês.
      await page.locator('input[name=title]').fill('Pizza');
      await page.locator('input[name=category]').fill('Comida');
      await date.fill('');
      await page.keyboard.type('29022024');
      await amount.fill(''); await amount.click(); await page.keyboard.type('67,13');
      await page.getByRole('button', { name: 'Salvar lançamento' }).click();
      await page.waitForFunction(() => document.getElementById('saved').textContent !== '');
      let last = sent.at(-1);
      assert(last.method === 'POST' && last.body.amountCents === 6713 && last.body.date === '2024-02-29' && last.body.currency === 'BRL' && last.body.paymentMethod === 'pix' && last.body.linkedMonth === null && last.body.link === 'none', 'Payload saída: ' + JSON.stringify(last));

      // Entrada com vínculo: sem método, com mês; valor grande e 0,01.
      await page.locator('#new').click();
      await page.locator('input[name=title]').fill('Salário');
      await page.locator('input[name=category]').fill('Renda');
      await page.getByLabel('Tipo', { exact: true }).selectOption('income');
      await page.getByLabel('Vínculo', { exact: true }).selectOption('monthlyBills');
      await page.getByLabel('Mês de referência').selectOption('02');
      await page.getByLabel('Ano de referência').selectOption('2026');
      await page.getByLabel('Valor', { exact: true }).click(); await page.keyboard.type('0,01');
      await page.getByRole('button', { name: 'Salvar lançamento' }).click();
      await page.waitForFunction(() => document.getElementById('saved').textContent !== '' && JSON.parse(document.getElementById('saved').textContent).title === 'Salário');
      last = sent.at(-1);
      assert(last.body.amountCents === 1 && last.body.paymentMethod === null && last.body.linkedMonth === '2026-02' && last.body.link === 'monthlyBills', 'Payload entrada: ' + JSON.stringify(last));

      // Edição começa no valor exato.
      await page.locator('#edit').click();
      assert(await page.getByLabel('Valor', { exact: true }).inputValue() === '1.234,56' && await page.locator('.money-prefix').textContent() === '€', 'Edição inicia com valor exato');
      assert(await page.getByLabel('Data', { exact: true }).inputValue() === '29/02/2024', 'Data existente');
      assert(await page.getByLabel('Mês de referência').inputValue() === '09' && await page.getByLabel('Ano de referência').inputValue() === '2026', 'Mês existente');
      await page.getByRole('button', { name: 'Salvar lançamento' }).click();
      await page.waitForTimeout(300);
      last = sent.at(-1);
      assert(last.method === 'PATCH' && last.body.amountCents === 123456 && last.body.version === 3 && last.body.date === '2024-02-29', 'Payload edição: ' + JSON.stringify(last));
      out.push('payloads');

      // Parcelas (cartão): UI reativa, total, validação e payload.
      const submitForm = async () => { await page.getByRole('button', { name: 'Salvar lançamento' }).click(); await page.waitForTimeout(250); };
      const fill = async (title) => { await page.locator('input[name=title]').fill(title); await page.locator('input[name=category]').fill('Teste'); await page.getByLabel(/^Valor/, { exact: false }).first().click(); await page.keyboard.type('300'); };
      const sentBefore = () => sent.length;
      await page.locator('#new').click();
      await fill('Notebook');
      assert(await page.getByText('Compra parcelada').count() === 0, 'Parcelas ocultas fora do cartão');
      await page.getByLabel('Método de pagamento').selectOption('card');
      const parceled = page.getByLabel('Compra parcelada');
      assert(await parceled.count() === 1 && !(await parceled.isChecked()), 'Checkbox de parcelas no cartão');
      assert(await page.getByLabel('Número de parcelas').count() === 0 && await page.getByLabel('Valor', { exact: true }).count() === 1, 'À vista: sem contagem e valor simples');
      await parceled.check();
      assert(await page.getByLabel('Valor total da compra').count() === 1 && await page.getByText('total da compra, não o de cada parcela').count() === 1, 'Valor rotulado como total');
      const count = page.getByLabel('Número de parcelas');
      for (const bad of ['0', '1', '121', '1.5', '-3', '']) {
        await count.fill(bad);
        const before = sentBefore();
        await submitForm();
        assert(sent.length === before && await count.evaluate(el => el.validationMessage) !== '', 'Parcelas inválidas bloqueiam: ' + JSON.stringify(bad));
      }
      await count.fill('3');
      assert(await count.evaluate(el => el.validationMessage) === '', 'Contagem 3 válida');
      await submitForm();
      await page.waitForFunction(() => JSON.parse(document.getElementById('saved').textContent || '{}').title === 'Notebook');
      last = sent.at(-1);
      assert(last.method === 'POST' && last.body.installmentCount === 3 && last.body.amountCents === 30000 && last.body.paymentMethod === 'card', 'Payload cartão 3x (total inalterado): ' + JSON.stringify(last.body));

      // Edição do count 3 -> 4 e depois método pix -> null.
      const card = { direction: 'expense', paymentMethod: 'card', installmentCount: 3, link: 'none', linkedMonth: null, currency: 'BRL', amountCents: 30000, title: 'Notebook' };
      await page.evaluate((patch) => window.__setExisting(patch), card);
      await page.locator('#edit').click();
      assert(await page.getByLabel('Compra parcelada').isChecked() && await page.getByLabel('Número de parcelas').inputValue() === '3' && await page.getByLabel('Valor total da compra').inputValue() === '300,00', 'Edição inicia com 3x e total exato');
      await page.getByLabel('Número de parcelas').fill('4');
      await submitForm();
      last = sent.at(-1);
      assert(last.method === 'PATCH' && last.body.installmentCount === 4 && last.body.amountCents === 30000 && last.body.version === 3, 'Payload edição 4x: ' + JSON.stringify(last.body));
      await page.locator('#edit').click();
      await page.getByLabel('Método de pagamento').selectOption('pix');
      assert(await page.getByLabel('Compra parcelada').count() === 0 && await page.getByLabel('Número de parcelas').count() === 0, 'Pix oculta parcelas');
      await submitForm();
      last = sent.at(-1);
      assert(last.body.installmentCount === null && last.body.paymentMethod === 'pix', 'Pix envia null: ' + JSON.stringify(last.body));
      await page.locator('#edit').click();
      await page.getByLabel('Tipo', { exact: true }).selectOption('income');
      assert(await page.getByLabel('Compra parcelada').count() === 0, 'Entrada oculta parcelas');
      await submitForm();
      last = sent.at(-1);
      assert(last.body.installmentCount === null && last.body.paymentMethod === null, 'Entrada envia null');
      // Cartão à vista e lançamento antigo sem informação.
      await page.evaluate((patch) => window.__setExisting(patch), { ...card, installmentCount: 1 });
      await page.locator('#edit').click();
      assert(!(await page.getByLabel('Compra parcelada').isChecked()), 'Count 1 aparece como à vista');
      await submitForm();
      assert(sent.at(-1).body.installmentCount === 1, 'À vista envia 1');
      await page.evaluate((patch) => window.__setExisting(patch), { ...card, installmentCount: null });
      await page.locator('#edit').click();
      assert(await page.getByText('Parcelamento não informado').count() === 1, 'Legado mostra não informado');
      await submitForm();
      assert(sent.at(-1).body.installmentCount === null, 'Legado intocado continua null');
      await page.locator('#edit').click();
      await page.getByLabel('Compra parcelada').check();
      await page.getByLabel('Compra parcelada').uncheck();
      assert(await page.getByText('Parcelamento não informado').count() === 0, 'Decisão do usuário remove o aviso');
      await submitForm();
      assert(sent.at(-1).body.installmentCount === 1, 'Decisão explícita à vista envia 1');
      out.push('parcelas');

      // Erro de API mantém o formulário utilizável; data inicial local e ISO via FormData.
      await page.unroute('**/v1/finance/transactions**');
      await page.route('**/v1/finance/transactions**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Falha sintética.' } }) }));
      await page.locator('#new').click();
      const form = await page.evaluate(() => { const now = new Date(); const local = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`; const visual = document.querySelector('.date-control input[type=text]'); const data = new FormData(document.querySelector('form.finance-form')); return { local, shown: visual.value, visualName: visual.name, submitted: data.get('date') }; });
      assert(form.shown === form.local && form.visualName === '' && /^\d{4}-\d{2}-\d{2}$/.test(form.submitted), 'Data inicial local e ISO oculto: ' + JSON.stringify(form));
      await page.locator('input[name=title]').fill('Erro'); await page.locator('input[name=category]').fill('Teste');
      await page.getByLabel('Valor', { exact: true }).click(); await page.keyboard.type('1');
      await submitForm();
      assert(await page.getByRole('alert').count() >= 1 && await page.getByRole('button', { name: 'Salvar lançamento' }).isEnabled(), 'Erro de API exibido e formulário liberado');
      assert(await page.evaluate(() => document.querySelector('input[name=title]').value) === 'Erro', 'Dados preservados após erro');
      // Colagem pelo clipboard real do navegador.
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.evaluate(() => navigator.clipboard.writeText('R$ 2.500,75'));
      await page.getByLabel('Valor', { exact: true }).click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Control+V');
      assert(await page.getByLabel('Valor', { exact: true }).inputValue() === '2.500,75', 'Ctrl+V real: ' + await page.getByLabel('Valor', { exact: true }).inputValue());
      await page.getByRole('button', { name: 'Fechar janela' }).click();
      out.push('erro+data+clipboard');

      // Calendário perto da borda inferior em telas curtas e 390x844.
      for (const [width, height] of [[390, 844], [390, 520]]) {
        await page.setViewportSize({ width, height });
        await page.locator('#new').click();
        await page.locator('.date-control input[type=text]').scrollIntoViewIfNeeded();
        await page.getByRole('button', { name: /Abrir calendário/ }).click();
        const popover = page.getByRole('dialog', { name: /Escolher data/ });
        await popover.waitFor();
        await page.waitForTimeout(400);
        const box = await page.evaluate(() => { const rect = document.querySelector('.date-popover').getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, h: innerHeight, w: innerWidth, scroll: document.querySelector('.date-popover').scrollHeight <= document.querySelector('.date-popover').clientHeight }; });
        assert(box.top >= 0 && box.bottom <= box.h && box.left >= 0 && box.right <= box.w, 'Calendário dentro da viewport ' + height + ': ' + JSON.stringify(box));
        const days = page.getByRole('button', { name: /^\d+ de \w+ de \d+$/ });
        const lastDay = days.last();
        const lastBox = await lastDay.boundingBox();
        assert(box.scroll ? lastBox.y + lastBox.height <= height : true, 'Último dia visível ' + height);
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Escape');
        await popover.waitFor({ state: 'detached' });
        assert(await page.locator('dialog.finance-modal').count() === 1, 'Esc fecha só o calendário em ' + height);
        await page.getByRole('button', { name: /Abrir calendário/ }).click();
        await popover.waitFor();
        await page.waitForTimeout(300);
        await page.getByRole('button', { name: /^15 de \w+ de \d+$/ }).click();
        assert(await page.locator('.date-control input[type=text]').inputValue().then(v => v.startsWith('15/')), 'Dia clicável em ' + height);
        await page.getByRole('button', { name: 'Fechar janela' }).click();
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      out.push('calendário-borda');

      // Bancos: Select de logo.
      await page.locator('#banks').click();
      await page.getByLabel('Logo', { exact: true }).selectOption('url');
      assert(await page.getByLabel(/URL HTTP/).count() === 1, 'Select de logo reage');
      await page.getByLabel('Logo', { exact: true }).selectOption('upload');
      await page.locator('input[type=file]').setInputFiles({ name: 'logo.txt', mimeType: 'text/plain', buffer: Buffer.from('não é imagem') });
      assert(await page.getByRole('alert').filter({ hasText: 'PNG, JPEG ou WebP' }).count() === 1, 'Arquivo inválido recusado com mensagem');
      await page.getByRole('button', { name: 'Fechar janela' }).click();

      // Movimento reduzido e mobile.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 390, height: 800 });
      await page.locator('#new').click();
      await page.getByRole('button', { name: /Abrir calendário/ }).click();
      const reduced = await page.evaluate(() => { const style = getComputedStyle(document.querySelector('.date-popover')); return style.opacity + ' ' + style.transform; });
      assert(reduced === '1 none', 'Reduced motion no calendário: ' + reduced);
      const geometry = await page.evaluate(() => {
        const box = document.querySelector('.date-popover').getBoundingClientRect();
        const modal = document.querySelector('dialog.finance-modal');
        return { left: box.left, right: box.right, innerWidth, modalScroll: modal.scrollWidth <= modal.clientWidth, doc: document.documentElement.scrollWidth <= innerWidth };
      });
      assert(geometry.left >= 0 && geometry.right <= geometry.innerWidth && geometry.modalScroll && geometry.doc, 'Calendário cabe em 390px: ' + JSON.stringify(geometry));
      out.push('mobile+reduced');
      return out.join(' | ');
    }""" % json.dumps(base_url)
    result = call(run_code, dict(code=code))
    print(result['content'][0]['text'].split('### Ran')[0].strip())
    call('browser_close', {})
finally:
    server.terminate()
    server.wait(timeout=10)
