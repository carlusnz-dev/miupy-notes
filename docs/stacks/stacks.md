# Stack e critérios

| Camada | Escolha | Estado | Motivo |
|---|---|---|---|
| Desktop | Tauri 2 + Rust | Login Google próprio (PKCE, loopback) com `keyring` 4, `reqwest` 0.13 (rustls), `tokio` | Distribuição nativa e casca pequena; medir binário real. |
| Editor | CodeMirror 6 (`@uiw/react-codemirror`, `@codemirror/lang-markdown`) + `react-markdown`/`remark-gfm` | Em uso, carregado sob demanda | Markdown puro (exportável), atalhos e prévia sem HTML bruto. |
| Interface | React + TypeScript + Vite | Base de interface em `apps/web`; instalada e compilada | UI tipada e fluxo já iniciado no repositório. |
| HTTP client | Axios | Cliente central em uso por notas, pastas, finanças e Calendar | Autenticação, timeout, erros e cancelamento padronizados; contratos compartilhados. |
| API | Express + TypeScript + Zod + AWS SDK + `jose` + adaptador Lambda | Módulos autenticados de notas, pastas, finanças e Calendar compilados/testados localmente; Lambda não implantada | Fronteiras por módulo e rota pública de saúde. |
| API Gateway HTTP + Lambda | AWS | Planejado | Entrada HTTP e execução sob demanda. |
| Dados | DynamoDB | Repositórios em uso com DynamoDB Local; AWS não implantada | Metadados e entidades; índices só após consultas reais. |
| Objetos | S3 | Planejado | Anexos, exportações e backups com regras distintas. |
| Observabilidade | CloudWatch logs, métricas e alarmes | Planejado | Falhas, latência, custo e sincronizações. |
| Logs da API | Classe Logger + middleware Express, texto colorido e JSON opcional | Implementado localmente; ver sessões 07/09 | Correlação por requestId, nível configurável e metadados seguros; coleta CloudWatch e alarmes dependem de implantação. |
| IaC | Terraform | Planejado | Infraestrutura reproduzível em `infra/`. |
| Integrações | Google Calendar/Gmail | Calendar parcial; Gmail planejado | Calendar local Linux com login Google único (Calendar pedido no login do Tauri; API lê o refresh token do chaveiro do login), leitura/escrita explícitas e ETag/PATCH; testes sintéticos. Conta real/chaveiro real/aceite nativo e cofre AWS pendentes; Lambda sem adaptador. Coordenação conectar/desconectar apenas por processo local. |
| Integração | Google Keep | Condicional | API oficial tem foco empresarial; verificar conta e permissões. |
| LLM | MCP | Futuro | Ferramentas sobre dados autorizados e com auditoria. |
| Movimento e CSS | GSAP + Tailwind CSS 4 | Tailwind ativo; GSAP em transições, seleção de períodos e troca de dias, com movimento reduzido | GSAP nas animações de interação; preferências do proprietário em AGENTS.md. Mesh decorativo CSS permanece na base. |

Não fixar versões de provider, runtime Lambda, autenticação ou região até o primeiro módulo concreto e a decisão em `docs/decisoes/pendencias.md`.
