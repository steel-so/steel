# Bloqueio de contatos (Comunicação)

Manual do usuário: `content/docs/comunicacao/bloqueio-de-contatos.mdx`.

Um contato é bloqueado **por número** (conexão). O bloqueio vale no Steel na
hora, qualquer que seja a resposta do provedor:

- **Entrada:** a mensagem do contato bloqueado é descartada no webhook antes
  de criar contato, conversa, notificação, resposta da IA, chatbot, SLA,
  distribuição ou sentimento. O bloqueio conta as mensagens ignoradas
  (`dropped_count`, `last_dropped_at`).
- **Saída:** todo envio ao contato é recusado com `WHATSAPP_CONTACT_BLOCKED`
  (409) — atendimento, templates, chatbot, IA, cobrança, documentos, campanhas
  do CRM. Transmissões e campanhas de IA pulam o destinatário (`SKIPPED`,
  "Contato bloqueado neste número"); newsletters marcam `BLOCKED`.

## Peças

| Peça | Onde |
| --- | --- |
| Chamadas ao provedor (Meta Block Users API, Z-API `modify-blocked`), normalização do número | `src/lib/whatsapp/contact-block.ts` |
| Regras, permissões, auditoria, sincronização | `src/services/whatsapp-contact-block.service.ts` |
| Gancho no envio | `withProvider` em `src/lib/whatsapp/send.ts` (antes do rate limit e da cota) |
| Gancho na entrada | `WhatsAppWebhookService.ingestInboundMessage` (logo após a deduplicação) |
| Pulos em lote | `whatsapp-broadcast.service.ts`, `whatsapp-ai-campaign.service.ts`, `crm-newsletter-whatsapp.service.ts` |
| Tabela | `whatsapp_contact_blocks` (único por `connection_id` + `wa_id`) |
| API | `GET/POST /api/workspaces/{id}/whatsapp/blocks`, `DELETE .../blocks/{blockId}`, `POST .../blocks/sync`, `GET .../conversations/{conversationId}/block` |
| Telas | `app/_components/whatsapp/contact-block/*` (diálogo, faixa, lista em Configurações › Contatos bloqueados); selo "Bloqueado" na lista de contatos |

## Situação no provedor

| Status | Significado |
| --- | --- |
| `APPLIED` | Bloqueado também na Meta / no aparelho da Z-API. |
| `PENDING` | Só Meta: a pessoa não escreveu nas últimas 24 h (erro 131047). Fica bloqueado no Steel e vai para a Meta na próxima mensagem dela — o webhook descarta a mensagem e chama `block_users` na hora. |
| `FAILED` | O provedor recusou (motivo em `provider_error`) ou a conexão está sem credenciais. Continua bloqueado no Steel; **Sincronizar** tenta de novo. |

O número é guardado só com dígitos. Para celulares do Brasil, o Steel trata
como o mesmo contato o número com e sem o nono dígito (a Meta às vezes manda o
`wa_id` sem ele). Contatos só com username (BSUID) são bloqueados na Meta pelo
`user_id`; a Z-API não bloqueia quem não tem telefone (fica `FAILED`).

## Permissões

- **Bloquear pela conversa:** quem pode responder a conversa (`conversations ×
  CREATE` e acesso a ela pelas Equipes).
- **Bloquear por número + contato, desbloquear, listar e sincronizar:** OWNER,
  ADMIN e líderes de equipe.
- Módulo Comunicação habilitado. Toda ação é auditada
  (`audit.mutation.whatsapp_contact_block.{block,unblock,sync}`) sem conteúdo
  de mensagem nem o texto do motivo (só `hasReason`).

## Decisões

- **Desbloquear nunca deixa o contato preso:** se o provedor recusar o
  desbloqueio, o Steel remove o bloqueio mesmo assim e devolve
  `providerWarning` para a tela avisar.
- **Desbloquear apaga a linha.** O histórico fica na auditoria.
- **Z-API não lista bloqueados.** O endpoint de "contatos não permitidos" da
  Z-API é de privacidade (visto por último, foto, recado, grupos), não do
  bloqueio. Na Z-API a sincronização só reenvia os pendentes/falhos.
- **Sincronização da Meta importa, não remove:** bloqueios feitos fora do
  Steel entram como `APPLIED` (origem `PROVIDER`). Um `APPLIED` do Steel que
  não aparece mais na lista da Meta não é apagado.
- **Falha na consulta do bloqueio na entrada deixa a mensagem passar**
  (perder mensagem de cliente é pior); no envio, a falha é propagada.
- Reações recebidas e mensagens de grupo não passam pelo filtro.

## Operação

- **"Aguardando a pessoa escrever" há muito tempo:** normal — a Meta não
  aceita o bloqueio sem a janela de 24 h. Nada chega nem sai pelo Steel.
- **"Falhou: a conexão está sem credenciais":** reconecte o número e use
  Sincronizar.
- **Não bloquear números reais em homologação/produção para teste.** Os
  testes automatizados usam conexões sem credenciais (nenhuma chamada sai).
- **Logs (Axiom):** `whatsapp.contact_block.blocked`, `.unblocked`,
  `.inbound_dropped`, `.send_refused`, `.pending_retried`, `.screen_failed`,
  `.client_failed`, `.meta_failed`, `.zapi_failed`.
