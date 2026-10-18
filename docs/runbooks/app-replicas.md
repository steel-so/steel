# Runbook — réplicas do app (upstream do nginx)

O app do Steel roda como **três réplicas** iguais atrás do upstream
`steel_app` do nginx (ADR 0037). Use este runbook na primeira instalação de
um host, para conferir a saúde das réplicas, tirar ou acrescentar uma, ligar
o PgBouncer e rodar o teste de capacidade.

| Réplica (serviço) | Container | Porta no host |
| ----------------- | --------- | ------------- |
| `steel-app` | `nextjs-app` | `3000` |
| `steel-app-2` | `steel-app-2` | `127.0.0.1:3001` |
| `steel-app-3` | `steel-app-3` | `127.0.0.1:3002` |

O worker (`steel-worker`) e o realtime da Wiki (`steel-realtime`) continuam
sendo um container cada.

```text
homologação:
navegador ──https──▶ Apache .31 (TLS) ──http:80──▶ nginx .145 ──least_conn──▶ nextjs-app :3000
                                                        │                ├──▶ steel-app-2 :3001
                                                        │                └──▶ steel-app-3 :3002
                                                        └── /realtime ──▶ steel-realtime :1235
```

Os arquivos do nginx ficam versionados em `infra/nginx/` — **edite lá e
instale no servidor**, nunca o contrário:

| Arquivo do repositório | No servidor | Contexto |
| ---------------------- | ----------- | -------- |
| `steel-upstream.conf` | `/etc/nginx/conf.d/steel-upstream.conf` | `http` |
| `steel-gzip.conf` | `/etc/nginx/conf.d/steel-gzip.conf` | `http` |
| `steel-realip-homologacao.conf` (homologação) ou `cloudflare-realip.conf` (atrás da Cloudflare) | `/etc/nginx/conf.d/steel-realip.conf` | `http` |
| `steel-locations.conf` | `/etc/nginx/snippets/steel-locations.conf` | dentro do `server` do domínio |

## 1. Primeira instalação num host

Faça **antes** do primeiro deploy com réplicas, nesta ordem.

### 1.1 Pré-requisitos

1. **Secret do GitHub** `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (repositório
   `steel-so/steel`), gerado com `openssl rand -base64 32`. Guarde uma cópia
   em `secrets/homologacao.enc.env` e `secrets/production.enc.env` (SOPS):
   secret do GitHub não pode ser lido de volta. Para uma chave só de
   produção, crie também `PRODUCTION_NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`.
   Sem o secret o build passa igual, mas cada build gera uma chave nova.
2. **Portas livres** no host: `ss -ltnp | grep -E ':(3001|3002) '` não pode
   mostrar nada.
3. **Memória**: cada réplica usa ~650 MB parada e ~1 GB sob carga.
   `free -g` antes; no .145 (7,7 GB) três réplicas cabem ao lado do banco,
   Redis e MinIO, quatro não sem medir.

### 1.2 nginx

Como root (no .145 o usuário `stratus` não tem `sudo`; use `su -`):

```bash
cd /root && cp /etc/nginx/sites-enabled/homologacao.stratustelecom.com.br \
  nginx-homologacao.bak-$(date +%F)
# a partir de um checkout do repositório no commit deployado
git clone --depth 1 https://github.com/steel-so/steel.git /tmp/steel-nginx && cd /tmp/steel-nginx
cp infra/nginx/steel-upstream.conf /etc/nginx/conf.d/
cp infra/nginx/steel-gzip.conf /etc/nginx/conf.d/
cp infra/nginx/steel-realip-homologacao.conf /etc/nginx/conf.d/steel-realip.conf
mkdir -p /etc/nginx/snippets && cp infra/nginx/steel-locations.conf /etc/nginx/snippets/
```

No `server` do domínio (`/etc/nginx/sites-enabled/homologacao.stratustelecom.com.br`):

1. **Remova** os blocos `location /`, `location /api/mcp` e
   `location /realtime` — eles agora vêm do snippet. **Mantenha** `listen`,
   `server_name`, certificados, `client_max_body_size`, `location /media/`
   (MinIO) e `location /.well-known/acme-challenge/`.
2. Acrescente, no fim do `server`:

   ```nginx
   # TLS termina no Apache .31; o app monta as URLs públicas com https.
   set $steel_forwarded_proto https;
   include /etc/nginx/snippets/steel-locations.conf;
   ```

   Num host onde o próprio nginx termina o TLS (produção), use
   `set $steel_forwarded_proto $scheme;` e **não** instale o
   `steel-realip-homologacao.conf`.
3. Se o `nginx.conf` já tiver `gzip_proxied`/`gzip_types`, deixe só um dos
   dois lugares (o `nginx -t` acusa diretiva duplicada).

```bash
nginx -t && systemctl reload nginx
```

O Apache de borda (.31) **não muda**: ele já repassa `/`, `/api/mcp` e
`/realtime` para o nginx do .145 (ver [MCP](./mcp-edge-proxy.md) e
[realtime](./realtime-wiki.md)).

> Até o upstream estar instalado, o nginx só fala com `127.0.0.1:3000`
> (`nextjs-app`): o site funciona, mas sem as outras duas réplicas e com o
> mesmo instante fora do ar de antes em cada deploy.

### 1.3 Conferir

```bash
# as três respondem direto
for p in 3000 3001 3002; do curl -s -o /dev/null -w "$p %{http_code}\n" http://127.0.0.1:$p/api/status/live; done
# o nginx distribui (repita algumas vezes; o access log mostra o upstream)
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: homologacao.stratustelecom.com.br' http://127.0.0.1/sign-in
# MCP e SSE sem buffering, realtime com upgrade: ver os diagnósticos dos runbooks de MCP e realtime
```

## 2. Deploy em rolagem

O CD não muda de forma: ele chama `scripts/deploy.sh <tag>`, que agora:

1. sobe `steel-worker`, `steel-realtime` (e `steel-pgbouncer`, se o perfil
   estiver ligado);
2. para cada réplica, em ordem (`steel-app`, `steel-app-2`, `steel-app-3`):
   recria o container, espera o healthcheck (`GET /api/status/live`) ficar
   `healthy` e confere `/sign-in` 200, CSP, HSTS e o redirect de
   `/onboarding` **na porta daquela réplica**;
3. só então passa para a próxima. Enquanto uma é trocada, o nginx serve com
   as outras (`max_fails=3 fail_timeout=10s` tira a que está reiniciando).

Se uma réplica falha, a rolagem para e o script volta **todas** para o tag
anterior pelo mesmo caminho; o log do job mostra qual réplica e as últimas
50 linhas dela. O [Rollback](./ci-deploy-failure.md) usa o mesmo script.

Uma aba aberta durante o deploy recarrega a página sozinha na próxima
navegação (deployment id): é o esperado, não um erro.

## 3. Saúde

```bash
cd /var/www/steel
docker compose ps steel-app steel-app-2 steel-app-3   # todas "Up ... (healthy)"
docker stats --no-stream nextjs-app steel-app-2 steel-app-3
docker logs --tail 100 steel-app-2
```

- `(unhealthy)` numa réplica: o nginx já a tirou da rotação. Veja o log e
  reinicie só ela (seção 4).
- Todas `unhealthy` ao mesmo tempo: o problema não é das réplicas (rede,
  disco, memória do host). `free -g`, `df -h`, `dmesg | tail` (OOM killer).
- Log `next_cache.tags_refresh_failed` / `next_cache.redis_error`: a réplica
  perdeu o Redis. Ela continua servindo, mas um site publicado pode demorar a
  atualizar nela até reconectar. Confira o `steel-redis`.

## 4. Reiniciar, tirar ou acrescentar uma réplica

```bash
cd /var/www/steel
docker compose restart steel-app-2      # reinicia só uma; as outras seguem servindo
```

**Tirar uma da rotação** sem parar o container (investigar, por exemplo):
no `/etc/nginx/conf.d/steel-upstream.conf`, acrescente `down` na linha dela
(`server 127.0.0.1:3001 max_fails=3 fail_timeout=10s down;`), `nginx -t &&
systemctl reload nginx`. Desfaça do mesmo jeito.

**Acrescentar uma réplica** (depois de medir memória e CPU):

1. no `docker-compose.yml` do repositório, copie o bloco `steel-app-3` como
   `steel-app-4` com a porta `127.0.0.1:3003:3000`;
2. em `infra/nginx/steel-upstream.conf`, acrescente
   `server 127.0.0.1:3003 max_fails=3 fail_timeout=10s;`;
3. commit; depois do deploy (o `deploy.sh` já rola qualquer `steel-app-<n>`),
   instale o upstream novo e recarregue o nginx;
4. se passar de ~5 réplicas, ligue o PgBouncer (seção 5) antes.

**Voltar para uma réplica só** (emergência): no upstream, deixe só
`server 127.0.0.1:3000 ...;` e recarregue o nginx; depois
`docker compose stop steel-app-2 steel-app-3`.

## 5. PgBouncer (opcional)

Sem configuração, cada processo abre até `DB_POOL_MAX` (padrão 10) conexões
direto no Postgres: três réplicas + worker + realtime = até 50. Para mais
réplicas, ligue o pooler. No SOPS do ambiente:

```bash
COMPOSE_PROFILES=pooler
DATABASE_URL_POOLED=postgresql://<usuário>:<senha>@steel-pgbouncer:5432/<banco>
DB_POOL_MAX=20
```

O próximo deploy sobe o `steel-pgbouncer` (modo transaction, até 300
clientes, 40 + 5 conexões reais no Postgres) e as réplicas passam a usá-lo.
Migrations, backups e restores continuam no `DATABASE_URL` direto.

Ver o que o pooler está segurando (`cl_waiting` > 0 de forma constante =
`DEFAULT_POOL_SIZE` pequeno):

```bash
docker exec -e PGPASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' /var/www/steel/.env)" steel-db \
  psql -h steel-pgbouncer -p 5432 -U "$(sed -n 's/^POSTGRES_USER=//p' /var/www/steel/.env)" \
  -d pgbouncer -c 'SHOW POOLS;'
```

Para desligar: remova `DATABASE_URL_POOLED` (o app volta ao Postgres direto
no próximo deploy) e depois `COMPOSE_PROFILES`.

## 6. Cache dos sites entre réplicas

Cada réplica guarda em memória o que leu com `'use cache'` (sites
publicados); quando um site é publicado numa réplica, as outras ficam
sabendo pelo Redis antes da próxima requisição. Chaves:

```bash
docker exec steel-redis redis-cli --tls --cacert /opt/bitnami/redis/certs/ca.crt \
  -a "$(sed -n 's/^REDIS_PASSWORD=//p' /var/www/steel/.env)" -n <db> \
  HGETALL steel:next-cache:tags:expired
```

(`<db>` é o número no fim do `REDIS_URL`.) Cada campo é uma tag
(`site:<slug>`) com o horário (ms) da última publicação. Se um site
publicado não atualiza numa réplica, confira o log dela (seção 3) e, em
último caso, reinicie só aquela réplica — o cache dela começa vazio.

## 7. Teste de capacidade (k6)

**Só com o ok do product owner, e nunca em horário de uso.** No topo da
rampa é uma carga real no host.

```bash
# degraus de 1.000 VUs até 6.000 (padrão), budget remoto inferido do BASE_URL
BASE_URL=https://homologacao.stratustelecom.com.br SITE_SLUG=<site publicado> \
  k6 run k6/capacity-test.js
# platô
PROFILE=hold VUS=3000 RAMP=5m HOLD=5m BASE_URL=... k6 run k6/capacity-test.js
```

- Rode o gerador fora do host do Steel e de preferência vários geradores:
  um IP só bate no rate limit do app (contado em `rate_limited`, não como
  falha).
- Durante o teste, no host: `docker stats` das três réplicas e do
  `steel-db`, e `SHOW POOLS` se o pooler estiver ligado.
- Anote no PR/ADR: degrau em que p95 passou do budget ou a falha passou de
  1%, req/s nesse degrau e CPU por réplica. O teste aborta sozinho quando 5%
  das requisições falham por um minuto.

O smoke diário (`k6/smoke-test.js`, `k6/api-smoke-test.js`) continua no
workflow Performance, com o budget do ambiente em `k6/profiles.js`.
