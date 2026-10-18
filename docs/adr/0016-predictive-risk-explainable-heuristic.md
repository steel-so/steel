# 0016 — Risco preditivo por heurística explicável, não por modelo treinado

- **Status:** Aceita
- **Data:** 2026-10-02
- **Decisores:** dono do produto

## Contexto

O ServiceDesk precisa avisar antes de o SLA estourar, não depois: o selo "este
chamado vai violar o prazo" no quadro e na fila é o que permite remanejar
alguém a tempo. A mesma necessidade aparece em "estes incidentes são a mesma
coisa, abre um problema".

A saída óbvia seria treinar um modelo com o histórico de chamados. Isso traz
três custos que o produto hoje não paga: (1) **dado pessoal de cliente** sairia
do banco para um pipeline de treino, contra o que a
[ADR 0006](./0006-central-ai-assistant-claude-code.md) estabeleceu; (2) cada
workspace tem fase, SLA e calendário próprios ([ADR 0008](./0008-servicedesk-itil-configurable-engine.md)),
então um modelo global erraria em todo mundo e um modelo por workspace exigiria
histórico que um cliente novo não tem; (3) um número sem motivo não muda o
comportamento de quem atende — agente não remaneja fila porque "a IA deu 0,82".

## Decisão

- O risco é calculado por **heurística explicável**, em código versionado:
  uma tabela de fatores com peso fixo (`src/lib/servicedesk/risk.ts`), somando
  no máximo 100 pontos, e dois cortes (`MEDIUM` ≥ 40, `HIGH` ≥ 70).
- **A previsão nunca aparece sem o porquê.** `SdTicketRiskPrediction.factors`
  guarda, por fator que pegou, a frase em pt-BR que a interface mostra ("80%
  do prazo consumido", "sem responsável há 3 h"). Selo sem motivo é bug.
- O cálculo roda no worker (`servicedesk-risk`, a cada 10 min) sobre os
  chamados abertos, e grava uma linha por chamado. Nada é calculado na
  renderização: a tela lê a previsão pronta.
- A detecção de incidentes repetidos segue a mesma régua: agrupamento por
  assinatura (categoria + termos do título), guardado em `SdIncidentCluster`
  como **sugestão** — abrir o problema é ação do agente, nunca automática.
- A heurística é ajustável sem migração: mudar peso ou corte é mudar a tabela.
  O teste do catálogo trava a soma em 100 para a nota continuar legível como
  porcentagem.

## Consequências

- Explicável e auditável por construção: dá para responder "por que este
  chamado está vermelho" lendo uma linha do banco.
- Nenhum dado de cliente sai do workspace, e um cliente sem histórico já
  recebe previsão útil no primeiro dia (os fatores não dependem de passado).
- O custo é precisão: a heurística não descobre padrão que ninguém codificou.
  Aceitável porque o objetivo é **priorizar fila**, não prever com exatidão.
- Se um dia houver histórico e demanda, o caminho natural é calibrar os pesos
  com o histórico de cada workspace, mantendo o formato dos fatores — a tela e
  o contrato não mudam. Isso seria uma ADR nova, não uma revisão desta.
- A IA generativa (ADR 0007) continua no que ela é boa: redigir o rascunho do
  artigo de KCS e a triagem textual. Nota de risco não passa por LLM.

## Atualização (2026-10-18)

A decisão continua a mesma (heurística explicável, sem modelo treinado). Uma
revisão do código achou quatro lacunas, corrigidas sem mudar a tabela de
pesos, as faixas nem o formato dos fatores:

- **"Sem interação da equipe" só conta a equipe.** O fator lia
  `SdTicket.lastActivityAt`, que também anda com mensagem do cliente (portal,
  e-mail, WhatsApp, Slack) — o cliente cobrando zerava o silêncio. Agora
  conta o último evento de agente (`SdTicketEvent.actorKind = AGENT`); sem
  nenhum, conta desde a abertura.
- **O prazo de 1ª resposta entra no risco.** Antes, havendo prazo de
  resolução, a 1ª resposta era ignorada. Enquanto ninguém respondeu, os dois
  timers concorrem: o fator `sla_consumed` usa o mais urgente e a previsão de
  estouro é o primeiro prazo a vencer.
- **Termos do agrupamento por relevância.** A assinatura cortava os termos
  do título em ordem alfabética; agora ficam os que mais se repetem no
  título e nos incidentes da janela (frequência de documento — não tf-idf,
  que premiaria o termo raro, justamente o que não agrupa). Custo aceito: a
  assinatura de um título com mais de 4 termos pode mudar quando a janela
  muda.
- **Backtest.** `pnpm risk:backtest [workspace]` reproduz a heurística sobre
  chamados encerrados com desfecho conhecido e mede calibração por faixa,
  precisão/revocação da faixa alta e antecedência
  ([README do ServiceDesk](../servicedesk/README.md#backtest-do-risco)). É o
  primeiro passo do caminho que as Consequências já apontavam: calibrar os
  pesos com o histórico de cada workspace. Calibrar de fato continua sendo
  uma ADR nova.
