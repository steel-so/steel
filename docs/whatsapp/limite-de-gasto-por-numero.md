# Limite de gasto por número (Comunicação)

Decisão: [ADR 0064](../adr/0064-limite-de-gasto-por-numero-do-whatsapp-com-dados-da-meta.md).
Base de custos: [ADR 0050](../adr/0050-whatsapp-cost-analysis-meta-and-zapi.md).
Manual do usuário: `content/docs/comunicacao/custos.mdx`.

## Peças

| Peça | Onde |
| --- | --- |
| Leitura da Meta (`pricing_analytics`, COST → VOLUME × tabela) | `src/lib/whatsapp/meta-pricing.ts` |
| Leitura + snapshot + cache de 60 s + single flight | `src/services/whatsapp-meta-spend.service.ts`, `src/cache/whatsapp-meta-spend.cache.ts` |
| Limite, bloqueio, avisos, reversão de falhas, tick | `src/services/whatsapp-spend-cap.service.ts` |
| Gancho no envio | `withProvider` em `src/lib/whatsapp/send.ts` |
| Reversão por webhook `failed` | `WhatsAppWebhookService.ingestStatusUpdate` |
| Tabelas | `whatsapp_spend_caps`, `whatsapp_meta_spend_snapshots`; `whatsapp_cost_entries.provider_message_id` e `reversed_at` |
| API | `GET /api/workspaces/{id}/whatsapp/costs/spend-caps[?connectionId=]`, `PUT .../spend-caps/{connectionId}` (OWNER/ADMIN) |
| Fila | `whatsapp-meta-spend`, job `refresh-tick` (min 7, 22, 37, 52) |
| Tela | `app/_components/whatsapp/costs/whatsapp-spend-caps.tsx` (aba Custos e cartão da conexão) |

## Como o gasto é calculado

```
gasto = snapshot.cost (dias UTC fechados, da Meta)
      + soma da razão (TEMPLATE, não revertida) desde snapshot.periodEnd
```

Sem snapshot no mês, a razão desde o primeiro dia do mês às 00:00 UTC. A
janela pedida à Meta é `[1º dia do mês de uso 00:00 UTC, hoje 00:00 UTC)`,
granularidade `DAILY` — a Meta recusa fim no futuro e instantes fora do dia.

O envio é recusado quando `capMode = BLOCK` e `gasto + preço da próxima
mensagem > limite`. O preço vem da tabela do workspace (categoria do template,
país do destinatário, Marketing Lite), igual à razão.

## Operação

- **Configurar o limite de um cliente:** aba Custos do workspace (ou o cartão
  do número em Ajustes > Integrações > WhatsApp), com uma conta OWNER/ADMIN.
  Não há script; nada é configurado na migração.
- **"A conexão não tem permissão para ler os gastos na Meta"**: o token da
  conexão perdeu o escopo `whatsapp_business_management`. O valor segue pela
  razão e pela última leitura até a conexão ser refeita.
- **Origem `Volume da Meta × tabela`**: normal hoje — a Meta recusa `COST`
  (código 10 / 2388184) ao nosso app. O valor é tão bom quanto a tabela de
  preços do workspace; confira-a com a planilha oficial da Meta.
- **Cliente bloqueado e precisa enviar já:** aumentar o limite, mudar para
  "Só avisar" ou remover o limite. As transmissões já interrompidas não são
  reenviadas sozinhas; crie outra para os contatos com falha.
- **Logs (Axiom):** `whatsapp.meta_spend.refreshed`, `.cost_refused`,
  `.fetch_failed`; `whatsapp.spend_cap.send_blocked`, `.notify_failed`,
  `.reverse_failed`, `.tick_failed`; `whatsapp.broadcast.spend_cap_reached`;
  auditoria `audit.mutation.whatsapp_spend_cap.*`.
