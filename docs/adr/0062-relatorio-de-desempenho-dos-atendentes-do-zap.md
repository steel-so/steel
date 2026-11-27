# 0062 — Relatório de desempenho dos atendentes do zap, ligado por workspace pelo admin global

- **Status:** Aceita
- **Data:** 2026-11-06
- **Decisores:** Alexandre (product owner); detalhes decididos pelo agente da fatia `zap-agent-report`.

## Contexto

A Fidelizza+ (workspace `fidelizza-atendimento`) pede um relatório do
desempenho de cada atendente depois de **tabular** as conversas. Tabular é
escolher, ao encerrar, os status de fechamento (`WhatsAppCloseStatus`, cada um
com resultado `SUCCESS` ou `FAILURE`); a conversa guarda `closeOutcome`,
`closeStatusIds`, `closeStatusLabels`, `closedAt` e `assignedUserId`. Já existem
o relatório de SLA (ADR 0048) e o de custos (ADR 0050), mas nenhum olha a
tabulação por atendente. O pedido vem de um único cliente, então o recurso não
deve aparecer para os demais, no mesmo molde do arquivamento (ADR 0052).

## Decisão

Criar o **relatório de atendentes**, **desligado por padrão** e ligado só pelo
admin global da plataforma, por workspace, na tabela
`whatsapp_agent_report_settings` (`enabled`, `updated_by_id`; mesmo padrão de
`whatsapp_archive_settings`). Ligado, a aba **Atendentes** aparece em
Comunicação › Relatórios; desligado, a aba não é renderizada e a API responde
**404** (`WHATSAPP_AGENT_REPORT_DISABLED`). A ação do admin é auditada
(`recordAdminAction`) e cada exportação CSV vai para a auditoria.

### O que é medido

Uma linha por atendente — o `assignedUserId` **no momento do encerramento** —,
mais "Sem atendente" e um total:

- **Encerradas**: conversas com `closedAt` dentro do período (conversas apagadas
  ficam de fora); **sucesso/insucesso**: pelo `closeOutcome`; **sem tabulação**:
  `closeOutcome` nulo;
- **taxa de sucesso** = sucesso ÷ tabuladas (sem tabuladas: sem taxa, nunca
  divisão por zero);
- **tempo médio** = média de `closedAt − createdAt`. Uma conversa reaberta conta
  a **vida inteira** (o Steel não guarda o início de cada atendimento); o total
  pondera por conversa, não por atendente;
- **em aberto**: conversas não encerradas **agora** do atendente (retrato atual,
  não depende do período);
- **por status**: contagem por rótulo; uma conversa com vários rótulos conta em
  cada um. O resultado (sucesso/insucesso) do rótulo vem do status; sem status
  correspondente fica sem resultado.

Dias e horas em **America/Sao_Paulo**; `from`/`to` são dias inclusivos, padrão
últimos 7 dias, máximo 1 ano. Filtros opcionais por equipe e por conexão.

### Quem vê o quê

- **OWNER/ADMIN** veem todos os atendentes, mesmo que estejam em alguma equipe
  (decisão do product owner; é diferente da regra de conversas das Equipes, em
  que um ADMIN de equipe fica "escopado");
- **líder de equipe** (`LEADER`) vê os membros das equipes que lidera, ele
  mesmo e a fila sem atendente dessas equipes (reaproveita
  `resolveConversationScope`);
- **os demais** veem só a si mesmos.

### Agregação

Tudo no banco, em `WhatsAppAgentReportRepository`: três consultas SQL
(`COUNT ... FILTER` por atendente; abertas; rótulos com `unnest` dos arrays
`close_status_ids`/`close_status_labels` ligado a `whatsapp_close_statuses`).
Nenhuma conversa é carregada em memória. As contas puras (taxa, média, períodos
em São Paulo, montagem do relatório e CSV) ficam em
`src/lib/whatsapp/agent-report.ts`.

### CSV

`GET /api/workspaces/{id}/whatsapp/reports/agents?format=csv`: separador `;`,
UTF-8 com BOM (Excel-BR), cabeçalhos em português, uma coluna por rótulo de
status, texto que pareça fórmula recebe aspa simples na frente.

## Consequências

- Só a Fidelizza+ vê a aba; ligar para outro cliente é um clique no painel
  (runbook [Relatório de atendentes do WhatsApp](../runbooks/whatsapp-agent-report.md)).
- O tempo médio de conversas reabertas é inflado, porque conta desde a criação.
  Se isso incomodar, o caminho é medir a partir do último "reaberta" no
  histórico de eventos da conversa — decisão para depois de ver o uso real.
- O índice existente `(workspace_id, closeOutcome)` não cobre `closed_at`; num
  workspace com milhões de conversas o relatório pode pedir um índice
  `(workspace_id, closed_at)`. Medir antes de criar.
- Reabrir uma conversa limpa `closedAt`/`closeOutcome`: ela some do relatório do
  período em que foi encerrada e volta quando for encerrada de novo.

## Adendo (27/11/2026): visão por dia e equipe

Pedido da Fidelizza+: ver, por dia e por equipe, quantas conversas foram
encerradas e quanto se conversou. As decisões acima continuam valendo; esta
seção só acrescenta uma segunda visão ao mesmo relatório.

- **Mesma rota, `view=daily`:** `GET .../whatsapp/reports/agents?view=daily`
  (JSON) e `&format=csv`. Mesmo gate (relatório ligado, senão 404), mesmas
  permissões (OWNER/ADMIN tudo, líder as equipes que lidera, atendente só o
  próprio) e mesmos filtros `from`/`to`/`teamId`/`connectionId`.
- **Agrupamento:** dia em America/Sao_Paulo × `conversation.teamId`; sem equipe
  vira "Sem equipe". O nome da equipe é o atual (equipe apagada: "Equipe
  removida").
- **Colunas:** encerradas (`closedAt` no dia), sucesso, insucesso
  (`closeOutcome`), sem tabulação (`closeOutcome` nulo) e mensagens.
- **Mensagens — escolha:** conta linhas de `whatsapp_messages` (entrada e saída)
  pelo `createdAt` no dia, nas conversas daquela equipe (conversa não apagada,
  dentro da restrição de visibilidade). Mensagens apagadas e reações ficam de
  fora. Importante: o dia da mensagem independe do dia do encerramento, então
  um dia pode ter mensagens e zero encerradas (e vice-versa); a equipe é a
  atual da conversa, não a da época da mensagem.
- **Agregação:** duas consultas SQL no repositório
  (`closedByDayAndTeam`, `messagesByDayAndTeam`, `GROUP BY` dia/equipe); a
  junção das duas é só montagem de linhas em `buildDailyTeamReport`.
- **CSV:** `;`, UTF-8 com BOM, CRLF, dia em `dd/MM/yyyy`, linha de total;
  arquivo `relatorio-por-dia-e-equipe-<de>-a-<ate>.csv`.
- **Custo:** a consulta de mensagens percorre as mensagens do período
  (índice `(conversation_id, created_at)` não ajuda sem a conversa); com
  períodos longos em workspaces grandes, medir antes de criar índice
  `(workspace_id, created_at)`.
