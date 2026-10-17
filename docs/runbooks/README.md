# Runbooks — operação do Steel

Procedimentos passo a passo para a equipe de TI operar o Steel **sem depender
do engenheiro de produto**. Cada runbook diz quando usar, o que rodar e como
confirmar que deu certo.

| Situação | Runbook |
| -------- | ------- |
| "O sistema está no ar?" / alguém reportou lentidão ou erro | [Verificar se o sistema está no ar](./health-check.md) |
| Um serviço travou, precisa reiniciar | [Reiniciar um serviço](./restart-service.md) |
| Perda de dados, banco corrompido, servidor perdido | [Restaurar um backup](./restore-backup.md) |
| Cliente encerrou / pediu exclusão dos dados | [Excluir um workspace](./delete-workspace.md) |
| CI vermelho, deploy não saiu ou saiu quebrado | [CI vermelho / deploy falhou](./ci-deploy-failure.md) |
| Wiki não sincroniza / instalar o realtime no nginx | [Servidor realtime da Wiki](./realtime-wiki.md) |
| Claude/ChatGPT/Cursor não conectam ao Steel / instalar o MCP no proxy | [Proxy de borda do servidor MCP](./mcp-edge-proxy.md) |

## Referência rápida do servidor

| O quê | Onde |
| ----- | ---- |
| Diretório da aplicação | `/var/www/steel` (`docker-compose.yml` + `.env`) |
| Infra (banco, Redis, MinIO) | `docker-compose.infra.yml` (containers `steel-db`, `steel-redis`, `steel-minio`) |
| App / worker | containers `nextjs-app` (porta 3000) e `steel-worker` |
| Rede Docker | `steel_default` |
| Status público | `https://<domínio>/status` |
| Painel das filas | `https://<domínio>/jobs` (usuário/senha `WORKBENCH_USER`/`WORKBENCH_PASS` do `.env`) |
| Painel admin (workspaces, backups, visão geral) | `https://<domínio>/admin` (conta `@stratustelecom.com.br` com admin global) — ver [painel admin](../admin-panel.md) |
| Logs centralizados | Axiom, dataset `NEXT_PUBLIC_AXIOM_DATASET` |
| Segredos | `secrets/production.enc.env` (SOPS); decriptado em `/var/www/steel/.env` a cada deploy |

> `<domínio>`: o CD publica hoje em `homologacao.stratustelecom.com.br`; o
> domínio de marca é `steel.stratustelecom.com.br`. Use o que estiver ativo.

Regras gerais:

- Nunca rode `docker compose down -v` (o `-v` **apaga os volumes**, ou seja,
  o banco e os arquivos).
- Nunca edite `/var/www/steel/.env` à mão para "consertar" algo: o próximo
  deploy sobrescreve com o conteúdo do SOPS. Mudanças de segredo vão em
  `secrets/production.enc.env`.
- Anote o que fez (horário, comando, resultado) no canal de incidentes.
