# Modelo de dados proposto

## Entidades

- `note`: ID, proprietário, título, corpo Markdown, tags, links, timestamps e versão.
- `attachment`: ID, proprietário, tipo, tamanho, checksum, chave S3 e referência ao registro.
- `integration`: provedor, escopos concedidos, status, cursor, último sucesso/erro; sem token em respostas.
- `external_record`: provedor, ID externo, tipo, versão/remoto, payload normalizado e proveniência.
- `transaction`: conta, categoria, valor decimal em unidade mínima, moeda, data e origem.
- `work_entry`: tipo de obra, título, criador, data de consumo, nota, avaliação e origem.
- `export_job`: formato, versão do esquema, período, status, checksum e localização temporária.

Metadados e registros consultáveis são candidatos a DynamoDB; arquivos e backups ficam em S3. A modelagem de chaves, índices, tamanho de itens e retenção depende de consultas reais e virá antes do Terraform de produção. Toda chave de acesso deve incorporar o proprietário validado no backend. Salvar origem e ID externo para evitar duplicatas. Não misturar payload bruto de Gmail com dados normalizados sem política de retenção e consentimento.

Exportação JSON deve conter `schemaVersion`, `exportedAt`, `owner`, manifestos e checksums. CSVs por domínio precisam codificação UTF-8, cabeçalho estável e valores seguros para planilhas. Restaurar em ambiente de teste antes de confiar em backup.
