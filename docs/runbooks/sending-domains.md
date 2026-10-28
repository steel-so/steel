# Domínios de e-mail da newsletter (suporte)

Quando usar: um cliente cadastrou o domínio em **Ajustes › Domínios de e-mail**
e ele não fica **Verificado**, deixou de estar verificado, ou o cliente não sabe
o que fazer com os registros DNS. Decisão e regras:
[ADR 0054](../adr/0054-newsletter-no-crm-com-dominio-proprio.md) e o
[contrato da newsletter](../crm-newsletter/README.md).

## Como funciona (o resumo para o atendimento)

- O workspace cadastra um domínio (de preferência um **subdomínio dedicado**,
  como `news.empresa.com.br`). O Steel registra o domínio no **Resend** (região
  São Paulo por padrão) e mostra os registros DNS que o cliente precisa criar:
  - **SPF** — um `MX` e um `TXT` em `send.<subdomínio>` (retorno de erros e
    autorização de envio);
  - **DKIM** — um `TXT` em `resend._domainkey.<subdomínio>` (assinatura);
  - **Tracking** (quando aparece) — um `CNAME` para o rastreio de abertura e
    clique.
- Status: **Aguardando DNS** (`NOT_STARTED`) → **Verificando** (`PENDING`) →
  **Verificado** (`VERIFIED`). Pode virar **Falhou** (`FAILED`) ou **Falha
  temporária** (`TEMPORARY_FAILURE`, o DNS não respondeu).
- A newsletter só envia de um endereço cujo domínio é **exatamente** um domínio
  verificado do workspace. Verificar `news.empresa.com.br` **não** libera
  `contato@empresa.com.br`, e vice-versa.
- O worker (fila `sending-domains`, a cada 10 min) reconfere sozinho: os
  domínios pendentes a cada 10 minutos nas primeiras 72 h; depois disso, e os
  com falha, uma vez por dia; os verificados, uma vez por dia. Quando um domínio
  fica verificado, ou quando um verificado deixa de estar, o dono e os
  administradores recebem um aviso na caixa de entrada.
- O nome é único na plataforma: se outro workspace já cadastrou, o cliente vê
  "Este domínio já está cadastrado na plataforma" (`SENDING_DOMAIN_TAKEN`).

## 1. Diagnóstico rápido

1. Peça um print de **Ajustes › Domínios de e-mail › Ver registros DNS**. Cada
   linha da tabela mostra o status do registro: **Ok**, **Pendente**, **Não
   publicado** ou **Não encontrado**.
2. Confira no DNS público o que o mundo enxerga (troque pelo nome da linha,
   completo, com o domínio raiz):

   ```bash
   dig +short TXT send.news.empresa.com.br
   dig +short MX  send.news.empresa.com.br
   dig +short TXT resend._domainkey.news.empresa.com.br
   dig +short TXT _dmarc.empresa.com.br
   ```

   Sem `dig`: <https://dnschecker.org> com o mesmo nome e tipo.
3. Se o `dig` devolve o valor certo, peça ao cliente **Verificar agora**. A
   propagação pode levar de minutos a algumas horas (até 48 h em alguns
   provedores).

## 2. Erros comuns de DNS

### Nome com o domínio duplicado

O painel de DNS da maioria dos provedores (Registro.br, Cloudflare, GoDaddy,
Hostinger, Locaweb) **completa o domínio sozinho**. Se o cliente colar
`send.news.empresa.com.br` no campo "Nome", o registro vira
`send.news.empresa.com.br.empresa.com.br` e nunca é encontrado.

- Sintoma: `dig` no nome certo não devolve nada; no nome duplicado devolve.
- Correção: no campo "Nome", usar exatamente o que a tela mostra (`send.news`,
  `resend._domainkey.news`), sem o domínio raiz. Em painéis que pedem o nome
  completo com ponto final (`send.news.empresa.com.br.`), aí sim completo.

### Cloudflare com o proxy ligado (nuvem laranja)

Registros `CNAME` de rastreio criados com a **nuvem laranja** ("Proxied") não
apontam para o Resend: o Cloudflare responde no lugar. `TXT` e `MX` não têm
proxy, mas o `CNAME` sim.

- Correção: editar o registro e deixar a **nuvem cinza** ("Somente DNS" / "DNS
  only").

### SPF duplicado (juntar em um só)

Um nome só pode ter **um** registro SPF (`v=spf1 …`). Com dois, os servidores
de e-mail tratam como erro (`permerror`) e o SPF falha.

- No subdomínio dedicado (`send.news.empresa.com.br`) isso quase nunca acontece
  — é um dos motivos para recomendarmos subdomínio.
- Se o cliente insistiu no domínio raiz e já tinha SPF (Google Workspace,
  Microsoft 365), é preciso **juntar** os `include:` num único registro. Exemplo:

  ```
  antes (dois registros — errado):
    v=spf1 include:_spf.google.com ~all
    v=spf1 include:amazonses.com ~all
  depois (um registro):
    v=spf1 include:_spf.google.com include:amazonses.com ~all
  ```

  Limite de 10 consultas DNS por SPF: se juntar estourar, sugira o subdomínio.

### Outros

- **Valor com aspas extras ou quebrado em dois**: alguns painéis colocam aspas
  sozinhos; colar com aspas gera `""valor""`. Cole sem aspas. Valores DKIM
  longos podem ser divididos pelo provedor em partes de 255 caracteres — isso é
  normal.
- **Registro criado na zona errada**: o domínio usa os nameservers de outro
  provedor (ex.: registrado no Registro.br, mas o DNS está no Cloudflare). Veja
  com `dig NS empresa.com.br` onde a zona realmente está.
- **TTL alto de um registro antigo**: espere o TTL vencer e verifique de novo.

## 3. DMARC

O Resend não exige DMARC para verificar o domínio, mas Gmail e Yahoo exigem de
quem envia em volume. A tela consulta `_dmarc.<domínio raiz>` e, se não houver,
sugere um `TXT` com `v=DMARC1; p=none;`.

- Se já existe DMARC, **não crie outro**: dois registros invalidam os dois.
- "Não foi possível consultar o DMARC agora" é só aviso: a consulta passou do
  tempo ou o DNS falhou. Não afeta a verificação.

## 4. Domínio verificado que deixou de estar

Aviso "Domínio deixou de estar verificado" na caixa de entrada: alguém apagou
ou alterou um registro (troca de provedor de DNS, migração de site). As
newsletters desse domínio **param de enviar** (`SENDING_DOMAIN_NOT_VERIFIED`)
até corrigir. Refaça o diagnóstico da seção 1 e, depois de corrigir,
**Verificar agora**.

## 5. Domínio "já cadastrado" (`SENDING_DOMAIN_TAKEN`)

1. Descubra qual workspace tem o domínio:

   ```sql
   select d.name, d.status, w.slug, d.created_at
     from workspace_sending_domains d
     join workspaces w on w.id = d.workspace_id
    where d.name = 'news.empresa.com.br';
   ```

2. Se é um workspace antigo do mesmo cliente, peça para remover lá (Ajustes ›
   Domínios de e-mail › Remover domínio) e cadastrar no novo.
3. Se o Resend responde que o domínio já existe e **não há linha** no banco, o
   domínio está em outra conta do Resend (outro produto do cliente). O cliente
   precisa removê-lo de lá, ou usar outro subdomínio (`news2.empresa.com.br`).

## 6. Remover

**Remover domínio** é recusado (`SENDING_DOMAIN_IN_USE`) enquanto alguma
newsletter **ativa** envia dele. Troque o remetente ou arquive a newsletter
antes. Ao remover, o domínio sai do Resend e do Steel; os registros DNS podem
ser apagados depois. A criação e a remoção ficam na auditoria (Axiom,
`audit.mutation.sending_domain.*`).

## 7. Onde olhar no servidor

| O quê | Onde |
| ----- | ---- |
| Fila e execuções do re-check | `/jobs`, fila `sending-domains` (job `check-tick`) |
| Logs | Axiom: `sending_domain.status_changed`, `sending_domain.provider_error`, `sending_domain.tick_check_failed`, `queue.sending_domains.tick_completed` |
| Painel do provedor | Resend › Domains (conta da Stratus, chave `RESEND_API_KEY`) |
