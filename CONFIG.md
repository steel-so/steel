# CONFIG.md — contas, tokens e passos manuais do Steel (plano grátis)

Guia para você (dono do produto) fazer o que **só uma pessoa com a conta**
consegue fazer. Cada seção diz: para que serve, o que precisa, o passo a passo,
o que me mandar e como conferir. Nada aqui exige gastar dinheiro, exceto onde
está marcado **(PAGO)**.

> **Regra de segredo:** nunca cole chave, token ou senha no chat. Quando eu
> pedir "o valor", entregue pelo canal combinado (arquivo SOPS ou GitHub
> Secret). Menus de painéis de terceiros mudam: onde eu não vi a tela, está
> marcado **(confirme na tela)**.

## Índice

1. [Onde os segredos ficam (SOPS e GitHub Secrets)](#0-onde-os-segredos-ficam)
2. [Marketing Messages Lite (Meta / WhatsApp)](#1-marketing-messages-lite-meta--whatsapp)
3. [Assinar o campo `flows` no app da Meta](#2-assinar-o-campo-flows-no-app-da-meta)
4. [AbacatePay (Pix, boleto e assinatura)](#3-abacatepay-pix-boleto-e-assinatura)
5. [Slack (SD e integrações)](#4-slack)
6. [Checklist final](#checklist-final)

---

## 0. Onde os segredos ficam

O Steel lê tudo do `.env` do servidor de homologação (`/var/www/steel/.env`),
gerado no deploy a partir de `secrets/homologacao.enc.env` (criptografado com
SOPS + age). Duas formas de colocar um valor novo:

**Forma A — você tem a chave age no seu computador**

```bash
export SOPS_AGE_KEY_FILE=~/caminho/da/chave-age.txt
sops secrets/homologacao.enc.env      # abre no editor, descriptografado
# acrescente a linha  NOME_DA_VARIAVEL=valor   salve e feche
git add secrets/homologacao.enc.env
git commit -m "chore(secrets): add <nome>"
```

**Forma B — você não tem a chave** (ela só existe no GitHub Secret
`SOPS_AGE_KEY`): me diga "quero colocar X" e eu preparo um workflow do GitHub
que recebe o valor por **Secret do repositório** e atualiza o arquivo. Cadastre
o valor em *GitHub → Settings → Secrets and variables → Actions → New
repository secret*, nunca no chat.

Variáveis que são lidas **na compilação** (`NEXT_PUBLIC_*`) também precisam
estar como GitHub Secret e nos build-args do `cd.yml` (CLAUDE.md, seção
Observabilidade).

---

## 1. Marketing Messages Lite (Meta / WhatsApp)

**Para que serve:** a API "Marketing Messages Lite" envia campanhas de
marketing com otimização de entrega da Meta (o Steel a usa nos broadcasts —
feature Z11). Sem aceitar os termos, a conta continua enviando pelo caminho
normal; só não ganha a otimização.

**Estado hoje (lido pela API, em 30/10):**

| Conta WhatsApp (WABA) | Status do Lite |
| --- | --- |
| Stratus Lab (+55 13 97804-7819, WABA 2485886955247758) | **ELIGIBLE** — termos **não** aceitos |
| Fidelizza+ | ONBOARDED (já aceito) |
| IPMO | ELIGIBLE (CONNECTING) |

**Custo:** grátis para aceitar; as mensagens de marketing são cobradas pela
Meta como sempre.

**Requisitos:** você precisa ser **administrador** do *portfólio empresarial*
(Business Manager) dono da WABA, e a empresa deve estar **verificada** (se a
Meta pedir).

### Passo a passo (confirmado na documentação da Meta)

A Meta **não tem chamada de API para aceitar** os termos: o aceite é feito na
interface, por quem tem **controle total do portfólio empresarial**. (O produto
passou a se chamar *Marketing Messages API for WhatsApp*.)

**Caminho A — WhatsApp Manager**

1. Entre em <https://business.facebook.com/wa/manage/home/> com o administrador.
2. Abra **Visão geral (Overview)**.
3. Na seção **Alertas**, clique em **"Accept terms to get started"** (aceitar
   termos para começar) da Marketing Messages API for WhatsApp.
4. Siga os passos e assine os Termos de Serviço.

**Caminho B — Painel do app (integração direta)**

1. <https://developers.facebook.com/apps> → app **SteelZAP** → **WhatsApp →
   Quickstart (Início rápido)**.
2. No cartão **"Improve ROI with Marketing Messages API for WhatsApp"**, clique
   em **Get started**.
3. Clique em **Continue to integration guide** para aceitar os termos.

O aceite vale para o portfólio e cobre todas as contas elegíveis dele.

> **Aviso (31/10):** no Quickstart do app SteelZAP, o cartão "Aumente o ROI com
> mensagens de marketing com otimizações" aparece com **"A análise do app é
> obrigatória"** (assim como os de API de Conversões e API de Marketing). Se o
> Caminho A (WhatsApp Manager > Visão geral > Alertas) não mostrar o aceite, o
> App Review do app passa a ser necessário: clique em "Começar" no cartão e
> anote qual permissão ele pede. A Z11 segue funcionando sem isso (desligada
> por padrão e com fallback para a API comum).

### Como conferir

Me avise que aceitou. Eu releio o status pela API (leitura apenas):
`GET /<WABA_ID>?fields=marketing_messages_onboarding_status` deve mudar de
`ELIGIBLE` para `ONBOARDED` (o campo antigo `marketing_messages_lite_api_status`
está obsoleto). A Meta também envia o webhook `account_update` com o evento
`MM_LITE_TERMS_SIGNED` quando o aceite conclui.

---

## 2. Assinar o campo `flows` no app da Meta

**Para que serve:** o Steel só atualiza sozinho o status dos formulários
(WhatsApp Flows: publicado, bloqueado, limitado) se o app da Meta **assinar o
campo `flows`**. Sem isso nada quebra; o status só deixa de se atualizar.

**Custo:** grátis. **App:** `SteelZAP` (id `1438397020818382`).

1. Entre em <https://developers.facebook.com/apps> e abra o app **SteelZAP**.
2. No menu lateral: **WhatsApp → Configuração** (ou **Webhooks → WhatsApp
   Business Account**).
3. Confirme que a URL de retorno é
   `https://<domínio do Steel>/api/whatsapp/webhook/meta` e que está
   **Verificada**.
4. Em **Campos do webhook**, ache **`flows`** e clique em **Assinar**.
5. Os campos antigos (`messages`, `message_template_status_update`,
   `message_template_quality_update`) continuam assinados.

**Conferir:** no painel de webhooks da Meta, use **Testar** no campo `flows`;
o Steel responde 200. Detalhes em `docs/runbooks/whatsapp-flows-webhook.md`.

---

## 3. AbacatePay (Pix, boleto e assinatura)

**Para que serve:** cobrar Pix e boleto dentro da conversa do WhatsApp e nas
propostas do CRM, e as assinaturas do Steel. **Sempre a API v2** (decisão de
31/10). Tudo já está no código e **desligado**: `PIX_PROVIDER` e
`BOLETO_PROVIDER` valem `mock`, `BILLING_ENABLED=false` e cada workspace liga a
opção sozinho. O passo a passo técnico está em `docs/abacatepay-ativacao.md`.

**Custo:** conta grátis; a AbacatePay cobra taxa por transação paga.

**Fase 1: modo teste (dev mode)**

1. No painel da AbacatePay, pegue a chave do **modo dev**. A mesma URL v2 serve
   para teste e produção; é a chave que decide.
2. Em `secrets/homologacao.enc.env` (SOPS) defina `ABACATE_PAY=<chave dev>`,
   `PIX_PROVIDER=abacatepay`, `BOLETO_PROVIDER=abacatepay`,
   `PIX_WEBHOOK_SECRET` e `BOLETO_WEBHOOK_SECRET` (cada um com 16+ caracteres
   aleatórios).
3. No painel de teste, registre dois webhooks:
   - Pix: `https://<domínio>/api/whatsapp/webhook/pix/abacatepay?webhookSecret=<PIX_WEBHOOK_SECRET>` (evento `transparent.completed`);
   - Boleto: `https://<domínio>/api/boleto/webhook/abacatepay?webhookSecret=<BOLETO_WEBHOOK_SECRET>` (`transparent.completed` e `transparent.refunded`, e `transparent.expired` se a tela oferecer).
4. Deploy da homologação, ligar Pix e boleto em WhatsApp › Configurações ›
   Atendimento, enviar um Pix e um boleto e pagar pela simulação do painel.
5. Assinatura: registrar de novo o webhook `…/api/payment/webhook?webhookSecret=<ABACATE_PAY_WEBHOOK_SECRET>`.

**Fase 2: produção (depende da validação do CNPJ)**

1. Criar `secrets/production.enc.env` (hoje não existe) com a chave de produção
   e os segredos.
2. Registrar os mesmos webhooks no painel de produção.
3. Cada workspace liga Pix e boleto; `BILLING_ENABLED` só muda por decisão sua.

**Para conferir no smoke:** o formato exato dos dados dos webhooks
`transparent.*` não está na documentação pública; e a AbacatePay não documenta
cancelamento de boleto (cancelar fecha só no Steel).

---

## 4. Slack

**Para que serve:** o ServiceDesk e as configurações do workspace conectam o
Slack por OAuth. O app do Slack é **um só para todos os workspaces**; cada
cliente autoriza o próprio.

**Custo:** grátis (apps próprios funcionam no plano gratuito do Slack).

1. Entre em <https://api.slack.com/apps> → **Create New App → From scratch**.
   Nome: `Steel`; escolha o workspace de desenvolvimento.
2. **OAuth & Permissions**:
   - em **Redirect URLs** adicione  
     `<BETTER_AUTH_URL>/api/servicedesk/integrations/oauth/slack`;
   - em **Bot Token Scopes** adicione: `chat:write`, `chat:write.public`,
     `channels:read`, `groups:read`, `channels:history`, `groups:history`,
     `commands`, `users:read`, `users:read.email`.
   - (Para o recurso de criar canais por chamado, que está na lista de
     pendências, serão necessários também `channels:manage` e `groups:write`.)
3. **Event Subscriptions**: ative e use a Request URL  
   `<BETTER_AUTH_URL>/api/servicedesk/integrations/slack`  
   (o Slack testa a URL; o app precisa estar no ar com as variáveis abaixo).
   Em *Subscribe to bot events* adicione `message.channels` e
   `message.groups`.
4. **Interactivity & Shortcuts**: ative e use a mesma Request URL.
5. **Basic Information → App Credentials**: copie
   - `SLACK_CLIENT_ID`
   - `SLACK_CLIENT_SECRET`
   - `SLACK_SIGNING_SECRET`
6. Coloque as três no `.env` (seção 0) e faça o deploy. A tela
   *Configurações → Integrações* deixa de mostrar "Slack não configurado".
7. No Steel, cada workspace clica em **Conectar Slack** e autoriza.

> Ordem importa: a Request URL do passo 3 só é aceita pelo Slack depois que o
> app subiu com `SLACK_SIGNING_SECRET`. Faça 5 → 6 antes de salvar o passo 3.

**Conferir:** use **Testar** na integração; chega uma mensagem no canal
escolhido.

---

---

## Checklist final

- [ ] 1. Marketing Messages Lite: Stratus **ONBOARDED**; IPMO fora do escopo (sem Marketing Meta)
- [x] 2. Assinar `flows` no app SteelZAP (feito em 31/10, teste do painel deu 200)
- [ ] 3. Testar o embed da Coexistência do WhatsApp (Z6)
- [ ] 4. AbacatePay: token de teste, webhooks e smoke (fase 1); chave de produção depois do CNPJ (fase 2)
- [ ] 5. Slack: `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_SIGNING_SECRET`
- [ ] 6. Conectar o TikTok no Stratus Lab

**Removidos do escopo (31/10):** push/VAPID, Brave e prospecção, Instagram e
Messenger no zap, e-commerce (Tray, Nuvemshop, VTEX), calendário e agendamento
público do CRM, RustDesk/AnyDesk, agente de inventário (Linux e Windows),
extensão do Chrome, nó do n8n, X e LinkedIn no CRM Social.
