# Subdomínios dos sites (`<slug>.sites.stratustelecom.com.br`)

Parte 1 do [issue #91](https://github.com/steel-so/steel/issues/91): cada site
publicado abre em `https://<slug>.sites.stratustelecom.com.br`. O caminho
`/s/<slug>` no domínio do app continua funcionando.

## Como funciona

1. DNS: `*.sites.stratustelecom.com.br` aponta para a borda (Apache,
   10.10.100.31 na homologação). Preferir um `CNAME` para
   `homologacao.stratustelecom.com.br`: um `A` para o IP interno só funciona
   dentro da rede.
2. Apache (borda) termina o TLS com um certificado **próprio** para
   `*.sites.stratustelecom.com.br` — o `*.stratustelecom.com.br` não cobre dois
   níveis — e repassa o `Host` original (`ProxyPreserveHost On`) ao nginx.
3. nginx (10.10.100.145) aceita `*.sites.stratustelecom.com.br` e repassa ao app
   com as mesmas rotas do host principal.
4. O app reconhece o host por `SITES_ROOT_DOMAIN` (`proxy.ts` →
   `parseSiteHost`) e reescreve para `/s/<slug>`.

## Arquivos

| O quê | Origem no repositório | Destino |
| ----- | --------------------- | ------- |
| vhost Apache | `infra/edge/steel-sites-apache-homologacao.conf` | `/etc/apache2/sites-available/steel-sites.conf` (.31) |
| server nginx | `infra/nginx/steel-sites-homologacao.conf` | `/etc/nginx/sites-enabled/steel-sites` (.145) |
| certificado | emitido por ACME (DNS-01) | `/etc/ssl/steel-sites/{fullchain,privkey}.pem` (.31, `privkey` 0600 root) |
| variável | `secrets/homologacao.enc.env` | `SITES_ROOT_DOMAIN=sites.stratustelecom.com.br` |

## Certificado curinga

Let's Encrypt, desafio DNS-01 (curinga não aceita HTTP-01): o ACME pede um `TXT`
em `_acme-challenge.sites.stratustelecom.com.br`. O DNS está no cPanel
(`ns2919.dizinc.com`), então a emissão e a renovação manuais exigem criar o TXT
a cada 90 dias — **automatizar** com um token de API do DNS, ou delegar
`_acme-challenge.sites` por CNAME a uma zona com API, antes da produção.
Alerta de expiração obrigatório.

## Verificação

```bash
curl -sI https://<slug>.sites.stratustelecom.com.br/ | head -3
openssl s_client -connect <slug>.sites.stratustelecom.com.br:443 \
  -servername <slug>.sites.stratustelecom.com.br </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -enddate
```

Pendente (Parte 2, domínios próprios): ver o issue #91.
