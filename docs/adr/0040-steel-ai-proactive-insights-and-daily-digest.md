# 0040 — IA proativa: alertas calculados por regra e resumo diário com números do banco

- **Status:** Aceita
- **Data:** 2026-10-18
- **Decisores:** product owner (frente 3 do [roadmap do Steel AI](../steel-ai/roadmap.md), aprovada em 18/10: "manda bala") + time de engenharia

## Contexto

Quase tudo no Steel AI começa com alguém perguntando. Os dados para avisar
antes já existem: a previsão de estouro de SLA por chamado
([ADR 0016](./0016-predictive-risk-explainable-heuristic.md)), o kit de
vendas com negócios parados e previsão contra a meta
([ADR 0031](./0031-crm-sales-tv-kit.md)), o sentimento médio das conversas
do WhatsApp e a regra de "conversa aguardando atendente" usada pela API v1 e
pelo webhook `communication.conversation.waiting`
([ADR 0036](./0036-outbound-webhooks.md)). Faltava juntar isso num lugar,
para a pessoa certa, sem virar mais uma fonte de ruído.

Três riscos guiaram o desenho: (1) **número inventado** — um LLM resumindo
dados pode errar uma contagem, e um alerta com número errado destrói a
confiança no recurso; (2) **vazamento** — um alerta de fila não pode contar a
um agente de uma equipe o que só o líder de outra vê; (3) **spam** — o mesmo
alerta a cada 15 minutos, ou um e-mail diário vazio.

## Decisão

**Os alertas ("insights") são calculados por regra, em código, a partir de
consultas; o LLM só redige a introdução do resumo diário, e a frase dele é
descartada se citar um número que não veio das consultas.**

### Alertas (`AiInsight`)

- Uma linha por **pessoa** e **chave de deduplicação** (`@@unique([userId,
  workspaceId, dedupeKey])`). Cada alerta guarda o porquê em números
  (`facts`: rótulo + valor), o link para o registro, uma pergunta pronta para
  o Steel AI (`prompt`) e a gravidade (`INFO`, `WARNING`, `CRITICAL`).
- O worker (`ai-proactive`, tique a cada 15 min) recalcula tudo por
  workspace. Alerta recalculado é **atualizado** (mesma linha, números novos);
  alerta que não aparece mais numa avaliação bem-sucedida do módulo vira
  `RESOLVED`; se a condição voltar depois, é um **episódio novo** (dispensa e
  adiamento zerados). Falha ao ler um módulo não resolve os alertas dele.
- **Dispensar** esconde o alerta enquanto a condição durar; **adiar** esconde
  até a hora escolhida. Os dois são da própria pessoa.
- **Regras da primeira versão** (limiares em `src/lib/ai/proactive/rules.ts`,
  ajustáveis sem migração):

  | Tipo | Quem recebe | Quando |
  | --- | --- | --- |
  | `SD_SLA_BREACH_FORECAST` | responsável (os chamados dele); líderes do departamento e admins do ServiceDesk (o departamento) | previsão de estouro (`breachEtaAt` da ADR 0016) nas próximas 4 h |
  | `CRM_STALE_OPPORTUNITIES` | dono (os negócios dele); OWNER/ADMIN (o total) | negócio aberto sem atividade há 10 dias ou mais (mesma regra do card "parados" do kit de vendas) |
  | `CRM_STALLED_STAGE` | OWNER/ADMIN | uma etapa concentra 3 ou mais desses negócios |
  | `CRM_FORECAST_GAP` | OWNER/ADMIN | meta do mês cadastrada e previsão ponderada abaixo de 90% dela |
  | `ZAP_WAITING_TOO_LONG` | quem vê a fila (regra de Equipes) | conversa sem responsável aguardando há mais de 30 min (mesma regra de `listWaiting`) |
  | `ZAP_NEGATIVE_SENTIMENT` | responsável da conversa, líderes da equipe e quem vê tudo | média de sentimento no limiar de alerta do workspace (padrão −0,3), mensagem nas últimas 24 h; no máximo 5 por pessoa |

- **Permissão no cálculo e na leitura.** O cálculo usa as regras dos
  próprios módulos: `SdAccess` (agente, departamentos, líder, admin),
  `assertModuleMember` com `opportunities`/`conversations` `VIEW`, e
  `canSeeConversation` (Equipes) sobre o retrato das equipes. A leitura
  confere de novo módulo habilitado e permissão; um alerta de um módulo que a
  pessoa perdeu some na hora, sem esperar o próximo tique.
- **Steel Agents.** Cada episódio novo dispara uma vez, por chave, os eventos
  `sd.insight.detected`, `crm.insight.detected` e `zap.insight.detected`
  ([ADR 0020](./0020-steel-agents-owner-identity-and-approvals.md)) — um
  agente pode, por exemplo, redistribuir a fila quando o alerta de SLA nasce.
  Mesmas proteções da ADR 0020 (escrita de agente não dispara agente).
- **Onde aparece:** página inicial ("Para sua atenção"), tela inicial do
  Steel AI e caixa de entrada (visão "Alertas da IA"). A ferramenta
  `ws_insights` (leitura) leva os mesmos alertas ao assistente, aos agentes e
  ao MCP. "Perguntar ao Steel AI" abre um chat novo com a pergunta preenchida
  (`/ai?prompt=`), que a pessoa revisa antes de enviar; ações de escrita
  seguem o fluxo de confirmação de sempre (ADR 0018).

### Resumo diário

- Tique de hora em hora; cada pessoa recebe às **08:00 no fuso dela**
  (Preferências; padrão `America/Sao_Paulo`), no máximo uma vez por dia local
  (`AiDigestSetting.lastSentOn`), na caixa de entrada (`AI_DAILY_DIGEST`) e
  por e-mail. **Dia sem alerta ativo não gera resumo.**
- O conteúdo são os alertas ativos da pessoa (já filtrados por permissão),
  em ordem de gravidade. O LLM (funcionalidade `PROACTIVE_DIGEST`, modelo
  barato do workspace — o de sentimento) recebe só títulos e números e
  escreve uma introdução curta. **Guarda contra número inventado:** todo
  número da frase precisa estar entre os números dos alertas; senão, a
  introdução é a frase determinística. Sem provedor, cota esgotada ou erro,
  também cai na frase determinística — o resumo sai igual.
- **Opt-out por pessoa** em Configurações › Notificações (caixa de entrada e
  e-mail, ligados por padrão). O tipo `AI_DAILY_DIGEST` não aparece na lista
  genérica de tipos para não ter dois interruptores para a mesma coisa.

### Interruptor e custo

- `WorkspaceAiSettings.proactiveEnabled` (padrão ligado) em Ajustes › Steel
  IA, abaixo do interruptor geral. Desligado (ou com a IA desligada), o tique
  resolve os alertas do workspace, o resumo não sai e a API responde
  `enabled: false`.
- Os alertas não chamam LLM (custo zero de IA). O resumo conta no razão
  `AiUsage` com `PROACTIVE_DIGEST`, por pessoa, e respeita a cota mensal
  (ADRs 0007 e 0019).

## Consequências

- Explicável por construção: cada alerta mostra os números que o
  dispararam, e dá para responder "por que recebi isto" lendo a linha.
- Nenhum número do resumo depende do LLM; o teste trava a guarda.
- Custo aceito: regras fixas não descobrem padrões novos e os limiares são
  globais. Limiar por workspace (ex.: dias de "parado") fica para quando um
  cliente pedir — entra como coluna nos ajustes, sem mudar o contrato.
- O tique recalcula por pessoa; em workspaces muito grandes (centenas de
  membros com os três módulos) o custo é de consultas, não de IA. Revisitar
  com cache por workspace se o tique passar de alguns segundos.
- Avaliação 👍/👎 dos alertas depende da frente 2 (`AiFeedback`, ADR 0039,
  ainda em PR): o cartão tem o ponto de encaixe marcado com TODO.
- Ficaram de fora nesta versão: alerta de previsão por vendedor (meta
  individual), "cliente X" sem conversa aberta, e alertas por canal externo
  (Slack/WhatsApp para o próprio atendente).
