# Runbook — servidor realtime da Wiki (Hocuspocus)

A Wiki edita em tempo real (Yjs) por um processo próprio, `realtime/index.ts`
(Hocuspocus), empacotado em `dist/realtime.cjs` na mesma imagem do app e do
worker. Em produção roda no container `steel-realtime`, publicado **só no
loopback** (`127.0.0.1:1235`).

O navegador conecta em `wss://<domínio>/realtime` (mesma origem, para o cookie
de sessão chegar ao servidor, que autentica pelo Better Auth e confere se o
usuário é membro do workspace com a Wiki ativada). Sem `NEXT_PUBLIC_REALTIME_URL`
o build já usa essa URL — não há build-arg nem secret novo.

## Caminho da conexão (homologação)

Em homologação há **dois proxies** entre o navegador e o realtime. O TLS
termina num **Apache 2.4 em 10.10.100.31** (host `sistemas`, Debian 11; vhost
`/etc/apache2/sites-available/homologacao.stratustelecom.com.br.conf`, com
`ProxyPass / http://10.10.100.145:80/`), que repassa para o **nginx em
10.10.100.145** (só porta 80, `location /realtime` → `127.0.0.1:1235`):

```text
navegador ──wss:443──▶ Apache .31 (TLS) ──http:80──▶ nginx .145 ──▶ steel-realtime (127.0.0.1:1235)
```

**Os dois saltos precisam repassar o upgrade de WebSocket.** Basta um deles
derrubar o `Upgrade` para o editor ficar em "Sem conexão". Em produção vale o
mesmo para qualquer proxy de borda que fique na frente do nginx.

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

Sem esse bloco a Wiki abre, mas o editor fica em **"Sem conexão"** e não
salva o estado colaborativo (o autosave do conteúdo por API continua
funcionando).

## 1.1 Apache de borda (homologação, 10.10.100.31)

O Apache precisa passar o upgrade de WebSocket de `/realtime` **antes** do
`ProxyPass /` do vhost (o `mod_proxy_wstunnel` já está carregado; o Apache
≥ 2.4.47 aceita `upgrade=websocket`):

```apache
    # Wiki realtime (Hocuspocus): WebSocket upgrade must pass through.
    ProxyPass /realtime http://10.10.100.145:80/realtime upgrade=websocket
    ProxyPassReverse /realtime http://10.10.100.145:80/realtime
```

Depois: `sudo apache2ctl configtest && sudo systemctl reload apache2`.

**Sintoma quando falta:** o editor mostra **"Sem conexão"**, o
`docker logs steel-realtime` não mostra **nenhum** `realtime.authenticate.*`,
e o access log do nginx .145 mostra `GET /realtime ... 200 33` vindo de
10.10.100.31 (o upgrade foi descartado no Apache e o Hocuspocus respondeu como
HTTP comum).

### Diagnóstico

De qualquer máquina, deve imprimir `HTTP/1.1 101 Switching Protocols`:

```bash
curl -s -D - -o /dev/null --max-time 4 -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  https://homologacao.stratustelecom.com.br/realtime | head -1
```

Não use `-o /dev/null -w '%{http_code}'`: o curl mantém o socket aberto e
imprime `000`. Um `200` com corpo "Welcome to Hocuspocus!" significa que algum
proxy está removendo o upgrade. Para achar qual salto, repita o mesmo comando
no .145 contra `http://127.0.0.1/realtime` (com `-H "Host:
homologacao.stratustelecom.com.br"`) e contra `http://127.0.0.1:1235/` — o
primeiro salto que devolve `101` está certo; o problema está no anterior.

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
