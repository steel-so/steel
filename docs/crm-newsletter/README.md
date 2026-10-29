# Newsletter do CRM — contrato

Decisão de arquitetura: [ADR 0054](../adr/0054-newsletter-no-crm-com-dominio-proprio.md).
Menu: **CRM › Newsletters**. Domínios: **Ajustes › Domínios de e-mail**.

## Peças do contrato

| Onde | O quê |
|---|---|
| `prisma/schema.prisma` (fim do arquivo) | `WorkspaceSendingDomain`, `CrmNewsletter`, `CrmNewsletterSubscriber`, `CrmNewsletterIssue`, `CrmNewsletterIssueRecipient`, `CrmNewsletterLinkClick`, `CrmNewsletterSettings`, `CrmNewsletterUsageMonthly`; `CrmForm.newsletterId`; `CrmEmailOptOutSource.PREFERENCES` |
| `src/schemas/sending-domain.schema.ts` | Nome do domínio (bloqueia Gmail/Outlook/…/stratustelecom), regiões, registros DNS, `SendingDomainDTO` |
| `src/schemas/crm-newsletter.schema.ts` | Newsletter, assinantes, importação, inscrição pública, central de preferências, ajuste do admin, uso do mês |
| `src/schemas/crm-newsletter-issue.schema.ts` | Edição, envio de teste, envio/agendamento, estatísticas, arquivo público |
| `src/errors/codes.ts` | `SENDING_DOMAIN_*`, `CRM_NEWSLETTER_*` (factories em `app-error.ts`) |
| `src/config/plans.ts` | `newsletterEmailsPerMonth`: FREE 3.000 · PRO 30.000 · BUSINESS 150.000 · ENTERPRISE ilimitado |
| `src/lib/newsletter/tokens.ts` | Links assinados: confirmação (7 dias), descadastro e preferências (sem validade) |
| `src/lib/newsletter/urls.ts` | Todas as URLs públicas + cabeçalhos `List-Unsubscribe` |
| `src/lib/sending-domain/resolve-sender.ts` | `resolveVerifiedSender(workspaceId, fromEmail)` — o remetente precisa estar num domínio `VERIFIED` (nome exato) |
| `app/_components/crm/newsletters/issues/newsletter-issues-tab.tsx` | Aba "Edições" (provisória; a frente de edições substitui o corpo) |

## Frentes

| Frente | Entrega | Depende de |
|---|---|---|
| `nl-domains` | Domínios de envio: cadastro no Resend, registros DNS para copiar, verificação (botão + fila), DMARC sugerido, remoção, página em Ajustes, runbook | contrato |
| `nl-core` | Newsletters e assinantes: CRUD, lista no CRM, página com abas (Edições, Assinantes, Configurações), adicionar/importar/exportar CSV, inscrição pública, confirmação dupla, central de preferências, descadastro, formulário do CRM inscrevendo | contrato |
| `nl-issues` | Edições e envio: editor (Steel Canvas), teste, enviar/agendar/cancelar, fila `crm-newsletter`, limite do mês, webhook do Resend, relatório da edição (funil e cliques por link), uso no admin | contrato |
| `nl-archive` | Arquivo público `/n/<ws>/<newsletter>`, versão web da edição, RSS, página de inscrição, elementos do Sites (inscrição e últimas edições) | contrato |

Ordem de merge: `nl-domains` → `nl-core` → `nl-issues` → `nl-archive`.

## Regras do domínio

**Domínio de envio**
- Cadastro: `resend.domains.create({ name, region, openTracking: true, clickTracking: true })`; guarda `resendDomainId`, `status` e `records`.
- Verificação: botão "Verificar agora" (`domains.verify` + `domains.get`) e fila que reconfere os pendentes a cada 10 minutos nas primeiras 72 h e depois uma vez por dia; os verificados são reconferidos uma vez por dia (DNS removido volta a `FAILED` e a newsletter para de enviar).
- DMARC: o Resend não exige, mas Gmail/Yahoo sim para volume. A tela consulta `_dmarc.<domínio raiz>` e, se não houver, sugere `v=DMARC1; p=none;`.
- Remover: recusado com `SENDING_DOMAIN_IN_USE` se alguma newsletter `ACTIVE` envia dele; senão `domains.remove` e apaga a linha.
- Nome único na plataforma (`SENDING_DOMAIN_TAKEN`).

**Newsletter**
- Slug único por workspace (derivado do nome quando omitido).
- `fromEmail` pode ser salvo antes de o domínio estar verificado; `senderVerified` no DTO avisa, e o envio é recusado com `SENDING_DOMAIN_NOT_VERIFIED`.
- Arquivar (`status: ARCHIVED`) para inscrições e envios; reativar volta.

**Assinante** (uma linha por newsletter × e-mail, e-mail sempre minúsculo)
- Inscrição pública: rate limit por IP e por e-mail; honeypot `website`; guarda IP, navegador e texto do consentimento.
  - Com confirmação dupla: `PENDING` + e-mail de confirmação (link de 7 dias). Repetir a inscrição reenvia, no máximo uma vez a cada 10 minutos.
  - Sem confirmação dupla: `ACTIVE`.
  - Endereço no descadastro global, `BOUNCED` ou `COMPLAINED`: a resposta pública é a mesma de sucesso (não revela nada); nada muda.
  - `UNSUBSCRIBED` que se inscreve de novo: volta para `PENDING` (ou `ACTIVE`).
- Adição manual e importação: `ACTIVE` na hora (o membro declara o consentimento — importação exige `consentConfirmed: true`), ou confirmação dupla se pedir.
- Liga à pessoa do CRM quando existe `CrmPerson` do workspace com esse e-mail; não cria pessoa.
- Descadastro: link do rodapé (página `/newsletter/sair/<token>`) e POST de um clique (RFC 8058) tiram só daquela newsletter; a central de preferências permite escolher cada uma ou "sair de tudo" (grava `CrmEmailOptOut` com `PREFERENCES`).
- Exportar CSV e remover assinante são auditados (`auditMutation`).

**Edição**
- Começa do modelo da newsletter, de outro modelo ou duplicando outra edição. Conteúdo = documento Steel Canvas de e-mail.
- Editável só em `DRAFT`/`SCHEDULED` (`CRM_NEWSLETTER_ISSUE_LOCKED`).
- Envio de teste: até 5 e-mails, 10 testes por hora por edição, não conta no limite.
- Enviar agora ou agendar (mínimo 5 minutos à frente). Antes de começar:
  remetente verificado, assunto e conteúdo válidos (checklist do editor), audiência > 0 (`CRM_NEWSLETTER_NO_SUBSCRIBERS`) e audiência ≤ saldo do mês (`CRM_NEWSLETTER_LIMIT_REACHED`, com os números na mensagem).
- Ao começar: número da edição (`max + 1`), fotografia da audiência (assinantes `ACTIVE` fora do descadastro global), `webHtml` sem dados pessoais e `excerpt`.
- Envio em lotes pela API de lote do Resend (até 100 por chamada), com `From: "<fromName>" <fromEmail>`, `Reply-To`, cabeçalhos `List-Unsubscribe`, rodapé obrigatório com descadastro, preferências e endereço da marca, e tags `kind=newsletter` / `issue=<id>`. `MAIL_DRY_RUN` e endereços de teste continuam sem sair.
- Cancelar: só `SCHEDULED` (volta para `DRAFT`); durante `SENDING`, "parar envio" marca os pendentes como `SKIPPED`.
- Uso do mês: incrementa por e-mail enviado; avisos no inbox em 50 %, 80 % e 100 % (uma vez por mês cada).

**Webhook do Resend** (`/api/crm/campaigns/resend-webhook`, mesma assinatura)
- Procura `providerMessageId` primeiro em `crm_newsletter_issue_recipients`, depois nas campanhas.
- `delivered` / `opened` / `clicked` marcam a primeira vez no destinatário e atualizam `lastOpenedAt`/`lastClickedAt` do assinante; cada clique grava `CrmNewsletterLinkClick` com a URL.
- `bounced` permanente: destinatário `bouncedAt` e o e-mail vira `BOUNCED` em todas as newsletters do workspace. Temporário: só registra.
- `complained`: destinatário `complainedAt` e o assinante daquela newsletter vira `COMPLAINED`.

**Arquivo público**
- `/n/<ws>/<newsletter>`: nome, descrição, frequência, formulário de inscrição e edições enviadas (mais recentes primeiro). 404 se a newsletter não existe, está arquivada ou o arquivo está desligado.
- `/n/<ws>/<newsletter>/<edição>`: `webHtml` com cabeçalho do arquivo e formulário de inscrição ao final; SEO (título, descrição, Open Graph).
- `/n/<ws>/<newsletter>/rss.xml`: RSS 2.0 das últimas 50 edições.

## Permissões

| Ação | Quem |
|---|---|
| Ver newsletters, edições, assinantes e relatórios | membro do módulo CRM (recurso `email`, `VIEW`) |
| Criar/editar newsletter, edição e assinantes | recurso `email`, `CREATE`/`EDIT` |
| Excluir newsletter ou edição em rascunho, remover assinante | recurso `email`, `DELETE` |
| Enviar, agendar, cancelar | recurso `email`, `EDIT` |
| Domínios de envio | OWNER/ADMIN do workspace |
| Ajuste do limite mensal | admin da plataforma |

## Ponte com o CRM (fase 2, `nl2-crm-bridge`)

Peças: `src/services/crm-newsletter-bridge.service.ts` (`CrmNewsletterBridge.emit`), `src/repositories/crm-newsletter-bridge.repository.ts`, `src/services/crm-newsletter-person.service.ts`, `CrmLeadScoringRuleService.applyEngagementEvent`, `dispatchCrmWorkflowNewsletterEvent` (`crm-workflow-dispatcher.ts`), tabela `crm_lead_score_events`.

**Eventos** — quem emite e o que cada um faz:

| Evento | Emitido por | Linha do tempo | Pontuação | Workflow |
|---|---|---|---|---|
| `subscribed` | inscrição pública/formulário/Sites, central de preferências (ligar), adição manual, cartão da pessoa | `NEWSLETTER_SUBSCRIBED` (texto diz se aguarda confirmação) | `newsletter_subscribed` se `ACTIVE` | `newsletter-subscribed` se `ACTIVE` |
| `confirmed` | link de confirmação | `NEWSLETTER_CONFIRMED` | `newsletter_subscribed` | `newsletter-subscribed` |
| `unsubscribed` | link/um clique, central de preferências (desligar/sair de tudo), cartão da pessoa | `NEWSLETTER_UNSUBSCRIBED` | — | `newsletter-unsubscribed` |
| `issue_received` | webhook `delivered` (primeira vez) | `NEWSLETTER_ISSUE_RECEIVED` | — | — |
| `issue_opened` | webhook `opened`, ou `clicked` sem abertura antes (primeira vez) | `NEWSLETTER_ISSUE_OPENED` | `newsletter_opened` | `newsletter-issue-opened` |
| `link_clicked` | webhook `clicked` (todo clique, depois de gravado) | `NEWSLETTER_LINK_CLICKED` | `newsletter_clicked` (+ "URL contém") | `newsletter-link-clicked`, só no 1º clique do destinatário naquela URL |

**Regras**
- Importação CSV **não** emite eventos (volume; decisão da frente). Retorno permanente e denúncia de spam também não.
- Pessoa: `subscriber.personId`, senão a pessoa viva mais antiga com o e-mail (sem gravar o vínculo). Sem pessoa → sem linha do tempo; pontuação e workflow seguem pelo e-mail.
- Linha do tempo: `CrmActivity` com `actorUserId` nulo, `entity` `newsletter` (`entityId` = newsletter) ou `newsletter_issue` (`entityId` = edição). Eventos de edição: uma entrada por tipo por edição (consulta antes de gravar). A tela mostra o texto sem "Sistema".
- Pontuação: regras de pontuação com `field` `newsletter_*` (só pontuação; roteamento recusa), gravadas com `operator: contains`; `value` só vale em `newsletter_clicked` (URL contém, sem diferenciar maiúsculas). Leads ligados = vivos com o e-mail ou `convertedPersonId` = pessoa. Idempotência: `crm_lead_score_events` único por regra × lead × chave (`newsletter:<id>` ou `issue:<id>`); o `score` é incrementado na mesma transação. O recálculo das regras de campo (`CrmLeadRepository.update` com `score`) soma os pontos ganhos, então editar o lead não os perde. Apagar a regra mantém os pontos.
- Workflows: gatilhos `newsletter-subscribed`, `newsletter-unsubscribed`, `newsletter-link-clicked` (`urlContains` opcional), `newsletter-issue-opened`, todos com `newsletterId` opcional. A execução não tem `startedById` e age como o criador do workflow (como o webhook). Payload: `{ event, newsletter: {id,name}, record: {id,email,name,status,personId}, issue?: {id,subject,number}, url? }`.
- Falhas: `emit` nunca lança nem devolve erro; cada passo (carga, linha do tempo, pontuação, workflows) loga `crm.newsletter.bridge_failed` e o seguinte continua.

**Cartão "Newsletters" da pessoa** — `GET/POST /api/workspaces/{id}/crm/people/{personId}/newsletters`, `DELETE …/{subscriberId}`. Lista inscrições ligadas à pessoa ou a um e-mail dela e as newsletters ativas disponíveis (sem inscrição ou descadastrada). Inscrever reaproveita a adição manual (consentimento declarado, `PENDING` para quem tinha saído, auditoria `create`). Descadastrar grava `UNSUBSCRIBED` com o motivo "Descadastrado por um membro do workspace." e audita `opt_out` com `source: CRM_PERSON`. Permissões: recurso `email` (`VIEW`/`CREATE`/`EDIT`).

## Público e segmentos (newsletter2 · `nl2-segments`)

Uma edição vai para todos os assinantes `ACTIVE` (fora do descadastro geral) ou só para um **segmento**. O segmento nunca amplia essa base: só restringe.

| Onde | O quê |
|---|---|
| `src/schemas/crm-newsletter-segment.schema.ts` | `NewsletterSegmentSchema` (E de `conditions` + grupos OU em `groups`), segmento salvo, público da edição, prévia, opções do construtor |
| `src/lib/crm-newsletter/segment-where.ts` | Compilador puro segmento → `Prisma.CrmNewsletterSubscriberWhereInput`; `segmentNeeds` (o que resolver antes) e `parseStoredSegment` |
| `src/services/crm-newsletter-audience.ts` | `resolveSegmentWhere` (valida campos personalizados, busca as últimas edições e os ids de pessoa por campo) e `issueAudienceWhere(issue)` |
| `prisma/schema.prisma` (fim do arquivo) | `CrmNewsletterSegment` (nome único por newsletter); relação `CrmNewsletterSubscriber.person` → `CrmPerson` (`SET NULL`) |
| Rotas | `GET/POST …/newsletters/:id/segments`, `PATCH/DELETE …/segments/:segmentId`, `GET …/segments/options`, `GET/PUT …/issues/:issueId/segment`, `POST …/issues/:issueId/audience-preview` |
| UI | Seção **Público** do diálogo de envio (`segments/issue-audience-section.tsx`); botão **Segmentos** na página da newsletter (`segments/newsletter-segments-dialog.tsx`) |

**Condições**
- Assinante: `source` (origens), `subscribed` (`before` / `onOrAfter` de um dia), `confirmed` (`confirmedAt`).
- Engajamento: `opened` / `clicked` em alguma (`any`) ou nenhuma (`none`) das últimas N edições `SENT` (1–50, por `sentAt`), `neverOpened` (`lastOpenedAt` nulo), `lastOpenedBefore` (já abriu e a última abertura foi antes do dia).
- Pessoa do CRM (não excluída): `linkedPerson`, `company`, `jobTitle` / `city` (`equals` / `contains`, sem diferenciar maiúsculas), `customField` (campo de **pessoa**: `equals`, `contains` — só texto —, `isSet`, `isNotSet`), `openOpportunity` (como ponto de contato ou pela empresa, etapa `OPEN`), `leadStage` (lead convertido na pessoa).
- Negações (`linkedPerson: false`, `openOpportunity: false`, `isNotSet`) incluem quem não tem pessoa.
- Datas são dias em America/Sao_Paulo (início do dia, -03:00).
- O CRM não tem etiquetas (tags) em pessoas: não há condição de etiqueta.
- Limites: 20 condições, 5 grupos, 10 opções por grupo, 50 segmentos salvos por newsletter.

**Regras**
- `CrmNewsletterIssue.segment` guarda uma **cópia** da definição (+ `savedSegmentId` de origem); `{}` = todos. Editar ou excluir o segmento salvo não muda edições.
- Público editável só em `DRAFT`/`SCHEDULED` (`CRM_NEWSLETTER_ISSUE_LOCKED`).
- O envio usa o segmento em todos os pontos: conferência (`preflight.audience` + `segmented`), `CRM_NEWSLETTER_NO_SUBSCRIBERS` ("Nenhum assinante ativo corresponde ao público escolhido"), limite do mês e a fotografia da audiência (os ids do segmento entram no `INSERT … SELECT` como um único parâmetro `text[]`).
- Segmento gravado que não é mais válido (tipo de condição removido, campo personalizado excluído) recusa o envio com `CRM_NEWSLETTER_SEGMENT_INVALID` — nunca cai para "todos".
- A migração limpa `person_id` de assinantes que apontavam para pessoas inexistentes antes de criar a chave estrangeira.
- Auditoria: `crm_newsletter_segment` (`create` / `update` / `delete`) e `crm_newsletter_issue` `update` com `audience: 'segment'`.

## Enquetes e versão no WhatsApp (nl2-engage)

**Peças**

| Onde | O quê |
|---|---|
| `prisma/schema.prisma` (fim) | `CrmNewsletterPoll` (edição × bloco), `CrmNewsletterPollVote` (enquete × envio), `CrmNewsletterIssueWhatsApp` (configuração por edição), `CrmNewsletterWhatsAppRecipient` (fotografia por número) |
| `src/lib/canvas-email/components/poll.tsx` | Bloco `email.poll` ("Enquete", 2–5 opções). Registrado no catálogo, mas só aparece na paleta com `allowPoll` (editor de edições) |
| `src/lib/newsletter/poll-links.ts` | Link provisório por opção (`https://enquete.steel.invalid/<bloco>/<opção>`); `applyPollLinks` troca pelo link assinado do envio ou tira o link (opções estáticas) |
| `src/lib/newsletter/poll-token.ts` | Token do voto (envio + bloco + opção), HMAC com domínio próprio, sem validade |
| `src/lib/newsletter/whatsapp.ts` | Regras puras do WhatsApp: público (um por número), fontes `summary`/`subject` → fontes da campanha, `{resumo}`/`{assunto}` |
| `src/services/crm-newsletter-poll.service.ts` | Voto público, resultado do relatório, CSV |
| `src/services/crm-newsletter-whatsapp.service.ts` | Configuração, conferência antes do envio, fotografia, envio (job `whatsapp-dispatch` da fila `crm-newsletter`), relatório |
| Ganchos aditivos | `personalizeIssue({ pollLink })`, `preSendChecks` (WhatsApp pronto), `startSending` (fotografia do WhatsApp), `sendBatch` (links de voto por envio), processador `crm-newsletter`, relatório da edição, botão **WhatsApp** do editor |

**Regras — enquete**
- O voto é um `POST /api/newsletters/polls/<token>` feito pela página `/newsletter/enquete/<token>` depois de carregar; o GET da página nunca vota (robôs de link).
- Um voto por envio (`CrmNewsletterIssueRecipient`) e enquete; votar de novo troca a opção (`changed: true`).
- A enquete é criada no primeiro voto com a fotografia do bloco (o documento já está travado depois do envio). Só vale para edições `SENDING`/`SENT`/`CANCELED`.
- Versão web, arquivo, teste e qualquer e-mail fora da newsletter: opções sem link.
- Relatório: barras por opção, 200 votantes mais recentes (com a pessoa do CRM), CSV com todos os votos (auditado: `crm_newsletter_poll` / `export_completed`).

**Regras — WhatsApp**
- Público: a fotografia de e-mail da edição restrita a assinantes ligados a uma `CrmPerson` (não excluída) com telefone válido (`toCampaignWaId`), um por número. Números com `WhatsAppContact.broadcastOptedOutAt` ficam `SKIPPED/OPTED_OUT` (e são conferidos de novo antes de cada mensagem).
- Consentimento: base legal declarada por um membro (`legalBasis` + `consentConfirmedAt/ById`, como nas campanhas). Trocar a base legal apaga a declaração.
- Conteúdo: Meta = template aprovado (validação e renderização das campanhas, ADR 0025) com as fontes `name`, `first_name`, `subject`, `summary`, `link`, `link_code`, `static`; Z-API = texto com `{link}` obrigatório.
- Antes do e-mail sair, `preSendChecks` recusa com `CRM_NEWSLETTER_WHATSAPP_UNAVAILABLE` se o WhatsApp ligado tiver pendências (módulo Comunicação, conexão, conteúdo, base legal, arquivo público).
- Quando: só depois de a edição ficar `SENT` + 2 minutos (a versão web precisa existir; o arquivo guarda o 404 em cache por um minuto). `CANCELED`/`FAILED` → pendentes `STOPPED`.
- Limites: o limite mensal de mensagens da Comunicação vale (`WhatsAppSend`); atingido, o restante fica `LIMIT_REACHED`. Meta: 1.000 conversas por número em 24 h somando campanhas e newsletters; acima disso, tenta de novo em 1 hora. Custos entram como `CRM_CAMPAIGN`.
- Ritmo: Meta 10 por job (1 s entre lotes por mensagem), Z-API 1 por job a cada 4 s.

## Boas-vindas e reengajamento (newsletter2, frente `nl2-automation`)

| Onde | O quê |
|---|---|
| `prisma/schema.prisma` (fim do arquivo) | `CrmNewsletterWelcomeStep`, `CrmNewsletterWelcomeDelivery` (progresso por assinante × etapa, único), `CrmNewsletterReengagementSettings`, `CrmNewsletterReengagement` (tentativa por assinante × ciclo `YYYY-MM`); `NotificationKind.CRM_NEWSLETTER_REENGAGEMENT_SUMMARY` |
| `src/schemas/crm-newsletter-automation.schema.ts` | Etapas (atraso em horas/dias, até 365 dias, até 10 etapas), reordenação, configuração do reengajamento (limites e padrões), prévia |
| `src/lib/newsletter/reengage-token.ts` | Link assinado do botão "Quero continuar recebendo" (`/newsletter/continuar/<token>`, sem validade) |
| `src/lib/crm-newsletter/reengagement-email.ts` | Layout fixo do e-mail de reengajamento com o texto editável, cor da marca e o rodapé obrigatório |
| Fila `crm-newsletter-automation` | `welcome-tick` a cada 5 min; `reengagement-monthly` dia 1 às 09:00; `reengagement-resolve` todo dia às 08:30 (São Paulo) |
| Aba **Boas-vindas** + `/crm/newsletters/<id>/welcome/<etapa>` | Lista de etapas e editor em tela cheia (Steel Canvas) |
| **Configurações › Reengajamento de inativos** | Seção com prévia ao vivo |

**Série de boas-vindas**
- Cada etapa sai `confirmedAt + atraso` para assinantes `ACTIVE`, confirmados e que não vieram de importação (`source = IMPORT` nunca recebe).
- Janela de 7 dias: etapa vencida há mais tempo não sai (criar/ligar uma série não dispara para a base antiga; uma queda do worker menor que isso só atrasa).
- Antes de reivindicar: remetente verificado e saldo do mês; sem isso nada é reivindicado e o envio espera.
- Reivindicação = `INSERT … ON CONFLICT DO NOTHING` em `crm_newsletter_welcome_deliveries` com status `SENDING`; linhas presas há 15 min são reivindicadas de novo e reenviadas com a mesma chave de idempotência do Resend. Falha transitória devolve a linha; falha definitiva vira `FAILED`.
- Na hora do envio: descadastro geral, `UNSUBSCRIBED`/`BOUNCED`/`COMPLAINED` e etapa desligada viram `SKIPPED` com o motivo.
- Mesmo From, Reply-To, rodapé, `List-Unsubscribe` e tags (`kind=newsletter`, `welcome=<etapa>`) de uma edição; conta no limite mensal. O token de descadastro não leva destinatário de edição.
- Estatística por etapa: enviados, aberturas únicas e cliques únicos (webhook do Resend).

**Reengajamento** (desligado por padrão; padrões: 3 edições, 90 dias, 30 dias de prazo, descadastrar)
- Candidato: `ACTIVE`, fora do descadastro geral, recebeu ≥ N edições (`SENT`) nos últimos X dias, sem `lastOpenedAt`/`lastClickedAt` nesse período e sem tentativa em aberto nem criada nesse período.
- Rodada mensal: cria a tentativa (`SENDING`, única por assinante × mês), envia em lotes de 100 e marca `WAITING`; conta no limite. Lote recusado vira `FAILED` (próximo mês tenta de novo). Resumo no inbox de quem criou a newsletter.
- Rodada diária: tentativas `WAITING` com `sentAt + Y dias` vencido. Abriu, clicou ou usou o botão depois do e-mail (na tentativa ou no assinante) → `REENGAGED`; assinante que já saiu → `SKIPPED`; senão `UNSUBSCRIBED` (assinante vira `UNSUBSCRIBED` com motivo `inativo`, auditado) ou `FLAGGED`. Resumo no inbox.
- Botão: página com GET só leitura e POST que marca `REENGAGED`, atualiza `lastClickedAt` e reativa quem tinha saído por inatividade (nunca quem saiu por conta própria ou teve retorno).

**Webhook do Resend**: depois das edições e antes das campanhas, procura o `providerMessageId` nas entregas da série e nas tentativas de reengajamento. Abertura/clique marcam a primeira vez e atualizam o engajamento do assinante; retorno permanente e reclamação seguem as regras das edições.

**Permissões**: as mesmas das edições (recurso `email`: `VIEW` lê, `CREATE` cria etapa, `EDIT` edita/reordena/configura, `DELETE` exclui etapa).
