# Webhook `flows` da Meta (status dos formulários)

Quando o campo **`flows`** está assinado no app da Meta, o Steel recebe cada
mudança de status de um formulário (WhatsApp Flow): publicado, descontinuado,
**bloqueado** ou **limitado** (`THROTTLED`) pela Meta. O evento atualiza o
`meta_status` do formulário e, no bloqueio ou na limitação, mostra o aviso no
topo do editor. Sem a assinatura nada quebra: o status só deixa de se
atualizar sozinho (a lista continua mostrando o último que o Steel viu).

> O Steel **não** altera a configuração de webhook do app por código. A
> assinatura é um passo manual do dono do app da Meta, uma vez.

## Assinar o campo (uma vez por app)

1. Em developers.facebook.com, abra o app usado pelo Steel.
2. **WhatsApp > Configuração** (ou **Webhooks > WhatsApp Business Account**).
3. Confirme que a URL de retorno é `https://<domínio do Steel>/api/whatsapp/webhook/meta`
   (a mesma dos demais campos) e que a assinatura está **Verificada**.
4. Em **Campos do webhook**, localize **`flows`** e clique em **Assinar**.
5. Os campos já assinados (`messages`, `message_template_status_update`,
   `message_template_quality_update`) continuam como estão.

Contas conectadas pelo Embedded Signup herdam a assinatura do app: não é
preciso refazer nada por cliente.

## Como confirmar

1. Em Comunicação > Formulários, publique ou descontinue um formulário de teste
   direto no Gerenciador da Meta (WhatsApp Manager > Flows).
2. Em alguns segundos o status do formulário muda no Steel (a lista e o editor
   leem `meta_status`).
3. Nos logs (Axiom), procure `whatsapp.flow.webhook_status` com `from` e `to`.

Para testar sem mexer em formulário real, use **Testar** no painel de webhooks
da Meta (campo `flows`): o evento de teste não tem um `flow_id` conhecido, então
o Steel responde 200 sem alterar nada.

## O que o Steel faz com cada evento

| Evento / status | Efeito |
| --------------- | ------ |
| `FLOW_STATUS_CHANGE` → `PUBLISHED` ou `DRAFT` | grava `meta_status`; limpa o aviso de bloqueio, se havia |
| `FLOW_STATUS_CHANGE` → `DEPRECATED` | grava `meta_status` e descontinua o formulário no Steel |
| `FLOW_STATUS_CHANGE` → `BLOCKED` | grava `meta_status` e mostra o aviso "A Meta bloqueou este formulário" |
| `FLOW_STATUS_CHANGE` → `THROTTLED` | grava `meta_status` e mostra o aviso de limitação por excesso de erros |
| outros eventos (`ENDPOINT_*`, taxa de erro, latência...) | ignorados (resposta 200): o Steel só usa Flows estáticos, sem endpoint de dados |

O evento chega por WABA (`entry.id`); só os formulários das conexões Meta dessa
WABA são atualizados. Reentrega do mesmo evento não faz nada.

## Quando algo não atualiza

- Confirme a assinatura do campo `flows` (passo 4) e que a URL de retorno está
  verificada.
- O formulário precisa ter sido enviado à Meta pelo Steel (ter `meta_flow_id`).
  Um Flow criado direto na Meta não existe no Steel e o evento é ignorado.
- Assinatura inválida do webhook responde 401 (veja `WHATSAPP_META_APP_SECRET`).
