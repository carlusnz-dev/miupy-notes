# Stack e critérios

| Camada | Escolha | Estado | Motivo |
|---|---|---|---|
| Desktop | Tauri 2 + Rust | Login Google próprio (PKCE, loopback) com `keyring` 4, `reqwest` 0.13 (rustls), `tokio` | Distribuição nativa e casca pequena; medir binário real. |
| Editor | CodeMirror 6 (`@uiw/react-codemirror`, `@codemirror/lang-markdown`) + `react-markdown`/`remark-gfm` | Em uso, carregado sob demanda | Markdown puro (exportável), atalhos e prévia sem HTML bruto. |
| Interface | React + TypeScript + Vite | Base de interface em `apps/web`; instalada e compilada | UI tipada e fluxo já iniciado no repositório. |
| HTTP client | Axios | Instalado; cliente central sem chamadas reais | Cliente único com autenticação, timeout, erros e cancelamento padronizados. |
| API | Express + TypeScript + Zod + AWS SDK + `jose` + adaptador Lambda | Template em `apps/api`; instalado, compilado e testado | Fronteiras por módulo e rota pública de saúde. |
| API Gateway HTTP + Lambda | AWS | Planejado | Entrada HTTP e execução sob demanda. |
| Dados | DynamoDB | Planejado | Metadados e entidades; índices só após consultas reais. |
| Objetos | S3 | Planejado | Anexos, exportações e backups com regras distintas. |
| Observabilidade | CloudWatch logs, métricas e alarmes | Planejado | Falhas, latência, custo e sincronizações. |
| Logs da API | Classe Logger + middleware Express, texto colorido e JSON opcional | Implementado localmente; ver sessões 07/09 | Correlação por requestId, nível configurável e metadados seguros; coleta CloudWatch e alarmes dependem de implantação. |
| IaC | Terraform | Planejado | Infraestrutura reproduzível em `infra/`. |
| Integrações | Google Calendar/Gmail | Calendar parcial; Gmail planejado | Planner e adaptadores Google testados com fakes; conexão real pendente de cofre de produção e consentimento desktop. Sem conta real ou AWS usados. |
| Integração | Google Keep | Condicional | API oficial tem foco empresarial; verificar conta e permissões. |
| LLM | MCP | Futuro | Ferramentas sobre dados autorizados e com auditoria. |
| Movimento e CSS | GSAP + Tailwind CSS 4 | Tailwind ativo; GSAP em transições, seleção de períodos e troca de dias, com movimento reduzido | GSAP nas animações de interação; preferências do proprietário em AGENTS.md. Mesh decorativo CSS permanece na base. |

Não fixar versões de provider, runtime Lambda, autenticação ou região até o primeiro módulo concreto e a decisão em `docs/decisoes/pendencias.md`.
