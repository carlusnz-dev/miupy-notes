# miupy-notes — guia para agentes

Sistema pessoal em Tauri 2 + React, com template de API Express/TypeScript e infraestrutura serverless planejada. Antes de editar, leia `docs/requisitos/requisitos.md`, `docs/arquitetura/arquitetura.md`, `docs/arquitetura/api.md`, `docs/stacks/stacks.md` e `docs/arquitetura/arquitetura.json`. Para a API, leia também `docs/arquitetura/backend.json`.

## Fontes de verdade

- `docs/requisitos/requisitos.md` define escopo. IDs `RF-NN` e `RNF-NN` são estáveis.
- `docs/arquitetura/arquitetura.md` explica limites e fluxos; `arquitetura.json` registra o estado real. Não marque algo como implementado sem código e verificação.
- `docs/arquitetura/api.md` será o contrato HTTP. Mudou endpoint, payload ou erro: atualize-o junto com código e cliente.
- `styles/tokens.json` e `styles/referencias.json` são referências visuais provisórias.
- Registre decisão relevante em `docs/decisoes/` e resultado de sessão em `docs/relatorios/`.

## Regras de implementação

- Interface e documentação em pt-BR; identificadores de código em inglês.
- Títulos de página e da nota seguem a serif principal e escala responsiva coerente; corpo/labels em sans. Preferências do proprietário de 2026-10-19: Silvex para uso pessoal local (arquivo fora do Git público), alternativa livre semelhante à referência Lenora/Vogue; selects e modais reutilizáveis, com GSAP nas animações.
- Use GSAP nas animações de interação (incluindo seleção deslizante de grupos de botões e troca de períodos); respeite `prefers-reduced-motion` e remova animações/listeners ao desmontar. Preferência do proprietário registrada em 2026-10-19.
- Frontend: React/TypeScript em `apps/web/src/`; API HTTP no cliente Axios `apps/web/src/lib/api-client.ts`. Segredos e tokens de provedor nunca no bundle do frontend.
- Backend: `apps/api/src/core/` guarda contratos e tipos compartilhados; `apps/api/src/modules/` guarda features. Entre módulos, importe serviços apenas do `index.ts` público. Veja `apps/api/README.md`.
- Tauri é a casca desktop. O backend AWS é a autoridade dos dados sincronizados; acesso a provedores passa por conector autorizado. Não duplique regra de domínio entre React e Lambda.
- Infraestrutura em `infra/` com Terraform. Não coloque credenciais, arquivos de estado, `tfvars` reais ou dados pessoais no Git. Não aplique infraestrutura nem faça chamadas a contas reais sem autorização do usuário.
- Dados financeiros, e-mails e notas exigem isolamento por usuário, privilégio mínimo, criptografia, retenção e exportação verificável. MCP deve expor ferramentas restritas e somente dados autorizados.
- Antes de implementar: procure código existente. Faça o menor diff legível, teste comportamento relevante e relate exatamente o que foi verificado.

## Verificação atual

- `npm run build` verifica os dois workspaces após instalar dependências. `npm run check:modules` verifica a estrutura da API.
- `npm run tauri dev` permite verificação manual da janela, quando o ambiente suportar.
- Terraform será validado quando houver módulos `.tf`: `terraform fmt -check` e `terraform validate` em cada raiz.

## Skills locais

Leia a skill adequada em `skills/`: `codigo-enxuto` antes de implementar, `revisar-contrato` quando mudar API/persistência/integração, `validar-design` ao revisar telas, `revisar-pr` antes de merge e `relatorio` ao encerrar trabalho. Claude encontra atalhos equivalentes em `.claude/skills/`; Codex descobre as mesmas skills por links em `.agents/skills/` e agentes em `.codex/agents/`.

## Fim de sessão

Atualize `arquitetura.json` se o estado mudou. Salve um relatório factual em `docs/relatorios/`, inclusive falhas, trabalho pendente e comandos não executados.
