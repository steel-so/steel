# Saúde do cliente e do negócio (CRM)

Duas notas de risco explicáveis que compartilham a mesma mecânica: **T4**, o risco de churn por cliente (empresa do CRM), e **C4**, o risco por oportunidade em andamento. A decisão está na [ADR 0057](./adr/0057-saude-do-cliente-e-do-negocio-pela-mesma-heuristica-do-risco-preditivo.md); a base é a heurística do risco preditivo do ServiceDesk ([ADR 0016](./adr/0016-predictive-risk-explainable-heuristic.md)).

## Onde está o código

| Camada | Arquivo |
| --- | --- |
| Mecânica compartilhada (soma, faixas, ação, alerta) | `src/lib/crm-health/core.ts` |
| Fatores do cliente (T4) | `src/lib/crm-health/customer.ts` |
| Fatores do negócio (C4) | `src/lib/crm-health/opportunity.ts` |
| Coleta dos sinais | `src/repositories/crm-health-signals.repository.ts` |
| Notas gravadas | `src/repositories/crm-health.repository.ts` (`crm_customer_health`, `crm_opportunity_health`) |
| Serviço e tick do worker | `src/services/crm-health.service.ts` |
| Fila | `crm-health`, job `recompute-health`, de hora em hora no minuto 20 (`CrmHealthCron`) |
| API | `/api/workspaces/{id}/crm/health/companies[/{companyId}]` e `.../health/opportunities[/{opportunityId}]` |
| Interface | `app/_components/crm/health/` (painel e selo), ligada em `crm-companies-table.tsx` e `crm-opportunities-table.tsx` |

## Fatores do cliente (soma 100)

| Fator | Peso | O que pontua |
| --- | --- | --- |
| Sem interação recente | 20 | dias desde o último e-mail, reunião realizada, nota, ligação ou mensagem de WhatsApp com a empresa: 0 até 14 dias, máximo a partir de 90 |
| Sentimento no WhatsApp | 20 | média do sentimento das conversas dos últimos 90 dias: 0 a partir de +0,2, máximo em -1 |
| SLA estourado nos chamados | 15 | chamados do ServiceDesk com 1ª resposta ou resolução estourada nos últimos 90 dias (máximo com 3) |
| Negócios abertos em risco | 12 | parcela dos negócios abertos em risco alto (médio vale metade) |
| Negócios perdidos | 8 | perda nos últimos 180 dias; vale metade se há negócio aberto ou ganho recente |
| Chamados abertos | 8 | de 1 a 6 chamados abertos |
| Satisfação nos chamados | 7 | nota média de 4 (zero) a 2 (máximo) |
| Tarefas atrasadas | 5 | máximo com 3 |
| Chamados com risco de SLA | 5 | chamados abertos com risco alto no ServiceDesk |

Fator sem dado sai do denominador (a nota é `pontos / peso dos fatores aplicáveis`): sem conversa de WhatsApp, sem cliente do ServiceDesk ligado, sem avaliação de satisfação ou sem negócio, o fator correspondente não conta e a tela diz isso.

## Fatores do negócio (soma 100)

| Fator | Peso | O que pontua |
| --- | --- | --- |
| Negócio parado | 35 | dias sem nenhuma movimentação (edição, etapa, nota, tarefa, e-mail, reunião, mensagem, ligação): 0 até 7, máximo a partir de 30 |
| Sem contato com o cliente | 20 | dias sem e-mail, reunião realizada, WhatsApp do contato principal ou ligação: 0 até 7, máximo a partir de 30 |
| Contato principal | 15 | sem contato principal = máximo; contato trocado nos últimos 30 dias = dois terços |
| Data de fechamento | 15 | vencida (de 40% a 100% conforme o atraso) ou ausente (30%) |
| Sem próximo passo agendado | 8 | nenhuma tarefa aberta com prazo futuro (ou sem prazo) nem reunião futura |
| Tarefas atrasadas | 7 | máximo com 2 |

Negócio recém-criado conta os dias desde a criação, não desde "sempre": ninguém nasce parado.

## Como os módulos se ligam

- **CRM ↔ ServiceDesk:** o CNPJ da empresa (normalizado) contra `sd_customers.document`; sem CNPJ, o nome exato sem diferenciar maiúsculas. Chamados do cliente ou da empresa do chamado entram. Com o módulo ServiceDesk desligado, os fatores dele saem.
- **CRM ↔ WhatsApp:** os telefones das pessoas da empresa contra o `wa_id` do contato, pela chave DDD + últimos 8 dígitos (a mesma da ligação de chamadas telefônicas).

## Avisos

- `CRM_CUSTOMER_HEALTH_DROP` ao responsável pela conta quando o cliente **entra** na faixa alta, ou quando o risco sobe 20 pontos ou mais já na faixa média.
- `CRM_OPPORTUNITY_AT_RISK` ao responsável pelo negócio quando ele **entra** na faixa alta.
- O nível anterior fica na própria linha, então um retry do job não avisa de novo. Empresa sem responsável pela conta não gera aviso (a nota continua visível).
- O primeiro cálculo de um registro só avisa se já nasce na faixa alta; abrir um painel pela primeira vez nunca avisa.

## Operação

- O ciclo percorre, por workspace com CRM ligado, até 500 negócios e 300 empresas por rodada, das nunca calculadas para as mais antigas; uma base maior é coberta em rodadas sucessivas.
- Negócio ganho, perdido ou excluído perde a linha de nota no próximo ciclo.
- `pnpm` não tem comando próprio: para recalcular tudo agora, enfileire `recompute-health` na fila `crm-health` pelo Workbench (`/jobs`), com `{ "workspaceId": "<id>" }` para um só workspace.
- Colunas novas em `crm_opportunities`: `stage_changed_at` e `contact_changed_at`, gravadas quando a etapa ou o contato principal realmente mudam. Negócios antigos ficam com nulo até a primeira mudança.

## Fora do escopo desta entrega

- Calibração dos pesos com o histórico de cada workspace (seria uma ADR nova).
- Página com o ranking dos clientes em risco: a API já devolve (`GET .../health/companies`), mas hoje a interface mostra o painel na empresa e o selo no kanban.
- Coluna de risco na tabela de oportunidades.
