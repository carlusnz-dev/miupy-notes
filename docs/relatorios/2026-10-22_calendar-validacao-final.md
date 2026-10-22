# Calendar — validação final S13

Data: 2026-10-22. Código validado: `cb5c2964243362ba13c2ce4fe7c05e34b46985c6`, HEAD inicial desta worktree e de `carlusnz-dev/feat-calendar-google-sync-s13`, confirmado pelo coordenador. Não foi necessário merge nem alteração no checkout pai/implementador. Escopo: RF-05/RF-12, revalidação dos três achados do snapshot e inspeção pequena do diff final. Nenhum código de produção ou teste versionado alterado; somente este relatório. Índice central reservado ao coordenador.

## Resultado

Sem novo achado concreto no recorte revisado. Os achados anteriores foram tratados dentro do escopo **local, com um processo de API**:

- Exclusão refletida mantém reflection e versão até excluir o registro local. O teste HTTP injeta falha depois do DELETE remoto: primeiro retorno 500, vínculo preservado, retry com a mesma versão retorna 204 tolerando remoto ausente. Teste de edição concorrente preserva a edição/vínculo e exige nova versão.
- Conclusão OAuth tem ponto explícito em Rust: sob o mesmo mutex do cancelamento, verifica o flag, marca finalizing e emite evento antes do POST. Cancelar passa a retornar `CALENDAR_FINALIZING`; GooglePanel retira Cancelar espera e explica que revogação exige Desconectar. O cliente remove listener em finally; CalendarWorkspace guarda resultado de conexão pela sessão. Leitura estática desse caminho nativo, com UI finalizing/cancel simulada no MCP; logout durante POST continua sem promessa de revogação.
- Conectar/desconectar são serializados por proprietário na instância local do serviço. Teste pausa exchangeCode, pede desconexão e libera a troca: grant tardio é revogado, credencial removida e estado final not_connected. Não comprova coordenação entre processos/Lambdas.

Inspeção dirigida também conferiu PATCH Google com If-Match e campos parciais, preservação de texto remoto truncado no espelho, janela inicial limitada e estável entre páginas, uso único do state, segredo fora de argv e composição local separada da Lambda. Consulta Graphify existente `explain GooglePanel` serviu apenas de navegação; o grafo era anterior e as relações relevantes foram confirmadas na fonte atual.

## Verificação executada

- `npm ci --ignore-scripts`: 347 pacotes instalados; auditoria informou zero vulnerabilidades.
- `node --import tsx --test --test-name-pattern='exclusão refletida|desconectar durante|espelho exige|janela inicial|editar só título|duas conclusões|POST/PATCH|redirect OAuth|PATCH omite|cofre indisponível' apps/api/src/modules/calendar/services/google-integration.service.test.ts apps/api/src/modules/calendar/routes/calendar.routes.test.ts apps/api/src/modules/calendar/google/http-google-calendar.client.test.ts`: **10/10**. HTTP/Google/cofre falsos; logs 400/500/502 são falhas sintéticas esperadas.
- `node --import tsx --test --test-name-pattern='replay não conclui|GOOGLE_CONFLICT' apps/web/src/calendar/outbox.test.ts`: **2/2**, preservando intenção de envio e conflito Google.
- `python /tmp/calendar-final.mcp.py http://127.0.0.1:5214`: MCP stdio configurado em `.mcp.json`, Chromium headless com `--isolated`, **matriz 1440×900/390×900 × no-preference/reduce aprovada**, zero pageerror. Permissão por teclado, conexão reflect, sincronização e resultado, cancelar espera, finalizing sem Cancelar, confirmação/desconexão efetiva, foco inicial/trap/Escape/restauração, modos dia/semana/mês/ano acionados por teclado, formulário Google editável em reflect e leitura sem inputs em mirror, opt-in de envio em evento local. Sem overflow horizontal no documento em cada modo. Estados not_configured/not_connected/needs_reauth, erro de status, erro de sync e erro RATE_LIMITED visíveis. Home/404 verificadas em ambas larguras, sem overflow.
- `python /tmp/calendar-final-extra.mcp.py http://127.0.0.1:5214`: **duas larguras aprovadas**, salvar/excluir espelho acionam o remote sintético e alteram/removem o evento, ações inferiores do modal alcançáveis por rolagem, reduced-motion deixa vista sem transform após troca de modo.
- Inspeção visual de quatro capturas: desktop da agenda, formulário móvel de escrita, painel móvel e rodapé móvel do formulário. Superfícies monocromáticas, serifa da agenda, labels/inputs sans, texto e foco perceptivelmente legíveis; sem corte horizontal observado. Modal móvel tem rolagem vertical deliberada. Conferência com tokens/referências locais; não é auditoria quantitativa WCAG.
- `git diff --check`: aprovado antes do relatório. Nenhuma suíte completa/build foi repetido; a task pede testes dirigidos e a implementação já registra essas verificações.

## Ambiente e evidência

Vite programático `/tmp/calendar-vite.mjs`: configFile:false, envDir gerado vazio em /tmp, React e Tailwind explícitos, bind exclusivo `127.0.0.1:5214`. A primeira tentativa de iniciar falhou por dependências ausentes; npm ci resolveu. Runner derivado do exemplo `apps/web/tests/finance-balances.mcp.py`.

Harness **somente em /tmp**: `/tmp/calendar-final-harness.tsx`, derivado do harness Calendar existente, servido por plugin Vite temporário como `/tests/calendar-final.html` e `/tests/calendar-final.tsx`. Modificações sintéticas: status Google por query, callbacks conectar/cancelar/finalizar/desconectar/sync falsos, evento Google no dia visível e remote em memória já existente. Nenhum OAuth, cofre, Google, AWS ou API de produção foi usado; nenhum arquivo .env/credencial foi aberto. O fake de status não comprova persistência nem sincronização real.

Scripts: `/tmp/calendar-final-prepare.py`, `/tmp/calendar-final.mcp.py`, `/tmp/calendar-final.mcp.js`, `/tmp/calendar-final-extra.mcp.py`, `/tmp/calendar-final-extra.mcp.js`. Logs: `/tmp/calendar-final-mcp.log`, `/tmp/calendar-final-extra.log`, `/tmp/calendar-final-api.log`, `/tmp/calendar-final-web.log`.

Capturas `/tmp/calendar-final-{1440,390}-{no-preference,reduce}.png`, `/tmp/calendar-final-form-{1440,390}-{no-preference,reduce}.png`, `/tmp/calendar-final-mirror-{read,write}-{1440,390}-{no-preference,reduce}.png`, `/tmp/calendar-final-panel-{1440,390}.png` e `/tmp/calendar-final-mirror-save-{1440,390}.png` (chaves representam os arquivos da matriz, não nomes literais). Capturas de página refletem a posição do scroll interno; rodapé do modal foi capturado separadamente. Artefatos /tmp são locais e efêmeros.

## Limites e próximo passo

Sem execução nativa Tauri/WebKit, cargo, conta Google, Secret Service real, DynamoDB, AWS, deploy ou Terraform. A distinção entre lookup ausente e falha de Secret Service com exit 1 continua não comprovada em ambiente real. Listener/GSAP/matchMedia/ResizeObserver têm cleanup na fonte; testes observaram foco e vistas estáveis em movimento normal/reduzido, sem instrumentação de vazamento. Isolamento distribuído e revogação após perda de resposta/logout permanecem fora deste aceite. `arquitetura.json` não alterado: esta task não muda implementação e o coordenador mantém documentação central. Próximo passo: integrar relatório e decidir aceite nativo/real separadamente.
