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

## Remetente verificado nas campanhas e acertos da fase 1 (nl2-followups)

**Remetente das campanhas** ([ADR 0055](../adr/0055-remetente-verificado-nas-campanhas.md))
- Campanhas multicanal (`CrmCampaign`) e campanhas de e-mail antigas (`CrmEmailCampaign`) só enviam de um endereço em domínio `VERIFIED` do workspace ou do endereço da plataforma (`PLATFORM_CAMPAIGN_SENDER` = `notificacoes@stratustelecom.com.br`, em `src/lib/sending-domain/platform-sender.ts`). A checagem é `checkCampaignSender` (`src/lib/sending-domain/campaign-sender.ts`), que reaproveita `resolveVerifiedSender`.
- Multicanal: entra em `issues` (passo `content`) com `fix: 'SENDING_DOMAINS'`, bloqueando o lançamento; a revisão mostra o link para Ajustes › Domínios de e-mail. No disparo, cada e-mail com remetente bloqueado vira `FAILED` com o motivo (sem nova tentativa) e o criador recebe um aviso (`notifyCrmCampaignSenderBlocked`, uma vez por campanha).
- Campanhas antigas: `send` recusa com `SENDING_DOMAIN_NOT_VERIFIED` (422) antes de mudar qualquer coisa; o worker marca a agendada como `FAILED` e avisa o criador.
- `GET /api/workspaces/{id}/crm/email-senders` (recurso `email`, `VIEW`): `{ platformAddress, verifiedDomains }` — só nomes de domínio. Alimenta o `EmailSenderPicker` (parte local + domínio) dos dois assistentes.

**Formulário do CRM no Sites**
- O elemento `site.form` mostra a caixa de consentimento da newsletter quando o formulário tem `newsletterId` e a newsletter está `ACTIVE` (igual a `/f/<token>`), e envia `newsletterConsent` junto dos campos.

**Edições**
- Edição criada sem modelo começa do esqueleto `createNewsletterStarterDocument` (cabeçalho, título + introdução, conteúdo, assinatura, rodapé).
- O rodapé do canvas é renderizado em modo assinatura (`subscription` no contexto de render): "Você recebe a newsletter <nome> porque se inscreveu para recebê-la." + **Preferências** · **Descadastrar**. Vale para o editor, a prévia, o teste, o envio e a versão web (sem os links). A faixa de rodapé extra que era anexada no envio saiu — antes a edição chegava com dois rodapés.
- Relatório de edição em `DRAFT`/`SCHEDULED` mostra estado vazio em vez do funil zerado.

**Arquivo público**
- `/n/**` tem layout raiz próprio, sem o `Suspense` do layout do Steel: edição ou newsletter inexistente responde **HTTP 404** com página própria em pt-BR.

**Uso do mês**
- A lista de newsletters mostra "X de Y e-mails usados neste mês" para todo membro do CRM; o cartão com a barra fica nas Configurações da newsletter.
