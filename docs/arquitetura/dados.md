# Modelo de dados proposto

## Entidades

- `note`: ID, proprietário, título, corpo Markdown, tags, links, timestamps e versão.
- `attachment`: ID, proprietário, tipo, tamanho, checksum, chave S3 e referência ao registro.
- `integration`: provedor, escopos concedidos, status, cursor, último sucesso/erro; sem token em respostas.
- `external_record`: provedor, ID externo, tipo, versão/remoto, payload normalizado e proveniência.
- `transaction`: conta, categoria, valor decimal em unidade mínima, moeda, data e origem.
- `work_entry`: tipo de obra, título, criador, data de consumo, nota, avaliação e origem.
- `export_job`: formato, versão do esquema, período, status, checksum e localização temporária.

Metadados e registros consultáveis são candidatos a DynamoDB; arquivos e backups ficam em S3. Notas usam `pk = USER#<ownerId>` e `sk = NOTE#<id>`, com `version` para escrita condicional (implementado em código e testado com cliente falso; tabela não criada). A lista consulta só a partição do proprietário, em ordem de ID; ordem por data exigirá índice. Exclusão é física; a retenção em backup ainda não foi definida. Demais índices, tamanho de itens e retenção dependem de consultas reais e virão antes do Terraform de produção. Toda chave de acesso deve incorporar o proprietário validado no backend. Salvar origem e ID externo para evitar duplicatas. Não misturar payload bruto de Gmail com dados normalizados sem política de retenção e consentimento.

Exportação JSON deve conter `schemaVersion`, `exportedAt`, `owner`, manifestos e checksums. CSVs por domínio precisam codificação UTF-8, cabeçalho estável e valores seguros para planilhas. Restaurar em ambiente de teste antes de confiar em backup.

## Finanças

[Modelo de lançamentos e bancos](dados-finance.md): chaves por proprietário na mesma tabela, versão, centavos, moeda, logo limitado e nome histórico do banco. Verificado em DynamoDB Local; sem implantação AWS.

## Pastas de notas

Itens `FOLDER#<id>` na partição `USER#<ownerId>`, com nome, parentId, datas e version. Notas guardam folderId opcional no armazenamento (legado vira null na saída). Pai de pasta é imutável; só criação e renomeação. Limite de 500 pastas é verificado por leitura, sem contador atômico; criação concorrente pode ultrapassar esse limite. Profundidade máxima de oito níveis. Contrato e limites em [api.md](api.md).

## Leituras de notas (sessão 07)

O snapshot persiste **corpo e metadados juntos no item DynamoDB**; não existe migração do corpo para S3 nesta sessão. `listMetadata` projeta os atributos de navegação, sem corpo; `summary` percorre páginas completas de 100 itens do proprietário e agrega palavras, caracteres, tags, dias e até dez títulos, sem devolver o acervo ao React. Não há item agregado, GSI ou infraestrutura adicional. O cursor e a ordenação por ID permanecem iguais; não existe filtro de notas por pasta/tag no backend atual.

Projeção reduz tráfego, **não RCUs por si só**, pois a capacidade da tabela base considera o tamanho dos itens lidos ([DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ProjectionExpressions.html)). O resumo ainda custa leitura proporcional ao acervo, sem teto silencioso de 5.000 itens; mantém em memória a página atual, até dez títulos e as tags distintas. Sem benchmark ou promessa de economia percentual. Queries de lista/resumo são eventualmente consistentes, sem snapshot entre páginas; o detalhe passa a `ConsistentRead: true` para a reconciliação do autosave, com o custo de capacidade correspondente ([consistência DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html)). Escrita segue Put condicional por versão e dono derivado exclusivamente do principal. Uma leitura consistente não impede concorrência posterior nem torna PATCH idempotente.

## Biblioteca

Obras `LIBRARY#<id>` em `USER#<ownerId>`, na mesma tabela. Campos, concorrência e consultas em [api-library.md](api-library.md); decisão em [Biblioteca](../decisoes/2026-10-23_biblioteca.md). Filtros são aplicados depois da página avaliada; avanço usa o último ID avaliado. Sem índice de busca, snapshot, exportação, restauração ou retenção definida. Adaptador testado com cliente falso e integração em tabela DynamoDB Local sintética, criada e excluída no teste.

## Objetos preparados em 2026-10-24

[Prefixos e retenções S3](armazenamento-s3.md) têm Terraform validado localmente, sem implantação, dados migrados ou novos endpoints. Corpo de nota continua no DynamoDB. Expiração em bucket versionado não implica remoção física imediata de versões: exportações, importações e temporários têm prazos correntes e não correntes separados. Recuperação e exclusão verificável ainda exigem implementação e ensaio autorizados.
