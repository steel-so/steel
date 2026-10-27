# Arquivamento de conversas do WhatsApp (pacotes para bancos)

Quando usar: um cliente (a primeira é a Fidelizza+) precisa entregar a um banco
a cópia das conversas do WhatsApp — pacote **semanal** e **completo mensal**,
um PDF por atendimento, num `.zip`. Decisão e detalhes:
[ADR 0052](../adr/0052-whatsapp-conversation-archive-for-banks.md).

**Restore não se aplica**: o pacote é uma cópia de leitura gerada a partir do
banco. Se um pacote se perder, gere de novo (o período é o mesmo do dia em que
roda) ou restaure o banco pelo [runbook de backup](./restore-backup.md).

## 1. Ligar para um workspace

1. Entre em `/admin/workspaces`, abra o workspace.
2. No painel **Arquivamento de conversas (WhatsApp)**, ligue **Arquivar
   conversas**.
3. (Opcional) **Pasta raiz do .zip**: o padrão é o slug em maiúsculas só com
   letras e números (`fidelizza-mais` → `FIDELIZZAMAIS`). Se o banco pediu outro
   nome, escreva aqui (só `A-Z`, `0-9`, `-`, `_`, até 40) e **Salvar pasta**.
4. Pronto: o worker gera sozinho o **semanal** toda segunda às 02:00 (semana
   anterior, segunda a domingo) e o **completo** no dia 1 às 02:30 (tudo até o
   fim do mês anterior), horário de Brasília.

A ação fica no **Histórico do admin** do workspace.

## 2. Gerar um pacote agora

- Pelo painel: **Gerar semanal agora** ou **Gerar completo agora**. A lista
  mostra "Na fila" → "Gerando" → "Pronto" (atualiza sozinha).
- Pelo terminal (mesmos pré-requisitos dos comandos que enfileiram jobs em
  [Restaurar um backup](./restore-backup.md), passo 4 — `DATABASE_URL`,
  `REDIS_URL`, `REDIS_TLS_CA_PATH`):
  ```bash
  pnpm archive:whatsapp fidelizza-mais            # semanal
  pnpm archive:whatsapp fidelizza-mais --full     # completo
  ```
- Erros comuns: `O arquivamento de conversas não está ativo` (ligue no passo
  1); `Já existe um pacote deste tipo sendo gerado` (espere o atual terminar).

## 3. Achar o pacote

- **Tela**: o OWNER/ADMIN do workspace vê e baixa em **Comunicação ›
  Configurações › Atendimento › Arquivamento de conversas**. O admin global
  baixa pelo painel do passo 1.
- **Banco**:
  ```bash
  docker exec -it steel-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
    "SELECT id, kind, status, period_end, size_bytes, sha256, offsite_key, error
     FROM whatsapp_archives WHERE workspace_id = '\''<workspaceId>'\''
     ORDER BY created_at DESC LIMIT 10;"'
  ```
- **MinIO**: bucket `whatsapp-archives`, objeto `<workspaceId>/<archiveId>.zip`.
- **Cópia externa** (se `BACKUP_OFFSITE_*` estiver configurado): mesmo bucket
  dos backups, prefixo `<BACKUP_OFFSITE_PREFIX sem a barra>-whatsapp-archives/`
  (com o padrão: `steel-whatsapp-archives/<workspaceId>/<archiveId>.zip`). O
  campo `offsite_key` diz a chave exata.

Guarda: semanal **90 dias**, completo **12 meses** (MinIO e cópia externa). O
prune roda todo dia às 04:50; depois disso o pacote aparece como "Expirado".

## 4. Entregar a um banco

1. Baixe o `.zip` (nome: `<RAIZ>-whatsapp-semanal-<início>-a-<fim>.zip` ou
   `<RAIZ>-whatsapp-completo-ate-<fim>.zip`).
2. Confira a integridade com o SHA-256 mostrado na tela:
   ```bash
   sha256sum FIDELIZZAMAIS-whatsapp-semanal-2026-10-19-a-2026-10-25.zip
   ```
3. Envie pelo canal que o banco exigir (SFTP, portal) — **nunca por e-mail
   aberto**: são dados pessoais (LGPD).
4. Diga ao banco que o arquivo `WHATSAPP/INDICE.csv` lista cada PDF com data,
   atendente, contato, telefone, número de mensagens e o SHA-256 do PDF (no
   Linux: `sha256sum <arquivo>.pdf`; no Windows:
   `certutil -hashfile <arquivo>.pdf SHA256`).

Organização dentro do .zip:

```
FIDELIZZAMAIS/WHATSAPP/2026-10-20/ana-souza/maria-silva-5511988887777-2026-10-20-14h05.pdf
FIDELIZZAMAIS/WHATSAPP/2026-10-20/IA/5511977776666-2026-10-20-10h00.pdf
FIDELIZZAMAIS/WHATSAPP/INDICE.csv
```

Um atendimento é uma conversa num dia. Se dois atendentes falaram, o mesmo PDF
está na pasta de cada um. `IA` = só a IA respondeu; `sem-atendente` = ninguém
respondeu e a conversa não tinha responsável.

## 5. Quando algo falha

| Sintoma | O que fazer |
| --- | --- |
| Pacote "Falhou" com mensagem | Leia a mensagem na tela e o log `queue.whatsapp_archive.failed` no Axiom; corrija e gere de novo. O job já tentou 3 vezes. |
| Fica "Na fila" muito tempo | Veja se o `steel-worker` está de pé ([reiniciar um serviço](./restart-service.md)) e a fila `whatsapp-archive` em `/jobs`. |
| Sem "Cópia externa" | `BACKUP_OFFSITE_*` não configurado (log `queue.whatsapp_archive.offsite_not_configured`) ou a cópia falhou (`queue.whatsapp_archive.offsite_failed`; o job tenta de novo sozinho). |
| Disco cheio no worker | O pacote é montado em arquivo temporário (`/tmp`). Libere espaço; o completo cresce com o histórico. |

Desligar: o mesmo interruptor do passo 1. Os pacotes já gerados continuam até
vencer a guarda.
