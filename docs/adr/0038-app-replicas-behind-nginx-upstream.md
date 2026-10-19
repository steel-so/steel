# 0038 — Réplicas do app atrás de um upstream do nginx

- **Status:** Aceita
- **Data:** 2026-10-18
- **Decisores:** product owner + time de engenharia

## Contexto

O Steel roda **um** container de app (`nextjs-app`), ou seja, um processo
Node. Um processo Node satura um núcleo: no Nexo, um processo parou em ~45
req/s (400 usuários dentro de p95 500 ms / p99 1 s em 16/10/2026), e o host
tinha núcleos sobrando. O Steel fica abaixo de 1.000 VUs no k6, e a meta do
product owner (17/10/2026) é **no mínimo 6.000 VUs**.

O Nexo resolveu a primeira metade disso com réplicas: três instâncias atrás
de um `upstream` `least_conn` do nginx com deploy em rolagem (`d5626518`,
~800 usuários), depois cinco num host de 12 vCPU (`6208b16e`, ~2.000), mais
compressão no nginx (`164c94b1`), `deploymentId` contra Server Actions
órfãs (`c4fad13b`), PgBouncer com console de admin (`95f2629c`) e budgets do
k6 por ambiente (`dd22cfba`). Esta ADR reaproveita esse desenho.

O Steel tem três pontos que o Nexo não tinha:

- **Cache Components com `revalidateTag`.** Os sites publicados (`app/(sites)`)
  leem com `'use cache'` marcados com `site:<slug>`, e publicar, despublicar,
  renomear ou excluir um site chama `revalidateTag` (`src/lib/sites/cache.ts`,
  usado por seis services). O handler padrão do Next guarda as entradas **e o
  estado das tags** na memória do processo: com réplicas, publicar numa
  expiraria o cache só nela, e as outras continuariam servindo o site antigo
  por até uma semana (`cacheLife('days')`).
- **Streams longos.** SSE do WhatsApp, do ServiceDesk, das notificações e do
  `steel listen`, o MCP (ADR 0032) e o realtime da Wiki/Canvas (Hocuspocus).
- **Dois proxies na homologação.** O TLS termina no Apache do 10.10.100.31, que
  repassa para o nginx do 10.10.100.145 (10 vCPU, 7,7 GB, também com Postgres,
  Redis e MinIO).

## Decisão

**O app roda como N réplicas idênticas (três na homologação) atrás do
upstream `steel_app` do nginx (`least_conn`), substituídas uma por vez no
deploy; o estado das tags do `'use cache'` é compartilhado pelo Redis.**

Detalhes para aplicar:

- **Réplicas** (`docker-compose.yml`): `steel-app` continua sendo o container
  `nextjs-app` na porta 3000 (a sonda do worker, os runbooks e um nginx ainda
  apontando para `:3000` seguem funcionando), mais `steel-app-2` e
  `steel-app-3` no loopback (3001, 3002). Cada uma tem healthcheck em
  `GET /api/status/live` (nova rota de liveness, sem banco nem Redis, para
  um soluço do banco não tirar todas do upstream de uma vez) e 30 s de
  `stop_grace_period`. Nada de uma requisição depende da réplica que a
  atende: sessão no Postgres; rate limit, fan-out de SSE (pub/sub) e tags do
  cache no Redis.
- **Deploy em rolagem** (`scripts/deploy.sh`, usado pelo CD, pelo Rollback e
  pela promoção): sobe worker, realtime e pooler; depois cada réplica em
  ordem, espera o container ficar `healthy` e repete as checagens que já
  existiam (`/sign-in` 200, CSP, HSTS, redirect de rota privada) na porta
  dela. Uma falha para a rolagem e volta tudo para o tag anterior pelo mesmo
  caminho.
- **Cache compartilhado** (`lib/next-cache/`, `cacheHandlers.default` no
  `next.config.ts`): as **entradas** continuam no LRU em memória do Next, por
  réplica (50 MB, o mesmo padrão); só o **estado das tags** vai para o Redis.
  `updateTags` (chamado pelo `revalidateTag`) aplica localmente e faz
  max-merge em dois hashes (`steel:next-cache:tags:{stale,expired}`) por um
  script Lua, incrementando `steel:next-cache:tags:version`; `refreshTags`
  (chamado pelo Next antes de uma requisição ler o cache) lê o contador e só
  puxa os hashes quando ele mudou. O manifesto local é o mesmo `Map` que o
  handler padrão e o incremental cache do Next já consultam
  (`tags-manifest.external`), então a entrada some na próxima requisição de
  qualquer réplica. O Redis nunca fica no caminho crítico: timeout curto
  (`NEXT_CACHE_TAGS_TIMEOUT_MS`, padrão 150 ms), sem fila offline, sem
  conexão durante o `next build`; uma falha só registra (com limite de um log
  por minuto) e mantém o último estado conhecido.
  - **Por que não as entradas no Redis:** o mesmo Redis guarda as filas do
    BullMQ, que exigem `noeviction`; snapshots de site com vida de uma semana
    disputariam essa memória. Uma réplica que não tem a entrada paga uma
    leitura do banco, e só na primeira visita.
  - O handler é CommonJS puro porque o Next carrega `cacheHandlers` em tempo
    de execução sem empacotar (sem alias `@/`, sem TypeScript, sem o módulo
    Zod de env — por isso lê `process.env` direto, exceção documentada).
- **Server Actions entre deploys:** `NEXT_DEPLOYMENT_ID` (o commit, embutido
  pelo `next build`) faz uma aba aberta durante o deploy recarregar a página
  em vez de disparar uma Server Action que a build nova não conhece, como no
  Nexo. `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` vem de um secret do GitHub como
  secret mount do BuildKit (fora do histórico da imagem): toda build cifra as
  closures com a mesma chave. Sem o secret, o Next segue gerando uma por
  build (inerte, como o Sentry na ADR 0017).
- **Compressão no proxy:** `compress: false` no `next.config.ts`;
  `infra/nginx/steel-gzip.conf` comprime as respostas proxiadas (na
  homologação o Apache de borda também comprime).
- **nginx versionado** em `infra/nginx/`: `steel-upstream.conf` (upstream com
  `max_fails=3 fail_timeout=10s` e `keepalive`), `steel-locations.conf`
  (incluído no `server` do domínio: `/`, `/api/mcp`, os SSE e `/realtime`,
  cada um com buffering, timeout e upgrade próprios, e nova tentativa de
  requisição idempotente na próxima réplica), `steel-realip-homologacao.conf`
  (confia só no Apache .31) e `cloudflare-realip.conf` (para depois). Os
  locations entregam ao app um `X-Forwarded-For` de um salto só, com o
  endereço que a borda garante — o `getClientIp()` lê o primeiro salto.
  Os SSE do WhatsApp, ServiceDesk e notificações passaram a mandar
  `X-Accel-Buffering: no`, como os de IA e webhooks já mandavam.
- **Postgres:** `DB_POOL_MAX` dimensiona o pool de cada processo (padrão 10:
  três réplicas, worker e realtime somam no máximo 50, metade do
  `max_connections` padrão). `DATABASE_URL_POOLED` (opcional) aponta o
  Prisma para o `steel-pgbouncer` (perfil `pooler` do compose, modo
  transaction, `edoburu/pgbouncer` com `ADMIN_USERS` para o `SHOW POOLS`). O
  Prisma 7 fala com o Postgres pelo `@prisma/adapter-pg`, que manda
  statements sem nome, então o modo transaction não precisa de
  `pgbouncer=true` (isso era do cache de prepared statements do motor Rust).
  Migrations, `pg_dump` e `pg_restore` continuam no `DATABASE_URL` direto.
  O único `set_config` do código é local à transação, compatível com o
  pooler.
- **k6:** `k6/profiles.js` deriva o budget (local ou remoto) do `BASE_URL`;
  `k6/capacity-test.js` sobe visitantes com tempo de leitura em degraus de
  1.000 até 6.000 VUs (ou mantém um platô), contando 429 à parte e abortando
  quando 5% das requisições falham por um minuto.
- **O que não é replicado:** o `steel-realtime` (Hocuspocus guarda os
  documentos abertos em memória e o lock da Wiki assume um processo) e o
  `steel-worker` (as filas já distribuem trabalho; crons repetíveis assumem
  um agendador).

## Consequências

- O deploy fica mais longo (uma réplica por vez, cada uma esperando o
  healthcheck), mas sem janela fora do ar quando o upstream está instalado.
  Um stream SSE aberto cai quando a réplica dele é trocada e o `EventSource`
  reconecta em outra; o realtime não é afetado.
- Cada réplica tem o próprio cache em memória: depois de um deploy, a
  primeira visita a cada site em cada réplica vai ao banco. Uma réplica que
  perdeu o Redis serve conteúdo possivelmente desatualizado até reconectar —
  a troca escolhida é disponibilidade antes de consistência estrita.
- O handler depende de dois módulos internos do Next
  (`next/dist/server/lib/cache-handlers/default` e
  `.../incremental-cache/tags-manifest.external`). O teste unitário usa os
  módulos reais, então uma atualização do Next que os mude quebra o CI, não a
  produção.
- Memória: ~1 GB por réplica sob carga. Três cabem no .145 ao lado da infra;
  uma quarta só depois de medir. A sonda "app" da página de status continua
  olhando só a `nextjs-app`.
- O integrador precisa: criar o secret `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
  (e `PRODUCTION_NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, se quiser chave própria
  de produção) e guardar uma cópia no SOPS, porque secret do GitHub não pode
  ser lido de volta; instalar os arquivos do nginx; e, para ligar o pooler,
  `COMPOSE_PROFILES=pooler`, `DATABASE_URL_POOLED` e `DB_POOL_MAX=20` no
  SOPS. Passo a passo em `docs/runbooks/app-replicas.md`.

### O que ainda falta para 6.000 VUs

Réplicas sozinhas não chegam lá neste host. Conta grosseira: com tempo de
leitura médio de ~9 s, 6.000 visitantes geram algo como 600–700 req/s; a
~45 req/s por núcleo (o número do Nexo, ainda não medido no Steel) isso pede
uns 15 núcleos só de Node, e o .145 tem 10 vCPU dividindo com Postgres,
Redis e MinIO. O Nexo chegou a ~2.000 com cinco réplicas em 12 vCPU. O
caminho, em ordem:

1. **Medir antes e depois** desta mudança com `k6/capacity-test.js` (degraus
   de 1.000), anotando VUs no teto, req/s, p95/p99 e CPU por réplica. Sem
   isso o resto é palpite.
2. **Perfilar as rotas quentes**: custo do `proxy.ts` em toda requisição (CSP
   com nonce, log do Axiom, lookup de site por host), renderização das
   páginas públicas e do layout do workspace, e as leituras repetidas por
   requisição (sessão, membership, módulos) que podem ir para o cache do
   Redis (`src/cache/`).
3. **Tirar o público do Node**: páginas de marketing pré-renderizadas e
   estáticos servidos pelo nginx ou por uma CDN; **Cloudflare** na frente
   (como o Nexo em 17/10) para cache de borda dos sites publicados e dos
   assets (`cloudflare-realip.conf` já está pronto).
4. **Mais hosts ou um host maior para o app**, separado do banco: o upstream
   aceita servidores de outra máquina sem mudar o desenho. Com mais de ~5
   réplicas o PgBouncer deixa de ser opcional.
5. **Gerador de carga distribuído**: um gerador é um IP só, e o rate limit
   por IP do app responde 429 bem antes de 6.000 VUs. Medir o teto de
   verdade pede vários geradores (ou uma isenção autenticada do limitador
   para o teste, que é uma decisão de segurança à parte).
