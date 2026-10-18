# Stack e critérios

| Camada | Escolha | Estado | Motivo |
|---|---|---|---|
| Desktop | Tauri 2 + Rust | Template presente | Distribuição nativa e casca pequena; medir binário real. |
| Interface | React + TypeScript + Vite | Base de interface em `apps/web`; instalada e compilada | UI tipada e fluxo já iniciado no repositório. |
| HTTP client | Axios | Instalado; cliente central sem chamadas reais | Cliente único com autenticação, timeout, erros e cancelamento padronizados. |
| API | Express + TypeScript + Zod + AWS SDK + adaptador Lambda | Template em `apps/api`; instalado, compilado e testado | Fronteiras por módulo e rota pública de saúde. |
| API Gateway HTTP + Lambda | AWS | Planejado | Entrada HTTP e execução sob demanda. |
| Dados | DynamoDB | Planejado | Metadados e entidades; índices só após consultas reais. |
| Objetos | S3 | Planejado | Anexos, exportações e backups com regras distintas. |
| Observabilidade | CloudWatch logs, métricas e alarmes | Planejado | Falhas, latência, custo e sincronizações. |
| IaC | Terraform | Planejado | Infraestrutura reproduzível em `infra/`. |
| Integrações | Google Calendar/Gmail | Planejado | OAuth com consentimento e sincronização por provedor. |
| Integração | Google Keep | Condicional | API oficial tem foco empresarial; verificar conta e permissões. |
| LLM | MCP | Futuro | Ferramentas sobre dados autorizados e com auditoria. |
| Movimento e CSS | GSAP + Tailwind CSS 4 | Instalados; Tailwind ativo no build, GSAP ainda sem uso | GSAP para interações futuras; base atual usa animação CSS com movimento reduzido. |

Não fixar versões de provider, runtime Lambda, autenticação ou região até o primeiro módulo concreto e a decisão em `docs/decisoes/pendencias.md`.
