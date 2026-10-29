# @steel-so/n8n-nodes-steel

Nós do [n8n](https://n8n.io) para o Steel: o **Steel Trigger** inicia um fluxo
com os eventos do Steel (chamados, SLA, leads, negócios, WhatsApp) e o nó
**Steel** cria e consulta chamados, leads, oportunidades e templates de
WhatsApp pela API pública v1.

## Instalação

No n8n: **Settings › Community nodes › Install** e `@steel-so/n8n-nodes-steel`.
Precisa de Node.js 22 ou mais novo.

## Credencial

Crie um token em **Configurações › Segurança › Tokens de API** do Steel e use-o
na credencial **Steel API** junto com o endereço do seu Steel. Para o gatilho,
o token é **Ler e alterar** e de dono ou administrador do workspace.

## Documentação

- Guia completo: `/dev/n8n` no site de desenvolvedores do seu Steel.
- Decisões e publicação: `docs/integrations/n8n.md` no repositório do Steel.

## Desenvolvimento

```bash
cd integrations/n8n
pnpm install
pnpm typecheck && pnpm test:coverage
pnpm build && pnpm check:bundle
```

Publicação: tag `n8n-node-v<semver>` (veja `.github/workflows/n8n-node.yml`).
