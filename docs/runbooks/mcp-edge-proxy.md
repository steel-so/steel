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

## 1. Configuração atual da homologação (aplicada em 17/10/2026)

As regras abaixo **já estão no ar** em homologação. Use esta seção como
referência para conferir, refazer depois de uma reinstalação ou copiar para
produção. Nos dois hosts o usuário `stratus` não tem `sudo`: o acesso de root é
por `su -`.

### 1.1 Apache de borda (10.10.100.31)

Vhost `/etc/apache2/sites-available/homologacao.stratustelecom.com.br.conf`,
**antes** do `ProxyPass /`:

```apache
    <Location /api/mcp>
        SetEnv no-gzip 1
        SetEnv dont-vary 1
    </Location>
    ProxyPass /api/mcp http://10.10.100.145:80/api/mcp flushpackets=on
    ProxyPassReverse /api/mcp http://10.10.100.145:80/api/mcp
```

- `no-gzip` (e `dont-vary`) desligam o `mod_deflate` nessa rota: comprimir SSE
  segura os eventos até encher o bloco.
- `flushpackets=on` manda cada pedaço da resposta adiante assim que chega.
- O `mod_proxy_http` repassa o `Authorization` por padrão; não acrescente regra
  que remova ou reescreva esse header. Confira que o vhost mantém
  `ProxyPreserveHost On` (já é o caso do `/realtime`).

Para mudar: faça um backup ao lado do arquivo
(`cp homologacao.stratustelecom.com.br.conf homologacao.stratustelecom.com.br.conf.bak-$(date +%F)`),
edite e rode `apache2ctl configtest && systemctl reload apache2` (como root).

### 1.2 nginx (10.10.100.145)

Arquivo `/etc/nginx/sites-enabled/homologacao.stratustelecom.com.br`,
**antes** do `location /`:

```nginx
location /api/mcp {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    # Same forwarding headers as `location /`.
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

Os `proxy_set_header` de encaminhamento são **os mesmos do `location /`**
desse arquivo; se o `location /` mudar (por exemplo, o `X-Forwarded-Proto`
fixo em `https`, já que o TLS termina no Apache), mude aqui também.

Para mudar: backup em `/root` (`cp /etc/nginx/sites-enabled/homologacao.stratustelecom.com.br /root/nginx-homologacao.bak-$(date +%F)`),
edite e rode `nginx -t && systemctl reload nginx` (como root).

Confira também que nenhum `location /.well-known/` genérico serve arquivos do
disco; só o `location /.well-known/acme-challenge/` pode existir.

### 1.3 Runner do GitHub Actions no .145

O mesmo host roda o runner self-hosted do CD (ADR 0005). Ele está registrado
no repositório `steel-so/steel` como **`steel-homologacao`** (labels
`self-hosted`, `homologacao`), mas a unidade do systemd manteve o nome antigo,
de antes da mudança de organização:

```bash
systemctl status actions.runner.stratus-so-steel.steel-homologacao.service
```

Não estranhe o `stratus-so` no nome; não é preciso recriar a unidade. Recarregar
o nginx não afeta o runner.

## 2. Produção (nginx)

Em produção o nginx do servidor termina o TLS e fala direto com o
`nextjs-app`. Use o mesmo bloco `location /api/mcp` da seção 1.2 **antes** do
`location /` do domínio, com os headers de encaminhamento do `location /` de
lá (o `$scheme` já é `https`). Faça o backup em `/root`, depois
`nginx -t && systemctl reload nginx`. Se houver outro proxy de borda na frente
(balanceador, WAF), ele precisa das mesmas regras: sem compressão, sem buffering
e com `Authorization`, `Host` e `X-Forwarded-Proto` repassados.

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
curl -sN -X POST https://homologacao.stratustelecom.com.br/api/mcp \
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
