# 0030 — Conectar número Meta pelo WhatsApp Embedded Signup

- **Status:** Aceita
- **Data:** 2026-10-15
- **Decisores:** Produto e engenharia (Steel)

## Contexto

Conectar um número da Meta Cloud API ao módulo Comunicação exigia passos manuais
na Meta: compartilhar a WABA com o parceiro, atribuir ativos ao System User,
`POST /{phone-id}/register` com PIN, `POST /{waba-id}/subscribed_apps` e colar
phone-number-id, WABA id e token no formulário (caso Fidelizza, 2026-10-15).
Além disso, as conexões Meta nunca saíam de `CONNECTING`: só o webhook da Z-API
chamava `markUp`, e as campanhas do CRM exigem `CONNECTED`.

## Decisão

1. **Status real da Meta.** Ao criar e em "Atualizar status", a conexão Meta é
   verificada na Graph API (`status` e `health_status` do número, em
   `evaluateMetaPhoneHealth`, compartilhado com o ServiceDesk) e vira
   `CONNECTED`, `ERROR` ou `DISCONNECTED`, com o motivo em pt-BR (ex.: 141006
   pagamento, 141000 número não registrado). Um evento válido no webhook da
   Meta também chama `markUp`.
2. **Embedded Signup.** O botão "Conectar com a Meta" abre o login do SDK do
   Facebook (`FB.login` com `config_id`, `response_type=code`) e escuta o evento
   `WA_EMBEDDED_SIGNUP`. O servidor (`connectViaEmbeddedSignup`) troca o `code`
   por um token (app id + secret só no servidor), inscreve o app na WABA,
   registra o número com um PIN aleatório de 6 dígitos (guardado cifrado em
   `encrypted_meta_pin` para o suporte), lê nome e número e cria a conexão. "Já
   registrado" conta como sucesso; erros da Meta viram códigos
   `WHATSAPP_SIGNUP_*` em pt-BR. Token e PIN nunca vão para log.
3. **Inerte sem configuração.** Sem `NEXT_PUBLIC_META_APP_ID` e
   `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID` (build time) o botão some e a CSP
   não ganha origem da Meta. O cadastro manual continua como fallback.

## Consequências

- O cliente conecta o número em um clique e já pode usá-lo.
- As variáveis `NEXT_PUBLIC_*` entram no Dockerfile e no `cd.yml` (GitHub Secrets).
- A troca do código usa `WHATSAPP_META_APP_ID` (ou o id público) e
  `WHATSAPP_META_APP_SECRET`; sem o secret a rota responde `FEATURE_NOT_ENABLED`.
- O token de integração do Embedded Signup não é de System User: se expirar, o
  status vira `ERROR` e o cliente reconecta pelo botão.
