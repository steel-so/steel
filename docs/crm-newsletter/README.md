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
