# Contrato de finanças — sessão 06

RF-02, RF-03, RF-04, RF-08 e RF-10. Base `/v1/finance`, montada atrás da mesma autenticação das notas (JWT validado e `ALLOWED_SUBS`). `ownerId` vem exclusivamente do principal; não é aceito no corpo nem exposto na resposta. Usuário diferente recebe `404` para leitura, edição e exclusão de um ID alheio. Código local, sem implantação AWS.

| Método | Caminho | Entrada | Saída |
|---|---|---|---|
| GET | `/transactions` | `limit` inteiro 1–50, padrão 20; `cursor` opaco opcional | `{ items, nextCursor }` |
| POST | `/transactions` | lançamento completo | `201` lançamento |
| GET | `/transactions/:id` | UUID | lançamento |
| PATCH | `/transactions/:id` | lançamento completo + `version` inteiro positivo | lançamento, versão incrementada |
| DELETE | `/transactions/:id` | JSON `{ version }` | `204` |
| GET | `/banks` | mesma paginação | `{ items, nextCursor }` |
| POST | `/banks` | `{ title, logo }` | `201` banco |
| GET | `/banks/:id` | UUID | banco |
| PATCH | `/banks/:id` | `{ title, logo, version }` | banco, versão incrementada |
| DELETE | `/banks/:id` | JSON `{ version }` | `204` |
| GET | `/summary` | sem query | `{ currencies: [{ currency, incomeCents, expenseCents, balanceCents, count }] }` |
| GET | `/export.csv` | sem query | CSV UTF-8 com BOM, download `financas.csv` |

Lançamento completo (campos obrigatórios, inclusive nulos, exceto `installmentCount` opcional):

```json
{
  "title": "Mercado sintético", "amountCents": 12345, "currency": "BRL",
  "direction": "expense", "date": "2026-10-19", "category": "Casa",
  "tags": ["teste"], "bankId": null, "source": "Manual",
  "link": "monthlyBills", "linkedMonth": "2026-10", "paymentMethod": "pix"
}
```

`title`: 1–200 caracteres; `amountCents`: inteiro 1–1.000.000.000.000; moedas `BRL`, `USD`, `EUR`; `direction`: `income`/`expense`; data real ISO `AAAA-MM-DD`; categoria 1–80; até 20 tags de 1–40; origem 1–200. `bankId`: UUID do próprio usuário ou null. `link`: `none`, `salary`, `monthlyBills`; mês obrigatório nos dois últimos, nulo em `none`. Entrada exige método nulo; saída exige `pix`, `card`, `cash`, `transfer` ou `other`.

Resposta do lançamento adiciona `id`, `bankTitle` (fotografia do nome do banco), `createdAt`, `updatedAt`, `version`; a resposta do banco adiciona os mesmos metadados, exceto `bankTitle`. Exclusão de banco preserva os lançamentos e seu nome histórico. Edição de lançamento mantém essa fotografia quando o ID do banco não muda; selecionar outro banco exige que exista e pertença ao usuário.

`logo` é null, `{ kind: "url", url }` ou `{ kind: "upload", mime, base64 }`. URL: HTTP(S), sem credenciais, caminho terminado em `.png`, `.jpg`, `.jpeg` ou `.webp`. A API não busca URLs remotas; navegador usa `<img>` com `referrerPolicy="no-referrer"`. Conteúdo remoto não é verificado pelo servidor e pode mudar; a extensão permitida não comprova seu MIME. Upload: até 65.536 bytes decodificados, base64 canônico, MIME PNG/JPEG/WebP e assinatura de arquivo correspondente; SVG/GIF/HTML não são aceitos. O conteúdo raster não é recodificado nem analisado integralmente pelo servidor. Limite HTTP existente: 256 KiB.

Schemas Zod estritos em `modules/finance/contract.ts` e `dto/input.ts`; campos desconhecidos, datas inválidas, valores fracionários e `limit > 50` retornam `400 VALIDATION_ERROR`. Erros reutilizam envelope central com `requestId`: `401`, `403`, `404`, `409 CONFLICT` (versão obsoleta/concorrência), `413` e `500`; somatório que ultrapasse inteiro seguro responde `422 TOTAL_OVERFLOW`.

Paginação por ID, sem ordem cronológica; cursor opaco carrega somente ID, e a partição sempre é reconstruída pelo principal. `summary` e CSV percorrem todas as páginas (50 por consulta), apenas do usuário autenticado, sem converter moedas. CSV inclui ID, título, centavos, moeda, tipo, data, categoria, banco histórico, tags, origem, vínculo, mês e método; campos entre aspas, aspas duplicadas, fórmulas prefixadas com apóstrofo. Exportação é transmitida em fluxo com controle de escrita; falha após envio do cabeçalho encerra a conexão. Totais e exportação não são um snapshot transacional durante escritas concorrentes.

Integração web: `FinancePage` em `apps/web/src/finance/FinancePage.tsx`, cliente `lib/finance-api.ts` usa Axios central autenticado; rotas lazy `#/finance` e `#/finance/:id` (detalhe via GET individual) montadas após autorização do coordenador. Consultas e formulários pessoais só montam com `auth.status === "signed-in"`; sair desmonta estado local e cancela leituras, sem cache financeiro global. `401` expira a sessão. Exportação usa o endpoint global, nunca a página visível. Upload usa FileReader e envia os bytes. Sem login no navegador comum, o cliente central impede requisições, como nas notas.

## Parcelas de cartão

`installmentCount?: number | null` é opcional em POST e PATCH: inteiro de 1 a 120, sem coerção de strings. Número não-nulo só é aceito em `direction: "expense"` e `paymentMethod: "card"`; fora dessa combinação responde `400 VALIDATION_ERROR`. `null` explícito é aceito em qualquer método e significa não informado; `1` significa à vista; `2..120` informa parcelamento. Saídas sempre incluem `installmentCount`, com `null` para itens antigos sem o atributo. O tipo compartilhado `TransactionInput` contém a propriedade opcional, sem exigir adaptação insegura no cliente.

Em PATCH, o corpo continua exigindo os demais campos de domínio e a versão: omitir parcelas preserva o valor existente quando continua despesa por cartão; ao mudar para entrada ou outro método, omissão limpa para `null`. `null` explícito limpa também um cartão. Concorrência e isolamento continuam seguindo as condições de versão e principal já documentadas.

`amountCents` permanece o valor TOTAL: não se divide automaticamente o valor, não se geram lançamentos futuros, nem se alteram os totais globais. CSV acrescenta a coluna `Parcelas` ao final, vazia para `null`; mantém todas as páginas do usuário e o escape de fórmulas/aspas. Exemplo: cartão com `amountCents: 12000, installmentCount: 3` representa uma única despesa de R$ 120,00, informada como três parcelas.
