# Reiniciar um serviço

**Quando usar:** um container está travado, `unhealthy`, em loop de
`Restarting`, ou o [health check](./health-check.md) apontou um serviço.

Antes de reiniciar, **salve os logs** (o reinício não os apaga, mas facilita
a análise depois):

```bash
docker logs --tail 500 <container> > /tmp/<container>-$(date +%F-%H%M).log 2>&1
```

## Comandos por serviço

Todos os containers têm `restart: unless-stopped`: se o processo morrer, o
Docker sobe de novo sozinho. O reinício manual é para quando ele está de pé
mas travado.

| Serviço | Container | Reiniciar | Impacto |
| ------- | --------- | --------- | ------- |
| App (Next) | `nextjs-app`, `steel-app-2`, `steel-app-3` | uma réplica: `cd /var/www/steel && docker compose restart steel-app-2` (serviços `steel-app`, `steel-app-2`, `steel-app-3`) | nenhum com o upstream instalado: as outras réplicas seguem servindo ([réplicas](./app-replicas.md)); reinicie uma por vez |
| Worker | `steel-worker` | `cd /var/www/steel && docker compose restart steel-worker` | jobs pausam; retomam sozinhos |
| Banco | `steel-db` | `docker restart steel-db` | **app e worker falham** até voltar |
| Redis | `steel-redis` | `docker restart steel-redis` | sessões/cache/filas indisponíveis por segundos |
| MinIO | `steel-minio` | `docker restart steel-minio` | upload/download de arquivos e mídia falham |
| nginx | — | ver abaixo | site inteiro fora durante o reload/restart |

`docker restart <container>` funciona para qualquer um deles,
independentemente de onde está o arquivo compose.

### Ordem quando vários caíram (ex.: após reboot do servidor)

1. Infra primeiro: `steel-db`, `steel-redis`, `steel-minio`. Espere ficarem
   `(healthy)`:
   ```bash
   docker ps --format '{{.Names}}\t{{.Status}}' | grep steel-
   ```
2. Depois app e worker:
   ```bash
   cd /var/www/steel && docker compose up -d
   ```

Se os containers de infra não existem mais (não só parados), recrie a partir
do diretório onde está o `docker-compose.infra.yml` (o mesmo `.env` precisa
estar ao lado):

```bash
docker compose -f docker-compose.infra.yml up -d
```

> **Nunca** use `docker compose down -v` — apaga os volumes (dados).

### nginx

O nginx não faz parte dos composes do repositório. Descubra como ele roda:

```bash
systemctl status nginx 2>/dev/null | head -3   # instalado no host?
docker ps --format '{{.Names}}' | grep -i nginx # ou em container?
```

- **No host (systemd):** valide a configuração e recarregue (sem derrubar
  conexões):
  ```bash
  sudo nginx -t && sudo systemctl reload nginx
  # se reload não resolver:
  sudo systemctl restart nginx
  ```
- **Em container:** `docker restart <nome-do-container-nginx>`.

Se `nginx -t` acusar erro, **não reinicie** — corrija o arquivo apontado
primeiro (o restart com config inválida deixa o site fora).

## Confirmar

1. `docker ps` mostra o container `Up` (e `(healthy)` para infra).
2. `docker logs --tail 50 <container>` sem erros novos. Para o worker, deve
   aparecer `queue.worker.started`.
3. [Health check](./health-check.md) passo 1 e 2 ok.

## Se não voltar

- Loop de `Restarting` no app/worker logo após um deploy → provável bug ou
  variável de ambiente nova faltando: veja
  [CI vermelho / deploy falhou](./ci-deploy-failure.md#deploy-saiu-e-quebrou-a-produção).
- `steel-db` não sobe com `No space left on device` → libere disco
  (`docker image prune -f`, logs antigos) antes de qualquer outra coisa.
- Dados corrompidos → [restaurar backup](./restore-backup.md).
