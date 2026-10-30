# AWS dev — migração de KMS, Lambda com Hábitos e URL da API (2026-10-30)

Pedido do proprietário: aplicar as alterações pendentes na AWS, cadastrar `VITE_API_BASE_URL` e fazer backup da chave de release Android. Apply executado como root (login `aws login` feito pelo proprietário), com plan revisado e escolha explícita do escopo.

## Mudanças na AWS (dev, sa-east-1)

- `backend.hcl` e `terraform.tfvars` locais tinham se perdido junto com o worktree `infra-aws`; foram reconstruídos fora do Git a partir do estado no S3 (`miupy-notes-tfstate-f22b82042741`). O bucket de estado exige SSE-KMS com a chave do bootstrap, então o backend recebeu `kms_key_id`, ao contrário do que diz o `infra/README.md`, que descreve o estado após a migração do bootstrap.
- O plan completo de `develop` trouxe toda a migração de KMS decidida em `docs/decisoes/2026-10-27_kms-gerenciado-aws.md` (nunca aplicada), não só a permissão de hábitos. O proprietário escolheu aplicá-la no dev.
- Etapa 1 (`-target` na tabela e nos `moved` de SSE do S3): 0/2/0; `describe-table` voltou `ACTIVE` sem `SSEDescription`.
- Etapa 2 (plan completo): `Apply complete! Resources: 3 added, 16 changed, 24 destroyed`. Destruídos: alarme composto, 18 alarmes e 5 filtros de métrica. Criados: alarmes de throttling de leitura e escrita do DynamoDB e a inscrição de e-mail de billing (a anterior expirou sem confirmação). As quatro chaves KMS do dev foram só esquecidas pelo Terraform e não estão agendadas para exclusão. A Lambda recebeu o bundle de `develop` (`9e49e8e`), com Hábitos e `dynamodb:ConditionCheckItem`.
- O plan após o apply não mostra mudanças.
- `vars.VITE_API_BASE_URL` = `https://c19hq9whnd.execute-api.sa-east-1.amazonaws.com` no repositório; entra no próximo release.

## Verificação

- Antes do apply: bucket do app sem objetos nem versões; tabela `ACTIVE` com 0 itens.
- `curl`: `/health` 200; `/v1/notes` e `/v1/habits` 401 sem token e com Bearer inválido. Lambda `Active`/`Successful`; sem eventos de erro no log nos 5 minutos seguintes.
- Backup da chave Android: `~/Documentos/pessoal/chaves/miupy-notes-android-release.tar.gpg` (gpg simétrico AES-256, senha do proprietário); decifrado e conferido por SHA-256 contra os originais. O `.gitignore` do cofre só admite `.gpg` em `chaves/`; sem commit no cofre.

## Pendências

- Proprietário: confirmar o e-mail de inscrição do SNS de billing (e o de alertas, se ainda pendente).
- Bootstrap: o estado local se perdeu; migrar o bucket de estado para SSE-S3 exige importar os recursos para um estado novo. Até lá, o backend do dev mantém `kms_key_id`.
- Depois: remover os blocos `removed`, desabilitar e depois agendar a exclusão das chaves, seguindo os prazos da decisão (a do DynamoDB só após 35 dias, por causa do PITR).
- CORS da API só admite `http://tauri.localhost`, a origem do Tauri no Windows e no Android. Linux e macOS usam `tauri://localhost` e devem ser recusados até a origem ser incluída; não testado.
- A allow list de IP vale para o app: fora da rede autorizada (ex.: celular nos dados móveis), a API responde 403.
- Não executados: CRUD com token real, roteiro `docs/validacao/aws-dev.md` e release com a URL nova.
