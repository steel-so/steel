# ServiceDesk — previsão de demanda e dimensionamento (S5)

Tela **Demanda e escala** (`/{workspace}/servicedesk/demand`): previsão do
volume de chamados e agentes sugeridos por turno. Complementa o plantão
(`SdOnCallSchedule`); não o substitui.

## Modelo

`SdWfmSettings` (uma linha por workspace, criada sob demanda): `historyWeeks`,
`ticketsPerAgentHour`, `targetOccupancyPercent`, `minAgentsPerShift` e `shifts`
(`[{name,startHour,endHour}]`, hora local, `endHour` exclusivo; `endHour <
startHour` atravessa a meia-noite). Sem linha valem os padrões de
`SD_WFM_DEFAULT_SETTINGS`.

## Cálculo (`src/lib/servicedesk/wfm-forecast.ts`, puro)

1. `SdWfmRepository.hourlyCounts`: uma consulta agrupada por hora (UTC) em
   `sd_tickets`, sem apagados e com filtro opcional de departamento.
2. `buildWfmProfile`: converte cada hora para o fuso do workspace (fuso do
   calendário padrão, ou `America/Sao_Paulo`) e monta 168 slots com um valor por
   semana de histórico.
3. `wfmSlotForecast`: média com peso `0,8^semana`; banda = média ± desvio
   ponderado; fator de tendência = recente ÷ antigo (limitado a 0,7–1,5, só com
   4+ semanas).
4. `wfmShiftDemand`: soma por turno/dia e `ceil(volume / (taxa × horas ×
   ocupação))`, com o mínimo por turno. Turno noturno conta no dia em que
   começa; a cauda do último dia fica fora da janela.
5. `SdWfmService.forecast`: compara com as pessoas distintas no plantão no início
   do turno (`resolveSdOnCall` com as trocas) e com o time (membros de
   departamentos ativos). `understaffed` = menos gente que o sugerido;
   `exceedsTeam` = sugerido acima do time.

`insufficientData` é verdadeiro com menos de 20 chamados ou menos de 2 semanas
com movimento.

## API

- `GET /api/workspaces/{id}/servicedesk/wfm/forecast?departmentId=` — agente.
- `GET|PATCH /api/workspaces/{id}/servicedesk/wfm/settings` — leitura de agente,
  escrita de admin (auditoria `sd_wfm_settings`).

## Fora desta entrega

Previsão por canal/prioridade, feriados e sazonalidade anual, sugestão de quem
escalar, ausências/férias e exportação.
