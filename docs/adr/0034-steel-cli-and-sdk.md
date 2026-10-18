# 0034 — Steel CLI e SDK em repositório próprio

- **Status:** Aceita
- **Data:** 2026-10-18
- **Decisores:** product owner + time de engenharia

## Contexto

Quem integra com o Steel hoje só tem a API REST e, desde a ADR 0032, o
servidor MCP. Falta uma ferramenta de terminal para scripts, CI e para quem
desenvolve integrações: login, chamadas autenticadas, receber webhooks na
própria máquina e os fluxos mais comuns de cada módulo. Plano aprovado pelo
product owner em 2026-10-17.

## Decisão

**O Steel CLI (`steel`) e o SDK TypeScript vivem no repositório
`steel-so/steel-cli`, separados do app, e falam com o Steel só pela API
pública versionada (ADR 0035).**

Detalhes para aplicar:

- **Estrutura:** monorepo pnpm com `packages/sdk` (`@steel-so/sdk`, gerado do
  `openapi.v1.json` publicado pelo app) e `packages/cli` (`@steel-so/cli`,
  binário `steel`).
- **Interface:** TypeScript + Ink, tema com as cores do Steel. Saída rica no
  terminal interativo; `--json` estável (e sem cor) fora de TTY ou quando
  pedido; respeita `NO_COLOR`. Mensagens ao usuário em pt-BR.
- **Credenciais:** `steel login` usa o fluxo de dispositivo e termina com um
  token pessoal (ADR 0035). Token guardado no keychain do sistema; sem
  keychain, em `~/.config/steel/credentials` com permissão 600. `STEEL_TOKEN`
  no ambiente tem precedência (CI).
- **Perfis:** produção e homologação (`--profile`), cada um com URL e token.
- **Versão:** SemVer próprio, independente do CalVer do app (ADR 0003). Uma
  mudança incompatível na saída `--json` é major.
- **Distribuição:** npm (`@steel-so/cli`), binários únicos por plataforma via
  `bun build --compile` (Linux, macOS, Windows) e Homebrew tap
  `steel-so/tap`. Release por GitHub Actions no repo do CLI.
- **Ponte MCP:** `steel mcp` expõe o servidor MCP remoto via stdio para
  clientes que não fazem OAuth.

## Consequências

- O CLI e o SDK têm ciclo de release próprio e não travam o deploy do app.
- Toda funcionalidade do CLI depende de rotas na API v1; nada de rotas
  internas.
- Dois repositórios para manter; o repo do CLI roda um teste de contrato
  contra a homologação a cada release.
