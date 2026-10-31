# 0058 — Instagram, Messenger e Coexistência na caixa do zap, desligados por padrão

- **Status:** Aceita (parte de Instagram e Messenger substituída pelo [ADR 0060](./0060-remocao-do-instagram-e-messenger-da-caixa-do-zap.md); a Coexistência segue valendo)
- **Data:** 2026-10-30
- **Decisores:** Claude (com a autorização do dono do produto para decidir dentro da fatia meta-channels)

## Contexto

O roadmap pede atendimento por Instagram Direct, Messenger e comentários na mesma
caixa do WhatsApp (com equipes, SLA e IA), e a conexão de números que o cliente já
usa no app WhatsApp Business (Coexistência), com importação do histórico. A
aprovação do app na Meta (permissões, parceria de tecnologia) é do dono do produto
e ainda não aconteceu.

## Decisão

- Reaproveitar o modelo do zap: `WhatsAppConnection` ganha `channel`
  (`WHATSAPP`, `INSTAGRAM`, `MESSENGER`), `metaPageId`, `metaInstagramAccountId` e
  `coexistence`. O `provider` continua `META`. Não criamos valores novos em
  `WhatsAppProvider` para não quebrar as ramificações existentes por provedor.
- O contato social usa `waId` com prefixo (`ig:`, `fb:`); nada de telefone falso.
- Mensagens entram pelo mesmo `ingestInboundMessage` e saem pelo mesmo
  `WhatsAppSend`, com um cliente de provedor que só implementa texto e mídia.
  Assim equipes, distribuição, SLA, IA e pesquisas funcionam sem duplicar regras.
- Webhook novo e separado (`/api/whatsapp/webhook/meta-social`), porque a Meta
  cadastra uma URL por produto (Página, Instagram); a assinatura e o token de
  verificação são os do webhook do WhatsApp.
- Comentários ficam como mensagens de entrada mais uma linha em
  `WhatsAppSocialComment`; a resposta pública ou privada é um serviço próprio
  e vira mensagem de saída da conversa.
- Coexistência usa o Embedded Signup com `featureType:
  whatsapp_business_app_onboarding`, **não registra** o número e importa o
  histórico direto no banco, em conversas fechadas, sem efeitos colaterais
  (IA, SLA, não lidas, tempo real, uso mensal).
- Tudo fica **desligado por padrão** em `WhatsAppMetaChannelSettings`
  (`instagramEnabled`, `messengerEnabled`, `commentsEnabled`,
  `coexistenceEnabled`). Ligar não exige deploy; a revisão da Meta é um passo à parte
  ([guia](../whatsapp-meta-channels.md)).
- O token do usuário do login nunca é guardado: troca por token de longa duração só
  para listar Páginas e obter o token da Página, que é cifrado.

## Consequências

- Telas e relatórios que listam conexões `META` passam a ver as conexões sociais
  (com `phoneNumber` `fb:<id>`/`ig:<id>`); transmissões e campanhas não as tratam.
- `contactHasPhone` é falso para contatos sociais: ações de ligação ficam ocultas.
- Anexos recebidos viram texto com o link até existir um fluxo de mídia próprio.
- Se a Meta pedir `config_id` também para o login dos canais sociais, será preciso
  uma variável de build nova.
