# Copiloto do atendente (Z7)

Assistência de IA sob demanda dentro da conversa do módulo Comunicação. Nada é
enviado nem persistido: o resultado volta ao atendente, que revisa e envia.

## Rotas

`POST /api/workspaces/{id}/whatsapp/conversations/{conversationId}/copilot/...`

| Rota | Corpo | Resposta |
| --- | --- | --- |
| `suggest` | `{ hint? }` (até 500 caracteres) | `{ text }` |
| `summary` | vazio | `{ summary, pending[] }` |
| `tone` | `{ text, tone }` (`FRIENDLY`, `FORMAL`, `DIRECT`, `EMPATHETIC`, `FIX_ONLY`) | `{ text }` |

## Decisões

- **Permissão**: mesma exigência de enviar mensagem (`conversations` /
  `CREATE`) e a mesma visibilidade por equipe (`loadVisibleConversation`).
  Conversa fora do escopo responde 404.
- **Cota e modelo**: usa a feature `WHATSAPP_REPLY` do `AiUsageService`
  (classe CONVERSATION), sem enum novo. O consumo aparece junto da resposta
  automática; o `scope` do registro marca o módulo e a conversa.
- **Contexto**: últimas 40 mensagens, respeitando "Limpar conversa" (`clearedAt`).
  O texto do cliente entra cercado por `wrapUntrusted` (ADR 0041), então
  instruções coladas pelo cliente não são obedecidas.
- **Sem configuração própria**: não depende da IA de atendimento estar ligada
  (`WhatsAppAiConfig`); a cota do workspace é o limite.
- **Auditoria**: `auditMutation` com `meta.copilot` = `suggest`, `summary` ou
  `tone` (o conteúdo gerado não é registrado).
- **Erros**: `WHATSAPP_COPILOT_NO_CONTEXT` (422, conversa sem texto),
  `WHATSAPP_COPILOT_FAILED` (502), além de `AI_QUOTA_EXCEEDED` e
  `AI_PROVIDER_UNAVAILABLE`.

## Resumo automático na transferência (follow-up)

`WhatsAppSettings.copilotSummaryOnTransfer` (padrão **desligado**, ligado por
OWNER/ADMIN em Configurações › IA › Copiloto do atendente).

- `WhatsAppConversationService.assign` e `setTeam` chamam, **depois** da
  transferência e sem esperar, `WhatsAppCopilotService.summarizeOnTransfer`.
  Dispara quando a conversa vai para **outro atendente** (ou quando alguém a
  entrega a um atendente) e quando entra em **uma equipe**; pegar para si uma
  conversa sem dono, devolver à fila ou tirar da equipe não gera resumo.
- Usa a mesma chamada do botão **Resumir a conversa** (`WHATSAPP_REPLY`, cota de
  IA do workspace, atribuída a quem transferiu) e grava o resultado como evento
  da linha do tempo `TRANSFER_SUMMARY` (origem `COPILOT`), texto = resumo +
  “Pendente:” com os itens. É interno: nunca vai ao contato. Limite de 1.500
  caracteres.
- **Nunca bloqueia a transferência**: erro de cota, provedor, conversa sem texto
  ou do banco só gera um `warn` (`whatsapp.copilot.transfer_summary_failed`).
  Auditado como `whatsapp_conversation` / `update` com `meta.via = transfer`.
- UI: `WhatsappSettingsCopilot` e o chip da linha do tempo (`TRANSFER_SUMMARY`,
  com quebras de linha preservadas).

## Fora do escopo

Voz/transcrição, e resumo na passagem do chatbot para um atendente (o
atendente usa **Resumir a conversa**).
