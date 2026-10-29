# Nó do n8n (E3)

Pacote `@steel-so/n8n-nodes-steel`, em `integrations/n8n/`. Dá ao n8n o gatilho
de webhook do Steel e ações sobre a API pública v1 (ADR 0035) e os webhooks de
saída (ADR 0036). Roadmap: E3, rótulo `2026.06.11.3`. Make e Zapier ficam para
uma fatia própria (veja "Fora do escopo").

## O que tem

| Peça | Arquivo | Observação |
| --- | --- | --- |
| Credencial `steelApi` | `credentials/SteelApi.credentials.ts` | `baseUrl` + token `stl_pat_...`; botão **Test** chama `GET /api/v1/me` |
| Nó **Steel** | `nodes/Steel/` | recursos `ticket`, `lead`, `opportunity`, `template`, `conversation`, `apiCall`; `usableAsTool` |
| Nó **Steel Trigger** | `nodes/SteelTrigger/` | webhook `POST`; cadastra e remove o endpoint sozinho |
| Helpers | `nodes/shared/steel.ts` | cliente do SDK a partir da credencial, `unwrap` (erro do SDK vira `NodeApiError` com dica), paginação |
| Testes | `integrations/n8n/test/` | Vitest, SDK mockado; contextos do n8n simulados |
| CI e publicação | `.github/workflows/n8n-node.yml` | verificação em PR e no `main`; publicação por tag `n8n-node-v<semver>` |

## Decisões

- **Pasta própria, sem entrar no workspace do app.** `integrations/n8n` tem
  `package.json`, `pnpm-workspace.yaml` (raiz própria, com `minimumReleaseAge` e
  `trustPolicy` iguais aos do app) e `pnpm-lock.yaml`. O `tsconfig.json` do app
  exclui `integrations`; o Biome do app **inclui** `integrations/**`, então o
  lint e o formato rodam no CI principal.
- **Depende do `@steel-so/sdk` publicado no npm** (devDependency, versão exata),
  nunca do código do repositório `steel-cli`. O `tsup` **embute** o SDK no
  bundle CommonJS: o pacote publicado não tem dependência de runtime, só
  `n8n-workflow` como peer. É o que a verificação do n8n exige, e
  `scripts/check-bundle.cjs` (rodado no CI) falha se sobrar qualquer outro
  `require`.
- **Textos do nó em inglês.** O editor do n8n não tem tradução de nós da
  comunidade; seguimos o padrão dele. A documentação para o usuário (manual e
  site de desenvolvedores) está em pt-BR.
- **O gatilho usa o endpoint de webhook, não o `listen` (SSE).** `listen` exige
  uma conexão aberta e não sobrevive a reinício do n8n; o endpoint persiste e o
  Steel repete a entrega com backoff (ADR 0036).
- **Ciclo do gatilho.** `create`: `POST /api/v1/webhooks/endpoints` com a URL do
  webhook do n8n e `description` `n8n: <fluxo>`; guarda `endpointId` e `secret`
  no `staticData` do nó (o segredo só volta nessa resposta). `checkExists`: o
  endpoint ainda existe e aponta para a mesma URL. `delete`: `DELETE`, aceitando
  `404`. Se o endpoint sumir do Steel, o n8n recadastra na próxima ativação.
- **Assinatura conferida por padrão** com `verifySignature` do SDK sobre o
  `rawBody` (HMAC-SHA256 de `timestamp.corpo`, janela de 5 minutos); sem segredo
  guardado ou sem `rawBody` a entrega é recusada com `401`. Há a opção
  **Verify Signature** para desligar.
- **Escopo do token.** O gatilho precisa de `api:write` e de um usuário
  OWNER/ADMIN (as rotas de webhook são de administração). Isso está no manual.
- **Custom API Call** só aceita caminhos `/api/v1/...` (sem `..`), então o token
  nunca vai para outra rota ou host.
- **Sem URL padrão na credencial.** O domínio de produção ainda não está fixado
  na documentação; o campo vem vazio, com a homologação de exemplo.

## Publicação

1. Mescle no `main`. O workflow só verifica (tipos, testes com cobertura,
   build, `check-bundle`, `npm pack --dry-run`).
2. Para publicar, crie a tag `n8n-node-v0.1.0` (o número vem da tag). O job `npm`
   publica com **trusted publishing por OIDC** e proveniência, pelo mesmo caminho
   do CLI. **Falta configurar** o publicador confiável do pacote
   `@steel-so/n8n-nodes-steel` em npmjs.com (repositório `steel-so/steel`,
   workflow `n8n-node.yml`); sem isso o job falha.
3. Para o selo de nó verificado, o n8n pede uma submissão no n8n Creator Portal;
   o bundle já não tem dependências de runtime. Não bloqueia o código.

## Fora do escopo desta fatia

- **Make e Zapier.** O roadmap diz "depois"; cada um tem formato e publicação
  próprios (app privado do Make em JSON; app do Zapier com a CLI deles). Ambos
  podem reusar o contrato acima: token pessoal, API v1 e
  `POST /api/v1/webhooks/endpoints` (REST hooks).
- Mais operações no nó (catálogo, fases, importação de leads em CSV): hoje
  cobertas pelo **Custom API Call**; entram conforme a API v1 crescer.
