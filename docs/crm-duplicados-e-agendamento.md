# Duplicados e mesclagem (CRM)

Entrega C7 da fatia `crm-ops` e as lacunas fechadas depois dela. Manual do usuário em `content/docs/crm/duplicados-e-mesclagem.mdx`. O agendamento público de reuniões (C5) foi removido; o motor de horários compartilhado ficou em `src/lib/scheduling` para o agendamento do WhatsApp (ADR 0059).

## C7 — duplicados e mesclagem

### Modelo

| Tabela | Papel |
| --- | --- |
| `crm_duplicate_candidates` | Um par por `entity` (`PERSON`/`COMPANY`) + `left_id` < `right_id` (único). `score`, `reasons`, `status` (`PENDING`/`MERGED`/`DISMISSED`), `notified_at` |
| `crm_merge_logs` | Uma mesclagem: sobrevivente, arquivado, quem fez, `snapshot` JSON (o que foi movido e os campos antes/depois) e `undo_until` (24 h) |

### Fluxo

- **Varredura diária**: fila `crm-duplicates`, job `run-scan` às 02:40 (`CrmDuplicatesCron`), processador `src/lib/queue/processors/crm-duplicates.ts` → `CrmDuplicateService.runScheduled()`. Percorre os workspaces com o módulo CRM ligado e `status = ACTIVE`; um workspace com falha não interrompe os outros (conta em `failed`).
- **Detecção** em `src/lib/crm-duplicates/detect.ts`: bloqueio por e-mail, telefone, nome e (empresas) CNPJ e domínio; nota mínima 60. Similaridade de nome ≥ 0,9, ou ≥ 0,82 para pessoas da mesma empresa. A varredura lê até 30.000 registros por workspace.
- **Na chegada** (`flagOnArrival`): formulário, fluxo do WhatsApp e cadastro manual chamam o serviço sem esperar (`void`); a vizinhança do registro (mesmo e-mail/telefone ou mesma primeira palavra do nome) é comparada e os pares novos entram na fila. Falha nunca bloqueia a gravação.
- **Notificação**: no máximo uma por dia, por entidade, para o dono e administradores (`CRM_DUPLICATES_FOUND`, `dedupeKey` com a data).
- **Mesclar** exige o recurso `people`/`companies` com a ação `DELETE` (dono e administradores). Descartar e procurar exigem `EDIT`. Ver a fila exige `VIEW`.

### Mesclagem e desfazer

`executeMerge` roda numa transação (timeout de 60 s): arquiva o perdedor (`deleted_at`; numa empresa, também zera `cnpj`/`domain` para liberar a unicidade), grava no sobrevivente só o que mudou (plano em `src/lib/crm-duplicates/merge-plan.ts`: o sobrevivente mantém o que tem, preenche o que está vazio e une e-mails e telefones), re-aponta as linhas filhas listadas em `PERSON_MOVES`/`COMPANY_MOVES` e os valores de campos customizados, descarta os outros pares do perdedor e registra a atividade `MERGED`.

`undoMerge` (janela de 24 h, uma única vez): devolve as colunas do sobrevivente **só se ninguém as editou depois** (compara o valor atual com `survivorAfter`), restaura o perdedor (e o CNPJ/domínio), devolve cada linha filha **só se ainda apontar para o sobrevivente**, reabre o par como `PENDING` e registra `MERGE_UNDONE`. Se o sobrevivente foi excluído, recusa (`CRM_DUPLICATE_INVALID`).

Códigos de erro: `CRM_DUPLICATE_NOT_FOUND`, `CRM_DUPLICATE_INVALID`, `CRM_MERGE_NOT_FOUND`, `CRM_MERGE_UNDO_EXPIRED`.

## Testes

- Unitários: serviço `crm-duplicate`, mapeador, schema e o processador da varredura (`src/lib/__tests__/crm-duplicates-processor.test.ts`).
- Integração (Postgres real): `crm-duplicate.repository.test.ts` (mesclar e desfazer, pessoas e empresas, janela, edição posterior).
- E2E (rodam só na CI): `app/api/workspaces/[id]/crm/duplicates/__tests__`.
