# Procedimentos com passos obrigatórios (A5)

Roteiro em linguagem natural com condições e passos obrigatórios, executado
pela resposta automática do WhatsApp e disponível para os Steel Agents. O motor
**determinístico** decide a ordem; o modelo não pula nem reordena passos.

## Peças

| Camada | Arquivo |
| --- | --- |
| Schema (Zod) | `src/schemas/ai-procedure.schema.ts` |
| Motor puro | `src/lib/ai/procedures/{engine,validate,prompt,types}.ts` |
| Repositórios | `src/repositories/ai-procedure{,-run}.repository.ts` |
| Serviço (CRUD, versões, histórico) | `src/services/ai-procedure.service.ts` |
| Execução | `src/services/ai-procedure-runtime.service.ts` |
| API | `app/api/workspaces/[id]/ai-procedures/**` |
| UI | `app/(private)/[workspace-slug]/ai/procedures/**`, `app/_components/ai-procedures/**` |
| Tabelas | `ai_procedures`, `ai_procedure_versions`, `ai_procedure_runs`, `ai_procedure_run_steps` |

## Como a ordem é garantida

1. O prompt mostra à IA só o passo atual e as ferramentas desse passo
   (`procedimento_iniciar`, `procedimento_registrar`, `procedimento_transferir`).
2. `procedimento_registrar` só aceita a variável do passo `COLLECT` atual e
   valida o valor (`checkAnswer`, o mesmo do chatbot). Outra variável vira um
   passo `REJECTED` no rastro e nada muda.
3. Passos `HTTP`, `TOOL` e `MESSAGE` com texto fixo rodam no servidor, em
   `settle`, sem o modelo. Só `COLLECT` e `MESSAGE` com instrução param para o
   cliente ou para o modelo.
4. Passo obrigatório que falha (HTTP, ferramenta, tentativas esgotadas) encerra
   a execução como `FAILED` e a conversa vai para um humano
   (`handoffMessage` ou a frase padrão). Passo opcional é dispensado.
5. As mensagens fixas são enviadas pelo sistema, não pelo modelo: o texto do
   modelo é descartado quando o procedimento termina no mesmo turno.

## Estado e versões

- Uma execução `RUNNING` por conversa (`subject_type` + `subject_id`); o estado
  (`variables` + progresso por passo) fica em `ai_procedure_runs.state`. Sem
  atividade por 24 h a execução é cancelada.
- A execução guarda o `version_number` com que começou. Editar o procedimento
  cria uma versão nova (snapshot imutável); **restaurar** cria outra versão a
  partir de uma antiga. Decisão: a trava por conjunto de avaliação e o teste A/B
  do A2 **não** foram replicados, porque o procedimento é determinístico e é
  testado pelas simulações A3 do agente ao qual está vinculado.

## Rastro (A4)

- Em execuções de agente, cada evento vira um passo `PROCEDURE` em
  `steel_agent_run_steps` e aparece na linha do tempo da execução.
- Na WhatsApp, os passos ficam em `ai_procedure_run_steps` e são abertos na aba
  **Execuções** do procedimento, com o mesmo componente da linha do tempo.

## Cota

Os tokens do modelo entram na cota mensal de IA do workspace pelo mesmo
caminho de antes (`WHATSAPP_REPLY` ou `STEEL_AGENT`). A contagem de execuções
do mês aparece na lista de procedimentos. Limites: 50 procedimentos por
workspace e 30 passos por procedimento.

## Permissões

Reaproveita o recurso RBAC `steel-agents`: membros e visualizadores leem,
administradores criam/editam/excluem. Passos `TOOL` só aceitam ferramentas de
**leitura** e rodam com as permissões do responsável (`owner_id`, o criador por
padrão). Passos `HTTP` usam o mesmo guarda SSRF do chatbot (HTTPS público, sem
redirecionamento, 8 s).

## Fora do escopo desta entrega

- Envio de arquivos/PDF como passo (só texto).
- Chamar outro procedimento a partir de um passo (A7).
- Edição visual em grafo; o editor é uma lista ordenada com condições.
- Executar procedimentos nos canais Instagram/Messenger (Z5).
