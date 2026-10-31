# 0057 — Saúde do cliente e do negócio pela mesma heurística explicável do risco preditivo

- **Status:** Aceita
- **Data:** 2026-10-30
- **Decisores:** Claude (com a autorização do dono do produto para decidir dentro da fatia health-scores)

## Contexto

O roadmap pede duas notas de risco que respondem à mesma pergunta em escalas
diferentes: quais clientes podem cancelar (T4) e quais negócios estão
esfriando (C4). Os sinais estão espalhados: estágio e engajamento no CRM,
sentimento das conversas no WhatsApp e chamados e SLA no ServiceDesk.

A [ADR 0016](./0016-predictive-risk-explainable-heuristic.md) já decidiu como
o produto calcula risco: heurística explicável, sem modelo treinado, sem LLM,
com o motivo sempre junto da nota.

## Decisão

- As duas notas usam **a mesma mecânica** (`src/lib/crm-health/core.ts`) e os
  **mesmos cortes** da ADR 0016 (`SD_RISK_THRESHOLDS`: médio a partir de 40,
  alto a partir de 70). Mudar o corte do ServiceDesk muda o do CRM, de
  propósito: "risco alto" quer dizer a mesma coisa nos dois módulos.
- Cada nota é uma **tabela de fatores com peso fixo somando 100**
  (`customer.ts`, `opportunity.ts`); um teste trava a soma. O fator que
  pontuou guarda a frase em pt-BR que a interface mostra. Nota sem motivo é
  bug.
- A nota é um **risco** (0 a 100, quanto maior pior). Para o cliente, a
  interface mostra também a saúde (`100 - risco`). Não guardamos as duas.
- Um fator **sem dado** (cliente sem conversa de WhatsApp, empresa sem
  cadastro no ServiceDesk, sem avaliação de satisfação) **sai do
  denominador**: a nota é `pontos / peso dos fatores aplicáveis`. Assim uma
  fonte ausente não deixa o cliente mais saudável nem mais doente do que os
  dados sustentam, e a tela lista o que ficou de fora.
- A **próxima ação** é a ação do fator que mais pontuou; sem fator, a ação é
  manter o relacionamento. É texto fixo, escolhido por regra, não gerado.
- O cálculo roda no worker (fila `crm-health`, de hora em hora) e a tela lê a
  linha pronta (`crm_customer_health`, `crm_opportunity_health`), com
  recálculo sob demanda. O ciclo percorre as notas mais antigas primeiro e
  tem teto por workspace e por rodada.
- O negócio ganho ou perdido **não tem nota** (a linha é apagada): risco de
  perder um negócio já decidido não é informação.
- O aviso sai quando o registro **entra** na faixa alta (cliente e negócio)
  ou, só para o cliente, quando o risco sobe 20 pontos ou mais já na faixa
  média. Nunca a cada rodada: o nível anterior fica na própria linha.
- Ligação entre os módulos, sem tabela nova de vínculo: a empresa do CRM é
  ligada ao cliente do ServiceDesk pelo CNPJ (ou, sem CNPJ, pelo nome
  exato), e as pessoas da empresa às conversas do WhatsApp pelo telefone
  (DDD + últimos 8 dígitos, a mesma chave da ligação das chamadas
  telefônicas).
- Para "troca de contato" e "dias na etapa" o negócio ganhou duas colunas,
  `stage_changed_at` e `contact_changed_at`, gravadas pelo serviço quando a
  etapa ou o contato principal realmente mudam.

## Consequências

- Explicável e auditável: responder "por que este cliente está vermelho" é
  ler uma linha (`factors` e `signals`).
- A heurística não aprende. A ADR 0016 já aceitou esse custo; calibrar os
  pesos com o histórico de cada workspace seria uma ADR nova.
- O vínculo por nome exato com o ServiceDesk pode errar com homônimos. Foi
  aceito para não exigir cadastro duplo; o CNPJ, quando existe, manda.
- Um cliente novo, sem histórico, recebe nota útil no primeiro dia, porque os
  fatores contam desde a criação do cadastro e não dependem de passado.
