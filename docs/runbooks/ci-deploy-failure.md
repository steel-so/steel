# CI vermelho / deploy falhou

**Contexto:** todo commit em `main` roda o **CI** (`.github/workflows/ci.yml`).
Só um CI **verde** dispara o **CD** (`cd.yml`), que roda no runner
self-hosted do próprio servidor: migrations → build + scan (Trivy) + push da
imagem → `docker compose pull && up -d` em `/var/www/steel` → tag CalVer +
release → aviso no Slack. Ver [ADR 0001](../adr/0001-trunk-based-main-ci-gate.md)
e [ADR 0005](../adr/0005-self-hosted-runner-on-prod-server.md).

**Regra de ouro:** CI vermelho **não afeta a produção** — o que está no ar é
o último deploy verde. Não há pressa de "consertar em produção"; há pressa de
destravar `main`, porque nada novo sai enquanto ele estiver vermelho.

Onde olhar: GitHub → repositório → **Actions**. O Slack recebe
"Deploy succeeded/failed" ao fim de cada CD.

## 1. Identifique onde falhou

Abra a execução com ❌ e veja qual job falhou:

| Job | Significa | O que fazer |
| --- | --------- | ----------- |
| Lint & Type Check / Unit / Integration / E2E / Build | problema no código do commit | [passo 2](#2-ci-vermelho-por-código) |
| Docker Image Build | o código builda no CI mas não dentro da imagem (sem `.env`, `SKIP_ENV_VALIDATION=true`): em geral código de topo de módulo que lê env ou rede na importação. É o mesmo build que o CD faz, então corrigir aqui evita deploy quebrado | [passo 2](#2-ci-vermelho-por-código) |
| Security (audit, Snyk, Semgrep, Gitleaks) | dependência vulnerável ou segredo no código | [passo 2](#2-ci-vermelho-por-código); segredo vazado = **rotacionar o segredo** além de remover |
| Qualquer job com erro de rede, timeout, `docker pull` falhando, runner sem espaço | falha de infraestrutura, não de código | **Re-run failed jobs** (botão no canto superior direito). Se repetir, abra incidente |
| CD → Run Database Migrations | migration não aplicou | [passo 3](#3-cd-falhou) |
| CD → Build & Deploy | build/scan/push/compose falhou | [passo 3](#3-cd-falhou) |
| CD → Tag & Release | só a tag/release falhou; **o deploy já está no ar** | Re-run do job; não é urgente |

## 2. CI vermelho por código

1. Leia o log do passo que falhou (clique no job → passo com ❌). A última
   mensagem de erro costuma dizer o arquivo/teste.
2. Descubra o commit culpado: é o do run (título do run = mensagem do commit).
3. Opções:
   - **Reverter** (resolve em minutos, sem depender de ninguém entender o bug):
     ```bash
     git checkout main && git pull
     git revert <sha-do-commit>
     git push
     ```
     Isso gera um commit novo que desfaz o anterior; o CI roda de novo e,
     verde, o CD republica o estado anterior. Nunca use `git push --force`.
   - **Corrigir**: se o autor está disponível e a correção é óbvia, ele commita
     o fix em `main`.
4. Teste intermitente (passou antes, falhou agora sem mudança relacionada):
   **Re-run failed jobs** uma vez. Se passar, registre o teste instável para
   correção.

## 3. CD falhou

A produção continua no último deploy bem-sucedido, **exceto** se a falha foi
depois do `docker compose up -d` (aí veja [passo 4](#deploy-saiu-e-quebrou-a-produção)).

### CD nem começou / ficou "Queued"

O runner self-hosted está offline.

1. No servidor, veja o serviço do runner:
   ```bash
   sudo systemctl list-units 'actions.runner*'
   sudo systemctl status 'actions.runner*'
   ```
2. Reinicie: `sudo systemctl restart 'actions.runner.*'`
3. No GitHub: Settings → Actions → Runners — o runner deve aparecer "Idle".
4. Re-run do CD (Actions → CD → execução → Re-run all jobs).

### Falhou em "Run Database Migrations"

- Leia o erro do Prisma no log. Causas comuns: banco fora do ar
  ([health check](./health-check.md)), migration conflitante com dados
  existentes (ex.: `NOT NULL` em coluna com nulos).
- Banco fora → suba o `steel-db` ([reiniciar](./restart-service.md)) e re-run.
- Erro da migration em si → **precisa do engenheiro de produto**. O deploy
  não aconteceu, então a produção segue estável na versão anterior.

### Falhou em "Build & Deploy"

| Passo | Causa comum | Ação |
| ----- | ----------- | ---- |
| Build image | erro de build ou falta de disco no runner | `df -h` no servidor; `docker system prune -f` (não usa `-v`, não apaga volumes); re-run |
| Scan image with Trivy | vulnerabilidade **CRITICAL** nova numa dependência | código: atualizar a dependência (Dependabot/engenheiro). Deploy fica bloqueado de propósito |
| Push scanned image | falha no GitHub Container Registry | re-run |
| Decrypt production secrets | `SOPS_AGE_KEY` inválida ou `secrets/production.enc.env` corrompido | verificar o secret no GitHub (Settings → Secrets) |
| Deploy to server | `docker compose pull/up` falhou | ver logs do passo; `cd /var/www/steel && docker compose up -d` manualmente |

## 4. Deploy saiu e quebrou a produção

Sintoma: CD verde, mas o [health check](./health-check.md) falha ou
`nextjs-app`/`steel-worker` em loop de `Restarting`.

1. Logs: `docker logs --tail 200 nextjs-app`. `ZodError` na subida =
   variável de ambiente nova faltando no `secrets/production.enc.env`.
2. **Voltar para a imagem anterior** (rápido, sem código). Cada deploy
   publica a imagem com a tag do SHA do commit:
   ```bash
   # descubra o SHA do último deploy bom: GitHub → Releases (tag CalVer anterior) → commit
   cd /var/www/steel
   docker pull ghcr.io/steel-so/steel:<sha-curto-anterior>
   docker tag ghcr.io/steel-so/steel:<sha-curto-anterior> ghcr.io/steel-so/steel:latest
   docker compose up -d
   ```
   Atenção: se o deploy ruim aplicou uma migration que a versão anterior não
   suporta, voltar a imagem pode não bastar — acione o engenheiro.
3. Em paralelo, **reverta o commit** em `main` ([passo 2](#2-ci-vermelho-por-código))
   para que o próximo deploy não reinstale a versão quebrada.
4. Confirme com o [health check](./health-check.md) e registre o incidente.
