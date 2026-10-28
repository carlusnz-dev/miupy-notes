# Biblioteca — contrato HTTP

Estado em 2026-10-23: CRUD autenticado composto na API local e no handler Lambda (não implantado). Repositório em memória e adaptador DynamoDB, verificados com HTTP local sintético e cliente DynamoDB falso. Persistência também verificada em tabela sintética DynamoDB Local, criada e excluída no teste. Sem AWS, upload, importação, exportação ou sincronização de obras nesta frente. A interface usa o cliente Axios central e schemas públicos de `modules/library/contract.ts`.

Base `/v1/library`. Identidade, lista de proprietários permitidos e envelope de erro seguem [api.md](api.md). `ownerId` vem exclusivamente do principal; campos desconhecidos no corpo e na query são rejeitados. IDs são UUIDs. Obra inexistente ou pertencente a outra pessoa retorna o mesmo `404 NOT_FOUND`.

| Método | Caminho | Entrada | Sucesso |
|---|---|---|---|
| GET | `/library` | `limit=1..100` (20), `cursor?`, `kind?`, `status?`, `tag?`, `q?` | 200 `{ items, nextCursor }` |
| POST | `/library` | campos abaixo; `kind` e `title` obrigatórios | 201 obra |
| GET | `/library/{id}` | — | 200 obra |
| PATCH | `/library/{id}` | `version` positiva e ao menos um campo mutável | 200 obra com versão incrementada |
| DELETE | `/library/{id}` | — | 204 sem corpo |

## Campos

- `kind`: `book`, `film` ou `music`.
- `title`: 1–200 caracteres após trim.
- `creator`: autor, diretor ou artista; até 200 caracteres após trim, padrão `""`.
- `year`: inteiro 1–9999 ou `null` (padrão).
- `status`: `wanted` (Quero conhecer, padrão), `in_progress` (Em andamento), `completed` (Concluído), `abandoned` (Abandonado).
- `rating`: número de 0 a 5, inclusive frações, ou `null` (sem nota, padrão). Zero é uma avaliação válida.
- `tags`: até 20 strings de 1–40 caracteres após trim; padrão `[]`. Correspondência exata para filtro por tag.
- `startedOn`, `finishedOn`: data civil válida `AAAA-MM-DD` ou `null` (padrão). Fim não pode preceder início; PATCH valida também contra o campo preservado do registro.
- `comment`: comentário curto até 1000 caracteres após trim; padrão `""`.
- `externalUrl`, `coverUrl`: URL absoluta HTTP/HTTPS até 2048 caracteres ou `null` (padrão). Sem upload, download pelo backend ou armazenamento S3. Capa é carregada diretamente pelo navegador, sem referrer; o host externo recebe a requisição da imagem. Falha exibe capa tipográfica.

A resposta contém todos esses campos, mais `id`, `createdAt`, `updatedAt` (ISO UTC) e `version` (inteiro ≥1), sem `ownerId` nem chaves do banco. Omitir um campo no PATCH o preserva; `null` limpa opcionais anuláveis, `[]` limpa tags e `""` limpa criador/comentário.

## Paginação, busca e concorrência

A ordenação é crescente por UUID, sem ordem cronológica. Cursor opaco contém apenas o último ID avaliado; a partição continua derivada do principal, inclusive com cursor reaproveitado por outro usuário. Cursor malformado retorna 400. Use os mesmos filtros ao continuar a consulta.

`limit` limita itens **avaliados antes dos filtros**, seguindo a paginação base do DynamoDB. Uma página pode ter menos resultados ou estar vazia e ainda possuir `nextCursor`; continue até `null`. `kind`, `status`, `tag` e `q` se combinam por AND. Busca `q` (1–200 caracteres após trim) encontra trechos no título sem diferenciar maiúsculas/minúsculas, preservando acentos. Tag tem 1–40 caracteres. Nenhum GSI, scan global ou motor de busca foi criado. O custo de percorrer todo o acervo é proporcional ao acervo do proprietário; páginas não formam um snapshot transacional.

PATCH exige a versão lida. `PutCommand` condicional cobre disputa entre leitura e gravação: perdedor recebe `409 CONFLICT`; não há sobrescrita silenciosa. A interface mantém o formulário e instrui fechar/abrir a obra para carregar a versão atual. Detalhe usa leitura consistente no DynamoDB. DELETE é físico, condicional à existência; segue notas e não exige versão, podendo excluir uma edição recente. POST gera UUID no backend e não é idempotente; uma repetição após resultado ambíguo pode duplicar a obra.

## Erros

400 `VALIDATION_ERROR` para UUID, corpo, query ou cursor inválido; 401 `UNAUTHORIZED`; 403 `FORBIDDEN` para principal fora da lista; 404 `NOT_FOUND`; 409 `CONFLICT`; 413 `PAYLOAD_TOO_LARGE` (limite HTTP de 256 kB); 500 `INTERNAL_ERROR` para falhas inesperadas. Envelope `{ error: { code, message, requestId } }` e `X-Request-Id` seguem o contrato geral. Logs usam template `/v1/library/:id`, sem títulos, buscas, tokens ou proprietário.

## Persistência e limites

Mesma tabela `NOTES_TABLE_NAME`: `pk=USER#<ownerId>`, `sk=LIBRARY#<id>`. Query por partição/prefixo; sem migração de itens anteriores. Chaves separadas de notas, pastas, finanças e agenda. Atualização por versão e exclusão por existência são atômicas. Não há lixeira, política de retenção, backup/restauração verificado, exportação, contador agregado ou outbox offline. RF-09 permanece parcial até exportação/restauração e validação nativa.
