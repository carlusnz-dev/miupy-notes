# Pluggy, contas e saldos

Pesquisa pública e direção de integração solicitada pelo proprietário. Não há conexão Pluggy implementada ou conta bancária consultada nesta decisão.

## Modelo financeiro

Instituição (`bank`) e conta são entidades diferentes: um banco pode ter várias contas e moedas. Saldo manual calculado parte de referência com data explícita e soma movimentos posteriores da conta; lançamentos legados sem conta permanecem identificáveis como não alocados. Nunca somar BRL e USD em um único número. Alterar/excluir lançamento deve refletir o saldo calculado, sem manter total paralelo sujeito a divergência.

O saldo de um provedor é uma observação com origem, moeda e instante. Não acrescente novamente as transações importadas a esse mesmo saldo. Conta de cartão representa dívida/fatura e não deve aumentar disponibilidade de caixa. A [documentação de contas Pluggy](https://v2.docs.pluggy.ai/en/docs/products/accounts) distingue `BANK` de `CREDIT` e a semântica de `balance`.

## Integração proposta

- **Consentimento:** o backend autentica o usuário do miupy e emite Connect Token temporário. API key e segredo da aplicação permanecem no backend; o widget recebe apenas o token de conexão. O callback do browser não basta para vincular um Item ao proprietário: a aplicação deve validar e persistir esse vínculo no servidor. Fluxo na [introdução oficial](https://docs.pluggy.ai/en/docs/quickstart).
- **Importação:** manter origem, Item, conta, identificador externo e versão/estado do lançamento. Paginação completa, upsert idempotente, retentativa limitada e reconciliação devem ser testados antes de automatizar registros. Importação não deve sobrescrever anotação/categoria manual sem política de conflito explícita.
- **Notificações:** validar autenticação do webhook configurado e limitar corpo; deduplicar `eventId`, enfileirar trabalho e só confirmar após proteção durável. Não confiar em um `ownerId` recebido no corpo. A [referência de webhooks](https://docs.pluggy.ai/en/reference/webhooks) descreve headers configuráveis e eventos; não presumir assinatura nativa sem verificar o contrato adotado.
- **Mudança de identificador:** cartão pode reapresentar transação como delete/create ao fechar fatura. `providerId` existe somente para conectores Open Finance; igualdade de data/valor não prova duplicata. Fazer reconciliação conservadora e permitir revisão, conforme [ciclo de fatura](https://docs.pluggy.ai/en/docs/products/credit-card-statement-cycle). `PENDING` e `POSTED` exigem tratamento distinto.
- **Atualização de saldo:** [GET /accounts/{id}/balance](https://docs.pluggy.ai/en/reference/account/account-balance-get) retorna saldo, moeda e instante. O [guia de saldo em tempo real](https://docs.pluggy.ai/en/docs/products/real-time-balance) limita o recurso a Open Finance e informa quota compartilhada com sincronização; tratar `429` sem disparar tentativas pela renderização da tela.
- **Desconexão e retenção:** revogar novas sincronizações, descartar credenciais protegidas e deixar clara a escolha entre conservar histórico importado ou excluí-lo. Exportação deve preservar proveniência. Logs registram resultado técnico e requestId, sem saldo, identificação bancária ou conteúdo de lançamento.

## Aceite antes de habilitar uma conexão

Validar em sandbox oficial, sem conta real: consentimento negado/expirado, isolamento entre usuários, webhook repetido/fora de ordem/falso, paginação e `429`, atualização/exclusão/recriação de lançamento, mudança de moeda, múltiplas contas por banco, limites de centavos e saldo de cartão. Testar desconexão durante sincronização e recuperação após falha entre gravar e confirmar.

Cache da interface é uma cópia datada, não comprovação de saldo atual. Escrita offline só pode anunciar proteção local depois de persistir por conta; anunciar sincronização somente após confirmação do backend. Onde não houver outbox implementada, mostrar indisponibilidade e preservar o formulário em erro, sem prometer envio posterior automático.
