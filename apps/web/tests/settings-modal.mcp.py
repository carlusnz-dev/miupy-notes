"""Teste do Select (configurações) e do Modal (tests/modal-harness.html) pelo Playwright MCP de .mcp.json.

Uso: python3 apps/web/tests/settings-modal.mcp.py http://127.0.0.1:1450
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
                           clientInfo=dict(name='settings-modal-test', version='1')))
    server.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    server.stdin.flush()
    names = {tool['name'] for tool in rpc('tools/list', {})['tools']}
    run_code = 'browser_run_code' if 'browser_run_code' in names else 'browser_run_code_unsafe'
    base_url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:1450'
    code = r"""async (page) => {
      const base = %s;
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const out = [];
      const luminance = (rgb) => { const [r,g,b] = rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v => { v/=255; return v<=.03928 ? v/12.92 : ((v+.055)/1.055)**2.4; }); return .2126*r+.7152*g+.0722*b; };
      const contrast = (a,b) => { const [x,y] = [luminance(a),luminance(b)].sort((m,n)=>n-m); return (x+.05)/(y+.05); };
      for (const width of [1440, 390]) {
        await page.setViewportSize({width, height: 900});
        await page.goto(base + '/#/settings');
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.getByRole('heading',{name:'Configurações.',exact:true}).waitFor();
        const selects = await page.evaluate(() => [...document.querySelectorAll('.select-control select')].map(s => { const c = getComputedStyle(s); return { label: s.labels[0]?.textContent, text: s.selectedOptions[0]?.textContent, color: c.color, bg: c.backgroundColor, right: s.getBoundingClientRect().right }; }));
        assert(selects.length === 5, 'Cinco selects');
        for (const s of selects) {
          assert(s.label && s.text, 'Label e valor visíveis: ' + JSON.stringify(s));
          assert(contrast(s.color, s.bg) >= 7, 'Contraste do select ' + s.label);
          assert(s.right <= width, 'Select dentro da viewport ' + s.label);
        }
        const select = page.getByLabel('Largura do Markdown');
        await select.focus();
        const outline = await select.evaluate(el => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
        assert(outline.startsWith('solid 2px'), 'Foco visível: ' + outline);
        await page.keyboard.press('ArrowDown');
        assert(await select.inputValue() === 'wide', 'Teclado altera valor');
        assert(JSON.parse(await page.evaluate(() => localStorage.getItem('miupy.editor-preferences.v1'))).width === 'wide', 'Preferência persistida com o mesmo valor');
        await page.getByLabel('Fonte do editor').selectOption('serif');
        assert(await page.evaluate(() => getComputedStyle(document.querySelector('.settings-editor-line')).fontFamily.includes('Instrument Serif')), 'Fonte do editor aplicada');
        await page.getByLabel('Fonte dos títulos').selectOption('editorial');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.markdown-preview h1')).fontFamily.startsWith('"Bodoni Moda"') && [...document.fonts].some(f => f.family === 'Bodoni Moda' && f.status === 'loaded'));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.page-scroll').scrollWidth <= document.querySelector('.page-scroll').clientWidth), 'Overflow em configurações ' + width);
        out.push('select ' + width);
      }
      await page.evaluate(() => localStorage.clear());

      await page.setViewportSize({width: 1440, height: 900});
      await page.goto(base + '/tests/modal-harness.html');
      const count = async () => Number(await page.locator('#closed-count').textContent());
      const dialog = page.locator('dialog.modal');
      const opener = page.locator('#opener');
      // Entrada animada pelo GSAP.
      const midOpacity = await page.evaluate(async () => {
        document.getElementById('opener').focus();
        document.getElementById('opener').click();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return Number(getComputedStyle(document.querySelector('dialog.modal')).opacity);
      });
      assert(midOpacity < 1, 'Fade-in em andamento: ' + midOpacity);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('dialog.modal')).opacity === '1' && getComputedStyle(document.querySelector('dialog.modal')).transform === 'none');
      assert(await dialog.getAttribute('aria-labelledby') !== null && await dialog.evaluate(d => d.open && d.matches(':modal')), 'Dialog modal acessível');
      assert(await page.evaluate(() => document.activeElement.getAttribute('aria-label') === 'Confirmação'), 'Foco inicial via initialFocusRef');
      // Trap: Tab e Shift+Tab permanecem dentro do dialog.
      for (const key of ['Tab','Tab','Tab','Tab','Tab','Tab','Shift+Tab','Shift+Tab','Shift+Tab']) {
        await page.keyboard.press(key);
        assert(await page.evaluate(() => !!document.activeElement.closest('dialog.modal')), 'Foco escapou do modal em ' + key);
      }
      // Esc fecha com animação e devolve o foco.
      await page.keyboard.press('Escape');
      await dialog.waitFor({state: 'detached'});
      assert(await count() === 1, 'Esc chama onClose');
      assert(await page.evaluate(() => document.activeElement.id === 'opener'), 'Foco restaurado após Esc');
      // Clique no backdrop fecha.
      await opener.click();
      await dialog.waitFor();
      await page.waitForTimeout(400);
      await page.mouse.click(5, 5);
      await dialog.waitFor({state: 'detached'});
      assert(await count() === 2, 'Backdrop chama onClose');
      assert(await page.evaluate(() => document.activeElement.id === 'opener'), 'Foco restaurado após backdrop');
      // Clique dentro do painel não fecha.
      await opener.click();
      await page.waitForTimeout(400);
      await page.locator('.modal-body p').click();
      assert(await dialog.count() === 1 && await count() === 2, 'Clique no conteúdo não fecha');
      // Ocupado bloqueia Esc, backdrop e botão de fechar.
      await page.evaluate(() => document.getElementById('busy-toggle').click());
      await page.keyboard.press('Escape');
      await page.mouse.click(5, 5);
      await page.waitForTimeout(400);
      assert(await dialog.count() === 1, 'Ocupado mantém o modal aberto');
      assert(await count() === 2, 'Ocupado não chama onClose: ' + await count());
      assert(await page.locator('.modal-close').isDisabled() && await dialog.getAttribute('aria-busy') === 'true', 'Botão desabilitado e aria-busy');
      // Libera e fecha pelo botão.
      await page.evaluate(() => document.getElementById('busy-toggle').click());
      await page.locator('.modal-close').click();
      await dialog.waitFor({state: 'detached'});
      out.push('modal animado');

      // Movimento reduzido: sem intermediário.
      await page.emulateMedia({reducedMotion: 'reduce'});
      const reduced = await page.evaluate(async () => {
        document.getElementById('opener').click();
        await new Promise(r => requestAnimationFrame(r));
        const style = getComputedStyle(document.querySelector('dialog.modal'));
        return { opacity: style.opacity, transform: style.transform };
      });
      assert(reduced.opacity === '1' && reduced.transform === 'none', 'Reduced motion abre direto: ' + JSON.stringify(reduced));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(50);
      assert(await dialog.count() === 0, 'Reduced motion fecha sem animação');
      assert(await page.evaluate(() => document.activeElement.id === 'opener'), 'Foco restaurado (reduced)');
      // Mobile.
      await page.emulateMedia({reducedMotion: 'no-preference'});
      await page.setViewportSize({width: 390, height: 700});
      await opener.click();
      await page.waitForTimeout(500);
      const box = await page.locator('dialog.modal').boundingBox();
      assert(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 700, 'Modal cabe em 390px: ' + JSON.stringify(box));
      out.push('modal reduced/mobile');
      return out.join(' | ');
    }""" % json.dumps(base_url)
    result = call(run_code, dict(code=code))
    print(result['content'][0]['text'].split('### Ran')[0].strip())
    call('browser_close', {})
finally:
    server.terminate()
    server.wait(timeout=10)
