# Instalar o pgvector no `steel-db`

**Quando usar:** uma vez por servidor (homologação, produção e máquina de
dev), para ligar a metade semântica da busca de conhecimento do Steel AI
([ADR 0037](../adr/0037-unified-knowledge-search-hybrid-pgvector.md)). Sem
isso a busca funciona, mas só por texto.

> **Nunca troque a imagem por uma Debian** (`postgres:17`,
> `pgvector/pgvector:pg17`). O diretório de dados foi criado na imagem
> alpine (musl); um servidor glibc ordena texto de outro jeito e corrompe em
> silêncio os índices. A imagem nova é o mesmo `postgres:17-alpine` com o
> pgvector compilado em cima, e reaproveita o volume `pgdata` como está.

## Antes

- A migration `20261018220000_ai_search_knowledge_index` pode ser aplicada
  antes ou depois desta troca: sem pgvector ela cria só a parte de texto.
- Confira que o backup FULL da noite terminou (`/admin/backups`) ou rode um
  agora: `pnpm backup:full`.
- Janela: o Postgres fica fora do ar durante a recriação do contêiner
  (normalmente menos de 1 minuto). App e worker reconectam sozinhos.

## Passo a passo (no servidor, em `/var/www/steel`)

1. Atualize o checkout com o commit que traz `infra/postgres/Dockerfile`.
2. Construa a imagem:

   ```bash
   docker compose -f docker-compose.infra.yml build steel-db
   ```

   O build baixa o pgvector 0.8.7 do GitHub e confere o SHA-256. Falha de
   checksum = pare e avise; não edite o hash sem conferir a origem.
3. Recrie **só** o `steel-db`, mantendo o volume:

   ```bash
   docker compose -f docker-compose.infra.yml up -d --no-deps steel-db
   ```

   Não use `down -v`, `rm -v` nem apague o volume `pgdata`.
4. Espere o healthcheck:

   ```bash
   docker inspect --format '{{.State.Health.Status}}' steel-db   # healthy
   docker exec steel-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -c "select name, default_version from pg_available_extensions where name = 'vector'"
   ```

5. Ligue o sidecar e gere os embeddings (ou espere a reindexação das 02:45):

   ```bash
   pnpm ai:index            # todos os workspaces com Steel AI ligado
   pnpm ai:index <slug>     # ou só um
   ```

   A saída termina com `vector index on`. Para conferir no banco:

   ```bash
   docker exec steel-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -c "select ai_knowledge_enable_vector(), count(*) from ai_vector.ai_knowledge_embeddings"
   ```

6. Em **Admin › Steel IA › Busca de conhecimento** os selos devem mostrar
   "Chave da OpenAI configurada", "pgvector instalado" e "Modo: texto +
   significado".

## Se der errado

- **Contêiner não sobe**: veja `docker logs steel-db`. Para voltar, troque
  em `docker-compose.infra.yml` o `build`/`image` do `steel-db` por
  `image: postgres:17-alpine` e rode o passo 3 de novo. O banco continua
  íntegro; só a busca semântica fica desligada (a extensão instalada não
  impede o Postgres antigo de subir, mas as consultas ao
  `ai_vector` falham e a busca cai para texto).
- **`vector index off` depois do `ai:index`**: a extensão não está visível
  (`pg_available_extensions`). Confira que o contêiner em execução usa a
  imagem nova: `docker inspect steel-db --format '{{.Config.Image}}'`.
- **Modo continua "só texto" com tudo instalado**: falta
  `OPENAI_API_KEY` no `.env` (SOPS) ou a chave foi desligada no admin.

## Restore de backup

O backup FULL inclui a extensão `vector` e o schema `ai_vector`. O banco de
destino de um `pnpm restore:full` precisa ter o pgvector disponível (use
esta imagem). Sem ele o restore falha no `CREATE EXTENSION vector`. Os
embeddings também podem ser descartados e refeitos com `pnpm ai:index`.

## Máquina de dev

Mesmo procedimento com `docker-compose.infra.yml` na raiz do repositório.
Bancos de agentes/worktrees no mesmo contêiner ganham o sidecar quando a
migration roda de novo ou no próximo `pnpm ai:index`.
