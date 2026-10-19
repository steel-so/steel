# 0042 — Modelo por tarefa e contingência automática de provedor

- **Status:** Aceita
- **Data:** 2026-10-18
- **Decisores:** product owner (frente 6 do roadmap do Steel AI, aprovada em 18/10) + time de engenharia

## Contexto

O workspace escolhe um modelo para três "funcionalidades"
(`crmAssistantModel`, `whatsappReplyModel`, `whatsappSentimentModel`), e as
demais herdavam de uma delas por um mapa fixo (ADR 0019). Os Steel Agents
usavam o modelo do assistente; não havia como pôr um modelo forte nos
agentes e um barato na classificação de forma explícita, nem padrão da
plataforma para workspaces novos (sem linha = tudo em `gpt-4o-mini`).

E quando o provedor caía (5xx, sobrecarga, timeout, chave revogada) a
chamada simplesmente falhava: a resposta automática deixava o cliente sem
resposta, a triagem não classificava e o chat mostrava erro, mesmo com o
outro provedor habilitado e funcionando.

O app roda em réplicas (ADR 0038) e no worker, então o estado de "provedor
fora" precisa ser compartilhado.

## Decisão

**Toda funcionalidade pertence a uma classe de tarefa, cada classe tem um
modelo (do workspace, senão o padrão do admin global), e toda chamada tenta
outro modelo habilitado quando o escolhido falha, com um circuit breaker em
Redis compartilhado entre réplicas e worker.**

Detalhes para aplicar:

- **Classes** (`AI_TASK_CLASSES`, `src/lib/ai/models.ts`;
  `AI_TASK_CLASS_BY_FEATURE`, `src/services/ai-usage.service.ts`):
  - `CLASSIFICATION` — sentimento, triagem, classificador das proteções
    (ADR 0041); guardada em `whatsappSentimentModel`;
  - `CONVERSATION` — resposta automática do WhatsApp e pré-atendimento;
    `whatsappReplyModel`;
  - `ASSISTANT` — Steel AI, copiloto, Wiki, CRM; `crmAssistantModel`;
  - `AGENT` — Steel Agents; coluna nova `agentModel` (nula = padrão da
    plataforma para agentes, senão o do assistente).
  Reaproveitamos as colunas existentes em vez de criar quatro novas: o
  significado já era esse, e assim não há migração de dados. A tela passa a
  chamá-las pelo nome da tarefa.
- **Padrões do admin global**: `PlatformAiSettings` ganha
  `classificationModel`, `conversationModel`, `assistantModel` e
  `agentModel` (nulos = `gpt-4o-mini`; agente = o do assistente). Valem para
  workspaces sem linha salva; quem já salvou mantém o que salvou. Lidos com
  o mesmo cache de 60 s da margem.
- **Ordem de resolução** (inalterada no resto): modelo pedido na conversa →
  preferência do usuário (só assistente) → modelo da classe → habilitados.
- **Failover** (`failover.ts` + `guarded-provider.ts`): na preparação, até
  dois modelos de reserva entre os habilitados e com chave, ordenados por
  outro provedor primeiro e, dentro dele, o porte que a classe pede
  (`AI_MODEL_TIER`: rápido para classificação e atendimento, forte para
  assistente e agentes). Erro que troca de modelo: timeout, rede, 401, 403,
  404, 408, 429 e 5xx (chave revogada e modelo aposentado são indisponibilidade
  do ponto de vista do workspace); 400, 413 e 422 não trocam (o pedido está
  errado em qualquer provedor). A troca é **pegajosa**: as rodadas seguintes
  da mesma interação seguem no modelo que respondeu. No streaming só troca
  antes do primeiro trecho; depois o erro sobe.
- **Timeout por classe** (`AI_TASK_TIMEOUT_MS`): 30 s classificação, 60 s
  atendimento, 120 s assistente e agentes; no streaming, para o primeiro
  trecho. Só se aplica quando há reserva — sem reserva a chamada espera como
  antes.
- **Circuit breaker** (`circuit-breaker.ts`): 5 falhas de um provedor em 60 s
  abrem o circuito por 60 s (`ai:cb:open:<provider>`); provedor aberto vai
  para o fim da fila (ainda é a última tentativa). Sucesso zera a contagem.
  Redis lento (300 ms) ou fora = circuito fechado: o breaker nunca derruba a
  chamada.
- **Consumo com o modelo real**: a troca atualiza `call.model`, então
  `AiUsage` grava o provedor e o modelo que responderam e o preço deles; o
  log `ai.usage_recorded` leva a lista de trocas.
- **Interruptores**: `WorkspaceAiSettings.failoverEnabled` e
  `PlatformAiSettings.failoverEnabled`, ambos ligados por padrão; qualquer
  um desligado = sem reserva.

## Consequências

- Uma queda de provedor deixa de derrubar a resposta automática, a triagem e
  o chat em workspaces com os dois provedores habilitados.
- O admin global define o "mix" barato/forte de quem nunca abriu os ajustes.
- Custo aceito: numa troca no meio de um laço de ferramentas, as rodadas
  anteriores (do modelo original) são lançadas com o preço do modelo que
  terminou; o razão tem uma linha por interação, não por rodada.
- Custo aceito: um timeout não cancela o pedido original no SDK; se ele
  terminar depois, o consumo dele não é lançado.
- Workspace com um só provedor habilitado só troca de modelo dentro dele (o
  que ajuda em modelo aposentado, não em queda do provedor).
- Revisitar: separar o razão por rodada se a troca no meio do laço for
  frequente; ligar o `AbortSignal` dos SDKs no timeout.
