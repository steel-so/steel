# Verificar se o sistema está no ar

**Quando usar:** alguém reportou erro/lentidão, alerta de monitoramento, ou
checagem de rotina depois de um deploy/reinício.

Siga na ordem; pare quando achar o problema e vá para o runbook indicado.

> Os problemas costumam chegar antes pelo Slack: o canal **#alerts** recebe as quedas e voltas dos componentes do `/status` e os jobs do worker que morreram; o Better Stack avisa se o servidor inteiro sair do ar. Detalhes em [Alertas no Slack](../architecture/overview.md#alertas-no-slack-alerts).

## 1. Status page (de fora, sem acessar o servidor)

1. Abra `https://<domínio>/status`.
2. Leia o estado de cada componente: **Aplicação, Banco de dados, Cache
   (Redis), Autenticação** (core) e **Assinatura, Envio de e-mail (Resend),
   Armazenamento (MinIO)** (periféricos).
3. Veja o horário da última atualização. O worker coleta os core **a cada 1
   min** e os periféricos **a cada 5 min**. Se nada mudou há mais de ~10 min,
   o **worker está parado** — vá ao passo 3 e reinicie o `steel-worker`.
4. **Aplicação em "Interrupção total" com o site no ar** é a sonda, não a
   app: o worker precisa falar com o Next pela rede Docker
   (`STATUS_APP_PROBE_URL=http://nextjs-app:3000`, padrão no
   `docker-compose.yml`). Pelo domínio público a requisição sai do container,
   volta pelo IP externo do próprio servidor e o roteador não faz o retorno
   (*hairpin*) — toda coleta estoura o timeout de 5 s. Foi o que deixou o
   `/status` de homologação em interrupção de 18/09 a 08/10/2026.
   Conferir de dentro do worker:
   `docker exec steel-worker node -e 'fetch(process.env.STATUS_APP_PROBE_URL+"/api/status").then(r=>console.log(r.status))'`

Pela linha de comando:

```bash
curl -s https://<domínio>/api/status | head -c 600; echo
```

Resposta `"success":true` = app no ar. Erro 502/504 = o nginx está de pé mas
o app não responde.

## 2. Endpoints de saúde

| Checagem | Comando | Esperado |
| -------- | ------- | -------- |
| App (via nginx) | `curl -sI https://<domínio>/api/status` | `HTTP/2 200` |
| App (direto, no servidor) | `curl -sI http://localhost:3000/api/status` | `HTTP/1.1 200` |
| Cada réplica (no servidor) | `for p in 3000 3001 3002; do curl -s -o /dev/null -w "$p %{http_code}\n" http://127.0.0.1:$p/api/status/live; done` | `200` nas três |
| MinIO (no servidor) | `curl -sI http://127.0.0.1:9002/minio/health/live` | `200 OK` |
| Postgres (no servidor) | `docker exec steel-db pg_isready` | `accepting connections` |
| Redis (no servidor) | `docker exec steel-redis sh -c 'redis-cli --tls --cacert /opt/bitnami/redis/certs/ca.crt -a "$REDIS_PASSWORD" ping'` | `PONG` |

Forçar uma coleta do status page na hora (opcional; o segredo está no
`.env` como `STATUS_COLLECTOR_SECRET`):

```bash
cd /var/www/steel
SECRET=$(grep '^STATUS_COLLECTOR_SECRET=' .env | cut -d= -f2-)
curl -s -X POST -H "x-status-secret: $SECRET" http://localhost:3000/api/status/collect/core
curl -s -X POST -H "x-status-secret: $SECRET" http://localhost:3000/api/status/collect/peripheral
```

## 3. Containers

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' \
  | grep -E 'NAMES|nextjs-app|steel-'
```

Esperado: `nextjs-app`, `steel-app-2`, `steel-app-3`, `steel-worker`,
`steel-realtime`, `steel-db`, `steel-redis`, `steel-minio` todos `Up`. As
réplicas do app e os de infra mostram `(healthy)`; uma réplica
`(unhealthy)` já saiu do upstream do nginx — ver [réplicas](./app-replicas.md).

- `Restarting` ou `Exited` → veja os logs (passo 4) e depois
  [reinicie o serviço](./restart-service.md).
- `(unhealthy)` em `steel-db`/`steel-redis`/`steel-minio` → logs e reinício
  do serviço de infra.

Recursos da máquina (disco cheio derruba o Postgres e o MinIO):

```bash
df -h /            # uso de disco — acima de 90% é urgente
docker system df   # espaço usado por imagens/volumes
free -h            # memória
```

## 4. Logs

```bash
docker logs --tail 200 nextjs-app
docker logs --tail 200 steel-worker
docker logs --tail 200 steel-db
docker logs --tail 200 steel-redis
docker logs --tail 200 steel-minio
# acompanhar ao vivo: acrescente -f  (Ctrl+C para sair)
```

O que procurar:

- `nextjs-app`: `ECONNREFUSED` (banco/Redis/MinIO fora), `ZodError` na
  subida (variável de ambiente faltando/errada no `.env`).
- `steel-worker`: `queue.worker.started` deve aparecer após cada reinício;
  `queue.job.failed` repetido indica um job quebrando.
- `steel-db`: `No space left on device`, `database system is shut down`.

No Axiom, filtre por `component = "Worker"` ou pelo nome do evento (ex.:
`queue.status_collect.failed`, `queue.database_backup.full_failed`).

## 5. Cabeçalhos de segurança e o `Server` do nginx

O job `Security Headers Validation` (workflow **Security DAST**, segundas às
06:00 UTC, também por `workflow_dispatch`) prova três classes de resposta —
página pública, asset de `_next/static` e redirect do middleware — e falha se
alguma perder `X-Frame-Options`, `Strict-Transport-Security`,
`X-Content-Type-Options`, `Content-Security-Policy`, `Referrer-Policy` ou
`Permissions-Policy`. Todos saem da aplicação (`proxy.ts` e `next.config.ts`),
então falha aqui é regressão de código, não de servidor.

O que **não** é da aplicação é o `Server`, que o nginx acrescenta na frente:

```bash
curl -sI https://<domínio>/ | grep -i '^server:'
# Server: nginx/1.18.0   <- expõe a versão (ZAP 10036)
```

O ZAP reporta isso como *Server Leaks Version Information* a cada varredura.
Para resolver, no servidor (fora deste repositório), dentro do bloco `http`
de `/etc/nginx/nginx.conf`:

```nginx
http {
    server_tokens off;   # Server: nginx, sem a versão
    # ...
}
```

Depois `sudo nginx -t && sudo systemctl reload nginx` e confira com o `curl`
acima: o esperado passa a ser `Server: nginx`. Apagar o cabeçalho por completo
exige o módulo `headers-more` (`more_clear_headers Server;`), que não vem no
nginx dos repositórios da distribuição — `server_tokens off` já resolve o
achado. Aproveite para atualizar o nginx: a 1.18.0 é de 2020.

## 6. Backups (checagem diária recomendada)

O backup FULL roda às 03:15 (horário de Brasília). No Axiom, procure:

- `queue.database_backup.full_completed` — backup local OK.
- `queue.database_backup.offsite_completed` — cópia fora do servidor OK.
- `queue.database_backup.offsite_not_configured` — **não há cópia offsite**;
  avise o responsável (ver [restore](./restore-backup.md#configurar-a-cópia-offsite)).
- `..._failed` — falha; abra incidente.
