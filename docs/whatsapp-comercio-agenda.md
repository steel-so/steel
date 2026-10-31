# WhatsApp: catálogo, gatilhos de loja e agendamento (Z8, Z9, Z10)

Tudo nasce **desligado** por workspace. O que depende de credencial ou aprovação de terceiros
fica atrás de uma chave que o dono liga depois de cumprir os passos abaixo.

## Z8 Catálogo e carrinho

- Telas: `/zap/catalogo` (Produtos, Pedidos, Configurações) e o item "Produtos do catálogo" no
  menu de anexos da conversa.
- Origem dos produtos: **CRM** (tabela `crm_products`, ativos), **Tray** ou **Nuvemshop**. As lojas
  passam por `StoreCatalogAdapter` (`src/lib/whatsapp/catalog/store-adapters.ts`) e só rodam com a
  chave "Ler os produtos direto da loja" ligada e as credenciais salvas na loja.
- O id do produto na Meta (`retailer_id`) é o **SKU** (ou o id interno quando não há SKU).
- Envio: 1 produto vira mensagem de produto, 2 a 30 viram lista. Só API oficial da Meta.
- Pedido: a mensagem `order` da Meta vira registro em `whatsapp_catalog_orders`, lead (sem
  duplicar), oportunidade com os itens e anotação. O cliente recebe um agradecimento. Com
  "Cobrar o pedido via Pix" ligado, sai uma cobrança pelo `PixProvider` (hoje só o provedor de teste).

### Passos do dono (Meta)

1. Criar o catálogo no Gerenciador de Comércio e ligá-lo ao número do WhatsApp Business
   (Configurações do catálogo, Conectar ativo; ativar "Carrinho").
2. Cadastrar os produtos lá com o id do conteúdo igual ao SKU.
3. Copiar o id do catálogo em Catálogo, Configurações, e ligar.

## Z9 Gatilhos de e-commerce

- Tela: `/zap/lojas` (Lojas, Gatilhos, Eventos). Webhook público:
  `POST /api/whatsapp/webhook/ecommerce/{id da loja}`.
- Assinatura: cabeçalho `x-steel-signature` (ou `x-linkedstore-hmac-sha256`) com o HMAC-SHA256 do
  corpo, em hexadecimal, feito com o segredo da loja (mostrado uma vez; dá para gerar outro).
- Corpo: formato genérico `{ event, id, customer: { name, phone }, ... }` para qualquer
  plataforma, ou o objeto completo do pedido da Nuvemshop, Tray ou VTEX. O evento também pode vir
  no cabeçalho `x-steel-event`. Eventos: carrinho abandonado, pedido criado, enviado, entregue.
- Os webhooks "magros" das lojas (só o id, sem telefone) são recusados e aparecem no histórico.
  **Não feito:** buscar o pedido pela API da loja a partir do id. Tray e VTEX não assinam o
  webhook: use uma automação intermediária (n8n, Make) que assine com o segredo.
- Regras: um pedido criado cancela o carrinho abandonado pendente; o mesmo evento repetido é
  ignorado; contatos descadastrados não recebem; há intervalo mínimo por cliente (padrão 24 h).
  O worker (`whatsapp-automations`, a cada minuto) envia o template aprovado.

### Passos do dono

1. Criar e aprovar na Meta os templates (carrinho, enviado, pós-compra).
2. Conectar a loja, configurar o webhook na plataforma (ou na automação) com o segredo.
3. Em Gatilhos, escolher template, espera e variáveis (`{nome}`, `{pedido}`, `{valor}`, `{itens}`,
   `{link_carrinho}`, `{rastreio}`, `{link_rastreio}`) e ligar a chave geral.

## Z10 Agendamento nativo

- Tela: `/zap/agenda` (Agenda, Serviços, Profissionais, Configurações).
- Serviços têm duração e intervalo; profissionais têm janelas semanais e os serviços que atendem.
  Horários livres respeitam grade, antecedência mínima, janela de dias e o fuso da agenda.
  Dupla marcação é impedida por checagem em transação serializável e por índice único parcial
  (`professional_id`, `starts_at`) nos agendamentos pendentes e confirmados.
- Confirmação e lembrete saem por **templates aprovados** (variáveis: nome, serviço, data e hora,
  profissional). O cliente responde CONFIRMAR ou CANCELAR (texto ou botão do template).
- Reuso do Z3: o formulário com o modelo "Agendamento" marca o primeiro horário livre do dia e
  período escolhidos (títulos das opções iguais aos nomes dos serviços).
- Motor de horários: o cálculo de horários livres e de fuso usa `src/lib/scheduling/slots.ts` e `tz.ts`
  (motor único, ADR 0059) por meio de adaptadores finos em `src/lib/whatsapp/scheduling/`. A reserva do
  WhatsApp confere cada agendamento com o intervalo do seu próprio serviço no banco (`createIfFree`),
  porque aqui vários profissionais e serviços dividem a agenda.
- Fora desta entrega: aviso ao cliente quando o atendente cancela, folgas e feriados por
  profissional, sincronização com calendário externo.

### Passos do dono

1. Criar e aprovar os templates de confirmação e lembrete.
2. Cadastrar serviços e profissionais, escolher conexão e templates, ligar.
