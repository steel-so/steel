# 0039 — Avaliação e feedback das respostas de IA

- **Status:** Aceita
- **Data:** 2026-10-18
- **Decisores:** product owner + time de engenharia

## Contexto

O Steel tem IA em muitos pontos — chat do Steel AI, Steel Agents, copiloto,
triagem e rascunho KCS do ServiceDesk, resposta automática do WhatsApp —, mas
não há como saber se ela acerta. Trocar de modelo, de prompt ou de skill é um
salto no escuro: o único sinal é a reclamação de quem usa. A frente 2 do
roteiro do Steel AI (`docs/steel-ai/roadmap.md`) pede três coisas: 👍/👎 com
motivo em toda resposta de IA, conjuntos de teste por workspace rodados antes
de uma troca e um painel de qualidade.

O que já existia e foi reaproveitado: o razão de consumo `ai_usage` (custo
real por chamada, ADR 0019), a porta única de chamadas `AiUsageService`
(provedor, modelo e cota — ADR 0007), a tela **Análises** do Steel AI com
filtro de período em UTC e CSV, e os flags `sentByAi` (WhatsApp) e `outcome`
do pré-atendimento (ServiceDesk).

## Decisão

**Um modelo único de feedback (`AiFeedback`) para todas as superfícies,
conjuntos de teste (`AiEvalSet` / `AiEvalCase`) executados por uma fila do
worker com juiz LLM + verificações simples (`AiEvalRun` / `AiEvalResult`), e
um painel "Qualidade" dentro de Análises.**

Detalhes para aplicar:

- **Feedback.** Uma linha por pessoa, superfície, alvo e variação
  (`@@unique([userId, surface, targetId, variant])`); avaliar de novo
  substitui, desfazer apaga. Superfícies e alvos:
  `STEEL_AI_MESSAGE` → `AiMessage` do assistente (só o dono da conversa);
  `STEEL_AGENT_RUN` → execução (quem vê os agentes); `SD_COPILOT` → chamado,
  com variação `summary | reply | solution | classification | chat[:n]`
  (as respostas do copiloto não são gravadas, então o alvo é o chamado);
  `SD_TRIAGE` → chamado com `aiTriage`; `SD_KCS_DRAFT` → artigo com
  `sourceTicketId`; `WHATSAPP_AUTO_REPLY` → mensagem com `sentByAi`, com a
  mesma regra de visibilidade da conversa (equipe). O servidor confere o alvo
  e grava o modelo que respondeu (da própria resposta quando ela guarda; senão
  o modelo configurado para a funcionalidade). Motivo é um código fixo
  (`incorrect`, `incomplete`, `irrelevant`, `tone`, `unsafe`, `other`) só no
  👎, mais comentário livre opcional (até 1.000 caracteres).
- **LGPD.** Comentário pode ter dado pessoal: a linha cai junto com o usuário
  (`onDelete: Cascade`) e com o workspace. Criar, trocar e apagar feedback são
  auditados (`auditMutation`, entidade `ai_feedback`), sem o texto do
  comentário no log.
- **Papéis.** Qualquer membro avalia o que vê e consulta o próprio painel;
  dono e administradores veem a qualidade do workspace inteiro, quem avaliou e
  as métricas de resolução. Conjuntos de teste são só de dono e
  administradores (o custo da execução sai da cota do workspace).
- **Conjuntos de teste.** Cada conjunto tem um alvo: `STEEL_ASSISTANT` (o
  prompt de sistema do Steel AI no modo explorar, com skill opcional) ou
  `WHATSAPP_REPLY` (prompt da resposta automática + documentos de
  conhecimento). Cada caso tem a pergunta e ao menos uma forma de correção:
  resposta esperada, critério, "deve conter" ou "não pode conter". Limites:
  20 conjuntos por workspace, 50 casos por conjunto. Um turno do chat pode
  virar caso ("salvar como caso de teste"): a pergunta é a mensagem do usuário
  anterior e a esperada é a resposta.
- **Execução.** `POST /ai/evals/{setId}/runs` cria a execução `QUEUED` e
  enfileira em `ai-eval` (uma tentativa; uma execução por conjunto por vez).
  O worker responde cada caso com o modelo pedido (ou o padrão), sem
  ferramentas — avalia a resposta, não as ações —, aplica as verificações de
  texto (sem diferenciar maiúsculas e acentos) e, quando há esperada ou
  critério, pede ao juiz (modelo do assistente do workspace) uma nota de 0 a 1
  em JSON estruturado. Passa quem passa nas verificações e tira nota ≥ 0,7. O
  consumo entra no razão como `AI_EVAL` e respeita a cota; cota esgotada no
  meio encerra a execução como `FAILED` com o que já foi corrigido.
- **Antes de trocar.** A execução aceita um rascunho: `modelKey`, `skillId` e
  `promptOverride` (só WhatsApp), com o motivo (`model_change`,
  `prompt_change`, `skill_change`). As telas de modelo (Ajustes › Steel IA),
  de prompt (WhatsApp › Configurações › IA) e de skill mostram o último
  resultado e "Rodar avaliação antes de trocar".
- **Painel Qualidade** (Steel AI › Análises): taxa de aprovação por
  superfície, por modelo e por dia; resolução sem humano — conversas do
  WhatsApp com resposta da IA fechadas sem mensagem de atendente, e
  pré-atendimentos do ServiceDesk resolvidos pela base (`resolved_by_kb`) —;
  custo por resolução (custo da funcionalidade no período ÷ resoluções); e as
  piores respostas (👎 mais recentes, com motivo). CSV por avaliação, por
  superfície e por modelo, auditado.

## Consequências

- Dá para comparar modelos e prompts com dados do próprio workspace antes de
  trocar, e acompanhar se a IA melhora ou piora com o tempo.
- O alvo do copiloto é o chamado, não a resposta exata: um 👎 no resumo vale
  para o último resumo gerado. Aceito porque o copiloto não grava as
  respostas; se passar a gravar, o alvo vira a resposta.
- A avaliação do Steel AI roda sem ferramentas, então mede tom, conhecimento e
  seguimento de instruções, não o uso de dados reais. Rodar com ferramentas de
  leitura exige um usuário para as permissões; fica para depois.
- "Resolução sem humano" é uma aproximação com o que os dados guardam hoje. O
  ServiceDesk não marca "resolvido pela sugestão da IA" no chamado; se passar
  a marcar, entra na conta.
- Revisitar quando a frente 6 (modelo por tarefa) chegar: o juiz pode virar um
  modelo fixo e mais barato.
