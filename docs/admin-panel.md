# Painel admin global (`/admin`)

Painel da equipe Stratus para operar a plataforma inteira. Acesso só para
**admin global**: flag `users.is_platform_admin` **e** e-mail
`@stratustelecom.com.br` (`assertPlatformAdmin`, `src/services/authz.ts`).
Quem não passa recebe 404 nas páginas e 403 na API. Toda autorização é
checada no service, não só na UI.

## Navegação

| Página | O que tem |
| ------ | --------- |
| **Visão geral** `/admin` | totais (workspaces ativos/suspensos/em trial, usuários, MRR, jobs com falha), operações em andamento, status de cada componente (última coleta do `/status`), contadores das filas BullMQ, cadastros recentes, ações recentes do admin, últimos backups |
| **Workspaces** `/admin/workspaces` | lista com status, plano, membros, ID; busca (nome/slug/id, sem acento) e filtro por status |
| **Detalhe** `/admin/workspaces/[id]` | ciclo de vida (suspender/reativar, plano, excluir), módulos, funcionalidades, membros e perfis, backups do workspace, histórico do admin |
| **Métricas** `/admin/metrics` | ver [métricas da plataforma](./admin-metrics.md) |
| **Backups** `/admin/backups` | backups completos e por workspace, disparo manual, download, restauração, progresso de exclusões/restaurações |
| **Changelog** `/admin/changelog` | e-mails de novidades |
| **Analytics** `/admin/analytics` | tráfego, rotas, erros, acessos (país/cidade) e filas a partir dos logs no Axiom — ver [analytics](./admin-analytics.md) |

A casca (`app/(private)/admin/layout.tsx`) usa barra lateral em telas ≥ md e
uma faixa de navegação rolável abaixo disso. Os primitivos visuais ficam em
`app/_components/admin/shell/` (`AdminPage`/`AdminPageHeader` com
breadcrumbs, `AdminPanel`, `StatTile`, `StatusPill`, `MonoId`, estados
vazio/erro/carregando, `DENSE_TABLE`). Tabelas rolam dentro do próprio
container; nomes/e-mails/slugs longos truncam com o valor completo no
`title`.

## Ciclo de vida de um workspace

`workspaces.status`: `ACTIVE` · `SUSPENDED` · `DELETING`.

### Suspender / reativar

- Motivo obrigatório (5–500 caracteres), gravado na auditoria e no
  workspace (`suspended_reason`, `suspended_at`, `suspended_by_id`).
- **Bloqueio central:** `assertMember` (usado por todos os services de
  workspace/módulo) responde `WORKSPACE_SUSPENDED` (403) para membros de um
  workspace que não está `ACTIVE`; não-membros continuam recebendo
  `FORBIDDEN`, sem saber que o workspace existe. Rotas públicas (formulários,
  propostas, webhooks) também fecham: o módulo é considerado
  desligado (`WorkspaceModuleAccessRepository.isEnabled`).
- **UI:** o layout `[workspace-slug]` troca o app por uma tela de bloqueio
  (`WorkspaceBlockedScreen`), com atalhos para os outros workspaces do
  usuário. O motivo interno não aparece para o cliente.
- Limitação: jobs do worker já agendados (campanhas, transmissões,
  workflows) não checam o status; mensagens recebidas pelo webhook do
  WhatsApp continuam sendo gravadas.

### Trocar plano

`PATCH /api/admin/workspaces/[id]/plan` muda `active_plan` na hora, zera o
trial (para o job de fim de trial não desfazer) e invalida os caches de
workspace e feature flags. É para contratos fora do AbacatePay (ex.:
ENTERPRISE negociado): a assinatura no provedor não muda. **Assentos não são
editáveis à parte** — o limite vem do plano (`limitOf(plan, 'seats')`).

### Excluir definitivamente

1. O admin digita o **slug** e o motivo. A API
   (`POST /api/admin/workspaces/[id]/deletion`, 202) cria uma
   `admin_operations` (`WORKSPACE_DELETE`), marca o workspace `DELETING` (os
   membros são bloqueados na hora) e enfileira `delete-workspace` na fila
   `database-backup`, com `attempts: 1`.
2. O worker faz o **backup do workspace** (mesmo passo do job
   `run-workspace-backup`). Só com o backup `COMPLETED` segue.
3. **Cancela as assinaturas** `PAID` e `PENDING` do workspace no AbacatePay
   (`POST /subscriptions/cancel` com o `bill_id`,
   `SubscriptionService.cancelWorkspaceSubscriptions`). Cada tentativa gera
   `auditMutation` (`subscription`/`cancel`, sucesso ou falha). Tem que ser
   antes do purge: `subscriptions` cai por cascata junto com o workspace e o
   `bill_id` se perderia.
4. Apaga as linhas (uma transação; oportunidades primeiro, o resto por
   cascata) e depois os **arquivos no MinIO** (`src/lib/storage/workspace-files.ts`:
   buckets com prefixo `<workspaceId>/` — inclusive as mídias de landing
   page (editor removido, ADR 0068)/proposta enviadas a partir de 19/09/2026 — + anexos da IA do CRM).
5. Registra `workspace.deleted` em `admin_audit_logs` (sem FK: sobrevive ao
   workspace) e no Axiom.

Falha antes do passo 4 devolve o workspace ao status anterior e nada é
apagado. Falha ao apagar arquivos não desfaz o banco: fica em
`filesError` para limpeza manual. O progresso (passo, erro, backup gerado)
aparece no detalhe do workspace e em `/admin/backups`.

- **Assinaturas — política:** se o AbacatePay recusar (ou não responder)
  o cancelamento de **qualquer** assinatura, a exclusão é **barrada**: a
  operação fica `FAILED` com o erro (“Exclusão barrada: … Nada foi
  apagado”), o workspace volta ao status anterior e nada é apagado. As que
  já cancelaram continuam canceladas (não tem volta no provedor). O admin
  pode repetir o pedido ou marcar **“Seguir mesmo se o cancelamento da
  assinatura falhar”** (`ignoreSubscriptionCancelFailure: true`): aí a
  exclusão segue e as assinaturas recusadas ficam em `subscriptionsToCancel`
  (“Exclusão forçada: … Cancele à mão”, em vermelho no progresso), em
  `admin_audit_logs` (`subscriptionCancelForced: true`) e no log
  `queue.admin_operation.subscription_cancel_forced` — o cancelamento no
  painel do AbacatePay passa a ser manual. As canceladas automaticamente
  aparecem em `subscriptionsCancelled`.
- **Rota do provedor:** `POST https://api.abacatepay.com/v2/subscriptions/cancel`
  ([doc](https://docs.abacatepay.com/pages/subscriptions/cancel)), definida
  num só lugar em `lib/abacatepay.ts`; `ABACATE_PAY_CANCEL_PATH` sobrescreve o
  caminho se o provedor mudar. Qualquer resposta não-2xx é falha — nunca
  vira “cancelado”. A chave precisa da permissão `SUBSCRIPTION:DELETE`.
- **Exclusão pelo OWNER** (`DELETE /api/workspaces/[id]`, sem UI hoje): também
  cancela antes de apagar e, em falha, responde `SUBSCRIPTION_CANCEL_FAILED`
  (502) sem apagar nada. Não tem *force*: o cliente fala com o suporte, que
  usa o override do painel.
- **Arquivos entram no backup** do workspace (a partir de 19/09/2026): o
  backup tirado no passo 2 leva as mídias e anexos, e restaurá-lo traz de
  volta linhas **e** arquivos. Mídias **antigas** de proposta
  (gravadas na raiz do bucket, sem o workspace na chave) entram no backup
  quando alguma seção as cita, mas **não são apagadas** na exclusão (a
  varredura depende das linhas, que já foram removidas) — ficam órfãs.

Runbook: [excluir um workspace](./runbooks/delete-workspace.md).

## Backups pelo painel

- **Listar:** status, tamanho, **arquivos** (quantidade e tamanho em claro
  dos arquivos do MinIO no backup de workspace; `—` em backup anterior à
  inclusão de arquivos, que é só de banco), onde está (MinIO local e/ou
  offsite — gravado quando o `copy-to-offsite` confirma), origem (painel ou
  cron/CLI) e se o workspace ainda existe. Aviso quando `BACKUP_OFFSITE_*`
  não está configurado.
- **Fazer backup agora:** completo (`pg_dump`) ou de um workspace. O worker
  processa um por vez.
- **Baixar:** `POST .../download-link` gera um link assinado (HMAC com
  `BETTER_AUTH_SECRET`, amarrado ao backup **e** ao admin, válido 5 min); o
  app transmite o arquivo do MinIO (que nunca é público). O arquivo vem
  **cifrado**; para abrir: `pnpm backup:decrypt <arquivo.enc> <saida>` com o
  mesmo `CONNECTION_SECRETS`. Trate a saída como dado pessoal. O download
  traz só o JSON das linhas; os arquivos do backup de workspace ficam no
  MinIO sob `workspace/<ws>/<backup>.files/` e voltam pelo restore.
- **Restaurar um workspace:** só backups `WORKSPACE` concluídos. Digita o
  slug + motivo; enfileira `restore-workspace`, que tira um **backup de
  segurança** do estado atual (se o workspace existe), restaura as linhas
  numa única transação (falhou → nada muda) e depois regrava os arquivos do
  manifesto no MinIO (só as chaves do backup; nada é apagado). Falha no
  passo de arquivos não desfaz as linhas: a operação conclui com
  `filesError` e os arquivos são reprocessados com
  `pnpm restore:workspace <id> --files-only`. O diálogo de confirmação diz
  quantos arquivos serão regravados, ou avisa que o backup é só de banco.
  Serve também para desfazer uma exclusão, desde que o slug não tenha sido
  reaproveitado. Um backup tirado durante a exclusão volta como `ACTIVE`.
- **Restore completo** (banco inteiro) continua só pelo
  [runbook](./runbooks/restore-backup.md): exige parar app e worker.

O backup de workspace inclui as tabelas com `workspace_id` **e** as tabelas
filhas que só chegam ao workspace por relação (estágios de pipeline, itens de
oportunidade, destinatários de transmissão...), listadas em
`src/lib/queue/workspace-snapshot.ts`. Um teste lê o `schema.prisma` e falha
se um modelo-filho novo ficar de fora.

Os **arquivos** do workspace vêm de `collectWorkspaceFileRefs`
(`src/lib/storage/workspace-files.ts`): os buckets prefixados por
`<workspaceId>/` (lista `WORKSPACE_BUCKETS` — bucket novo com dado de
workspace entra ali, com a flag `public`), os anexos da IA pela linha e,
best-effort, as mídias antigas de proposta citadas no conteúdo.
A cópia/restauração em si está em `src/lib/queue/workspace-file-archive.ts`
(um objeto por vez, cada um cifrado; manifesto com SHA-256). O que entra,
o que fica de fora e a limitação das mídias antigas estão no
[runbook de restore](./runbooks/restore-backup.md#restore-de-um-workspace).

## Auditoria

Toda ação do admin gera `auditMutation` (Axiom) **e** uma linha em
`admin_audit_logs` (`recordAdminAction`, `src/lib/admin-audit.ts`): quem, o
quê (`workspace.suspend`, `workspace.delete_requested`, `backup.download`,
`module.grant`, `feature.override`...), alvo, rótulo legível e motivo. É o
que aparece em “Ações recentes” e no histórico do workspace.

## API

| Método e rota | Uso |
| ------------- | --- |
| `GET /api/admin/overview` | dados da visão geral |
| `GET /api/admin/analytics?view=&range=&workspace=&route=&status=&env=` | uma aba do Analytics ([detalhes](./admin-analytics.md)) |
| `PATCH /api/admin/workspaces/[id]/status` | `{ action: 'suspend' \| 'reactivate', reason }` |
| `PATCH /api/admin/workspaces/[id]/plan` | `{ plan, reason }` |
| `POST /api/admin/workspaces/[id]/deletion` | `{ confirmSlug, reason, ignoreSubscriptionCancelFailure? }` → 202 + operação |
| `GET /api/admin/workspaces/[id]/audit` | histórico do admin no workspace |
| `GET /api/admin/operations[?workspaceId=]`, `GET /api/admin/operations/[id]` | progresso de exclusões/restaurações |
| `GET /api/admin/backups[?scope=&workspaceId=&limit=]` | lista + `offsiteConfigured` |
| `POST /api/admin/backups` | `{ scope: 'FULL' }` ou `{ scope: 'WORKSPACE', workspaceId }` → 202 |
| `POST /api/admin/backups/[id]/download-link` | link assinado (5 min) |
| `GET /api/admin/backups/[id]/download?exp=&sig=` | stream do arquivo cifrado |
| `POST /api/admin/backups/[id]/restore` | `{ confirmSlug, reason }` → 202 + operação |

Erros específicos: `WORKSPACE_SUSPENDED` (403), `WORKSPACE_STATUS_CONFLICT`
(409), `WORKSPACE_OPERATION_IN_PROGRESS` (409),
`WORKSPACE_CONFIRMATION_MISMATCH` (422), `BACKUP_NOT_FOUND` (404),
`BACKUP_NOT_RESTORABLE` (409), `BACKUP_DOWNLOAD_LINK_INVALID` (403),
`SUBSCRIPTION_CANCEL_FAILED` (502, exclusão pelo OWNER).
