"""Playwright MCP isolado: Biblioteca com API em memória e dados sintéticos.
Uso: timeout 150s python apps/web/tests/library.mcp.py http://127.0.0.1:5204
Sirva Vite sem arquivos de ambiente e library-api-harness.ts na porta 3204.
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
    rpc('initialize', dict(protocolVersion='2024-11-05', capabilities={}, clientInfo=dict(name='library-module', version='1')))
    server.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n'); server.stdin.flush()
    names = {tool['name'] for tool in rpc('tools/list', {})['tools']}
    name = 'browser_run_code' if 'browser_run_code' in names else 'browser_run_code_unsafe'
    code = Path(__file__).with_name('library.mcp.js').read_text()
    assets = root / 'docs/relatorios/assets/2026-10-23_biblioteca'
    assets.mkdir(parents=True, exist_ok=True)
    code = code.replace('__LIBRARY_ASSETS__', json.dumps(str(assets)))
    result = call(name, dict(code=code.replace('http://127.0.0.1:5204', sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5204')))
    print(result['content'][0]['text'].split('### Ran')[0])
    (assets / 'failure.png').unlink(missing_ok=True)
    call('browser_close', {})
finally:
    server.terminate(); server.wait(timeout=10)
