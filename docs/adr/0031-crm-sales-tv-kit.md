# 0031 — Kit de Vendas calculado no servidor e modo TV por link com token

- **Status:** Aceita
- **Data:** 2026-10-15
- **Decisores:** Produto e engenharia (Steel)

## Contexto

Os painéis do CRM (`CrmDashboard`, widgets `CHART`/`VIEW`/`IFRAME`/`RICH_TEXT`)
agregam linhas no navegador a partir das rotas de listagem. Para a TV da sala
de vendas isso não basta:

- gráficos e tabelas mostravam o id cru de `stageId`, `ownerId` e `pipelineId`;
- não havia como mostrar meta, ranking, ritmo, vitórias ou negócios parados
  sem baixar todas as oportunidades para o navegador;
- o painel não tinha telas para alternar na TV nem forma de abrir sem login;
- o CRM não guardava **quando** um negócio foi ganho (só `closeDate`, que o
  vendedor edita à mão e muitas vezes fica no passado ou no futuro).

O ServiceDesk já tinha um modo TV (tela cheia, escuro, relógio, rotação), mas
só com sessão.

## Decisão

1. **Novo tipo de widget `SALES`** (enum `CrmWidgetType`), com dez métricas
   (`kind`): `goal`, `ranking`, `pipeline`, `forecast`, `conversion`,
   `deal-stats`, `stalled`, `proposals`, `scoreboard`, `wins-feed`. Cada uma
   é calculada **no servidor** (`CrmSalesMetricsService`) com consultas
   agregadas e enxutas; o navegador só recebe os números
   (`GET /api/workspaces/:id/crm/sales-metrics?kind=…`). Só painéis do CRM
   aceitam o tipo (`CRM_SALES_WIDGET_UNSUPPORTED`).
2. **Data do ganho = `wonAt`.** Nova coluna em `crm_opportunities`, carimbada
   quando o negócio entra numa etapa de categoria `WON` (criado direto nela ou
   movido para ela), mantida ao trocar de uma etapa de ganho para outra e
   limpa ao reabrir. Um ganho conta no período de `wonAt` **e** só se o
   negócio ainda estiver numa etapa `WON`. A migração preenche os já ganhos
   com `closeDate` (ou `updatedAt`). `closeDate` continua sendo a previsão de
   fechamento das abertas (usada pela previsão).
3. **Fuso e dias úteis.** O período (mês ou trimestre, chave igual à de
   `CrmQuota.periodKey`) é o civil do fuso do calendário de atendimento padrão
   do workspace (`SdBusinessCalendar`), ou `America/Sao_Paulo` sem ele. Dias
   úteis = segunda a sexta menos os feriados desse calendário. Hoje conta como
   dia trabalhado (o ganho de hoje já entrou) **e** como dia restante (ainda dá
   para fechar hoje).
4. **Definições das métricas.**
   - *Meta*: ganho do período × soma das metas do período. Sem meta (ou só
     metas zeradas) não existe alvo: o bloco mostra o ganho e pede "Cadastre as
     metas". Ritmo = ganho ÷ dias úteis decorridos × dias úteis do período;
     "no ritmo" quando o ritmo (ou o ganho) alcança a meta.
   - *Ranking*: ganho por responsável e % da meta individual; quem tem meta e
     ainda não vendeu aparece com R$ 0; ganho sem responsável (ou de usuário
     excluído — a FK vira `null`) aparece como "Sem responsável".
   - *Pipeline ponderado*: abertas de um pipeline (o escolhido ou o padrão) por
     etapa, valor e valor × probabilidade (a do negócio, senão a da etapa).
   - *Previsão*: das abertas com `closeDate` no período, **comprometido** =
     ganho + abertas com probabilidade ≥ 70%; **melhor cenário** = ganho +
     todas; **ponderado** = ganho + Σ valor × probabilidade. Sem alvo quando
     filtrada por pipeline (metas são por pessoa, não por pipeline).
   - *Conversão* (coorte do período, atual × anterior): leads criados no
     período que chegaram a Oportunidade/Proposta, foram fechados como ganho ou
     convertidos; oportunidades criadas no período que estão ganhas hoje.
   - *Ticket médio* = média do valor dos ganhos com valor; *ciclo médio* = dias
     da criação ao `wonAt`; tendência contra o período anterior.
   - *Parados*: abertas cuja última atividade (`crm_activities` do negócio ou a
     última edição) tem `N` dias ou mais (padrão 14, configurável).
   - *Propostas*: enviadas ou vistas, ainda dentro da validade; "vence esta
     semana" até o domingo da semana corrente.
   - *Placar do dia*: ganhos e valor de hoje, reuniões (agenda + reuniões de
     lead), atividades (tarefas concluídas + tentativas de contato) e leads
     novos por origem (`source`, senão `channel`).
   - *Vitórias*: últimos ganhos de 30 dias.
5. **Telas do painel.** `CrmDashboard.settings` (`pages`: 1 a 3 títulos,
   `rotateSeconds`: 0 ou 10–600) e `CrmDashboardWidget.page`. O editor ganha
   abas de tela; a TV alterna entre as telas com widgets.
6. **Link da TV com token.** `CrmDashboardTvLink` guarda um token aleatório de
   192 bits em claro (como o link público da Wiki), para que o admin possa
   copiar o link de novo; revogar (`revokedAt`) corta a tela na próxima
   atualização. Só OWNER/ADMIN do CRM criam e revogam. A tela abre em
   `/tv/<token>` sem login; os dados são lidos **em nome de quem criou o
   link** — se essa pessoa sair do workspace ou perder acesso a painéis, o
   link deixa de valer. Pelo link: widgets `IFRAME` não aparecem; gráficos e
   tabelas só servem oportunidades, leads, tarefas, empresas, formulários e
   landing pages, **sem** campos de contato (e-mail, telefone, LinkedIn,
   WhatsApp, endereço, documentos) nem campos personalizados.
7. **Nomes no lugar de ids** em todo painel do CRM: `GET …/crm/dashboards/lookups`
   devolve pipelines, etapas e membros; a camada de dados dos widgets usa esses
   nomes nas categorias, séries, células e filtros ("Etapa igual a Proposta
   enviada").
8. **Experiência de TV.** Tema escuro por padrão, números que escalam com o
   bloco (container queries), relógio e contagem até o fim do mês no fuso do
   workspace, atualização a cada 60 s, rotação entre telas e comemoração na
   hora de uma venda nova (consulta a cada 15 s; confete com Web Animations,
   omitido com `prefers-reduced-motion`). Modelo "Vendas — TV" cria o painel
   pronto em duas telas com até 6 blocos cada.

## Consequências

- O time vê meta, ritmo e vitórias reais sem planilha, numa TV sem login, sem
  expor dados de contato de clientes.
- Cada métrica custa poucas consultas agregadas por atualização; a TV faz uma
  requisição por bloco por minuto (mais a de vitórias a cada 15 s), dentro do
  limite de API por IP.
- Ganhos anteriores a esta versão usam `closeDate` como data do ganho (melhor
  estimativa disponível). Negócios movidos para ganho por fora do service de
  oportunidades (SQL manual, importações futuras) precisam carimbar `wonAt`.
- O token em claro no banco é aceito como no link da Wiki: quem lê o banco já
  lê os próprios dados. Revisitar se o link passar a dar acesso a escrita.
- Metas por pipeline, feriados próprios do CRM e tempo real por SSE (em vez de
  consulta a cada 15 s) ficam para depois.
