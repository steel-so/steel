# 0067 — Uma branch de junção e um PR único para as fatias em paralelo

- **Status:** Aceita
- **Data:** 2026-11-13
- **Decisores:** dono do produto

## Contexto

O [ADR 0010](./0010-short-lived-prs-for-parallel-slices.md) mandou que cada
fatia construída em paralelo entre por um PR próprio, mesclado só com o CI
verde. Isso funcionou com poucas fatias.

Na leva de usabilidade e integrações (13/11/2026) foram dez fatias ao mesmo
tempo, mais um PR de outro agente. O CI do projeto roda nos runners hospedados
do GitHub (`ubuntu-latest`) e cada execução abre cerca de vinte jobs (e2e em
três partes, cobertura em quatro, componentes em três, segurança, build), além
do workflow de Performance (Lighthouse e k6). Com onze PRs, o limite de jobs
simultâneos do plano estourou: os jobs ficaram na fila com a mensagem *"All
GitHub-hosted runners with label [ubuntu-latest] are busy"*, os agentes
passaram horas esperando um CI que não começava, e cada push de correção
recolocava tudo na fila.

Além disso, validar cada fatia isolada não prova que o conjunto funciona: os
conflitos reais (arquivos compartilhados, migrations de mesmo prefixo de data,
mensagens de erro que mudaram) só aparecem na soma.

## Decisão

Quando houver fatias em paralelo, cada uma continua numa branch própria
(`feat/<fatia>`) e abre seu PR menor, como no ADR 0010. A diferença é onde o CI
roda e o que vai para a `main`:

- Logo no início da leva, quem integra cria a branch `integration/<leva>` e abre
  **um único PR** dela contra a `main`.
- Cada fatia é mesclada na branch de junção (`git merge --no-ff`) **assim que
  termina**, sem esperar CI. Conflitos em arquivos compartilhados são resolvidos
  somando os dois lados.
- O CI roda **só no PR de junção**. Os runs dos PRs menores são cancelados, e
  esses PRs são fechados com um comentário apontando para o PR de junção. As
  branches `feat/*` ficam no remoto para consulta.
- Os agentes **não esperam nem disparam CI** do próprio PR: fazem push, entregam
  o relatório e param. Quem lê o CI e corrige as falhas é quem integra, na
  branch de junção.
- Mudanças em rotas pedem o workflow `Regenerate OpenAPI` na branch de junção.
- O merge na `main` só acontece com o PR de junção **verde**, em um único push
  (o CD faz o deploy e o smoke vem depois).
- Relatório de agente do tipo "CI verde" não vale como prova: confere-se o
  `gh pr checks` do PR de junção.

Continuam valendo o ADR 0001 (trabalho sequencial direto na `main`) e a regra
do ADR 0010 de que o gate é o CI, não uma revisão obrigatória de terceiros.

## Consequências

- A fila dos runners some: uma execução de CI por leva em vez de uma por fatia.
- O CI valida o conjunto, que é o que vai de fato para a `main`.
- Os agentes terminam mais cedo, sem ficar parados esperando CI.
- Perde-se o isolamento: uma falha no CI da junção pode vir de qualquer fatia, e
  achar a origem exige ler os logs e o histórico de merges. Mitigação: um commit
  de merge por fatia, na ordem em que terminaram.
- A responsabilidade de corrigir o CI fica toda em quem integra.
- Revisitar se o plano de runners mudar (por exemplo, mais jobs simultâneos) ou
  se uma leva ficar grande a ponto de a junção ser difícil de depurar. Nesse
  caso, dividir em duas levas com duas branches de junção.
