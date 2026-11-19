# CRM > Atrair > Presença no Google

Três telas sobre o **Perfil da Empresa no Google** (Google Business Profile,
antigo Google Meu Negócio), com a conexão OAuth do próprio workspace:

| Tela | Rota | O que faz |
| ---- | ---- | --------- |
| Perfil da empresa | `/[workspace-slug]/crm/google/profile` | Escolhe o local; edita nome, telefone, site, descrição (com sugestão por IA), categorias, horários, atributos e fotos; checklist de completude |
| Google Maps | `/[workspace-slug]/crm/google/maps` | Mapa do local, links de avaliar/rotas/Maps com QR code, desempenho por período (buscas, visualizações no Maps, ligações, rotas, cliques no site), onde aparece e buscas que levaram ao negócio |
| Avaliações | `/[workspace-slug]/crm/google/reviews` | Nota média e evolução, lista paginada com filtros, resposta pelo Steel, sugestão de resposta por IA no tom da marca, alerta de nota baixa e "Pedir avaliação" |

Sem conexão, as três telas mostram a mesma tela de conexão (e a de
"reconectar" quando o acesso expirou ou foi revogado). Não há dado fictício.

## O que depende de aprovação do Google (ação da Stratus)

Nada disto funciona em produção até os itens abaixo estarem feitos. Do lado do
Steel tudo está pronto; sem eles a tela mostra "A API do Google Meu Negócio
ainda não está liberada para o aplicativo do Steel".

1. **Acesso às APIs do Business Profile.** Os projetos novos do Google Cloud
   começam com quota 0 nessas APIs. É preciso pedir acesso pelo formulário
   _Business Profile APIs: Prerequisites / Request access_ (precisa de um
   Perfil da Empresa verificado e ativo há 60+ dias, e do site da empresa).
   Depois de aprovado, ativar no projeto:
   - My Business Account Management API
   - My Business Business Information API
   - Business Profile Performance API
   - Google My Business API (v4) — avaliações e fotos ainda só existem nela
2. **Tela de consentimento OAuth.** O escopo
   `https://www.googleapis.com/auth/business.manage` é **sensível**: o app
   precisa de verificação do Google (política de privacidade, domínio
   verificado, vídeo de demonstração). Enquanto estiver em "Testing", só
   usuários de teste (até 100) conseguem conectar.
3. **URI de redirecionamento.** Cadastrar no mesmo cliente OAuth já usado por
   Analytics e Ads:
   `<BETTER_AUTH_URL>/api/google-business/callback`
   (homologação e produção, cada uma com o seu domínio).

Variáveis de ambiente: nenhuma nova. Reaproveita `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` e `SOCIAL_TOKEN_ENCRYPTION_KEY` (cifra dos tokens).
Sem elas a tela diz que a integração "ainda não foi habilitada neste ambiente".

## Como funciona

- **Conexão por workspace** (`CrmGoogleBusinessConnection`, uma por
  workspace). Tokens cifrados em repouso (AES-256-GCM, a mesma cifra das redes
  sociais) e nunca devolvidos em DTO. O `state` do OAuth é assinado (HMAC),
  expira em 10 minutos e vale só para o usuário que iniciou o fluxo.
- **Escolha do local**: depois de conectar, o usuário escolhe um dos locais das
  contas do Google; trocar de local apaga o cache do anterior.
- **Ao vivo**: perfil, categorias, atributos, fotos e links são lidos/gravados
  direto no Google (sem cópia no banco, para nunca divergir).
- **Cache no banco**: avaliações (`CrmGoogleReview`) e métricas diárias
  (`CrmGoogleBusinessDailyMetric`, 180 dias) são sincronizadas pelo worker na
  fila `crm-google-sync` a cada 30 minutos (métricas no máximo a cada 12 h).
  "Atualizar agora" na tela de avaliações lê todas as páginas na hora.
- **Alerta de nota baixa**: avaliação nova de 1 ou 2 estrelas, sem resposta e
  dos últimos 7 dias gera a notificação `CRM_GOOGLE_REVIEW_NEGATIVE` para
  OWNER/ADMIN (uma vez por avaliação). Avaliações antigas importadas na
  primeira sincronização não alertam.
- **IA** (descrição do perfil e resposta a avaliação): mesmo portão do restante
  do CRM — recurso `crm.aiAssistant` do plano, modelo do workspace e cota
  mensal via `AiUsageService` (o consumo entra no extrato de IA como
  `CRM_ASSISTANT`). O tom da marca é um texto livre por workspace
  ("Tom de voz da IA"). O texto do cliente segue cercado como conteúdo não
  confiável (guardrails de injeção). Nada é publicado sem o usuário revisar.
- **Permissões**: recurso `social` do CRM — ver (`VIEW`), conectar (`CREATE`),
  editar perfil/responder/sugerir (`EDIT`), desconectar/apagar foto ou resposta
  (`DELETE`). Auditoria em `crm_google_connection`, `crm_google_profile` e
  `crm_google_review`.

## Limites conhecidos

- O **endereço** não é editável pelo Steel (mudança de endereço no Google passa
  por verificação); a tela explica e o usuário altera no próprio Google.
- Atributos: só os de tipo sim/não são editáveis.
- Fotos: JPG/PNG, 10 KB a 5 MB. O Google baixa a imagem de uma URL temporária
  do Steel (`/api/social/blob/<token>`, 10 min), como o publicador do Instagram.
- O Google fecha as métricas com 2 a 3 dias de atraso.
- Perfis de área de atuação (sem endereço público) não têm mapa embutido.
- Pedir avaliação: o Steel entrega o link, a mensagem pronta (WhatsApp, e-mail)
  e o QR code; o disparo em massa para clientes do CRM fica para uma etapa
  futura (campanha com o link de avaliação).
