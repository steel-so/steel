# Relatório de atendentes do WhatsApp

Quando usar: um cliente (a primeira é a Fidelizza+, workspace
`fidelizza-atendimento`) quer ver o desempenho de cada atendente na tabulação
das conversas. O recurso vem **desligado** em todo workspace e é ligado só pelo
admin global. Decisão e detalhes:
[ADR 0062](../adr/0062-relatorio-de-desempenho-dos-atendentes-do-zap.md).

## 1. Ligar para um workspace

1. Entre em `/admin/workspaces` e abra o workspace.
2. No painel **Relatório de atendentes (WhatsApp)**, ligue **Relatório de
   atendentes**.
3. Pronto: a aba **Atendentes** aparece em **Comunicação › Relatórios** para
   quem é membro do workspace com o módulo Comunicação (no próximo carregamento
   da página). Para desligar, é o mesmo botão — a aba some e a API passa a
   responder 404.

A ação fica no **Histórico do admin** do workspace (`whatsapp_agent_report.settings`).
Nada precisa de deploy, worker ou variável de ambiente.

## 2. Quem vê o quê

- OWNER/ADMIN: todos os atendentes.
- Líder de equipe: os atendentes das equipes que lidera.
- Atendente: só ele mesmo.

Se alguém reclama de "não vejo fulano", confira o papel (Configurações ›
Membros) e a equipe/liderança (Comunicação › Configurações › Equipes).

## 3. Conferir o que o relatório mostra

O relatório conta conversas **encerradas no período** (`closed_at`), para o
`assigned_user_id` do momento do encerramento. Para conferir um atendente no banco:

```bash
docker exec -it steel-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT close_outcome, count(*) FROM whatsapp_conversations
   WHERE workspace_id = '\''<workspaceId>'\'' AND assigned_user_id = '\''<userId>'\''
     AND closed_at >= '\''2026-11-01 03:00'\'' AND closed_at < '\''2026-11-08 03:00'\''
     AND deleted_at IS NULL GROUP BY 1;"'
```

(`03:00` UTC = meia-noite em São Paulo.) Casos que parecem erro mas não são:
conversa reaberta some do período até ser encerrada de novo; tempo médio alto
com muita conversa reaberta (conta desde a criação); atendente que saiu do
workspace aparece como "Atendente removido".

## 4. Erros comuns

- `O relatório de atendentes não está disponível neste workspace` (404): o
  passo 1 não foi feito para esse workspace.
- `O período do relatório é de no máximo 1 ano`: reduza o intervalo.
