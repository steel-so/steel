# Limites dos planos — estado e decisões

> Atualizado em 22/10/2026 com as decisões do dono do produto. Os valores
> abaixo são os que estão em `src/config/plans.ts`.

## Resumo

- O catálogo (`src/config/plans.ts`) carrega **só o que o backend aplica**:
  o limite de assentos (`seats`). As features, capabilities e limites
  herdados da base Nexo (créditos de IA, convidados, versões de páginas,
  ciclos, importadores, SAML/LDAP...) foram **removidos**: nunca foram
  aplicados e descreviam funcionalidades que o Steel não tem. A página de
  preços (`pricing-table-data.ts`) lista apenas o que existe de verdade.
- **Decisão de 22/10/2026:** FREE e PRO até **12 assentos**; BUSINESS e
  ENTERPRISE **sem limite**. Como o trial é BUSINESS, o workspace em trial
  não tem teto de assentos.
- Assentos comprados na assinatura (`subscription.seats`, até 10.000)
  continuam **sem efeito** no limite de convites. Decisão adiada.
- Limites de CRM e WhatsApp no catálogo, e os módulos definidos pelo plano:
  **decisão adiada** (módulos continuam habilitados por workspace pela
  Stratus). Os limites mensais da Comunicação (abaixo) valem, por workspace,
  fora do plano.

## Cobrança desligada (`BILLING_ENABLED`)

Decisão do dono do produto em 06/10/2026: **não há cobrança pelo Steel por
enquanto**. O código do AbacatePay continua no repositório, mas fica atrás da
flag `BILLING_ENABLED` (default `false`; só `'true'` liga — `isBillingEnabled()`
em `src/lib/billing.ts`). Com a flag desligada:

- Checkout (`POST /api/payment/plan`) e cupom (`GET /api/coupons/validate`)
  respondem `BILLING_DISABLED` (503) sem chamar o provedor; o webhook
  (`POST /api/payment/webhook`) responde 404 sem processar nada — logo as
  notificações `BILLING_PAYMENT_FAILED` / assinatura cancelada nunca disparam.
- `/upgrade` redireciona para `/talk-to-sales`; `settings/billing` mostra o
  plano e os assentos, mas troca a grade de upgrade por "Planos e cobrança
  indisponíveis no momento — fale com a Stratus Telecom"; o banner do fim do
  trial some; na página de preços os planos pagos levam a vendas.
- O componente "Assinatura" (pagamento) sai da coleta e da página de status
  (o histórico antigo continua legível) e o AbacatePay sai da lista de
  subprocessadores.
- Plano e trial definidos pelo admin global continuam funcionando. Na
  exclusão de workspace, uma assinatura `PAID`/`PENDING` antiga vira tentativa
  `FAILED` (o provedor não é chamado) e barra a exclusão — o admin pode forçar.
- `ABACATE_PAY` e `ABACATE_PAY_WEBHOOK_SECRET` ficam opcionais e passam a ser
  obrigatórias no boot assim que `BILLING_ENABLED=true`.

Para religar: `BILLING_ENABLED=true` + as duas credenciais no `.env` do
servidor (SOPS) e reiniciar os containers — não precisa de rebuild.

## Limites numéricos (`LIMITS`)

| Limite | FREE | PRO | BUSINESS | ENTERPRISE | Onde é aplicado |
| ------ | ---- | --- | -------- | ---------- | --------------- |
| `seats` (membros + convites pendentes) | 12 | 12 | ilimitado | ilimitado | `InvitationService.assertSeatAvailable` (`src/services/invitation.service.ts`) ao criar convite (workspace e projeto) e ao aceitar → `SEAT_LIMIT_REACHED` (403). Exibido em `settings/billing` (usa `subscription.seats` se houver, senão o limite do plano) |

Outros valores relacionados, fora do catálogo:

| Item | Valor | Onde |
| ---- | ----- | ---- |
| Preço PRO | R$ 43,02/assento/mês · R$ 387,15/assento/ano | `src/config/plan-prices.ts` |
| Preço BUSINESS | R$ 80,06/assento/mês · R$ 836,81/assento/ano | idem |
| Trial | BUSINESS por 14 dias; banner a partir de 5 dias do fim; reversão de hora em hora | `src/config/trial.ts`, fila `trial-lifecycle` |
| Assentos na compra | 1 a 10.000 | `src/schemas/subscription.schema.ts` |
| Upload de mídia (genérico / vídeo de landing page) | 5 MB / 25 MB | `src/services/media/_media.ts`, `media/crm-landing-page-media.service.ts` — iguais para todos os planos |

## Limites mensais da Comunicação (por workspace, fora do plano)

Desde 14/10/2026 o OWNER/ADMIN define em **Ajustes › Comunicação** dois
limites mensais, independentes do plano (`WhatsAppSettings.monthlyConversationLimit`
e `monthlyMessageLimit`; vazio = ilimitado, o padrão):

| Limite | Conta | Em 100% | Onde é aplicado |
| ------ | ----- | ------- | --------------- |
| Conversas / mês | conversas abertas ou reabertas (recebidas e iniciadas) | a equipe não inicia nem reabre conversas (`WHATSAPP_CONVERSATION_LIMIT_REACHED`, 402); as recebidas continuam chegando | `WhatsAppConversationService.start`/`reopen`; contagem também no webhook |
| Mensagens / mês | mensagens enviadas (atendimento, IA, transmissões, campanhas; reações não) | envios recusados (`WHATSAPP_MESSAGE_LIMIT_REACHED`, 402); recebidas continuam | `WhatsAppSend` (`src/lib/whatsapp/send.ts`), ponto único de envio |

- Contadores em `whatsapp_usage_monthly` (mês no fuso America/Sao_Paulo).
- Só conexões do módulo Comunicação; o WhatsApp do ServiceDesk não conta.
- A confirmação de descadastro (LGPD) sai sempre e não conta.
- Todos os membros recebem aviso no inbox em 50%, 80% e 100%, uma vez por
  mês para cada limite e patamar.
- Se a consulta ao banco falhar, o envio é liberado (não para o atendimento);
  envios simultâneos bem no limite podem ultrapassá-lo em poucas unidades.

## Servidor MCP (todos os planos)

Decisão do dono do produto em 17/10/2026 (ADR 0032): o **servidor MCP**
(`/api/mcp`, que conecta Claude, ChatGPT, Cursor e outros clientes de IA ao
workspace) está **disponível em todos os planos**, sem limite por plano.

| Item | Valor | Onde |
| ---- | ----- | ---- |
| Plano mínimo | nenhum (FREE em diante) | não há checagem de plano na rota nem no consentimento |
| Cota de IA (ADR 0019) | **não se aplica**: o modelo é do cliente | o servidor não chama `AiUsageService` |
| Limite de uso | rate limit por usuário (`mcp:<userId>`) e por cliente OAuth (`mcp-client:<clientId>`) | `app/api/mcp/route.ts`, `src/lib/rate-limit.ts` |
| Escrita | só com `mcp:write` **e** "Permitir escrita via MCP" ligado pelo admin; `DELETE` nunca | `WorkspaceAiSettings.mcpWriteEnabled`, contrato em `docs/mcp/README.md` |

A página de preços não lista o MCP como diferencial de plano. Revisitar quando
houver uso medido (consequência registrada na ADR 0032).

## Decisões

| # | Tema | Decisão (22/10/2026) |
| - | ---- | -------------------- |
| 1 | Teto de assentos | FREE e PRO 12; BUSINESS e ENTERPRISE ilimitado |
| 2 | Assentos comprados substituem o teto do plano | adiado |
| 3 | Limites de CRM/WhatsApp no catálogo (conexões, contatos, transmissões, e-mails, redes, armazenamento) | adiado |
| 4 | Features/capabilities herdadas do Nexo | removidas do código e da página de preços; fica só o que é real |
| 5 | Plano define os módulos habilitados | ainda não; no futuro sim |

Quando os itens 2, 3 e 5 forem retomados: acrescentar a chave em
`PlanLimitsSchema` (`src/schemas/plan.schema.ts`) junto com a aplicação no
service correspondente, com código de erro próprio em `src/errors/codes.ts`
(`<FEATURE>_LIMIT_REACHED`), e atualizar a tabela de preços.
