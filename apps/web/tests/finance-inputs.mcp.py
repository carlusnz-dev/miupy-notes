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

      // Bancos: Select de logo.
      await page.locator('#banks').click();
      await page.getByLabel('Logo', { exact: true }).selectOption('url');
      assert(await page.getByLabel(/URL HTTP/).count() === 1, 'Select de logo reage');
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
