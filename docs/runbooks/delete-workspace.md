# Excluir um workspace

**Quando usar:** cliente encerrou o contrato, pediu a exclusão dos dados
(LGPD) ou o workspace foi criado por engano.

> A exclusão é **definitiva**. O único caminho de volta é restaurar o backup
> que o próprio processo gera — ele inclui as linhas **e** os arquivos do
> MinIO (mídias do WhatsApp, anexos, capas, imagens de site/proposta; veja o que fica de fora em
> [restaurar um backup](./restore-backup.md#restore-de-um-workspace)). Se o
> cliente só está inadimplente, **suspenda** em vez de excluir.

## Pelo painel (caminho normal)

1. Entre em `https://<domínio>/admin/workspaces`, abra o workspace e confira
   nome, slug e ID.
2. Em **Ciclo de vida → Excluir workspace**, escreva o motivo (fica na
   auditoria) e digite o **slug** exatamente. Deixe **desmarcado** “Seguir
   mesmo se o cancelamento da assinatura falhar” — ele só serve para a
   segunda tentativa descrita em [Se falhar](#se-falhar).
3. Acompanhe o progresso no próprio detalhe (ou em `/admin/backups`):
   `Na fila do worker` → `Fazendo backup do workspace` → `Cancelando
   assinaturas no AbacatePay` → `Apagando dados` → `Apagando arquivos` →
   `Concluída`. Os membros já ficam bloqueados desde o
   passo 1.
4. Ao concluir:
   - Anote o **ID do backup** mostrado na operação (retenção de 90 dias).
   - **“Assinaturas canceladas no AbacatePay”** lista o que o Steel
     cancelou sozinho — não precisa fazer nada.
   - Se aparecer **“Exclusão forçada: … Cancele à mão”** (só acontece se você
     marcou a opção de forçar), cancele essas assinaturas (`bill_...`) no
     painel do AbacatePay **no mesmo dia** — o cliente continua sendo cobrado
     até isso.
   - Se aparecer **“Arquivos não apagados por completo”**, veja
     [limpeza manual de arquivos](#limpeza-manual-de-arquivos).

## Pelo próprio dono (Ajustes > Geral)

O **OWNER** do workspace também pode pedir a exclusão, sem passar pelo time:
`/<slug>/settings` → **Excluir este workspace** → digita o **slug** no
diálogo. ADMIN e demais papéis não veem o botão (a API responde `403`).

- É o **mesmo pipeline** do painel (`queueWorkspaceDeletion` em
  `src/services/workspace-deletion.ts`): cria a operação `WORKSPACE_DELETE`,
  marca o workspace `DELETING` (membros bloqueados na hora) e o worker faz
  backup → cancela assinaturas → apaga dados → apaga arquivos. A operação
  aparece em `/admin/backups` e na linha do tempo do workspace no admin
  (`workspace.delete_requested`, motivo “Exclusão solicitada pelo dono do
  workspace em Ajustes > Geral”).
- O dono **nunca força** o cancelamento de assinatura: se o AbacatePay
  recusar, a operação falha, nada é apagado e o workspace volta a `ACTIVE`.
  O dono só percebe porque o workspace volta a abrir — confira a operação em
  `/admin/backups` e siga [Se falhar](#se-falhar).
- API: `DELETE /api/workspaces/{id}` com `{ "confirmation": "<slug>" }`,
  resposta `202` com o `operationId`.
- O texto da tela diz “Depois de excluído, você não poderá restaurá-lo”: o
  dono não tem como desfazer pelo app, mas o backup da operação (e os
  backups FULL diários) seguem existindo pela retenção de 90 dias. Se o dono
  se arrepender e pedir, o caminho é [Desfazer](#desfazer-restaurar-o-workspace-excluído)
  — decisão do produto (08/10/2026), não automática.

### Se falhar

| Passo onde parou | O que aconteceu | O que fazer |
| ---------------- | --------------- | ----------- |
| Na fila / backup | nada foi apagado; o workspace voltou ao status anterior | veja o erro na operação e os logs do worker (`queue.admin_operation.workspace_delete_failed`); resolva (MinIO fora? [health check](./health-check.md)) e peça a exclusão de novo |
| Cancelando assinaturas | o AbacatePay recusou/não respondeu (erro “Exclusão barrada: …” com o `bill_...` e a mensagem do provedor); nada foi apagado, o workspace voltou ao status anterior. As que cancelaram continuam canceladas | veja o [status do componente pagamento](./health-check.md) e tente de novo em alguns minutos. Se a assinatura já não existe/já foi cancelada no painel do AbacatePay, confira lá e peça a exclusão de novo marcando **“Seguir mesmo se o cancelamento da assinatura falhar”** — e cancele à mão o que sobrar listado |
| Apagando dados | a transação desfez tudo; o workspace voltou ao status anterior | idem; se repetir, acione o engenheiro com o erro |
| Apagando arquivos | **dados já apagados**; operação `Concluída` com aviso | [limpeza manual de arquivos](#limpeza-manual-de-arquivos) |

Operação parada em “Na fila” por muito tempo = worker parado:
[reinicie o `steel-worker`](./restart-service.md). A operação continua de onde
estava (backup já concluído é reaproveitado).

## Limpeza manual de arquivos

Os arquivos de um workspace ficam no MinIO sob o prefixo `<workspaceId>/`
nos buckets `projects-covers`, `crm-landing-page-images`,
`crm-landing-page-videos`, `crm-proposal-images`, `crm-scheduled-posts`,
`crm-social-publish-tmp`, `whatsapp-media`, `whatsapp-ai-knowledge`,
`servicedesk`, `steel-ai-attachments`, `workspace-logos` e `crm-email-images` (lista
em `src/lib/storage/workspace-files.ts`). Pelo console do MinIO
(`http://127.0.0.1:9003`, via túnel SSH) ou com o `mc` (imagem
`pgsty/mc`, o cliente do fork Silo — a `minio/mc` saiu do ar junto com a
distribuição pública do MinIO):

```bash
docker run --rm --network steel_default --entrypoint sh pgsty/mc -c \
  'mc alias set s http://steel-minio:9000 "$MINIO_USER" "$MINIO_PASSWORD" && \
   for b in projects-covers crm-landing-page-images crm-landing-page-videos crm-proposal-images crm-scheduled-posts crm-social-publish-tmp whatsapp-media whatsapp-ai-knowledge servicedesk steel-ai-attachments workspace-logos crm-email-images; do \
     mc rm --recursive --force "s/$b/<workspaceId>/"; done'
```

Imagens de proposta enviadas **antes de 19/09/2026**
ficam na raiz desses buckets, sem o workspace na chave, e não são apagados
pela exclusão (ficam órfãos).

(`MINIO_USER`/`MINIO_PASSWORD` do `.env`.) Anexos do assistente de IA
(`crm-ai-attachments`) usam o ID da conversa, não do workspace — a operação
já os apaga pela lista gravada antes do purge.

## Desfazer (restaurar o workspace excluído)

Em `/admin/backups`, filtre **Por workspace**, ache o backup (marcado
“excluído”) e use **Restaurar** digitando o slug. Funciona enquanto o slug
não tiver sido usado por outro workspace e os usuários-membros ainda
existirem. Detalhes em [restaurar um backup](./restore-backup.md#restore-de-um-workspace).
