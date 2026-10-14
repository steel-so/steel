# Runbook — servidor realtime da Wiki (Hocuspocus)

A Wiki edita em tempo real (Yjs) por um processo próprio, `realtime/index.ts`
(Hocuspocus), empacotado em `dist/realtime.cjs` na mesma imagem do app e do
worker. Em produção roda no container `steel-realtime`, publicado **só no
loopback** (`127.0.0.1:1235`).

O navegador conecta em `wss://<domínio>/realtime` (mesma origem, para o cookie
de sessão chegar ao servidor, que autentica pelo Better Auth e confere se o
usuário é membro do workspace com a Wiki ativada). Sem `NEXT_PUBLIC_REALTIME_URL`
o build já usa essa URL — não há build-arg nem secret novo.

## 1. Primeira instalação: location no nginx

O nginx não está nos composes do repositório (ver `restart-service.md`). No
`server` do domínio do Steel, acrescente **antes** do `location /`:

```nginx
location /realtime {
    proxy_pass http://127.0.0.1:1235;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

Depois: `sudo nginx -t && sudo systemctl reload nginx`.

Sem esse bloco a Wiki abre, mas o editor fica em "sincronizando" e não salva
o estado colaborativo (o autosave do conteúdo por API continua funcionando).

## 2. Saúde

```bash
docker ps --format '{{.Names}} | {{.Status}}' | grep steel-realtime
docker logs --tail 50 steel-realtime   # realtime.server.started, realtime.authenticate.*
```

`realtime.authenticate.failed` com `reason: forbidden` é esperado para quem não
é membro ou com a Wiki desligada; em massa, confira o cookie no proxy.

## 3. Reiniciar

```bash
cd /var/www/steel && docker compose restart steel-realtime
```

Os editores abertos reconectam sozinhos; o documento vem do Redis/Postgres
(`wiki_pages.yjs_state`).

## 4. Bloqueio de edição (canal Redis `wiki:page-lock`)

Quando o autor ou um OWNER/ADMIN bloqueia/desbloqueia uma página, o app grava
`wiki_pages.locked_at` e publica `{ wikiPageId, lockedAt }` no canal Redis
`wiki:page-lock` (mesmo Redis/DB lógico do `REDIS_URL`). O `steel-realtime`
assina esse canal e, para o documento aberto:

1. manda aos editores uma mensagem *stateless*
   `{"type":"wiki-page-lock-changed","wikiPageId":…,"lockedAt":…}` (o
   front recarrega a página);
2. fecha as conexões do documento. O provider reconecta na hora e o
   `onAuthenticate` decide de novo: quem não pode gerenciar o bloqueio entra
   com `readOnly` (o Hocuspocus descarta as alterações dele e o provider
   recebe o escopo `read-only`).

Logs: `realtime.lock.applied` (por documento aberto) e
`realtime.authenticate.success` com `readOnly: true|false`. Se o canal cair
(`realtime.lock.subscribe_failed` ou `wiki.lock.publish_failed` no app), o
bloqueio continua valendo na API (`423 WIKI_PAGE_LOCKED`) e no próximo
reconectar; para forçar, reinicie o `steel-realtime` (seção 3).

## Local

`pnpm realtime:dev` (porta `REALTIME_PORT`, padrão 1235 — a 1234 é do realtime
do Nexo) com `NEXT_PUBLIC_REALTIME_URL=ws://localhost:1235` no `.env`.
