# Persistência de finanças — sessão 06

O módulo `finance` contém bancos e lançamentos. Reutiliza `NOTES_TABLE_NAME` (chaves string `pk`/`sk`); nenhuma tabela de produção ou índice novo. `server.ts` mantém a restrição de endpoint DynamoDB em loopback. Lambda composta em código, não implantada.

| Entidade | Chave de partição | Chave de ordenação |
|---|---|---|
| Lançamento | `USER#<principal.ownerId>` | `FINANCE#transaction#<uuid>` |
| Banco | `USER#<principal.ownerId>` | `FINANCE#bank#<uuid>` |

Queries usam a partição do principal e prefixo da entidade, com leitura consistente e no máximo 50 itens. Cursores contêm apenas UUID; não aceitam proprietário ou chave arbitrária. O cursor usa `LastEvaluatedKey` mesmo quando o limite de 1 MiB do DynamoDB reduz a página de bancos com logos.

Itens guardam os campos de saída, proprietário e discriminador `kind`. Valores monetários são inteiros positivos em centavos e moeda explícita; sinal é determinado por `direction`. Totais por moeda não fazem conversão e rejeitam estouro de inteiro seguro. Data do evento é independente dos timestamps UTC de criação/edição. Origem é informativa, manual, sem conector ou alegação de proveniência verificada; salário/contas do mês são vínculos informativos com mês, sem entidades externas nesta entrega.

Criação exige chave inexistente. Alteração usa `Put` condicional em `version`; exclusão física usa `Delete` com versão. Bancos removidos não apagam nem alteram lançamentos; `bankTitle` mantém o nome histórico. Uma seleção nova de banco é validada dentro do usuário, mas a verificação e a gravação do lançamento não são transacionais com exclusão concorrente do banco. Nesse caso a fotografia preserva a leitura, e um vínculo pode apontar para banco já removido.

Uploads ficam inline em base64, até 64 KiB binários (~87,4 KiB codificados) e metadados pequenos: abaixo de 400 KiB por item. SVG bloqueado; raster com MIME, assinatura e base64 validados, sem decodificação integral ou recodificação. URLs remotas são referências HTTP(S) terminadas em extensão raster e podem mudar; sem fetch backend. Anexos maiores exigirão S3 e contrato separado.

Limitações: sem backup/restauração, lixeira, política de retenção, idempotência, índices por data, filtros, materialização de totais ou snapshot transacional da exportação. DynamoDB Local não comprova criptografia/retention/IAM de produção; esses recursos permanecem planejados. Exportar CSV permite leitura independente do app, mas não é backup restaurável.

Validação local: a suíte em `routes/finance.routes.test.ts` usa memória por padrão; `DYNAMODB_FINANCE_TEST_ENDPOINT=http://127.0.0.1:8000 npx tsx --test apps/api/src/modules/finance/routes/finance.routes.test.ts` cria tabela sintética única e a exclui ao final. Endpoint fora de loopback é recusado. Nenhuma consulta às tabelas pessoais é necessária.
