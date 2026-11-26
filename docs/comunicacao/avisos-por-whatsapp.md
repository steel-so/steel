# Avisos da plataforma por WhatsApp

Cada usuário pode receber no próprio WhatsApp uma cópia dos avisos da caixa de
entrada, enviada pela **conexão da Comunicação do workspace** (a primeira
conectada, da mais antiga para a mais nova).

## Como o usuário ativa

Configurações → Notificações → **Avisos por WhatsApp**:

1. Informa o número com DDD e pede o código.
2. Recebe 6 dígitos no WhatsApp (válidos por 10 minutos, 5 tentativas) e confirma.
3. Escolhe, por tipo, o que quer receber. Sem escolha salva, só os **urgentes**
   chegam (SLA violado, aprovações, atribuições, **nova conversa**, **IA transferiu para um humano**, ação da IA expirando).

O número só vale depois do código: sem isso, qualquer pessoa poderia apontar o
workspace para o telefone de outra.

## Regras

- Só tipos configuráveis (CRM, Comunicação, Plataforma). O ServiceDesk tem
  preferências e canais próprios e não passa por aqui.
- Silenciar o tipo na caixa de entrada também corta o WhatsApp.
- **Meta (API oficial):** texto livre só até 24 h depois da última mensagem do
  usuário ao número da conexão. Fora disso o aviso (e o código de confirmação)
  vai pelo template fixo `steel_aviso` (UTILITY, pt_BR; variáveis: título,
  mensagem, link), que o app cria e envia à Meta sozinho na primeira vez que
  precisa dele. Enquanto estiver `PENDING`/recusado o aviso é pulado (log
  `notifications.whatsapp.skipped`, motivo `template_*`). **Z-API** não tem janela.
- Quem pediu para sair (`sair`, LGPD) deixa de receber.
- O envio conta no limite mensal e nos custos da conexão (origem `OTHER`).
- Falha no WhatsApp nunca afeta o aviso do app.

## Nova conversa e transferência da IA

- **Nova conversa** (`WHATSAPP_NEW_CONVERSATION`): quando um cliente abre uma
  conversa em uma conexão da Comunicação. Vai para os membros da equipe para a
  qual a conversa foi roteada ou, sem equipe, para os OWNER/ADMIN (no máximo 20).
  Um aviso por conversa. Conversas do ServiceDesk não geram.
- **IA transferiu** (`WHATSAPP_AI_HANDOFF`): vai para o atendente da conversa, a
  equipe ou os admins — o mesmo destinatário do aviso no app.

## Onde está

`NotificationService.notifyUsers` → `NotificationWhatsappService.enqueue` →
fila `notifications` (job `whatsapp-deliver`, sem telefone no Redis) →
`NotificationWhatsappService.deliver`. Regras puras em
`src/lib/notifications/whatsapp-channel.ts`.

## Pendências conhecidas

- Template personalizável por workspace (hoje é fixo).
- Escolha da conexão pelo administrador (hoje automática).
- Limite por usuário/hora e ServiceDesk (etapa 2).
