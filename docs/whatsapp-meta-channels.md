# Instagram, Messenger e Coexistência do WhatsApp

Guia técnico das duas entregas que ampliam a caixa do zap com canais da Meta:
**Z5** (Instagram Direct e Messenger, com comentários) e **Z6** (Coexistência:
o app WhatsApp Business e a API no mesmo número). Decisão: ADR 0058.

Tudo vem **desligado por padrão**, por workspace. Ligar a chave sem o app da
Meta aprovado só faz as chamadas falharem; por isso este documento lista, no fim,
o que **o dono do produto precisa concluir na Meta** (revisão do app).

## Como funciona

### Z5 — Instagram Direct, Messenger e comentários

- Uma conexão por canal e Página: `WhatsAppConnection` com `provider = META` e
  `channel = INSTAGRAM | MESSENGER`. O token é o da **Página** (longa duração, não
  expira), cifrado com `CONNECTION_SECRETS`. O token do usuário usado no login
  **nunca é guardado**: serve só para listar as Páginas e obter o da Página.
- O contato usa uma identidade com prefixo, para nunca colidir com telefone:
  `ig:<IGSID>` e `fb:<PSID>` em `WhatsAppContact.waId`. A caixa mostra
  "Instagram" ou "Messenger" no lugar do telefone.
- Webhook próprio: `POST /api/whatsapp/webhook/meta-social` (objetos `page` e
  `instagram`). Mesma assinatura `X-Hub-Signature-256` e mesmo
  `WHATSAPP_META_VERIFY_TOKEN` do webhook do WhatsApp. A conexão é achada pelo id
  da Página (Messenger) ou da conta (Instagram).
- As mensagens entram no **mesmo pipeline** do WhatsApp
  (`WhatsAppWebhookService.ingestInboundMessage`): contato, conversa, equipes,
  distribuição, SLA, IA de resposta automática, sentimento e pesquisas. O envio
  também passa por `WhatsAppSend`, com um cliente de provedor próprio
  (`createMetaSocialClient`) que só sabe texto e mídia.
- Respostas digitadas no app do Instagram ou na Página chegam como eco
  (`is_echo`) e viram mensagem de saída humana
  (`ingestOutboundDeviceMessage`), como no WhatsApp pelo celular.
- **Comentários** (chave própria `commentsEnabled`): cada comentário vira uma
  mensagem de entrada com id `comment:<id>` mais uma linha em
  `WhatsAppSocialComment` (post, link, resposta). O atendente responde **em
  público** (`/{comment-id}/replies` no Instagram, `/{comment-id}/comments` no
  Facebook) ou **por mensagem privada** (`recipient.comment_id`, uma por
  comentário e em até 7 dias). A resposta vira mensagem de saída e fecha o relógio
  de primeira resposta do SLA.

### Z6 — Coexistência

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

Sem as duas `NEXT_PUBLIC_*` os botões de conexão não aparecem.

## Passo a passo do dono na Meta

Nada abaixo é código: é configuração e revisão no painel da Meta. O Steel só
funciona de verdade depois de concluído.

### 1. App e produtos

1. No app da Meta (tipo **Business**), mantenha o produto **WhatsApp** e o
   **Login do Facebook para Empresas** já usados no Embedded Signup.
2. Adicione os produtos **Messenger** e **Instagram** (API do Instagram com
   login do Facebook) e **Webhooks**.
3. Em **Login do Facebook** › Configurações, deixe o domínio do Steel em
   *Domínios permitidos para o SDK JavaScript* e ative *Login com o SDK do
   JavaScript*.
4. Conclua a **Verificação da empresa** (obrigatória para acesso avançado).

### 2. Webhooks

Em **Webhooks**, cadastre a mesma URL para os objetos de Instagram e Página:

| Objeto | URL de retorno | Token de verificação | Campos |
| --- | --- | --- | --- |
| Page | `https://<host>/api/whatsapp/webhook/meta-social` | `WHATSAPP_META_VERIFY_TOKEN` | `messages`, `messaging_postbacks`, `message_echoes`, `feed` |
| Instagram | `https://<host>/api/whatsapp/webhook/meta-social` | `WHATSAPP_META_VERIFY_TOKEN` | `messages`, `comments` |
| WhatsApp Business Account | `https://<host>/api/whatsapp/webhook/meta` (já existente) | idem | acrescente `history`, `smb_app_state_sync`, `smb_message_echoes` |

A assinatura da Página nos campos acima é feita pelo próprio Steel ao conectar a
Página (`POST /{page-id}/subscribed_apps`).

### 3. Permissões (App Review — acesso avançado)

| Canal | Permissões a pedir |
| --- | --- |
| Messenger | `pages_messaging`, `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_engagement` (responder comentários da Página) |
| Instagram Direct | `instagram_basic`, `instagram_manage_messages` |
| Comentários do Instagram | `instagram_manage_comments` |
| Coexistência | `whatsapp_business_management`, `whatsapp_business_messaging` (as mesmas do Embedded Signup) |

Pedidos opcionais: o recurso **Human Agent** (janela de 7 dias para responder
fora das 24 horas padrão; o Steel envia com `messaging_type: RESPONSE`, que vale
dentro da janela da Meta).

Cada permissão pede vídeo de demonstração do fluxo no Steel e política de
privacidade. Enquanto o app estiver em modo de desenvolvimento, só administradores
e testadores do app conseguem conectar.

### 4. Contas dos clientes

- **Instagram**: conta **profissional** (comercial ou criador de conteúdo),
  vinculada a uma Página do Facebook. No app do Instagram, em *Configurações ›
  Mensagens e respostas dos Stories › Controles de mensagens*, ligue **Permitir
  acesso às mensagens** para ferramentas conectadas.
- **Messenger**: o usuário que faz o login precisa ser administrador da Página
  (ou ter acesso total a ela no Meta Business Suite).

### 5. Coexistência — requisitos

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

### 6. Ligar no Steel

1. **Comunicação › Configurações › Conexões** › cartão *Instagram, Messenger e
   Coexistência*: ligue o canal desejado (e *Comentários nas publicações*).
2. Clique em **Conectar Página da Meta**, faça o login, escolha a Página e confirme.
   O Steel assina os webhooks da Página e cria a conexão.
3. Para Coexistência, ligue a chave e clique em **Conectar número em uso no
   aplicativo**; no popup, o cliente confirma no celular e escolhe se compartilha
   o histórico.

## O que ficou de fora

- **Login para Empresas com `config_id` nos canais sociais.** O login de
  Instagram e Messenger usa o parâmetro `scope` do SDK. Se o app da Meta exigir
  configuração do *Login do Facebook para Empresas* também para esses canais,
  é preciso criar a configuração e passar o `config_id` (variável de build
  nova).
- **Mídia nativa nas mensagens de Instagram e Messenger.** Anexos recebidos viram
  texto com o link; o envio de imagem, vídeo, áudio e documento funciona, mas não
  há prévia nem baixa para o MinIO.
- **Templates, botões, listas, Flows, reações e contatos** não existem nesses
  canais: o envio recusa com erro claro.
- **Renovação automática do token** de longa duração do usuário (a Página usa token
  que não expira; se o administrador sair da Página ou trocar a senha, é preciso
  reconectar — a conexão fica em erro e o botão *Renovar* refaz o fluxo).
- **Reconexão automática e alerta de queda** das conexões sociais (a saúde do
  WhatsApp não cobre `channel != WHATSAPP`).
- **Transmissões, campanhas e disparos** não consideram contatos `ig:`/`fb:`.
- **Importação de histórico do Instagram e Messenger** (só chega o que for enviado
  depois da conexão).
- **Retomar uma importação de Coexistência** que a Meta não concluiu, ou refazê-la
  depois das 24 horas (exige reconectar o número).
