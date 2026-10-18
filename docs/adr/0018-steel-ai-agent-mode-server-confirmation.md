# 0018 — Steel AI: modo agente com confirmação no servidor

- **Status:** Aceita
- **Data:** 2026-10-06
- **Decisores:** product owner + time de engenharia

## Contexto

O assistente de IA do CRM podia criar registros. A "confirmação" era um
campo `userConfirmed: true` que o próprio modelo preenchia depois de
perguntar "posso prosseguir?" em texto (ver `crm-ai-tools.ts`). Ou seja: a
garantia dependia do modelo seguir a instrução — um modelo confuso, um
prompt injetado num dado lido (e-mail, mensagem de WhatsApp, descrição de
chamado) ou uma resposta ambígua do usuário bastavam para gravar algo.

O Steel AI passa a cobrir ServiceDesk, CRM, Comunicação e plataforma, com
escritas mais sensíveis (mover fase, atribuir, excluir, mandar mensagem a
cliente). A ADR 0007 decidiu provedor/modelo por workspace; esta decide
como a IA escreve.

## Decisão

**Nenhuma escrita sai do modelo direto para o banco.** Toda ferramenta de
escrita (`CREATE`, `UPDATE`, `DELETE`, `ACTION`) chamada pelo modelo vira
uma `AiPendingAction` com prévia; ela só executa quando o usuário clica em
**Confirmar**, numa rota própria (`POST .../ai/actions/{id}/confirm`) que o
modelo não alcança.

Detalhes para aplicar:

- Dois modos por conversa: **Explorar** (só ferramentas `READ`) e
  **Agente** (escritas viram propostas). O filtro roda antes do modelo:
  modo, módulo habilitado, permissão do perfil (RBAC) e o interruptor
  `WorkspaceAiSettings.agentModeEnabled`, que o admin desliga em
  Ajustes > Steel IA.
- Fluxo da escrita: `parse` → `preview` (não altera nada) →
  `AiPendingAction(PENDING)` com validade de 30 min → evento SSE
  `action.pending` → confirmação humana → `execute` → `AiActionLog` +
  `auditMutation` → mensagem `TOOL` com o resultado no histórico.
- Na confirmação o servidor revalida tudo: dono da ação, status, validade,
  modo agente, módulo e permissão, e roda `parse` de novo sobre os
  argumentos. `DELETE` exige confirmação dupla (`doubleConfirmed: true`).
- A troca `PENDING → EXECUTED` é um `UPDATE ... WHERE status = 'PENDING'`:
  dois cliques (ou duas abas) nunca executam duas vezes; o segundo recebe o
  resultado do primeiro.
- A ferramenta roda com as permissões do usuário e chama o service de
  domínio, que continua sendo a autoridade (RBAC, módulo, workspace).
- O prompt do modo agente proíbe "posso prosseguir?" em texto: o modelo
  propõe com todos os campos e a tela faz a pergunta.

## Consequências

- A segurança da escrita deixa de depender do comportamento do modelo; um
  prompt injetado consegue no máximo *propor* algo que o usuário vê antes.
- Toda escrita feita por IA fica rastreável em `ai_action_logs`, além do
  log de auditoria do Axiom.
- Custo aceito: um clique a mais por escrita e um turno que termina
  "aguardando confirmação" — o modelo só fica sabendo do resultado na
  mensagem seguinte (a decisão entra no histórico como nota do sistema).
- Steel Agents (execução autônoma) reaproveitam o mesmo registro de
  ferramentas e o mesmo `executeClaimedAction`; lá cada ferramenta pode ser
  "automática" ou "requer aprovação", mas exclusão sempre requer aprovação.
- Revisitar se surgir demanda de lote (confirmar várias ações de uma vez)
  ou de ações de baixo risco sem confirmação no assistente.

## Atualização (18/10/2026) — prévia vencida

A confirmação revalidava permissão e status, mas não o conteúdo: `execute`
recalcula o plano a partir dos registros atuais, então uma alteração feita
por outra pessoa entre a prévia e o clique era aplicada (ou misturada) sem
que ninguém a visse. Agora, antes de reivindicar a ação, o servidor monta a
prévia de novo com os mesmos `args` e compara com a gravada
(`assertPreviewUnchanged` + `previewFingerprint`). Se mudou, nada executa: a
ação continua `PENDING` com a prévia nova e a resposta é
`409 AI_PENDING_ACTION_CHANGED` ("O registro mudou desde a prévia. Revise e
confirme de novo."). Vale para o assistente, para as pendências do MCP e
para a aprovação dos Steel Agents. A comparação é sobre o que a pessoa viu,
não sobre `updatedAt`, para que mudanças fora da prévia não bloqueiem; e não
é uma trava — sobra a janela de milissegundos entre a checagem e a execução.
