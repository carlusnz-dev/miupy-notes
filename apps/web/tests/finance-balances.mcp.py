"""Playwright MCP isolado: etapas/parcelas, modal/X, Sidebar e reduced-motion.
Uso: timeout 90s python apps/web/tests/finance-balances.mcp.py http://127.0.0.1:5202
Sirva apps/web com Vite/envDir vazio. Somente API sintética no harness.
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
    rpc('initialize', dict(protocolVersion='2024-11-05', capabilities={}, clientInfo=dict(name='finance-planner', version='1')))
    server.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n'); server.stdin.flush()
    names = {tool['name'] for tool in rpc('tools/list', {})['tools']}
    name = 'browser_run_code' if 'browser_run_code' in names else 'browser_run_code_unsafe'
    result = call(name, dict(code=Path(__file__).with_name('finance-balances.mcp.js').read_text().replace('http://127.0.0.1:5202', sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5202')))
    print(result['content'][0]['text'].split('### Ran')[0])
    call('browser_close', {})
finally:
    server.terminate(); server.wait(timeout=10)
