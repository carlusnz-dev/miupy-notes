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

## Parcelas de cartão

Lançamentos podem armazenar `installmentCount` como inteiro 1..120 ou null, apenas com número não-nulo em despesa por cartão. Ausência em itens legados é normalizada para null pelo schema de leitura do repositório; não há migração ou varredura de dados existentes. Novas gravações guardam o atributo explicitamente. Omissão no PATCH preserva o valor em cartão e limpa quando muda tipo/método; null explícito sempre limpa, sem alterar o controle de versão.

O atributo é informativo: 1 = à vista, 2..120 = parcelado, null = não informado. O total em centavos continua integral no mesmo lançamento; não há criação de itens futuros, divisão de valores ou mudança de agregações. A coluna `Parcelas` é acrescentada ao fim do CSV, vazia para null, com o mesmo percurso paginado e isolamento.

## Contas e referência manual (2026-10-21)

Acrescentado item `FINANCE#account#<uuid>` na mesma partição `USER#<principal.ownerId>`. Guarda `title`, `bankId`, `currency`, `openingBalanceCents`, `openingDate`, `source: "manual"`, timestamps e versão. Não foi criado índice, tabela AWS, migração nem conector. O repositório lê contas com schema próprio e usa as mesmas condições de criação/versão, reconstruindo a partição pelo principal.

Lançamento ganha `accountId` anulável; ausente no armazenamento lê como null. Referências de abertura não são lançamentos: nunca entram no `/summary` ou no CSV legado. O saldo por conta soma somente lançamentos a partir do início da data de referência, sem repetir os anteriores já cobertos por ela. Movimentos sem conta continuam separados como não alocados e entram uma vez no balanço por moeda. Mudança de referência é explícita e versionada; mudar instituição/moeda da conta é recusado, impedindo reclassificação indireta de seu histórico. Detalhes em [api-finance.md](api-finance.md#contas-e-balanço-2026-10-21).

Contas não são excluídas nesta etapa. Exclusão de instituição verifica todas as contas e recusa vínculos conhecidos; a leitura e a gravação não formam transação entre entidades, então criação de conta e exclusão simultânea de instituição ainda podem deixar referência órfã. O balanço conserva essa conta sob “Instituição removida”, sem perder seu valor. Corridas de edição do mesmo registro são protegidas por condição de versão; leituras de várias páginas/entidades não fornecem snapshot. O custo é proporcional ao acervo. O CSV atual não exporta referências/contas como backup restaurável; exportação completa, retenção e restauração seguem pendentes.

## Pluggy — pesquisa e proposta, sem integração executável

Pesquisa em 2026-10-21, apenas documentação pública primária; não foram cadastrados aplicativos, emitidos tokens, conectadas contas ou chamados endpoints financeiros. O [Quick Start oficial](https://docs.pluggy.ai/en/docs/quickstart) separa API key obtida pelo servidor do Connect Token usado no widget; a proposta é manter credenciais e API key exclusivamente no backend, emitir Connect Token efêmero após autenticação/consentimento e mantê-lo só em memória da web. Nada em bundle, localStorage, URLs ou logs.

Desenho proposto pelo projeto: mapear `(ownerId, provider, itemId)` para uma conexão autorizada e `(itemId, accountId externo)` para conta interna. Instituição corresponde ao conector, não ao item nem à conta. Para transações, manter mapeamento de `(ownerId, itemId, accountId, transactionId)` e histórico/tombstones. `transactionId` não é identidade imutável de uma compra: cartão pode receber delete + create; `providerId` só está disponível em Open Finance. Reconciliação por atributos deve admitir múltiplas compras idênticas e exigir revisão quando ambígua, sem colapsar cegamente data/valor. Esses limites constam na [documentação do ciclo de fatura](https://docs.pluggy.ai/en/docs/products/credit-card-statement-cycle).

Webhooks propostos: autenticar entrega com segredo backend em header configurado, validar payload e resolver proprietário pelo mapeamento autorizado do item (nunca confiar em `clientUserId` recebido como autorização). Persistir recebimento condicional por `(provider, eventId)` e enfileirar trabalho durável antes de confirmar; consumidor idempotente processa created/updated/deleted, pagina tudo e tolera reentregas e ordem diferente. `eventId` é compartilhado quando o mesmo evento é entregue a URLs distintas. Política de retry limitada, backoff, estado de falha e reconciliação periódica ainda precisam implementação. Base: [webhooks oficiais](https://docs.pluggy.ai/en/reference/webhooks).

Snapshot futuro separado da referência manual: `{ balanceCents, currency, observedAt, fetchedAt, source: "pluggy", itemId, accountId }`, com conversão decimal validada para centavos seguros. O [endpoint de saldo](https://docs.pluggy.ai/en/reference/account/account-balance-get) fornece `balance`, `currencyCode`, `updateDateTime`. Proposta: mostrar snapshot como saldo informado pelo provedor e lançamentos como movimentação/reconciliação; importar histórico não soma novamente ao snapshot nem altera `openingBalanceCents`. Contas de crédito devem distinguir fatura/passivo de ativo disponível antes de entrar em um balanço patrimonial.

[Saldo em tempo real](https://docs.pluggy.ai/en/docs/products/real-time-balance) é restrito a Open Finance, compartilha quota com sincronização e pode responder `429`; não presumir atualização instantânea. Antes de qualquer integração real: consentimento/escopos, retenção, remoção/desconexão, exportação verificável, gestão criptografada dos segredos, autenticação das entregas e reconciliação deverão ser definidos e testados em Sandbox sintético. Nenhuma autorização real foi concedida nesta etapa.
