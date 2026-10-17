# Revisão dos limites dos planos — preparação para decisão

> Documento de apoio. **Nenhum valor foi alterado**: os números abaixo são os
> que estão em `src/config/plans.ts` hoje. A tabela sugerida no final é uma
> proposta para o dono do produto decidir.

## Resumo

- O catálogo de planos (`src/config/plans.ts`) veio **inteiro da base Nexo**
  (gestão de projetos, inspirado no Plane): limites de páginas/wiki, ciclos,
  work items, importadores (Jira, Linear, Asana...). **Nenhum limite fala de
  CRM ou WhatsApp**, que são o produto do Steel.
- De tudo o que está no catálogo, **só `seats` é aplicado no backend**. O
  resto (créditos de IA, convidados, versões de páginas, ~85 features e 14
  capabilities) só aparece na tabela da página de preços.
- **BUSINESS (12 assentos) é mais limitado que PRO (ilimitado)** e igual ao
  FREE (12). Como o trial é BUSINESS, um workspace em trial tem menos
  assentos do que teria no PRO.
- Assentos comprados na assinatura (`subscription.seats`, até 10.000) **não
  são considerados** no limite de convites: um BUSINESS que paga 30 assentos
  continua travado em 12.

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
| `seats` (membros + convites pendentes) | 12 | ilimitado | **12** | ilimitado | `InvitationService.assertSeatAvailable` (`src/services/invitation.service.ts`) ao criar convite (workspace e projeto) e ao aceitar → `SEAT_LIMIT_REACHED` (403). Exibido em `settings/billing` (usa `subscription.seats` se houver, senão o limite do plano) |
| `aiCreditsPerSeat` | 500 | 1.000 | 2.000 | ilimitado | **Não aplicado.** O Steel AI (`src/lib/ai/`) e a IA do WhatsApp (`whatsapp-ai-reply`) não contam créditos. Só na página de preços |
| `guestsPerSeat` | 0 | 5 | 5 | ilimitado | **Não aplicado.** Não existe papel "convidado" (papéis: OWNER, ADMIN, MEMBER, VIEWER) |
| `pageVersions` | 0 | 20 | 60 | ilimitado | **Não aplicado.** Não há versionamento de páginas no código |
| `pageVersionDays` | 0 | 30 | 90 | ilimitado | **Não aplicado** (idem) |

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

## Features e capabilities (`FEATURE_MIN_TIER`, `CAPABILITIES`)

- **Features** (booleanas, monotônicas por tier): `projects`, `workItems`,
  `cycles`, `pages`, `importJira`... (FREE); `wiki`, `sla`, `github`,
  `slack`... (PRO); `saml`, `oidc`, `recurringWorkItems`, `intakeForms`...
  (BUSINESS); `ldap`, `apiAuditLogs`... (ENTERPRISE).
- **Capabilities** (níveis): `estimates`, `views`, `bulkOps`, `dashboards`,
  `timeTracking`, `workflows`, `roles`, `guests`, `supportChannels`...
- **Onde são aplicadas:** em lugar nenhum do backend. `can()` /
  `capabilityOf()` de `src/lib/plans.ts` não são chamados fora dos testes; o
  único consumidor é `app/(web)/_components/pricing/table/pricing-table-data.ts`.
- Várias descrevem funcionalidades que **não existem no Steel** (ciclos, work
  items, importadores, integrações GitHub/GitLab/Sentry/draw.io, SAML/OIDC/LDAP).
  A página de preços promete o que o produto não entrega.

## Inconsistências encontradas

1. **BUSINESS < PRO em assentos** (12 vs ilimitado), e BUSINESS = FREE.
   Hierarquia invertida: quem paga mais tem menos.
2. **Trial em BUSINESS** herda o teto de 12 — o trial é mais restrito que o
   plano mais barato pago.
3. **Assentos comprados ignorados** na checagem de convites (usa só o limite
   do plano).
4. **Limites e features exibidos mas não aplicados** (créditos de IA,
   convidados, versões de páginas, todas as features/capabilities).
5. **Catálogo sem nada de CRM/WhatsApp**: nenhum limite de conexões WhatsApp,
   contatos, transmissões, campanhas de e-mail, contas sociais, armazenamento
   ou módulos habilitados por plano.
6. **Módulos (CRM, Comunicação, ServiceDesk)** são habilitados por workspace
   (`WorkspaceModuleAccessService`) independentemente do plano.
7. Typo herdado numa chave: `wikiCollecions`.

## Tabela sugerida para o Steel (para decisão)

Proposta de ponto de partida — **valores ilustrativos**, a calibrar com
custo real (WhatsApp/IA/armazenamento) e posicionamento comercial.

| Limite | FREE | PRO | BUSINESS | ENTERPRISE | Como aplicar |
| ------ | ---- | --- | -------- | ---------- | ------------ |
| Assentos | 3 | até 25 (pagos por assento) | ilimitado (pagos por assento) | ilimitado | `limitOf` + considerar `subscription.seats` |
| Módulos incluídos | CRM | CRM + Comunicação | CRM + Comunicação + ServiceDesk | todos | `WorkspaceModuleAccessService` consultar o plano |
| Conexões WhatsApp (números) | 1 | 2 | 5 | sob contrato | `WhatsappConnectionService.create` |
| Contatos no CRM (pessoas + empresas) | 1.000 | 25.000 | 250.000 | ilimitado | `CrmPersonService`/`CrmCompanyService.create` |
| Mensagens de transmissão / mês | 0 | 5.000 | 50.000 | sob contrato | `WhatsappBroadcastService` |
| E-mails de campanha / mês | 500 | 10.000 | 100.000 | sob contrato | `CrmEmailCampaignService` |
| Contas de redes sociais conectadas | 1 | 5 | 20 | ilimitado | `CrmSocialService` |
| Créditos de IA por assento / mês (OpenAI + Anthropic, ver ADR 0007) | 100 | 1.000 | 3.000 | sob contrato | contador por workspace nos services de IA |
| Resposta automática por IA no WhatsApp | — | ✓ | ✓ | ✓ | `whatsapp-ai-config.service.ts` |
| Armazenamento (mídia, anexos) | 1 GB | 20 GB | 200 GB | sob contrato | soma por workspace no upload |
| Backup por workspace sob demanda | — | — | ✓ | ✓ | `triggerWorkspaceBackup` |
| Conexão a banco externo por módulo | — | — | ✓ | ✓ | `WorkspaceConnectionService` |
| Trial | BUSINESS 14 dias | | | | `src/config/trial.ts` |

Decisões necessárias:

1. Qual o teto de assentos de cada plano (e se BUSINESS passa a ser ≥ PRO).
2. Se assentos comprados na assinatura substituem o teto do plano.
3. Quais limites de CRM/WhatsApp entram no catálogo (e com quais valores).
4. Se as features/capabilities herdadas do Nexo saem da página de preços (ou
   são substituídas por features do Steel).
5. Se o plano define os módulos habilitados.

Depois da decisão: atualizar `PlanLimitsSchema` (`src/schemas/plan.schema.ts`),
`src/config/plans.ts`, a tabela de preços e aplicar cada limite no service
correspondente, com código de erro próprio em `src/errors/codes.ts`
(`<FEATURE>_LIMIT_REACHED`).
