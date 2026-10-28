# Biblioteca pessoal com API própria e capas por URL

Data: 2026-10-23. Estado: aceita para o recorte local, sem implantação AWS.

## Decisão

Obras usam um módulo `library` independente, sobre a mesma tabela das demais entidades e a partição do proprietário autenticado. Tipos iniciais: livro, filme e música. Status em código são `wanted`, `in_progress`, `completed`, `abandoned`, com rótulos em pt-BR. Campos opcionais usam null explícito para permitir limpeza via PATCH. Edição usa a versão condicional de notas; exclusão segue notas (existência, sem versão).

Consultas percorrem páginas por ID e aplicam filtros de tipo/status/tag/título na página avaliada. Essa escolha evita índices antes de medir o acervo pessoal, mantém leitura restrita ao proprietário e permite busca sem distinção de caixa. Páginas vazias com cursor são válidas, e a interface mantém o avanço disponível. Para acervos grandes, medir custo e latência antes de criar GSI ou busca dedicada.

Capas e links aceitam somente HTTP/HTTPS, sem uploads nem chamadas do backend ao endereço fornecido. O navegador carrega a capa externa com referrerPolicy=no-referrer e usa placeholder tipográfico ao falhar. Isso evita criar um proxy de imagens/SSRF no backend; ainda existe requisição do cliente ao host da imagem, informada no formulário.

## Interface

Preservar tokens do app: fundo #0B0B0C, superfície #151516, superfície elevada #202022, borda #343436, texto #F5F5F2 e secundário #A6A6A2. Título usa a serifa principal existente, corpo e controles usam Inter. Grade com quatro colunas em desktop amplo e duas em mobile; controles de busca empilham quando falta espaço. A capa tipográfica usa o título da obra para distinguir o acervo mesmo sem imagens. Grupo de tipos reutiliza ButtonGroup/GSAP; modal nativo e selects compartilhados mantêm teclado, foco e movimento reduzido.

Uma lista compacta reduziria altura, mas enfraqueceria a identificação visual de obras. Um mural decorativo dificultaria ações e consistência com Notas/Agenda/Finanças. A grade discreta atende o briefing, com modais para concentrar edição e confirmação para excluir.

O briefing autorizou decidir sem perguntar, prevalecendo sobre o protocolo de aprovação da skill bencium. Usou-se seu conteúdo de hierarquia, contraste, espaço e interação, preservando componentes/CSS/GSAP existentes em vez de introduzir shadcn, ícones ou dependências adicionais.

## Consequências e pendências

Sem snapshot entre páginas, busca indexada, idempotência de criação, lixeira, exportação, restauração, contador no Perfil ou sincronização offline. Adapter verificado com cliente falso e em tabela DynamoDB Local sintética (criada/excluída no teste); fluxos HTTP/UI usam memória e dados sintéticos. Não há teste nativo Tauri/WebKit. Persistência em AWS exige infraestrutura e autorização futuras.
