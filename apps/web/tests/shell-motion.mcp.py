"""Smoke test pelo Playwright MCP de .mcp.json; requer Vite já iniciado.

Uso: python3 apps/web/tests/shell-motion.mcp.py http://127.0.0.1:1436
O servidor deve usar envDir vazio; o teste acessa somente prévias sintéticas.
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
                           clientInfo=dict(name='shell-motion-test', version='1')))
    server.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    server.stdin.flush()
    names = {tool['name'] for tool in rpc('tools/list', {})['tools']}
    run_code = 'browser_run_code' if 'browser_run_code' in names else 'browser_run_code_unsafe'
    base_url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:1436'
    call('browser_navigate', dict(url=base_url + '/#/?estado=lista'))
    code = r'''async (page) => {
      const base = location => location.split('/#')[0];
      const url = base(page.url());
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const noOverflow = async () => {
        const result = await page.evaluate(() => {
          const content = document.querySelector('.page-scroll');
          return document.documentElement.scrollWidth <= innerWidth && content.scrollWidth <= content.clientWidth;
        });
        assert(result, 'Overflow horizontal');
      };
      await page.setViewportSize({width:1440,height:900});
      await page.getByRole('button',{name:'30 dias',exact:true}).waitFor();
      await noOverflow();
      const resize = page.getByRole('separator',{name:'Largura do menu'});
      await resize.focus();
      for (const key of ['End','ArrowRight']) await page.keyboard.press(key);
      assert(await resize.getAttribute('aria-valuenow') === '380', 'Limite máximo por teclado');
      await noOverflow();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowLeft');
      assert(await resize.getAttribute('aria-valuenow') === '200', 'Limite mínimo por teclado');
      await page.keyboard.press('Shift+ArrowRight');
      assert(await resize.getAttribute('aria-valuenow') === '240', 'Passo com Shift');
      const box = await resize.boundingBox();
      await page.mouse.move(box.x+4,box.y+100);
      await page.mouse.down();await page.mouse.move(700,box.y+100);await page.mouse.up();
      assert(await resize.getAttribute('aria-valuenow') === '380', 'Limite máximo por pointer');
      await page.getByRole('button',{name:'Recolher menu'}).click();
      assert(await page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().width) === 76, 'Menu recolhido');
      await page.getByRole('button',{name:'Expandir menu'}).click();
      assert(await page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().width) === 380, 'Largura restaurada');
      await page.getByRole('button',{name:'7 dias',exact:true}).click();
      await page.getByText('Nos últimos 7 dias',{exact:true}).waitFor();
      const last = page.getByRole('button',{name:'90 dias',exact:true});
      await last.focus();await page.keyboard.press('Enter');
      assert(await last.getAttribute('aria-pressed') === 'true', 'Período por teclado');
      await page.waitForTimeout(600);
      assert(await page.evaluate(()=>{
        const indicator=document.querySelector('.button-group-indicator').getBoundingClientRect();
        const selected=document.querySelector('.button-group [aria-pressed="true"]').getBoundingClientRect();
        return Math.abs(indicator.x-selected.x)<1 && Math.abs(indicator.width-selected.width)<1;
      }), 'Indicador alinhado');
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.getByRole('button',{name:'30 dias',exact:true}).click();
      assert(await page.locator('.period-content').evaluate(el=>{
        const style=getComputedStyle(el);return style.opacity==='1' && style.transform==='none';
      }), 'Movimento reduzido');
      for (const [label,path] of [['Perfil','profile'],['Configurações','settings']]) {
        await page.getByRole('link',{name:label,exact:true}).click();
        await page.getByRole('heading',{name:label+'.',exact:true}).waitFor();
        assert(page.url().endsWith('/#/'+path), 'Rota '+path);
      }
      for (const width of [1440,390]) {
        await page.setViewportSize({width,height:900});
        for (const route of ['/?estado=lista','/missing']) {
          await page.goto(url+'/#'+route);
          await page.getByRole('heading',{name:route.includes('missing')?'404.':'Seu espaço.',exact:true}).waitFor();
          await noOverflow();
        }
        if (width===390) assert(!await resize.isVisible(), 'Resize oculto no mobile');
      }
      return 'Shell, teclado, pointer, rotas, períodos, reduced motion e overflow: OK';
    }'''
    print(json.dumps(call(run_code, dict(code=code)), ensure_ascii=False))
    call('browser_close', {})
finally:
    server.terminate()
    server.wait(timeout=10)
