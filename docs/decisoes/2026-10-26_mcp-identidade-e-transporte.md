# MCP: adaptador da API, stdio primeiro e identidade remota pendente

Data: 2026-10-26. Estado: parte aceita (adaptador, stdio, ferramentas); parte **pendente de decisão do proprietário** (identidade do MCP remoto). Detalhes em [mcp.md](../arquitetura/mcp.md).

## Decidido

- **Adaptador da API HTTP.** `apps/mcp` só chama endpoints reais de `/v1` com o token do usuário. Sem acesso ao DynamoDB, sem regra de domínio duplicada, sem ferramenta genérica. Motivo: a API já isola por `ownerId`, versiona e limita; duplicar isso no MCP criaria uma segunda autoridade (AGENTS.md: o backend AWS é a autoridade).
- **Ferramentas iniciais enxutas e sem exclusão**: `notes_search`, `notes_get`, `notes_create`, `notes_update`, `folders_list`. Escrita exige `expectedVersion`. Exclusão de nota existe na API, mas não é exposta: a API só tem exclusão física, sem lixeira, e um agente induzido por prompt injection não deve ter esse poder.
- **Busca só por título/tag/pasta**, sobre `GET /notes/metadata`, limitada a 500 notas: é o que a API oferece hoje. Busca de texto exige mudança na API (índice ou varredura), fora desta frente. Alternativa rejeitada: ler todos os corpos pelo MCP para filtrar (custo de leitura proporcional ao acervo e muito dado enviado ao LLM).
- **SDK oficial 1.x (1.32.2) + Zod 4**, o mesmo Zod da API. A revisão 2026-07-28 da spec não está nesse SDK (anuncia até 2025-11-25); aceito o risco e revisito quando houver SDK compatível.
- **HTTP stateless** (servidor e transporte por requisição), conforme a revisão 2026-07-28 que removeu sessões e adequado a Lambda.
- **Reuso dos schemas de resposta da API** (`contract.ts`), como o cliente web já faz; o MCP importa por caminho relativo (testes e execução com `tsx`, sem etapa de build própria).
- **stdio com token em arquivo relido a cada chamada**, sem estado entre chamadas.

## Pendente: como o MCP remoto fala com a API

A API aceita só ID token do Google (`aud` = client ID do app; `ownerId` = `sub`). A spec MCP exige que o servidor aceite apenas tokens emitidos **para ele** (audiência = URL do MCP) e proíbe repassar o token recebido. Logo o ID token do Google não pode ser o token do MCP, nem ser repassado. O código já separa a verificação (feita) da troca (`apiClientFor`, injetada, **sem implementação**). Opções para o proprietário decidir:

1. **Servidor de autorização gerenciado** (ex.: um user pool com login Google, recurso e escopos `notes:*`) emitindo tokens com `aud` do MCP; o API Gateway passaria a aceitar também esse emissor/audiência. Custo: serviço adicional; o `sub` do emissor seria diferente do `sub` do Google (hoje o `ownerId` dos dados), exigindo mapeamento ou migração; DCR/CIMD varia por produto (se faltar, Claude e Gemini aceitam cadastro manual do cliente; ChatGPT aceita cliente pré-definido). Altera o fluxo de autenticação da API: **requer aprovação**.
2. **Servidor de autorização próprio mínimo** (Lambda) que federa o Google, guarda o `sub` original e emite tokens para o MCP. Mantém o `ownerId`, mas é código de segurança crítico a manter (PKCE, DCR/CIMD, refresh com rotação).
3. **Não expor MCP remoto agora.** Uso só por stdio (Claude Code/Codex/Gemini CLI no desktop). Zero superfície nova; nenhum acesso do celular.

Recomendação: seguir com a opção 3 até haver infraestrutura de autenticação; se o acesso por celular for prioridade, comparar 1 e 2 com custo e esforço reais antes de implementar. Nenhuma chamada AWS foi feita nem planejada nesta etapa.

## Riscos aceitos

Confirmação de escrita e auditoria persistente (RF-11) dependem do cliente e de logs em stderr; o ID token do stdio ainda é provisionado à mão; `POST /notes` não é idempotente, então retry do agente duplica nota; compatibilidade com clientes que falam a revisão 2026-07-28 não foi testada com clientes reais.
