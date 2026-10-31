# 0059 — Um só motor de horários para o agendamento do CRM e do WhatsApp

- **Status:** Aceita
- **Data:** 2026-10-31
- **Decisores:** dono do produto (decisão "unificar")

## Contexto

Existiam dois motores de agenda: as páginas de reunião do CRM (C5, `crm-meetings`)
e o agendamento nativo do WhatsApp (Z10, tabelas `whatsapp_sched_*`). O Z10 já
chamava o cálculo de horários livres do C5 por um adaptador, mas a regra de
conflito com folga (buffer) estava escrita duas vezes: no motor do C5 e, de outro
jeito, no `createIfFree` do repositório do Z10 (a folga do vizinho vale após o
fim dele). Os helpers de dia/fuso do Z10 também duplicavam os do C5.

## Decisão

Existe um único motor em `src/lib/scheduling/`:

- `slots.ts`: janelas semanais, passo, antecedência mínima, horizonte,
  `computeFreeSlots`, `collides` e `bufferedOverlap`, a regra única de conflito
  com folga (`afterCandidateMinutes` para o candidato, `afterOtherMinutes` para
  o vizinho).
- `tz.ts`: fuso IANA (com horário de verão), chaves de dia `YYYY-MM-DD`,
  `zonedDateKeyToUtc`, `weekdayOfDateKey`, `addDaysToDateKey`.

O C5 usa a folga da página nos dois lados (regra simétrica, igual à anterior).
O Z10 usa a folga do serviço do candidato antes do vizinho e a folga do serviço
do vizinho depois dele (a regra "slot taken" fica igual). Os adaptadores do Z10
(`src/lib/whatsapp/scheduling/slots.ts` e `time.ts`) continuam existindo, só com
o que é do WhatsApp (grade por dia, textos pt-BR).

Rotas, DTOs, tabelas e migrações não mudam: nenhum dado foi tocado.

## Consequências

- Uma regra de conflito, um conjunto de testes (`scheduling-engine.test.ts`).
- Os módulos continuam com seus repositórios e travas (advisory lock no C5,
  transação serializable e índice único no Z10); só a aritmética é compartilhada.
- `src/lib/crm-meetings/{slots,tz}.ts` deixaram de existir; imports antigos
  devem apontar para `@/src/lib/scheduling/*`.
- Unir as tabelas de reserva fica fora desta decisão (exigiria migração de dados
  sem ganho de comportamento).
