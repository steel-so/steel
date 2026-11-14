# Restaurar um backup

**Quando usar:** perda ou corrupção de dados, exclusão acidental, migração
que estragou dados, ou perda do servidor.

> Restaurar um backup FULL **substitui o banco inteiro** pelo estado da hora
> do backup: tudo o que aconteceu depois é perdido. Se o problema é de um só
> workspace, prefira o [restore de workspace](#restore-de-um-workspace).
> Na dúvida, **restaure primeiro num banco descartável** (`--target`) e confira.

## Como os backups funcionam

| Tipo | Quando | Onde fica | Retenção |
| ---- | ------ | --------- | -------- |
| FULL (`pg_dump --format=custom` do banco todo) | todo dia **03:15** (Brasília), pelo `steel-worker` | MinIO local, bucket `database-backups`, chave `full/<backupId>.dump.enc` | 90 dias (limpeza 03:30) |
| Cópia **offsite** do FULL | logo após cada FULL (job `copy-to-offsite`) | storage S3 externo (`BACKUP_OFFSITE_BUCKET`), chave `<prefixo>full/<backupId>.dump.enc` | `BACKUP_OFFSITE_RETENTION_DAYS` (padrão 90) |
| WORKSPACE (JSON das linhas **+ arquivos do MinIO** de um workspace) | sob demanda (painel `/admin/backups`, `pnpm backup:workspace`) e automaticamente antes de excluir/restaurar um workspace pelo painel | MinIO local: linhas em `workspace/<workspaceId>/<backupId>.json.enc`; arquivos em `workspace/<workspaceId>/<backupId>.files/` (`<n>.enc` + `manifest.json.enc`) | 90 dias (o prune apaga linhas e arquivos juntos) |

- Todo backup é **cifrado pela aplicação** com a chave `CONNECTION_SECRETS`
  do `.env`. **Sem essa chave o backup é ilegível** — guarde uma cópia do
  `.env`/da chave SOPS (`SOPS_AGE_KEY`) fora do servidor.
- Cada backup tem um registro na tabela `backups` (id, status, checksum
  SHA-256, tamanho, datas). O restore confere o checksum antes de aplicar.
- O painel admin (`/admin/backups`) lista os backups com status, tamanho e
  onde estão (MinIO/offsite), e baixa o arquivo **cifrado** por um link de
  5 minutos. Para decifrar uma cópia baixada:
  `pnpm backup:decrypt <arquivo.enc> <saida>` (mesmo `CONNECTION_SECRETS`).
- A cópia offsite leva os checksums nos metadados do objeto, então dá para
  restaurá-la **mesmo sem a tabela `backups`** (servidor perdido).
- **Só o FULL vai para o offsite.** Backups de workspace (inclusive os
  arquivos) ficam apenas no MinIO do servidor, e o FULL é só `pg_dump`: **não
  existe hoje cópia fora do servidor dos arquivos do MinIO** (mídias,
  anexos). Perder o volume do MinIO perde os arquivos.

## Preparação (uma vez por restore)

Os scripts de restore rodam a partir de um **checkout do repositório** (a
imagem de produção não inclui `pnpm`/`tsx`). No servidor ou numa máquina de
operador com acesso ao banco:

1. Pré-requisitos: Node 22, `pnpm` (`corepack enable`), Docker (usado para o
   `pg_restore` se ele não estiver instalado).
2. Clone e instale:
   ```bash
   git clone https://github.com/StratusTI/steel.git steel-restore
   cd steel-restore
   pnpm install --frozen-lockfile
   pnpm prisma:generate
   ```
   (o registry privado HugeIcons exige o `.npmrc` com token — o mesmo usado
   no CI; peça ao responsável se o `install` falhar por isso.)
3. Traga o `.env` de produção: `cp /var/www/steel/.env .env`
4. O `.env` de produção aponta para nomes da rede Docker
   (`steel-db`, `steel-minio`), que não resolvem fora dos containers. Ao rodar
   no host, sobrescreva na linha de comando (variáveis já definidas têm
   prioridade sobre o `.env`):
   ```bash
   export DATABASE_URL='postgresql://<usuario>:<senha>@localhost:5433/<banco>'
   export MINIO_ENDPOINT='http://127.0.0.1:9002'
   ```
   (usuário/senha/banco: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
   do `.env`.) Os comandos que **enfileiram** jobs (`pnpm backup:full`,
   `pnpm backup:workspace`) também falam com o Redis:
   ```bash
   export REDIS_URL='rediss://default:<REDIS_PASSWORD>@localhost:6380'
   export REDIS_TLS_CA_PATH=/var/www/steel/redis-tls/ca.crt
   ```

## Restore FULL a partir do MinIO local (caso comum)

1. **Ache o backup.** Liste os últimos FULL concluídos:
   ```bash
   docker exec -it steel-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
     "SELECT id, status, size_bytes, started_at, completed_at FROM backups
      WHERE scope = '\''FULL'\'' AND status = '\''COMPLETED'\''
      ORDER BY started_at DESC LIMIT 10;"'
   ```
   Anote o `id` do backup desejado (horários em UTC).
2. **Ensaie num banco descartável** (recomendado):
   ```bash
   docker exec steel-db sh -c 'createdb -U "$POSTGRES_USER" restore_test'
   pnpm restore:full <backupId> \
     --target='postgresql://<usuario>:<senha>@localhost:5433/restore_test'
   ```
   Confira contagens/registros que motivaram o restore. Depois:
   `docker exec steel-db sh -c 'dropdb -U "$POSTGRES_USER" restore_test'`.
3. **Pare quem escreve no banco:**
   ```bash
   cd /var/www/steel && docker compose stop steel-app steel-worker
   ```
4. **Restaure no banco real** (sem `--target` usa o `DATABASE_URL`):
   ```bash
   pnpm restore:full <backupId>
   ```
   Saída esperada: `Restore completo em <n>ms.` Erro de checksum = backup
   corrompido; tente o anterior ou a cópia offsite.
5. **Aplique migrations** (o backup pode ser de antes do último deploy):
   ```bash
   pnpm prisma:deploy
   ```
   Backup de **antes** de 13/11/2026 não tem as tabelas e colunas da onda
   ux (`whatsapp_contact_blocks`, `crm_retention_settings`,
   `crm_retention_actions`, os vínculos `crm_company_id` / `crm_person_id` /
   `crm_*_id` em `sd_customers`, `sd_contacts`, `whatsapp_contacts` e
   `sd_tickets`, `sd_settings.requester_whatsapp_templates` e outras): este
   passo as cria, e a migração `cadastro_unico` **refaz o preenchimento
   automático dos vínculos** sobre os dados restaurados (só o que é
   inequívoco). Confira que a saída lista as migrations aplicadas e termina
   sem erro antes de subir o app; migration pendente derruba rotas que usam a
   coluna nova.
6. **Suba app e worker:** `cd /var/www/steel && docker compose up -d`
7. **Confirme** com o [health check](./health-check.md) e avise os usuários
   sobre a janela de dados perdida (entre o backup e o incidente).

## Restore a partir da cópia offsite (servidor/MinIO perdidos)

Use quando o MinIO local não existe mais ou o backup local está corrompido.
Não depende da tabela `backups`.

1. Faça a [preparação](#preparação-uma-vez-por-restore) numa máquina nova
   (ou no servidor reconstruído). Se o servidor foi perdido, recupere o
   `.env` decriptando o SOPS de um checkout:
   `sops --decrypt secrets/production.enc.env > .env` (exige a chave age —
   `SOPS_AGE_KEY`, guardada fora do servidor).
2. Garanta no `.env` as variáveis `BACKUP_OFFSITE_*` (endpoint, bucket,
   chaves) e o **mesmo** `CONNECTION_SECRETS` da época do backup.
3. Suba um Postgres vazio (ex.: `docker compose -f docker-compose.infra.yml up -d`
   num servidor novo) e crie o banco (`POSTGRES_DB`).
4. Liste as cópias disponíveis (mais recentes primeiro):
   ```bash
   pnpm restore:full --list-offsite
   ```
   Cada linha: `data  tamanho  backupId`.
5. Restaure:
   ```bash
   pnpm restore:full <backupId> --offsite
   # ou num banco de teste primeiro:
   pnpm restore:full <backupId> --offsite --target='postgresql://...'
   ```
   O script baixa, confere o SHA-256 do arquivo cifrado e do dump em claro, e
   roda o `pg_restore`.
6. Continue a partir do passo 5 do restore local (`prisma:deploy`, subir
   app/worker, health check).

### Configurar a cópia offsite

Enquanto `BACKUP_OFFSITE_*` não estiver configurado, o worker só loga
`queue.database_backup.offsite_not_configured` e **não existe cópia fora do
servidor**. Para ativar:

1. Crie um bucket **privado** num provedor S3-compatível **fora deste
   servidor** (ex.: Backblaze B2, Cloudflare R2, AWS S3, Wasabi). Se o
   provedor oferecer, ative *object lock*/versionamento para proteger contra
   exclusão acidental ou ransomware.
2. Crie uma chave de acesso **restrita a esse bucket**, com permissão de
   ler, gravar, listar e apagar objetos (o prune de retenção apaga cópias
   antigas).
3. Adicione ao `secrets/production.enc.env` (via `sops`):
   ```
   BACKUP_OFFSITE_ENDPOINT=https://<endpoint-s3-do-provedor>
   BACKUP_OFFSITE_REGION=<região>
   BACKUP_OFFSITE_BUCKET=<bucket>
   BACKUP_OFFSITE_ACCESS_KEY_ID=<key id>
   BACKUP_OFFSITE_SECRET_ACCESS_KEY=<secret>
   # opcionais:
   BACKUP_OFFSITE_PREFIX=steel/
   BACKUP_OFFSITE_RETENTION_DAYS=90
   BACKUP_OFFSITE_SSE=true            # false se o provedor rejeitar SSE
   BACKUP_OFFSITE_FORCE_PATH_STYLE=false
   ```
4. Faça o deploy (commit em `main`). Para testar sem esperar as 03:15:
   `pnpm backup:full` (de um checkout com o `.env`) e procure
   `queue.database_backup.offsite_completed` no Axiom.

## Restore de um workspace

Restaura só os dados de um workspace (apaga o estado atual dele e recria a
partir do snapshot, numa transação — se algo falhar, nada muda). Não mexe nos
outros workspaces. Também desfaz uma [exclusão](./delete-workspace.md).

O backup de workspace tem duas partes, ambas cifradas com `CONNECTION_SECRETS`:

- **Linhas:** um JSON com todas as tabelas do workspace (inclusive as
  tabelas-filhas, como estágios de pipeline e itens de oportunidade).
- **Arquivos do MinIO** (backups a partir de 19/09/2026): cada objeto
  copiado e cifrado individualmente, mais um manifesto com bucket, chave,
  content-type, tamanho e SHA-256. O restore regrava esses arquivos depois
  das linhas.

| Entra no backup | Como é achado |
| --------------- | ------------- |
| mídias do WhatsApp (`whatsapp-media`), documentos de conhecimento da IA (`whatsapp-ai-knowledge`), capas de projeto (`projects-covers`), posts agendados (`crm-scheduled-posts`, `crm-social-publish-tmp`) | prefixo `<workspaceId>/` — completo |
| imagens/vídeos de landing page e imagens de proposta **enviadas a partir de 19/09/2026** | prefixo `<workspaceId>/` — completo |
| anexos do assistente de IA do CRM (`crm-ai-attachments`) | pela tabela `crm_ai_attachments` — completo |
| imagens/vídeos de landing page e imagens de proposta **antigas** (chave na raiz do bucket) | **best-effort:** pela URL citada no conteúdo das seções de landing page, de proposta e de modelo de proposta |

**Fica de fora:** avatar e capa de usuário (`avatars`, `user-covers` — são
do usuário, não do workspace), imagens do changelog (globais), exportações
LGPD e os próprios backups. Mídia **antiga** de landing page/proposta que
nenhuma seção cita mais (seção apagada, proposta excluída) não tem como ser
atribuída a um workspace e não entra; a referência que aponta para um
arquivo que já não existe é só contada (`missingLegacyKeys` no log
`queue.database_backup.workspace_completed`).

O restore **só escreve** as chaves do manifesto: não apaga nada e não mexe
em arquivos fora do backup (um arquivo enviado depois do backup continua lá).
Rodar de novo sobrescreve as mesmas chaves com o mesmo conteúdo. Cada
arquivo é conferido pelo SHA-256 antes de ir para o bucket.

Backups gerados antes de 19/09/2026 não têm a parte de arquivos (no painel,
a coluna **Arquivos** mostra `—`): restaurá-los traz só as linhas.

> Backups de workspace gerados antes de 18/09/2026 não tinham as
> tabelas-filhas: restaurar um deles num workspace com oportunidades,
> formulários, transmissões etc. falha (e não altera nada). Nesse caso use o
> caminho do backup FULL descrito no fim desta seção.

### Pelo painel (recomendado)

1. `https://<domínio>/admin/backups` → filtro **Por workspace** (ou a seção
   “Backups deste workspace” no detalhe do workspace).
2. No backup desejado (status **Concluído**), clique em **Restaurar**,
   escreva o motivo e digite o **slug** do workspace.
3. O worker tira antes um **backup de segurança** do estado atual (se o
   workspace existe — com arquivos), restaura as linhas e depois os
   arquivos. Acompanhe em “Exclusões e restaurações”; ao concluir aparecem
   as contagens e o ID do backup de segurança (para desfazer, restaure esse).
   Se o passo de arquivos falhar, a operação conclui assim mesmo (as linhas
   já voltaram) com `filesError` no resultado e no log
   `queue.admin_operation.workspace_files_restore_failed` — reprocesse só os
   arquivos pela linha de comando com `--files-only` (abaixo).
4. Confira no app com um usuário do workspace.

Falhas comuns (a operação mostra o erro; nada foi alterado):

| Erro | Causa | O que fazer |
| ---- | ----- | ----------- |
| `O slug "x" já é usado por outro workspace` | o workspace foi excluído e o slug reaproveitado | acione o engenheiro (restaurar com outro slug exige ajuste manual do snapshot) |
| `Não foi possível restaurar: membership (...)` | um membro do backup teve a conta excluída | acione o engenheiro; o restore precisa ignorar esse membro |
| `Checksum não bate` | arquivo corrompido | use outro backup |
| `Checksum não bate para <bucket>/<chave>` (em `filesError`) | um arquivo do backup está corrompido; os anteriores já foram regravados | as linhas estão ok; use outro backup com `--files-only` ou acione o engenheiro |

Um workspace restaurado a partir do backup tirado durante a exclusão volta
**ativo**; se estava suspenso antes, suspenda de novo pelo painel.

### Pela linha de comando

1. Ache o backup:
   ```bash
   docker exec -it steel-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
     "SELECT id, workspace_id, workspace_slug, started_at FROM backups
      WHERE scope = '\''WORKSPACE'\'' AND status = '\''COMPLETED'\''
      ORDER BY started_at DESC LIMIT 20;"'
   ```
   Para um ponto de restauração antes de uma operação arriscada:
   `pnpm backup:workspace <workspaceIdOuSlug>` (ou **Backup agora** no painel).
2. **Ensaie:** `pnpm restore:workspace <backupId> --dry-run` — não escreve
   nada; mostra tabelas/linhas e os arquivos por bucket (quantidade e
   tamanho), quantos são legados achados por referência e se o backup é só
   de banco.
3. Restaure: `pnpm restore:workspace <backupId>` (sem backup de segurança —
   faça um antes, se o workspace existe). Saída esperada:
   `Workspace "<id>" restaurado em <n>ms (<t> tabelas, <l> linhas, <a> arquivos (<tamanho>)).`
   - `--skip-files`: só as linhas.
   - `--files-only`: só os arquivos — para reprocessar um restore cujo passo
     de arquivos falhou. Pode ser repetido sem efeito colateral.
   - Rodando fora do container, lembre do `MINIO_ENDPOINT` da
     [preparação](#preparação-uma-vez-por-restore).
4. Confira no app com um usuário do workspace (abra uma conversa com mídia,
   uma landing page com imagem).

Para recuperar um workspace a partir de um backup FULL (não há WORKSPACE),
restaure o FULL num banco descartável (`--target`) e copie os registros
necessários — isso exige apoio do engenheiro de produto.
