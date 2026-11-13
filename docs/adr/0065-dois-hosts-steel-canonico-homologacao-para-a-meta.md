# 0065 — `steel.` como host canônico e `homologacao.` fixo para a Meta

- **Status:** Aceita
- **Data:** 2026-11-13
- **Decisores:** Alexandre (produto/TI)

## Contexto

O Steel passa a ser acessado em `steel.stratustelecom.com.br`. O app da Meta
(WhatsApp Cloud API, Embedded Signup e OAuth do Facebook/Instagram) está
cadastrado em `homologacao.stratustelecom.com.br` e o acesso à conta que
administra esse app foi perdido, então URL de webhook, redirect URIs e domínios
não podem mais ser alterados. A Graph API não tem chamada documentada para
convidar administradores ou mudar essas configurações sem a conta.

Há um só IP público e a porta 443 é compartilhada com outros sites no Apache
(`10.10.100.31`), que separa por nome e repassa ao nginx (`10.10.100.145`).

## Decisão

Os dois nomes apontam para o mesmo servidor e **nenhum sai do DNS**:

- `steel.` é o host canônico (`BETTER_AUTH_URL`, `NEXT_PUBLIC_URL`, e-mails,
  OAuth do login, Google/TikTok, Slack, GitHub, Resend, Apollo).
- `homologacao.` é o host que a Meta enxerga. A variável `META_PUBLIC_URL`
  (opcional, padrão `BETTER_AUTH_URL`) define esse host e é usada no callback
  OAuth do Facebook e do Instagram (`src/lib/social/redirect.ts`).
- O callback da Meta chega em `homologacao.`, onde não há cookie de sessão; a
  rota `app/api/social/callback/[platform]` repassa `code` e `state` ao host
  canônico, que tem a sessão e o cookie PKCE.
- `META_PUBLIC_URL` também é origem confiável do Better Auth, porque o
  Embedded Signup roda no JS SDK no host cadastrado na Meta e o app inteiro
  continua servido nele.
- Não há redirect de páginas em `homologacao.`; Apache e nginx atendem os dois
  nomes (`ServerAlias`/`server_name`).

## Consequências

- O que é da Meta continua funcionando sem acesso ao painel dela.
- Sessões são por host: quem entra por `homologacao.` loga separado de `steel.`.
- URLs já gravadas no banco com o host antigo seguem válidas, porque ele não
  sai do ar.
- Se um dia o acesso à conta da Meta for recuperado, basta cadastrar o host novo
  lá e remover `META_PUBLIC_URL` (volta ao canônico), sem mudança de código.
