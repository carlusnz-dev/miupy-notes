"""Aceite sintético via Playwright MCP; Vite deve usar envDir vazio.

Uso: python3 apps/web/tests/s07-notes.mcp.py http://127.0.0.1:5198
Sem login, credenciais, API real ou dados pessoais.
"""
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
config = json.loads((root / '.mcp.json').read_text())['mcpServers']['playwright']
server = subprocess.Popen([config['command'], *config['args'], '--isolated'], cwd=root,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
request_id = 0


def rpc(method, params):
    global request_id
    request_id += 1
    server.stdin.write(json.dumps(dict(jsonrpc='2.0', id=request_id, method=method, params=params)) + '\n')
    server.stdin.flush()
    for line in server.stdout:
        response = json.loads(line)
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
                           clientInfo=dict(name='s07-notes-test', version='1')))
    server.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    server.stdin.flush()
    names = {tool['name'] for tool in rpc('tools/list', {})['tools']}
    run_code = 'browser_run_code' if 'browser_run_code' in names else 'browser_run_code_unsafe'
    base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5198'
    code = Path(__file__).with_suffix('.js').read_text().replace('__BASE_URL__', json.dumps(base))
    result = call(run_code, dict(code=code))
    print(result['content'][0]['text'].split('### Ran')[0].strip())
    call('browser_close', {})
finally:
    try:
        call('browser_close', {})
    except Exception:
        pass
    server.terminate()
    server.wait(timeout=10)
