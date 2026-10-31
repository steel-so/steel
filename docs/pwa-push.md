# PWA e notificações push (E4)

App instalável a partir do manifest, com Web Push (VAPID) para quatro avisos: nova conversa, SLA perto de estourar, aprovação pendente e lead atribuído.

## Peças

- `app/manifest.ts`: `id`, `scope`, ícones 192/512 (`app/pwa-icon/[size]`, também `maskable`).
- `public/sw.js`: service worker só de push e clique. Sem `fetch` handler e sem cache de propósito (evita servir página autenticada velha). `next.config.ts` serve com `no-cache`; `proxy.ts` o libera sem sessão (`/sw.js`, `/pwa-icon`).
- `src/lib/push/web-push.ts`: envio Web Push com `node:crypto` (RFC 8291 `aes128gcm` + VAPID RFC 8292). Sem dependência nova.
- `src/lib/push/push-kinds.ts`: quais `NotificationKind` viram push e a mensagem genérica.
- `src/services/push.service.ts` e `src/repositories/push-subscription.repository.ts`: inscrições (`push_subscriptions`) e envio.
- `POST/GET/DELETE /api/push/subscriptions`: registrar, consultar e remover o dispositivo do usuário.
- UI: cartão em Ajustes > Notificações (`push-settings-card.tsx`, hook `use-push.ts`).

## Ligar em um ambiente

1. Gerar o par VAPID uma vez (`npx web-push generate-vapid-keys`).
2. Definir `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (`mailto:` do TI) nos secrets (SOPS) do ambiente.
3. Reiniciar app e worker. Sem as chaves o push fica **desligado e inerte**: o cartão some, `POST` não grava nada e o envio retorna 0.

Trocar o par invalida as inscrições existentes (cada pessoa liga de novo).

## Regras

- O push sai de `NotificationService.notifyUsers`, para os mesmos destinatários da caixa de entrada, **depois** do filtro de silenciados (preferências do usuário; os avisos do ServiceDesk usam as preferências próprias do módulo). Falha de push nunca derruba a notificação.
- O payload tem só título curto (`<módulo>: <tipo>`), texto fixo e o caminho interno. Nenhum conteúdo do registro viaja pelo serviço de push.
- Máximo de 10 dispositivos por usuário (os mais antigos saem). Respostas 404/410 do serviço de push apagam a inscrição.
- Auditoria LGPD: `push_subscription` (criar/remover).

## Fora do escopo desta entrega

- Preferência de push separada da de caixa de entrada por tipo.
- Silêncio por horário e agrupamento de avisos.
- Push enviado pelo worker em fila (hoje sai em linha, com timeout de 10 s).
- Cache offline / tela offline do app.
