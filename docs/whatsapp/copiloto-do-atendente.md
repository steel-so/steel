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

## Fora do escopo

Resumo automático no momento da transferência (hoje o atendente que assume
clica em **Resumir a conversa**) e voz/transcrição.
