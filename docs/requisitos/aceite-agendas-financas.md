# Aceite de Agendas e finanças

Checklist de experiência solicitado em 2026-10-21. Os itens abaixo são critérios, não declaração de implementação ou aprovação. Evidências e limitações ficam no relatório da sessão e nos PRs.

| Frente | Critério observável |
|---|---|
| Agendas — planner | Entrada prioriza próximos eventos; hoje e navegação de período são claros. Modos dia, semana, mês e ano funcionam sem perder seleção. |
| Cronograma | Dia/semana exibem duração, horário e sobreposição em blocos; eventos de dia inteiro ficam separados. Evento atravessando meia-noite aparece nos dias corretos. |
| Formulário | Criar/editar título, descrição, local, início/fim, fuso e dia inteiro; rejeitar fim anterior/igual ao início. Não normalizar silenciosamente horários inválidos. |
| Relações internas | Vincular somente notas autorizadas. Biblioteca indisponível não aparece como relação funcional; IDs de outro usuário não revelam existência. |
| Calendar — espelho | Consentimento de leitura separado do login; calendário/origem, última sincronização e erro visíveis. Paginar até o fim e avançar cursor só após proteção dos dados. |
| Calendar — refletor | Escrita consentida separadamente; criação repetida não duplica, atualização respeita versão/ETag e conflito fica visível. Desconectar interrompe novas escritas. |
| Offline | Confirmar proteção local antes do envio; recarregar e restaurar por conta. Falha HTTP preserva alteração; retorno online reenvia sem duplicar. “Sincronizado” exige confirmação remota. |
| Cache | Chaves por usuário, período e filtros; resposta atrasada não reaparece após logout/exclusão. Falha de quota não é anunciada como salvo. |
| Notas | Duas filas não substituem a proteção local da outra; ACK antigo não remove nova escrita. Intenção de descarte protegida é reaplicada antes de restaurar após reinício. |
| Saldos | Conta distinta de instituição, referência com data e moeda; movimentos refletem em saldo individual e agregado por moeda sem duplicação. Legado sem conta identificado. |
| Finanças — formulário | Duas etapas preservam valores e mostram validação pertinente; voltar/avançar não grava antes da confirmação final. Parcelas continuam compatíveis. |
| Perfil | Métricas financeiras vêm da API autorizada e abrangem os registros aplicáveis, com estados vazio/erro/carregamento independentes e sem inventar totais. |
| Movimento | Modal entra e sai antes de desmontar, X externo acessível e painel arredondado. Menu lateral anima entrada/saída e texto sem perder nome acessível. |
| Acessibilidade | Desktop/móvel, foco por teclado, retorno de foco do modal, Escape, ausência de overflow e `prefers-reduced-motion` verificados no navegador real. |
| Dados e provedores | Credenciais fora do bundle/logs; testes sintéticos isolados; exportação/proveniência, desconexão e retenção explicitadas. Nada exige acesso a conta real para validar o código. |

Aceite nativo ainda requer Tauri/WebKit, encerramento forçado e duas janelas reais. Testes em Node ou Chromium não substituem esses cenários. Referências visuais #1–#5 devem ser comparadas quando os anexos estiverem acessíveis; até lá só a descrição escrita pode orientar o layout.
