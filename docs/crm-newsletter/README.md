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

## Resumo automático, IA e teste A/B de assunto (fase 2, frente `nl2-digest-ai`)

Manual: `content/docs/crm/newsletter-resumo-e-ia.mdx`.

**Peças**

| Onde | O quê |
|---|---|
| `prisma/schema.prisma` (fim do arquivo) | `CrmNewsletterDigest` (1 por newsletter), enums `CrmNewsletterDigestCadence`, `CrmNewsletterDigestMode`, `CrmNewsletterAbMetric`; colunas `ab_*` e `digest_id` em `crm_newsletter_issues`; `ab_variant`/`ab_held` em `crm_newsletter_issue_recipients`; avisos `CRM_NEWSLETTER_DIGEST_READY`/`_SKIPPED` |
| `src/schemas/crm-newsletter-{digest,ai,ab}.schema.ts` | Contratos das três funções |
| `src/services/crm-newsletter-digest.service.ts` | Configuração, prévia, "Gerar rascunho agora" e o `tick` do worker |
| `src/services/crm-newsletter-ai.service.ts` | Fontes, "Escrever com IA", "Sugerir assuntos" |
| `src/services/crm-newsletter-ab.service.ts` | Teste A/B: configuração, relatório por variante e decisão do worker |
| `src/lib/crm-newsletter/feed*.ts` | Leitor RSS 2.0/Atom e o fetch protegido |
| `src/lib/canvas-email/components/content.tsx` | Bloco `email.posts` ("Lista de posts") do catálogo de e-mail |
| Fila `crm-newsletter` | Jobs `digest-tick` (a cada 5 min) e `ab-tick` (a cada 5 min, deslocado 2 min) |
| Rotas | `…/newsletters/{id}/digest` (GET/PUT/DELETE), `/digest/preview`, `/digest/run`, `/ai/sources`, `…/issues/{issueId}/ai/draft`, `/ai/subjects`, `…/issues/{issueId}/ab-test` (GET/PUT/DELETE) |
| UI | Aba **Resumo** da newsletter; botões **IA** e **A/B** no editor da edição; cartão do teste A/B no relatório |

**Resumo automático**
- Fontes: blog de um site do workspace (posts `PUBLISHED` ou `SCHEDULED` vencidos, links `<site>/blog/<slug>`; site nunca publicado vira aviso) e/ou feed RSS/Atom externo.
- Feed: só `https://`, sem usuário/senha, host público (o guarda de URL dos webhooks — literal e todos os endereços resolvidos); redirecionamentos seguidos à mão, no máximo 3, cada um conferido de novo; 8 s de tempo total e 1 MB de corpo. Entradas sem data ficam de fora.
- Agenda: semanal (dia da semana) ou mensal (dia 1–28) em hora cheia de America/Sao_Paulo (`croner`). O worker pega os resumos vencidos e "reivindica" a rodada trocando `next_run_at` de forma condicional (dois workers não rodam o mesmo resumo).
- "Novo" = publicado depois de `last_item_at` (no primeiro resumo: 7 dias no semanal, 31 no mensal). A rodada agendada move `last_item_at` para o post mais novo usado — também quando o envio automático foi recusado (o rascunho guarda esses posts). "Gerar rascunho agora" não move.
- Sem posts novos: nada é criado; resultado `SKIPPED` e aviso para quem configurou.
- `DRAFT`: cria a edição (`digest_id` preenchido, autor = quem configurou) e avisa (`CRM_NEWSLETTER_DIGEST_READY`). `AUTO_SEND`: cria e envia por `CrmNewsletterSendService.sendNowAsSystem` (mesmas conferências do envio); recusado → rascunho fica, resultado `FAILED` e aviso com o motivo.
- Documento: corpo e rodapé do modelo da newsletter (quando há), logo, título (assunto com `{data}` trocado pela data em pt-BR), texto de abertura e a "Lista de posts".

**IA no editor**
- Mesma porta das outras IAs do CRM: recurso `email` (`EDIT`), edição em `DRAFT`/`SCHEDULED`, feature `crm.aiAssistant`, provedor/modelo do workspace e cota mensal (`AiUsageService`, ADR 0007/0019).
- Vai para o provedor só o que o membro escolheu: o pedido e, de cada fonte marcada (até 6 por tipo), o título e ~700 caracteres. Artigos da base de conhecimento: só `PUBLISHED`, visíveis no portal e não arquivados, e só para quem é membro do ServiceDesk. Nenhum dado de assinante/pessoa/negócio.
- "Escrever com IA" devolve assunto, pré-visualização e até 5 seções do catálogo (validadas por `buildAiSection`); os posts marcados fecham a edição numa "Lista de posts" com os links e imagens reais (nunca vindos do modelo). Nada é salvo: o editor troca o conteúdo num passo só (Ctrl+Z desfaz) e o salvamento automático grava.
- "Sugerir assuntos" lê o texto da própria edição (variáveis como `{{…}}`) e devolve 5 pares assunto + pré-visualização, sem repetição.

**Teste A/B de assunto**
- Configurado na edição (`DRAFT`/`SCHEDULED`): assunto B (diferente do A), parcela de teste 10–50 %, métrica (`OPENS`/`CLICKS`) e espera de 1–72 h.
- Envio exige audiência ≥ 20 (`CRM_NEWSLETTER_AB_AUDIENCE_TOO_SMALL`; bloqueio `AB_AUDIENCE_TOO_SMALL` na conferência).
- Na fotografia da audiência, uma amostra aleatória do tamanho da parcela (mínimo 2) é dividida A/B (`ab_variant`); o resto fica `ab_held = true` e não é reivindicado pelo despacho — a edição continua `SENDING`.
- `ab-tick`: passadas as horas desde `sending_started_at`, compara a taxa (abertos ou clicados ÷ enviados) da parcela; empate fica com A. Grava `ab_winner`/`ab_decided_at`, libera os retidos e enfileira o despacho, que manda o assunto vencedor.
- O `subject` da edição continua sendo o A (arquivo público e lista); o relatório mostra as duas variantes. "Parar envio" também descarta os retidos.
