# Steel AI — contrato

Assistente de IA transversal (ServiceDesk, CRM, Comunicação e plataforma) com dois modos, e base dos Steel Agents.

Próximos passos de IA (levantamento, ainda não aprovado): [roadmap.md](./roadmap.md).

- **Explorar** (`EXPLORE`): só ferramentas de leitura (`kind = READ`). É o comportamento do antigo assistente do CRM, agora para todos os módulos.
- **Agente** (`AGENT`): também ferramentas de escrita (`CREATE`, `UPDATE`, `DELETE`, `ACTION`). **Toda escrita vira uma `AiPendingAction`** com prévia e só executa quando o usuário clica em **Confirmar** — o modelo nunca confirma sozinho. `DELETE` exige confirmação dupla (`doubleConfirmed: true`). Ação pendente expira em 30 min. O admin desliga o modo agente do workspace inteiro em Ajustes > Steel IA (`WorkspaceAiSettings.agentModeEnabled`).

Decisões do product owner (06/10/2026): toda escrita confirma; nos Steel Agents cada ferramenta é "automática" ou "requer aprovação" (padrão: requer; exclusão sempre requer, pela inbox); o widget flutuante de IA do CRM sai — fica só a tela Steel AI.

## Regras de segurança

1. Ferramenta roda com as permissões do usuário (`ctx.actorId`) e chama o **service de domínio** — o service continua sendo a autoridade (RBAC, módulo, workspace). `module`/`permission` na ferramenta só filtram o que o modelo enxerga.
2. Filtro antes do modelo: modo (EXPLORE ⇒ só READ), módulo habilitado no workspace, permissão do perfil e `agentModeEnabled`.
3. Escrita: `parse` → `preview` (não altera nada) → `AiPendingAction(PENDING)` → evento `action.pending` → humano confirma → `execute` → `AiActionLog` + `auditMutation` → mensagem `TOOL` com o resultado no histórico, para o modelo saber na próxima rodada.
4. Na confirmação o servidor revalida tudo (dono da ação, status, validade, modo agente ligado, permissão) e roda `parse` de novo sobre `args`.
5. **Prévia vencida** (18/10/2026): `execute` recalcula o plano a partir dos registros atuais, então uma mudança feita por outra pessoa entre a prévia e o clique seria aplicada sem ninguém ver. Antes de reivindicar a ação, `assertPreviewUnchanged` (`src/services/ai-pending-action.service.ts`) monta a prévia de novo com os mesmos `args` e compara com a gravada na linha (`previewFingerprint`, `src/lib/ai/tools/preview-fingerprint.ts`: título, resumo, linhas antes → depois e alvo, sem depender de ordem de chaves). Diferente → nada executa, a ação continua `PENDING` com a prévia nova gravada e a resposta é `409 AI_PENDING_ACTION_CHANGED` ("O registro mudou desde a prévia. Revise e confirme de novo.", ação atualizada em `error.details.action`); o segundo clique confirma a prévia nova. Vale para o cartão do chat, para as pendências do MCP na caixa de entrada e para a aprovação dos Steel Agents. Compara o que a pessoa viu, não `updatedAt`: mudança que não aparece na prévia (tique de SLA, mensagem nova) não bloqueia. Prévia que não pode mais ser montada (registro apagado, janela fechada) não bloqueia: `execute` falha igual e grava `FAILED`. Não é trava: sobra a janela entre a checagem e a execução.
5. Saída para o modelo limitada (~20 KB); listagens paginam (padrão 20, máx. 50).
6. Mensagem a cliente (WhatsApp, e-mail) é `ACTION` e respeita opt-out (`docs/lgpd.md`).

## API

Todas em `app/api/workspaces/[id]/ai/**`, com o fluxo padrão de rota (withAxiom → sessão → rate limit → Zod → service → envelope). Conversa é privada do usuário.

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/ai/capabilities` | — | `AiCapabilitiesDTO`: `{ aiEnabled, agentModeEnabled, autopilotEnabled, modules, modelKey, models: AiChatModelDTO[], attachments: { maxPerMessage, maxImageBytes, maxDocumentBytes, accept }, quota }` (responde mesmo com a IA desligada) |
| GET | `/ai/conversations?q=` | — | `AiConversationDTO[]` (fixadas primeiro, depois `updatedAt` desc) |
| POST | `/ai/conversations` | `CreateAiConversationSchema` | 201 `AiConversationDTO` |
| GET / PATCH / DELETE | `/ai/conversations/[conversationId]` | `UpdateAiConversationSchema` | `AiConversationDTO` (DELETE = soft delete) |
| GET | `/ai/conversations/[conversationId]/messages` | — | `AiMessageDTO[]` |
| POST | `/ai/conversations/[conversationId]/messages` | `SendAiMessageSchema` (`content`, `mode?`, `modelKey?`, `attachmentIds?`) | `text/event-stream` de `SteelAiStreamEvent`; erro antes do stream começar volta como JSON 4xx |
| POST | `/ai/conversations/[conversationId]/attachments` | multipart `file` | 201 `AiAttachmentDTO` |
| GET / DELETE | `/ai/conversations/[conversationId]/attachments/[attachmentId]` | — | arquivo (inline; `?download=1`) / remove anexo ainda não enviado |
| GET | `/ai/actions?status=&conversationId=` | — | `AiPendingActionDTO[]` (do usuário) |
| POST | `/ai/actions/[actionId]/confirm` | `ConfirmAiPendingActionSchema` | `AiPendingActionDTO` (`EXECUTED` ou `FAILED`) |
| POST | `/ai/actions/[actionId]/cancel` | — | `AiPendingActionDTO` |

Tipos: `types/steel-ai.d.ts`. Schemas: `src/schemas/steel-ai.schema.ts`. Contrato de ferramenta: `src/lib/ai/tools/types.ts`. Uso de IA vai no razão `AiUsage` com `feature = STEEL_ASSISTANT` (agentes: `STEEL_AGENT`), modelo pela configuração `crmAssistantModel` (rótulo "Steel AI") ou preferência do usuário.

## Fatias (onda 2) — quem é dono de quê

| Fatia | Dono de |
|---|---|
| **ai-core** | `src/lib/ai/{types,anthropic-provider,openai-provider}.ts` (streaming), `src/lib/ai/tools/registry.ts` + `platform.ts`, `src/lib/ai/steel-ai-prompt.ts`, repositories/mappers/services `ai-conversation`, `ai-pending-action`, `ai-action-log`, `steel-ai-chat`, rotas `app/api/workspaces/[id]/ai/**`, OpenAPI dessas rotas, ajustes de IA (rótulo, preferência do usuário, interruptor do modo agente) |
| **ai-tools-crm** | `src/lib/ai/tools/crm.ts` (+ `crm/*`), remoção do widget e do assistente antigo do CRM (`crm-ai*.ts`, rotas `crm/ai/**`, `use-crm-ai.ts`, `types/crm-ai.d.ts`, montagem no layout) — tabelas `crm_ai_*` ficam |
| **ai-tools-sd** | `src/lib/ai/tools/servicedesk.ts` (+ `servicedesk/*`) |
| **ai-tools-zap** | `src/lib/ai/tools/whatsapp.ts` (+ `whatsapp/*`) |
| **ai-ui** | `app/(private)/[workspace-slug]/ai/**`, `app/_components/steel-ai/**`, `src/hooks/use-steel-ai.ts` (inclui o leitor do SSE), botão "Steel AI" na barra global, blocos reui |

## Steel Agents

Agentes autônomos que um admin configura em **Steel AI > Agentes** (`/[slug]/ai/agents`). Decisão: [ADR 0020](../adr/0020-steel-agents-owner-identity-and-approvals.md).

- **Configuração** (`SteelAgent`): nome, descrição, **instruções** (prompt do agente), **gatilho** (`SCHEDULE` com cron de 5 campos + fuso, `EVENT` com uma chave do catálogo, `MANUAL` só pelo botão "Executar agora"), **responsável** (o agente roda com as permissões dele), máximo de etapas (padrão 8, até 20), limite opcional de execuções por mês, ativo/pausado.
- **Ferramentas** (`SteelAgentTool`): qualquer ferramenta de `STEEL_AI_TOOLS` dos módulos habilitados. Leitura sempre roda; escrita é **Automática** (`AUTO`) ou **Requer aprovação** (`APPROVAL`, padrão). **Exclusão sempre requer aprovação** — travado no editor, no service e no runner.
- **Eventos** (`src/lib/steel-agents/events.ts`): `sd.ticket.created`, `crm.lead.created`, `zap.conversation.assigned`, `zap.ai.handoff`. O gancho é `dispatchSteelAgentEvent(workspaceId, eventKey, payload)`, chamado com `void` depois da escrita de negócio (nunca falha a operação). Escrita feita por agente não dispara agentes.
- **Execução** (`SteelAgentRun` + `SteelAgentRunStep`): fila `steel-agents`; `QUEUED → RUNNING → SUCCEEDED | FAILED | SKIPPED`, ou `WAITING_APPROVAL` quando alguma escrita pediu aprovação. A linha do tempo registra cada chamada ao modelo (`MODEL`), ferramenta (`TOOL`) e aprovação (`APPROVAL`). Tokens e custo ficam na execução e no razão `AiUsage` (`STEEL_AGENT`).
- **Aprovação**: notificação `AGENT_APPROVAL_REQUESTED` para o responsável e os admins, com link para a tela da execução (prévia antes → depois, Aprovar/Rejeitar, confirmação dupla para exclusão). Decide o responsável ou quem tem `steel-agents` EDIT; a ferramenta executa **como o responsável**. A aprovação vale 72 h; depois vira `EXPIRED`. Execução que falha avisa com `AGENT_RUN_FAILED`.
- **Não roda (SKIPPED)** quando: agente pausado, sem responsável, responsável fora do workspace, workspace suspenso, cota de IA esgotada, nenhum modelo disponível, limite mensal atingido, ou modo agente desligado com ferramentas de escrita.
- **RBAC**: recurso `steel-agents` — admin gerencia, membro e visualizador só leem. "Executar agora": responsável ou admin.

| Método | Rota (`/api/workspaces/[id]/agents/**`) | Resposta |
|---|---|---|
| GET / POST | `/agents` | `SteelAgentDTO[]` / 201 `SteelAgentDTO` (`CreateSteelAgentSchema`) |
| GET | `/agents/catalog` | `SteelAgentCatalogDTO` (ferramentas, eventos, modo agente, `canManage`) |
| GET / PATCH / DELETE | `/agents/[agentId]` | `SteelAgentDTO` (`UpdateSteelAgentSchema`; `tools` substitui a lista) |
| POST | `/agents/[agentId]/run` | 202 `SteelAgentRunDTO` |
| GET | `/agents/[agentId]/runs?limit=&status=` | `SteelAgentRunDTO[]` |
| GET | `/agents/[agentId]/runs/[runId]` | `SteelAgentRunDetailDTO` (passos, ações, `canApprove`) |
| POST | `/agents/runs/[runId]/actions/[actionId]/approve` | `AiPendingActionDTO` (`{ doubleConfirmed? }`) |
| POST | `/agents/runs/[runId]/actions/[actionId]/reject` | `AiPendingActionDTO` |

Tipos: `types/steel-agent.d.ts`. Schemas: `src/schemas/steel-agent.schema.ts`. Runner: `src/services/steel-agent-runner.ts`. Hooks: `src/hooks/use-steel-agents.ts`. Telas: `app/_components/steel-agents/**`.

## Steel AI 2 (07/10/2026) — modos, modelos, anexos, skills, uso, memória, busca, inbox

Decisões do product owner: modos **Ask** (`EXPLORE`), **Build** (`AGENT`, toda escrita confirma) e **Autopilot** (`AUTOPILOT`: executa tudo sozinho, inclusive exclusões e mensagens ao cliente, sempre registrado em `AiActionLog`; só disponível com `WorkspaceAiSettings.autopilotEnabled`, desligado por padrão). Memória automática e revisável, em duas camadas (workspace e pessoal). Skills = instruções reutilizáveis chamadas com `/` (ex.: `/my-work`), embutidas e personalizadas. Ajustes > Steel IA ganha os interruptores: IA, agentes, memória e Autopilot. Custo de IA sempre pelo preço real (ADR 0019).

Fundação (já na `main`): enum `AUTOPILOT`, colunas `aiEnabled/agentsEnabled/memoryEnabled/autopilotEnabled`, escopo em `AiUsage` (`module`, `conversationId`, `agentRunId`), modelos `AiAttachment`, `AiSkill`, `AiMemory`, códigos `AI_DISABLED`, `AI_AUTOPILOT_DISABLED`, `AI_ATTACHMENT_*`, `AI_SKILL_*`, `AI_MEMORY_*` e os pontos de extensão `src/lib/ai/context/{skills,memory}.ts` (inertes até a fatia de skills/memória).

| Fatia | Dono de |
|---|---|
| **ai-chat-2** | modos Ask/Build/Autopilot no runtime (`steel-ai-chat.service.ts`, registry, `ai-pending-action.service.ts`), seletor de modelo, anexos (upload, visão, extração de texto), gravação do escopo em `AiUsage`, chamada aos pontos de extensão, interruptor `aiEnabled`, composer/transcript em `app/_components/steel-ai/**` |
| **ai-usage** | abas da área Steel AI (Skills, Agentes, Uso, Análises, Memória) no layout `ai/layout.tsx`, páginas Uso e Análises + export CSV, interruptores em Ajustes > Steel IA, recálculo do mês corrente pelo preço real |
| **search** | índice de busca (Postgres FTS + trigram, sem `LIKE`), paleta Ctrl+K, ferramenta `ws_search` |
| **inbox-actions** | pendências da IA na inbox, ações rápidas da inbox, notificações do navegador, botão "Perguntar ao Steel AI" nos registros |
| **ai-skills-memory** (depois de ai-chat-2) | `src/lib/ai/context/**`, skills (embutidas + CRUD + `/` no composer), memória (ferramenta de salvar, injeção, aba Memória) |

### Inbox e "Perguntar ao Steel AI" (fatia inbox-actions)

- **Pendências da IA** na caixa de entrada (`/[slug]/inbox?view=ai`): ações pendentes do assistente do próprio usuário e aprovações de agentes que ele pode decidir, com prévia, origem, contagem regressiva e decisão inline (exclusão com confirmação dupla). Leitura: `GET /api/workspaces/[id]/notifications/ai-pending` (`InboxAiPendingService`); decisão pelas rotas do assistente e dos agentes. Aviso `AI_ACTION_EXPIRING` ~5 min antes de uma ação do assistente expirar (fila `notifications`, uma vez por ação).
- **"Perguntar ao Steel AI"** no menu "⋯" do chamado, nos painéis de lead, oportunidade, pessoa e empresa do CRM e no cabeçalho da conversa do WhatsApp (`app/_components/steel-ai-ask/`): abre um diálogo com a referência ao registro já escrita (ex.: "Sobre o chamado INC-000123 — título: "), cria uma conversa no modo Ask e entrega o texto pela `stashSteelAiPrompt`; o chat envia ao abrir. Sem pergunta, vai "faça um resumo do contexto e sugira os próximos passos."

### ai-chat-2 — o que foi entregue

- **Modos** (ADR [0021](../adr/0021-steel-ai-autopilot-mode.md)): `EXPLORE` = Ask, `AGENT` = Build, `AUTOPILOT` = Autopilot. No Autopilot a escrita executa na hora (`executeAutopilotWrite` em `ai-pending-action.service.ts`): a `AiPendingAction` nasce `EXECUTED` com `autoExecuted = true`, vai para `AiActionLog` (`ASSISTANT`, ator = usuário) e para a auditoria (`auto_execute`); o stream emite `action.executed`. Exige `agentModeEnabled` **e** `autopilotEnabled`; senão `AI_AGENT_MODE_DISABLED` / `AI_AUTOPILOT_DISABLED`.
- **Interruptor geral** `aiEnabled`: desligado, conversas, mensagens, anexos e ações respondem `AI_DISABLED`; `capabilities` responde com `aiEnabled: false` e a tela mostra o aviso. O runner dos Steel Agents pula (`SKIPPED`) com `aiEnabled` ou `agentsEnabled` desligado. O resto dos interruptores (tela de Ajustes) é da fatia ai-usage; aqui só se aplica.
- **Modelo por conversa**: `AiConversation.modelKey` (criar, `PATCH` ou `modelKey` na mensagem). Ordem da rodada: modelo pedido na mensagem → da conversa → preferência do usuário → padrão do workspace → primeiro habilitado. Modelo que ficou indisponível é pulado, mas a escolha continua salva na conversa. `capabilities.models` traz só os habilitados e com provedor configurado, com o preço cobrado (preço do provedor × margem, US$ por 1M tokens).
- **Anexos** (`AiAttachment`, bucket privado `steel-ai-attachments`, chave `<ws>/<conversa>/<id>-<nome>`, incluído em `WORKSPACE_BUCKETS` para expurgo/backup): imagens PNG/JPEG/WebP/GIF até 5 MB vão ao modelo como visão (base64 — o MinIO não é público; o adaptador Anthropic converte `data:` em fonte base64); documentos PDF/DOCX/TXT/CSV/Markdown até 10 MB têm o texto extraído no envio (PDF sem texto é recusado) e vão como blocos `<anexo>`: até 24 mil caracteres por documento e 60 mil por mensagem; em mensagens antigas reenviadas como histórico, só o nome das imagens e 2 mil caracteres de cada documento. Até 5 anexos por mensagem e 20 soltos por conversa. XLSX ficou de fora (não há parser nas dependências).
- **Escopo de uso**: `AiUsage.module` = módulo das ferramentas usadas no turno (nenhuma → `null`; misto → o com mais chamadas, empate para o usado primeiro), `conversationId` preenchido, `agentRunId` nulo no chat.
- **Pontos de extensão**: a cada turno, `resolveSkillInvocation` (skill invocada vira bloco no system prompt; a mensagem salva mantém o `/slug` digitado), `skillsCatalogForPrompt` e `memoryForPrompt` (anexados ao system prompt quando não vazios).
- **Tela**: seletor Ask | Build | Autopilot, seletor de modelo agrupado por provedor com preço, anexos por botão, colar e arrastar, miniaturas/chips no histórico e cartões compactos das escritas do Autopilot.

### ai-usage — o que foi entregue

- **Navegação**: a barra lateral do Steel AI (e, por ela, a gaveta do celular) lista **Skills · Agentes · Uso · Análises · Memória** acima do histórico (`app/_components/steel-ai/steel-ai-area-nav.tsx`). Skills e Memória são páginas "em breve" (`SteelAiComingSoon`) até a fatia ai-skills-memory trocar o `page.tsx` delas.
- **Relógio**: tudo em **UTC**, o mesmo da cota (`currentPeriodStart`): dia UTC, semana ISO (segunda 00:00 UTC a domingo) e mês UTC. A tela diz "UTC". Valores em US$ (custo real congelado em `AiUsage.costUsd`), formatados em pt-BR.
- **Uso** (`/[slug]/ai/usage`, qualquer membro, `GET /api/workspaces/[id]/ai/usage`): gasto acumulado do usuário e do espaço inteiro no mês e na semana, contra a cota. **Não há limite por pessoa**: o mês compara com a cota mensal do espaço (compartilhada) e a semana com a **parcela semanal = cota × 7 ÷ dias do mês corrente** (referência de ritmo, não bloqueia). **Tendência** [Semana | Mês]: gasto até agora contra o período anterior **no mesmo ponto** (variação %; sem base quando o anterior é zero) e projeção linear = média diária até hoje × dias do período; também a projeção do espaço contra a cota.
- **Análises** (`/[slug]/ai/analytics`, `GET .../ai/usage/analytics?scope=&period=&from=&to=`): totais, gasto por dia e quebras por modelo, recurso (`feature`, rótulos pt-BR em `src/lib/ai/usage-labels.ts`), escopo (`module`; linha sem módulo usa o módulo do recurso — WhatsApp → Comunicação, ServiceDesk → ServiceDesk, CRM antigo → CRM — e senão "Plataforma") e, só para OWNER/ADMIN no escopo `workspace`, por usuário (sem usuário = "Automações"). Períodos: este mês, mês passado, 7/30/90 dias, personalizado (até 366 dias).
- **CSV** (`GET .../ai/usage/export?...&view=rows|model|feature|module|user`): `rows` sai em páginas de 1.000 linhas (keyset `createdAt, id`) direto para o corpo da resposta; os agregados reaproveitam as quebras. UTF-8 com BOM, proteção contra fórmula (`'` antes de `= + - @`), auditado (`ai_usage` / `download`). `user` só no escopo `workspace`.
- **Ajustes > Steel IA**: card "Recursos do Steel AI" com **Ativar Steel AI**, **Ativar agentes**, **Ativar memória** e **Permitir Autopilot** (aviso de que executa escritas, inclusive exclusões e mensagens a clientes, sem confirmação), além do interruptor do modo agente. Só OWNER/ADMIN; a auditoria de `workspace_ai_settings` registra os valores e `changedSwitches`.
- **Recálculo do mês corrente** (migração de dados `20261007150000_ai_usage_recost_current_month`, roda no `migrate` do deploy): reprecifica só as linhas do **mês UTC corrente** cujo `cost_usd` ainda bate com a regra antiga (`(entrada + saída) / 1000 × usd_per_1k_tokens` do workspace, padrão 4), com os preços do catálogo congelados no SQL (sem cache: entrada cheia; modelo desconhecido = preço do Opus) × a margem da plataforma. Idempotente pela própria condição; outros meses e linhas já no preço real não mudam.

### ai-skills-memory — o que foi entregue

- **Skills** (`/[slug]/ai/skills`, `GET/POST .../ai/skills`, `PATCH/DELETE .../ai/skills/[skillId]`): embutidas definidas em código (`src/lib/ai/context/builtin-skills.ts`: `/my-work`, `/sla`, `/pipeline`, `/follow-ups`, `/inbox`, `/resumo-semana`) e mescladas na leitura com as do workspace e as pessoais. Embutida não tem linha no banco até ser desligada: a linha `AiSkill` com `builtIn = true` só guarda o `enabled` do workspace (o texto vem do código); o id exposto é `builtin:<comando>`, aceita só `{ enabled }` (OWNER/ADMIN) e nunca é excluída. Pessoal: qualquer membro (inclusive visualizador); workspace: OWNER/ADMIN. Comando de 1 a 40 caracteres (`a-z`, `0-9`, hífen interno), único no escopo e nunca igual ao de uma embutida (`AI_SKILL_SLUG_TAKEN`); ferramentas sugeridas precisam existir no registro. Exclusão é lógica.
- **No chat**: `/comando` no começo da mensagem aplica a skill (pessoal > workspace > embutida; desligada ou desconhecida = texto normal); as instruções vão ao system prompt com a dica de ferramentas, e a mensagem salva mantém o `/comando`. O catálogo (até 40 skills, uma por comando) vai ao prompt e o modelo pode carregar uma skill sozinho pela ferramenta de plataforma `steel_get_skill` — que também serve aos Steel Agents. No compositor, digitar `/` abre a lista de skills (↑↓, Enter/Tab, Esc); escolher uma com modo sugerido troca o modo quando ele está liberado. "Usar no chat" abre `/[slug]/ai?skill=<comando>` com o comando já escrito. O editor de agentes ganhou "Inserir skill", que copia as instruções para o prompt do agente.
- **Memória** (`/[slug]/ai/memory`, `GET .../ai/memories?q=`, `POST`, `PATCH/DELETE .../ai/memories/[memoryId]`): duas camadas (workspace e pessoal), busca, edição em linha, exclusão, inclusão manual, origem automática/manual e link da conversa (só para quem salvou). Decisão e regras de segurança: [ADR 0022](../adr/0022-steel-ai-memory-saved-without-confirmation.md) — `memory_save`/`memory_forget` executam sem confirmação, só com `memoryEnabled`, guarda contra credenciais/documentos/dados sensíveis, sem duplicados, workspace só para admin. No prompt: fatos mais recentes primeiro, até ~800 tokens, com `lastUsedAt`. No histórico, chip "Memória salva" com "Desfazer". Memória desligada: sem ferramenta e sem injeção; a aba avisa e continua permitindo revisar e apagar.
- **Contratos**: tipos `types/ai-skill.d.ts`, `types/ai-memory.d.ts` (e `AiToolCallDTO.memory`); schemas `src/schemas/ai-{skill,memory}.schema.ts`; services `AiSkillService`, `AiMemoryService`; hooks `src/hooks/use-ai-{skills,memory}.ts`; `AiToolContext.conversationId` (preenchido pelo chat) e `AiToolAccess.memoryEnabled`.

### Resumo semanal de consumo por e-mail

- **O quê**: toda segunda-feira às 08:00 (`America/Sao_Paulo`, fila `ai-usage-weekly-email`), cada dono (OWNER) do workspace recebe o consumo de IA da **semana UTC anterior** (segunda 00:00 a domingo, o mesmo relógio da cota e da aba Uso): gasto da semana em US$ (custo real, ADR 0019) e a variação contra a semana anterior; o mês da semana até o domingo dela contra a cota mensal (barra e %) e a projeção linear para o fim do mês, com aviso quando passa da cota (mês já fechado aparece como "fechado", sem projeção); os 3 modelos, 3 recursos e 3 módulos que mais gastaram e as 5 pessoas que mais usaram (as automações sem usuário ficam de fora); e, se houve atividade, execuções e ações dos Steel Agents na semana e aprovações pendentes. Botões para as abas Uso e Análises e link para desligar.
- **Números**: saem do razão `AiUsage` pelos mesmos mappers das abas Uso e Análises (`toAiUsageOverviewDTO`, `toAiUsageAnalyticsDTO`) — o e-mail nunca discorda das telas. Montagem em `src/mappers/ai-usage-weekly-email.mapper.ts`, envio em `AiUsageWeeklyEmailService`, modelo `components/emails/steel-ai/ai-usage-weekly.tsx` (aparece no `pnpm email`).
- **Quem recebe**: workspace `ACTIVE`, `aiEnabled` e o interruptor **"Resumo semanal de consumo por e-mail"** em Ajustes > Steel IA (`WorkspaceAiSettings.usageWeeklyEmailEnabled`, ligado por padrão, só OWNER/ADMIN alteram). Workspace sem gasto na semana e na anterior não recebe. Contas com exclusão agendada ficam de fora.
- **Uma vez só**: o tick enfileira um job por workspace com `jobId` `ai-usage-weekly-email-<workspace>-<segunda>` e cada dono tem uma marca no Redis (`ai:usage-weekly-email:<workspace>:<segunda>:<usuário>`, 14 dias) reservada antes do envio e liberada se o envio falhar; o job falha (e o BullMQ tenta de novo) só para quem não recebeu. Com o Redis fora do ar nada é enviado e o job tenta depois. `MAIL_DRY_RUN=true` não envia nada.


### ai-test-mode — modo Teste e "Testar agente"

Pedido do product owner (08/10/2026): "Steel AI modo teste > mostra o que faria sem modificar realmente". Decisão: [ADR 0023](../adr/0023-steel-ai-test-mode-simulates-writes-server-side.md).

- **Modo `TEST` ("Teste")**, quarto segmento do seletor (Ask | Build | Autopilot | Teste), disponível sempre que a IA está ligada — não depende do modo agente nem de interruptor de admin. Leituras rodam de verdade; **toda escrita** (`CREATE`, `UPDATE`, `DELETE`, `ACTION`, mensagens a clientes e `memory_save`/`memory_forget`) é simulada **no servidor** por `simulateWriteTool` (`src/lib/ai/tools/registry.ts`): `parse` → `preview` e para. `execute` nunca é chamado, não há `AiPendingAction`, nada é enviado. O modelo recebe `status: simulated` com a prévia (`src/lib/ai/tools/simulation.ts`) e segue o plano; o turno não para depois de uma escrita.
- **Contrato**: `tool.end` chega com `status: 'simulated'` e `simulation: { kind, preview }` (`AiSimulatedActionDTO`); o histórico relê isso da linha `TOOL`. `AiActionLog.outcome = 'simulated'` (não conta como executada). Tokens contam na cota normalmente.
- **Tela**: aviso "Modo Teste" acima do compositor; cada escrita vira um cartão tracejado "Simulado — Faria: …" com a prévia; no fim do turno, "Em modo teste: N ações simuladas, nada foi alterado" e **Executar de verdade em Build** (troca a conversa para Build e reenvia o último pedido; as escritas passam pela confirmação normal). Com o modo agente desligado, o botão dá lugar à explicação.
- **Steel Agents — "Testar agente"** (`POST /api/workspaces/[id]/agents/[agentId]/test`, 202 `SteelAgentRunDTO` com `isTest: true`): mesmo gate do "Executar agora" (responsável ou admin), funciona com o agente pausado e com o modo agente desligado. Ferramentas `AUTO` e `APPROVAL` são simuladas (passo `SIMULATED` com `output.simulation`); sem aprovação na inbox, sem aviso de falha. Não conta no limite mensal, não mexe em `lastRunAt`/`nextRunAt` e não aparece como `lastRun`. A tela da execução mostra o selo "Teste" e a seção "O que o agente faria".
- **Migração** `ai_test_mode_simulated_writes`: `AiConversationMode.TEST`, `SteelAgentRunStepStatus.SIMULATED`, `steel_agent_runs.is_test`.

### ai-admin-templates — modelos prontos para admins

Pedido do product owner (08/10/2026): "Steel AI com modelos prontos com foco nos admins". Galeria de **modelos de Steel Agents** e **modelos de skills** para OWNER/ADMIN.

- **No código, sem seed** (como as skills embutidas): `src/lib/ai/templates/{agent-templates,skill-templates}.ts`. Cada modelo tem id, nome, descrição de uma linha, categoria (ServiceDesk, Vendas, Comunicação, Governança, Gestão), módulos exigidos, instruções e ferramentas sugeridas; agentes trazem agenda (cron + `scheduleLabel` em pt-BR) e máximo de etapas, skills trazem comando e modo (Ask).
- **Regra das ferramentas**: leitura `AUTO`; toda escrita sugerida — e tudo que chega a cliente — vem `APPROVAL` (exclusão é sempre aprovação, ADR 0020). Os modelos de agente só **propõem** escritas (atribuir chamado, nota interna, tarefa no CRM, atribuir conversa); nenhum envia mensagem a cliente. Um teste unitário garante que toda ferramenta existe no registro, que os módulos são `ModuleKind` reais, que os cron são válidos e que cada modelo passa no schema de criação (`CreateSteelAgentSchema` / `CreateAiSkillSchema`).
- **Usar um modelo só preenche** o editor do agente (`/ai/agents/new?template=<id>`) ou o formulário "Nova skill" (escopo workspace). Nada é salvo até o admin criar; a criação passa pelas rotas de sempre (`POST .../agents`, `POST .../ai/skills`), que continuam validando RBAC, módulos, ferramentas e gatilho. O agente criado de modelo **começa pausado**, e a tela do agente abre com o aviso "Teste antes de ativar" e o botão **Testar agente** (modo Teste, ADR 0023). A skill criada é uma skill comum do workspace, editável.
- **Quem vê**: só OWNER/ADMIN (`GET /api/workspaces/[id]/ai/templates` → `AiTemplatesDTO`; os demais recebem `canUse: false` e listas vazias, e a tela esconde o botão "Modelos"). Modelo cujo módulo está desligado aparece desabilitado com o motivo ("Requer o módulo ServiceDesk habilitado."). Em modelo sem módulo exigido (ex.: resumo executivo), as ferramentas de módulos desligados saem da sugestão.
- **Duas ferramentas novas de plataforma (leitura)**, para os modelos de governança: `ws_ai_usage` (consumo de IA do workspace: mês e semana contra a cota, projeção e os modelos/recursos/módulos/pessoas que mais gastaram; permissão `settings` VIEW e escopo workspace do `AiUsageAnalyticsService`, ou seja, só OWNER/ADMIN) e `ws_invitations` (convites pendentes com validade; permissão `members` VIEW e `InvitationService.list`, só OWNER/ADMIN).
- **Tela**: botão "Modelos" no topo de **Agentes** e de **Skills**, mais a linha "Criar a partir de modelo" na lista (e no estado vazio dos agentes). A galeria agrupa por categoria, filtra por módulo (Todos, ServiceDesk, CRM, Comunicação, Plataforma) e mostra em cada cartão os módulos, a agenda ou o comando, o que o agente **faz sozinho** e o que **pede aprovação**; skill cujo comando já existe aparece como "Já adicionada".

| Modelos de agente | Módulo | Agenda | Escritas (todas com aprovação) |
|---|---|---|---|
| Chamados sem responsável | ServiceDesk | dias úteis, de hora em hora (8h–18h) | atribuir chamado |
| SLA em risco | ServiceDesk | dias úteis, a cada 30 min (8h–18h) | nota interna |
| Fila parada por técnico | ServiceDesk | dias úteis às 9h | — |
| Oportunidades paradas no funil | CRM | segundas às 8h | tarefa no CRM |
| Propostas vencendo | CRM | dias úteis às 8h | tarefa no CRM |
| Conversas sem resposta | Comunicação | dias úteis, de hora em hora (8h–18h) | atribuir conversa |
| Conexões do WhatsApp desconectadas | Comunicação | a cada hora | — |
| Consumo de IA acima do ritmo | plataforma | todo dia às 9h | — |
| Auditoria semanal de acessos | plataforma | segundas às 9h | — |
| Resumo executivo semanal | plataforma (usa os módulos habilitados) | segundas às 7h | — |

Modelos de skill: `/saude-workspace`, `/membros`, `/consumo-ia`, `/auditoria`, `/sla-equipe`, `/fila-equipe`, `/pipeline-time`, `/atendimento-whatsapp` (nenhum colide com as embutidas).

O resultado de um agente de relatório fica no resumo da execução, na tela do agente. Contratos: `types/ai-template.d.ts`, `AiTemplateService` (`src/services/ai-template.service.ts`), mapper `src/mappers/ai-template.mapper.ts`, hook `src/hooks/use-ai-templates.ts`, telas `app/_components/steel-ai-templates/**`.

## Busca de conhecimento — `steel_search` (frente 1, 18/10/2026)

Decisão: [ADR 0037](../adr/0037-unified-knowledge-search-hybrid-pgvector.md).
Operação: [runbook do pgvector](../runbooks/postgres-pgvector.md).

- **O que busca**: artigos publicados da base de conhecimento, páginas da
  Wiki, chamados resolvidos com solução, documentos da IA do WhatsApp, notas
  e propostas do CRM. Catálogo em `src/lib/ai/knowledge/sources.ts`.
- **Como**: texto em português (`ai_knowledge_chunks.search_vector`, OR dos
  termos) + similaridade de embeddings (`ai_vector.ai_knowledge_embeddings`,
  pgvector HNSW), fundidos por RRF; uma entrada por fonte. Sem pgvector, sem
  chave da OpenAI, com a chave desligada no admin ou com a cota esgotada:
  só texto (`mode: "text"`).
- **Permissões**: as de cada service (módulo, RBAC `VIEW`, Wiki ligada,
  documentos do WhatsApp só OWNER/ADMIN, solicitante do ServiceDesk só vê
  artigos do portal e os próprios chamados), aplicadas no SQL.
- **Ferramenta** `steel_search` (READ, plataforma) em
  `src/lib/ai/tools/knowledge.ts`: assistente, Steel Agents e MCP. O
  resultado traz `ref`, `source`, `title`, `snippet`, `href`; o prompt manda
  citar com link. O chat mostra as fontes em **Fontes**
  (`app/_components/steel-ai/steel-ai-citations.tsx`,
  `AiToolCallDTO.citations`).
- **API**: `GET /api/workspaces/[id]/ai/knowledge/search?q=&sources=&limit=`
  → `AiKnowledgeSearchResponseDTO` (`types/ai-knowledge.d.ts`).
- **Indexação**: fila `ai-index` (`refresh` com debounce de 30 s por fonte,
  `reindex-workspace`, `reindex-all` às 02:45); ganchos em
  `src/lib/ai/knowledge/index-hooks.ts`; backfill `pnpm ai:index
  [workspace]`. Exclusão apaga os trechos na hora; Steel AI desligado apaga o
  índice do workspace.
- **Custo**: embeddings `text-embedding-3-small` no razão `AiUsage` como
  `KNOWLEDGE_SEARCH` (preço × margem, conta na cota).

## Avaliação e feedback (frente 2, 18/10/2026)

Decisão: [ADR 0039](../adr/0039-steel-ai-feedback-and-evals.md).

- **Feedback** (`AiFeedback`, `POST/GET .../ai/feedback`, `DELETE .../ai/feedback/[feedbackId]`): 👍/👎 com motivo opcional (`incorrect`, `incomplete`, `irrelevant`, `tone`, `unsafe`, `other`, só no 👎) e comentário (até 1.000 caracteres). Uma linha por usuário, superfície, alvo e variação; avaliar de novo substitui. Superfícies e alvos: `STEEL_AI_MESSAGE` (mensagem do assistente, só o dono da conversa), `STEEL_AGENT_RUN` (execução; `steel-agents` VIEW), `SD_COPILOT` (chamado + variação `summary | reply | solution | classification | chat:<n>`; agente do ServiceDesk), `SD_TRIAGE` (chamado com `aiTriage`), `SD_KCS_DRAFT` (artigo com `sourceTicketId`), `WHATSAPP_AUTO_REPLY` (mensagem `sentByAi`, com a visibilidade da conversa por equipe). O servidor grava o modelo da resposta (da mensagem, da execução ou do `aiTriage`; senão o configurado para a funcionalidade). Componente: `app/_components/steel-ai-quality/ai-feedback-buttons.tsx` (`AiFeedbackButtons` com o valor já carregado em lote, `AiFeedbackControl` que carrega sozinho); hook `src/hooks/use-ai-feedback.ts`.
- **LGPD e auditoria**: a linha cai com o usuário e com o workspace (cascade). `auditMutation` com entidade `ai_feedback` (`create`/`update`/`delete`), sem o texto do comentário.
- **Painel Qualidade** (`/[slug]/ai/analytics`, aba Qualidade; `GET .../ai/quality?scope=&period=`, `GET .../ai/quality/export?...&view=feedback|surface|model`): aprovação total, por dia (UTC), por superfície e por modelo; 👎 mais recentes com link (conversa do chat só para o dono). No escopo `workspace` (OWNER/ADMIN): quem avaliou, **resolução sem humano** (WhatsApp: conversas `CLOSED` no período com mensagem da IA e nenhuma saída que não seja da IA; ServiceDesk: `SdAiConversation` `PRE_SERVICE` criadas no período com `outcome = resolved_by_kb`) e **custo por resolução** (custo `WHATSAPP_REPLY` / `SERVICEDESK_PRE_SERVICE` do razão ÷ resoluções). CSV auditado (`ai_quality` / `download`).
- **Conjuntos de teste** (`AiEvalSet`, `AiEvalCase`, `AiEvalRun`, `AiEvalResult`; `/[slug]/ai/evals`; rotas `.../ai/evals/**`): só OWNER/ADMIN. Alvo `STEEL_ASSISTANT` (prompt do Steel AI no modo explorar, sem ferramentas, skill opcional) ou `WHATSAPP_REPLY` (`buildWhatsAppAiReplySystem`: prompt + marcador de transbordo + documentos). Caso = pergunta + esperada/critério/"deve conter"/"não pode conter". Até 20 conjuntos e 50 casos. "Salvar como caso de teste" no chat (`POST .../ai/evals/cases/from-message`).
- **Execução**: `POST .../ai/evals/[setId]/runs` cria `QUEUED` e enfileira `ai-eval` (`run`, uma tentativa, `jobId = ai-eval-<runId>`); uma por conjunto por vez (`AI_EVAL_RUN_IN_PROGRESS`). O worker (`executeAiEvalRun`, `src/services/ai-eval-runner.ts`) reconfere a cota a cada caso, responde, aplica as verificações (`src/lib/ai/eval-grading.ts`), chama o juiz (modelo do assistente do workspace, JSON estruturado) e fecha `DONE`/`FAILED`. Passa: verificações ok e nota ≥ 0,7. Consumo no razão como `AI_EVAL`. Rascunho testável: `modelKey`, `skillId`, `promptOverride` (só WhatsApp), com `reason`.
- **"Rodar avaliação antes de trocar"** (`AiEvalGuard`, `app/_components/steel-ai-evals/ai-eval-guard.tsx`; `GET .../ai/evals/latest?target=`): em Ajustes › Steel IA (modelo do Steel AI e da resposta do WhatsApp), em WhatsApp › Configurações › IA (prompt) e no formulário de skill. Some para quem não é admin.
