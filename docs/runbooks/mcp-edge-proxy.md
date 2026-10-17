# Runbook — proxy de borda do servidor MCP (`/api/mcp`)

O servidor MCP do Steel (ADR 0032) roda **dentro do app** (`nextjs-app`), na
rota `POST /api/mcp`, com transporte **Streamable HTTP sem estado**. Não há
container, porta nem domínio novo: o que muda é o **proxy**, que precisa
repassar a resposta sem segurar.

Use este runbook na primeira instalação (homologação e produção) e quando um
cliente de IA (Claude, ChatGPT, Cursor) não conseguir conectar ou ficar
"pendurado" esperando a resposta.

## Por que o proxy importa

- A resposta de `POST /api/mcp` pode vir como **SSE** (`Content-Type:
  text/event-stream`): o servidor manda os eventos à medida que a ferramenta
  roda. Um proxy com **buffering** ou **compressão** segura tudo até o fim, e
  o cliente estoura o próprio timeout ou recebe a resposta de uma vez.
- A autenticação é por **bearer** (`Authorization: Bearer <token>`). O proxy
  precisa repassar o header `Authorization` para o app e devolver o
  `WWW-Authenticate` do `401` sem mexer.
- A descoberta OAuth passa por `/.well-known/oauth-protected-resource` e
  `/.well-known/oauth-authorization-server`, servidas **pelo app**. Nenhum
  proxy pode responder `/.well-known/` sozinho (só o
  `/.well-known/acme-challenge/` do certbot).
- O app monta as URLs dos metadados a partir da origem pública. Se o proxy não
  repassar `Host` e `X-Forwarded-Proto: https`, os metadados saem com `http://`
  ou com o IP interno, e o cliente de IA recusa.

## Caminho da requisição

Homologação (dois proxies, como no realtime da Wiki — ver
`realtime-wiki.md`):

```text
cliente de IA ──https:443──▶ Apache .31 (TLS) ──http:80──▶ nginx .145 ──▶ nextjs-app (3000)
```

Produção: o nginx do servidor termina o TLS e fala direto com o
`nextjs-app`. Se houver outro proxy de borda na frente (balanceador, WAF), ele
precisa das mesmas regras.

## 1. nginx (homologação .145 e produção)

O nginx não está nos composes do repositório (ver `restart-service.md`). No
`server` do domínio do Steel, acrescente **antes** do `location /` (use no
`proxy_pass` o mesmo destino do `location /` existente):

```nginx
# MCP server (Streamable HTTP): stream SSE responses without buffering.
location = /api/mcp {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_request_buffering off;
    gzip off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```

Em homologação o TLS termina no Apache, então o `$scheme` do nginx é `http`.
Ali, troque a linha por `proxy_set_header X-Forwarded-Proto https;` (ou repasse
o header que o Apache já envia, se o `location /` faz isso).

Confira também que nenhum `location /.well-known/` genérico serve arquivos do
disco; só o `location /.well-known/acme-challenge/` pode existir.

Depois: `sudo nginx -t && sudo systemctl reload nginx`.

## 2. Apache de borda (homologação, 10.10.100.31)

Vhost: `/etc/apache2/sites-available/homologacao.stratustelecom.com.br.conf`.
Acrescente **antes** do `ProxyPass /`:

```apache
    # MCP server (Streamable HTTP): no compression, long timeout.
    <Location /api/mcp>
        SetEnv no-gzip 1
        SetEnv proxy-sendchunked 1
        RequestHeader set X-Forwarded-Proto "https"
    </Location>
    ProxyPass /api/mcp http://10.10.100.145:80/api/mcp timeout=300
    ProxyPassReverse /api/mcp http://10.10.100.145:80/api/mcp
```

- `no-gzip` desliga o `mod_deflate` nessa rota: comprimir SSE segura os
  eventos até encher o bloco.
- O `mod_proxy_http` repassa o `Authorization` por padrão; não acrescente
  regra que remova ou reescreva esse header.
- Confirme que o vhost tem `ProxyPreserveHost On` (já é o caso do `/realtime`).
- `RequestHeader` exige o `mod_headers` (`sudo a2enmod headers`, se faltar).

Depois: `sudo apache2ctl configtest && sudo systemctl reload apache2`.

## 3. Verificar

Troque o domínio pelo do ambiente.

**a) Metadados do recurso** — deve imprimir um JSON com
`"resource": "https://<domínio>/api/mcp"` (com `https` e o domínio público):

```bash
curl -s https://homologacao.stratustelecom.com.br/.well-known/oauth-protected-resource
```

**b) 401 com `WWW-Authenticate`** — sem token, deve responder `401` e o header
apontando para os metadados com `https`:

```bash
curl -s -D - -o /dev/null -X POST https://homologacao.stratustelecom.com.br/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}' | grep -iE '^HTTP|www-authenticate'
```

Esperado:

```text
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer resource_metadata="https://homologacao.stratustelecom.com.br/.well-known/oauth-protected-resource"
```

**c) `GET` não serve página** — `curl -s -o /dev/null -w '%{http_code}\n'
https://homologacao.stratustelecom.com.br/api/mcp` imprime `405` (ou `401`, a
resposta de quem chega sem token). Um `200` com HTML ou um `404` significa que
a regra não chegou no app.

**d) Sem buffering** — com um token de acesso válido em `$TOKEN` (de uma
conexão de teste, por exemplo com a conta de smoke), a resposta tem que começar
a chegar antes do fim:

```bash
curl -N -s -X POST https://homologacao.stratustelecom.com.br/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Para achar qual salto segura a resposta, repita (b) e (d) no .145 contra
`http://127.0.0.1/api/mcp` (com `-H "Host: homologacao.stratustelecom.com.br"`)
e contra `http://127.0.0.1:3000/api/mcp`. O primeiro salto que responde certo
está bem configurado; o problema está no anterior.

## Sintomas

| Sintoma | Causa provável |
| --- | --- |
| Cliente diz que o servidor não oferece OAuth / "falha ao descobrir a autorização" | `/.well-known/oauth-*` não chega ao app, ou o `WWW-Authenticate` foi removido |
| Metadados com `http://` ou IP interno | falta `X-Forwarded-Proto: https` ou `ProxyPreserveHost On` |
| Login funciona, mas toda chamada volta `401` | o proxy descartou o `Authorization` |
| Ferramentas demoradas estouram tempo, ou a resposta chega toda no fim | buffering (`proxy_buffering`) ou compressão (`mod_deflate`/`gzip`) ligados na rota |
| `504` em ferramentas longas | `proxy_read_timeout` / `timeout` abaixo do tempo da ferramenta |

Os logs do app ficam no Axiom (rota `/api/mcp`, via `withAxiom`); um `401`
que nunca aparece lá não chegou ao app.
