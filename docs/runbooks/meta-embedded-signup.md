# Conectar número Meta (Embedded Signup)

Configuração única do app da Meta e uso do botão "Conectar com a Meta" em
Comunicação > Configurações > Conexões. Decisão: ADR 0030.

## Configurar o app da Meta

1. No app (developers.facebook.com), adicione o produto **WhatsApp** e o
   **Login do Facebook para Empresas**.
2. Em Login do Facebook para Empresas > Configurações, crie uma configuração do
   tipo **WhatsApp Embedded Signup** com as permissões
   `whatsapp_business_management` e `whatsapp_business_messaging`. Copie o
   **Config ID**.
3. Em Domínios permitidos / URIs de redirecionamento OAuth válidos, inclua o
   domínio do Steel (ex.: `https://steel.stratustelecom.com.br`) e habilite o
   login pelo SDK JavaScript.
4. Coloque o app em modo **Live** e peça **acesso avançado** às duas permissões
   (Verificação de empresa concluída).
5. Webhook do WhatsApp apontando para `/api/whatsapp/webhook/meta`, com os
   campos `messages`, `message_template_status_update` e
   `message_template_quality_update`. Para acompanhar o status dos formulários
   (WhatsApp Flows), assine também o campo `flows`
   ([passo a passo](./whatsapp-flows-webhook.md)).

## Variáveis

| Variável | Onde | Observação |
| --- | --- | --- |
| `NEXT_PUBLIC_META_APP_ID` | GitHub Secret + build-arg | build time |
| `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID` | GitHub Secret + build-arg | build time |
| `WHATSAPP_META_APP_ID` | `.env` do servidor | opcional se o id público existir |
| `WHATSAPP_META_APP_SECRET` | `.env` do servidor | obrigatório para trocar o código |

Sem as duas `NEXT_PUBLIC_*` o botão não aparece.

## Erros comuns

- **Pagamento (141006):** cadastre uma forma de pagamento na conta WhatsApp Business.
- **Nome de exibição não aprovado:** aguarde a aprovação e use "Atualizar status".
- **Permissão (#200):** o usuário não autorizou todas as permissões; refaça o fluxo.

## PIN de registro

O PIN de 6 dígitos usado no registro fica cifrado em
`whatsapp_connections.encrypted_meta_pin` (chave `CONNECTION_SECRETS`).

## Fallback manual

"Adicionar conexão" > Meta Cloud API aceita Phone Number ID, WABA ID e token de
System User. Depois de criar, "Atualizar status" confere o número na Meta.
