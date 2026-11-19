# Painel do servidor (admin)

`/admin/server` (API `GET /api/admin/server`, só admin global) mostra a saúde
da máquina onde o app roda: CPU, memória, disco, load, uptime, rede,
containers Docker, PostgreSQL e Redis. Atualiza a cada 5 s (botão Pausar) e
mantém um histórico curto (5 min) só no navegador.

## Como coleta

Tudo em `AdminServerService` (`src/services/admin-server.service.ts`), com
parsers puros em `src/lib/server-stats/`.

| Dado | Fonte |
| ---- | ----- |
| CPU | `/proc/stat` lido duas vezes, com 250 ms entre as leituras |
| Memória, load, uptime | `/proc/meminfo`, `/proc/loadavg`, `/proc/uptime` (valores do host: o container não isola esses arquivos) |
| Disco | `statfs('/')` do container (overlay no mesmo disco de `/var/lib/docker`) |
| Rede | `/proc/net/dev` do namespace do container consultado (não do host) |
| Containers | Docker Engine API pelo socket `/var/run/docker.sock` |
| Postgres | `pg_database_size`, `pg_stat_activity`, `max_connections` e latência |
| Redis | `PING` (latência) e `INFO` |

Cada atualização cai em uma das réplicas do app (nginx `least_conn`); por isso
a rede e o disco do container podem variar entre leituras, e o painel mostra a
réplica consultada.

Alertas visuais: disco > 85 %, memória > 90 %, container reiniciando,
`unhealthy`, parado com erro ou com 3+ reinícios acumulados.

## Mudança de infra necessária (não aplicada)

Sem o socket do Docker, tudo funciona **menos a tabela de containers**, que
mostra "Indisponível: monte /var/run/docker.sock:ro". Para ativá-la, o dono do
servidor precisa alterar `docker-compose.yml` (anchor `x-steel-app`, que vale
para todas as réplicas):

```yaml
x-steel-app: &steel-app
  # ...
  volumes:
    - ./redis-tls/ca.crt:/etc/redis-tls/ca.crt:ro
    - /var/run/docker.sock:/var/run/docker.sock:ro
  # O app roda como o usuário `nextjs`; sem o GID do grupo dono do socket
  # (stat -c %g /var/run/docker.sock) a leitura dá EACCES.
  group_add:
    - "${DOCKER_GID:?}"
```

Atenção: `:ro` no socket **não** impede escrita — o modo só vale para o
arquivo do socket, não para os comandos que passam por ele. O coletor do
Steel só emite `GET` em três caminhos fixos (`/containers/json?all=1`,
`/containers/<id>/json` e `/containers/<id>/stats?stream=false`) e recusa
qualquer outro, mas quem tiver execução de código no container do app teria
controle do Docker do host. Alternativa mais segura: um proxy de socket
(ex.: `tecnativa/docker-socket-proxy` com `CONTAINERS=1` e `POST=0`) numa rede
interna, e o app apontando para ele. O cliente atual fala só por socket unix;
se o proxy for adotado, trocar o transporte em
`src/lib/server-stats/docker.ts` é uma mudança pequena.

O container do worker e os do `docker-compose.infra.yml` aparecem na lista
sem nenhuma outra mudança, pois o socket enxerga todo o daemon.
