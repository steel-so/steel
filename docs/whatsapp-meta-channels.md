# Coexistência do WhatsApp

Guia técnico da **Coexistência** (Z6): o app WhatsApp Business e a API no mesmo
número. Decisão: ADR 0058 (a parte de Instagram e Messenger foi removida pelo
ADR 0060).

Tudo vem **desligado por padrão**, por workspace. Ligar a chave sem o app da
Meta aprovado só faz as chamadas falharem; por isso este documento lista, no fim,
o que **o dono do produto precisa concluir na Meta** (revisão do app).

## Como funciona

- Mesmo popup do Embedded Signup, com `featureType:
  'whatsapp_business_app_onboarding'`. O número **não é registrado** (o app já o
  registrou) e não há PIN. Conexão: `coexistence = true`.
- Em seguida o Steel pede à Meta, em ordem, `smb_app_state_sync` (contatos) e
  `history` (histórico) em `POST /{phone-number-id}/smb_app_data`. A Meta exige
  esse pedido em até **24 horas** do cadastro; o Steel o faz na hora.
- O resultado chega pelo webhook do WhatsApp (`/api/whatsapp/webhook/meta`) nos
  campos `history`, `smb_app_state_sync` e `smb_message_echoes`:
  - `history`: blocos de conversas passadas. Entram direto no banco, em conversas
    **fechadas**, **sem** IA, SLA, contador de não lidas, evento em tempo real nem
    consumo do limite mensal. Mensagens repetidas são ignoradas
    (`providerMessageId` único). Mídia vira texto-marcador (`[Imagem]`), porque a
    Meta não entrega o arquivo do histórico.
  - `smb_app_state_sync`: contatos criados ou editados no app.
  - `smb_message_echoes`: o que a equipe digita no app depois da conexão; vira
    mensagem de saída humana na conversa.
- O andamento (0 a 100, contatos, mensagens, conversas) fica em
  `WhatsAppCoexistenceSync` e aparece em **Comunicação › Configurações ›
  Conexões**. Se o cliente recusar compartilhar o histórico no app, o estado é
  `DECLINED` e o número segue funcionando.

## Variáveis de ambiente

Nenhuma variável nova. O fluxo reaproveita as do Embedded Signup
([runbook](./runbooks/meta-embedded-signup.md)):

| Variável | Onde |
| --- | --- |
| `NEXT_PUBLIC_META_APP_ID` | GitHub Secret + build-arg (build time) |
| `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID` | GitHub Secret + build-arg (build time) |
| `WHATSAPP_META_APP_ID` | `.env` do servidor |
| `WHATSAPP_META_APP_SECRET` | `.env` do servidor |
| `WHATSAPP_META_VERIFY_TOKEN` | `.env` do servidor |

Sem as duas `NEXT_PUBLIC_*` o botão de conexão não aparece.

## Passo a passo do dono na Meta

Nada abaixo é código: é configuração e revisão no painel da Meta. O Steel só
funciona de verdade depois de concluído.

### 1. App e webhook

1. No app da Meta (tipo **Business**), mantenha o produto **WhatsApp** e o
   **Login do Facebook para Empresas** já usados no Embedded Signup.
2. Em **Webhooks**, no objeto *WhatsApp Business Account*
   (`https://<host>/api/whatsapp/webhook/meta`), acrescente os campos `history`,
   `smb_app_state_sync` e `smb_message_echoes`.
3. Conclua a **Verificação da empresa** (obrigatória para acesso avançado).

### 2. Permissões (App Review — acesso avançado)

`whatsapp_business_management` e `whatsapp_business_messaging` (as mesmas do
Embedded Signup). Cada permissão pede vídeo de demonstração do fluxo no Steel e
política de privacidade. Enquanto o app estiver em modo de desenvolvimento, só
administradores e testadores do app conseguem conectar.

### 3. Requisitos da Coexistência

A Coexistência exige que o app tenha sido liberado pela Meta para o fluxo *WhatsApp
Business app onboarding* (parceiro de tecnologia). Antes de oferecer ao cliente,
confirme na documentação atual da Meta:

- versão mínima do app WhatsApp Business no celular do cliente e se o número
  precisa estar em uso há alguns dias;
- países em que o fluxo está disponível (o Brasil é atendido);
- limitações que o app passa a ter com o número conectado à API (listas de
  transmissão e mensagens temporárias do app deixam de funcionar);
- janela de histórico compartilhada (até 6 meses) e o prazo de 24 horas para
  pedir a sincronização.

Esses pontos mudam com frequência; este guia não os fixa.

### 4. Ligar no Steel

1. **Comunicação › Configurações › Conexões** › cartão *Coexistência*: ligue a
   chave.
2. Clique em **Conectar número em uso no aplicativo**; no popup, o cliente confirma
   no celular e escolhe se compartilha o histórico.

## O que ficou de fora

- **Retomar uma importação de Coexistência** que a Meta não concluiu, ou refazê-la
  depois das 24 horas (exige reconectar o número).
