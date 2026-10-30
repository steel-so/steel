# Disco cheio no servidor da aplicação

**Quando usar:** o app mostra "This page couldn't load" / erro 500 em todas as páginas, o log do app traz `could not write init file: No space left on device`, o `steel-db` fica `unhealthy` em loop ("PANIC: could not write to file ... No space left on device") ou o runner do GitHub cai no meio de um deploy.

**Por que acontece:** cada deploy baixa uma imagem nova do Steel (tag versionada). As antigas não saem sozinhas. Em 29/10/2026 a homologação chegou a 159 imagens (65 GB, 88% sem uso) e o disco foi a 100%.

## 1. Confirmar

```bash
df -h /
docker system df
```

Se `Images` mostra muito espaço "reclaimable", é isso.

## 2. Liberar espaço (seguro)

```bash
docker image prune -a -f
df -h /
```

`-a` apaga só imagens que nenhum contêiner usa. Não toca em volumes nem no `pgdata`. O rollback continua possível: o deploy baixa o tag de volta do registry.

**Nunca** rode `docker system prune --volumes` nem apague nada em volumes do Postgres.

## 3. Recuperar o banco

Com espaço livre, o Postgres conclui a recuperação sozinho. Confirme:

```bash
docker logs steel-db --tail 20     # deve terminar em "database system is ready"
docker ps --format '{{.Names}} {{.Status}}'
```

Se não sair do loop em ~1 minuto: `docker restart steel-db`.

## 4. Voltar o runner e o deploy

Reinicie o serviço do runner `steel-homologacao` (ou rode o `run.sh`) e reexecute o deploy que falhou em **Actions › CD › Re-run**.

## Prevenção

- `scripts/deploy.sh` apaga, ao fim de cada deploy, imagens sem uso com mais de 72h (`IMAGE_PRUNE_AGE`) e avisa no log quando o disco passa de 80% (`DISK_WARN_PERCENT`).
- Alerta de disco: o Zabbix cobre o servidor do próprio Zabbix (template em `infra/zabbix/`). O servidor da aplicação ainda **não** tem alerta próprio.
