# 0026 — Steel Canvas: um motor de arrastar e soltar para e-mail e sites

- **Status:** Aceita
- **Data:** 2026-10-14
- **Decisores:** product owner ("drag-and-drop completo — igual a um Wix e WordPress"; aprovou o plano em 14/10: layout híbrido, domínio próprio no S3, loja e área de membros para depois, menu "Sites", ordem motor → e-mail → site)

## Contexto

O editor de e-mail do CRM (`docs/crm-email-builder.md`, documento
`version: 1`) e as landing pages (`CrmLandingPageSection`) são estruturas
travadas: o usuário escolhe um modelo e troca o conteúdo. O product owner
quer liberdade total: uma barra lateral com os componentes disponíveis,
arrastar e montar 100% da página, clicar num componente e o painel lateral
virar o menu de edição completo dele. Para o e-mail, sobre React Email; para
os sites, um produto no nível de Wix e WordPress (várias páginas, blog,
domínio próprio), com qualidade acima dos dois.

Construir dois editores independentes duplicaria seleção, arrastar e soltar,
histórico, camadas, inspetor e atalhos — e os bugs de cada um.

## Decisão

Um **motor de edição comum** (`src/lib/canvas/`, shell em
`app/_components/canvas/`) e **catálogos de componentes** por destino: o de
e-mail renderiza com React Email; o de sites renderiza HTML/CSS responsivo.

- **Documento normalizado**: mapa plano `nodes` + `rootId`, cada nó com
  `type`, `props` e `children`. Valida com o schema Zod de cada tipo
  registrado. Normalizado para que operações, histórico e, no futuro, Yjs
  mexam em um nó por vez.
- **Toda mudança é uma operação pura** (`insert`, `remove`, `move`,
  `update`, `meta`, `batch`) que devolve o documento novo e a operação
  inversa. O histórico guarda operações; digitação e sliders se fundem num
  passo só.
- **O catálogo declara, o motor executa**: quem aceita quem, mínimos e
  máximos, obrigatórios (rodapé do e-mail), únicos, e a descrição do
  inspetor (abas Conteúdo / Estilo / Avançado). Nenhum catálogo monta
  formulário próprio.
- **Valores responsivos** são `{ base, tablet?, mobile? }` com cascata
  base → tablet → mobile. O e-mail usa base + mobile; os sites, os três.
- **O canvas renderiza os componentes reais** do catálogo dentro de um
  iframe (CSS isolado); contornos, alças e linhas de soltar ficam numa camada
  por cima e nunca entram na saída.
- **Arrastar e soltar** com `@dnd-kit` (já instalado), inclusive por teclado.
- **Sites usam layout híbrido**: fluxo (seção → container flex/grid →
  elementos) como base e "posição livre" opcional dentro de um container.

## Consequências

- O e-mail serve de laboratório do motor com um catálogo pequeno; o site
  começa sobre algo testado.
- Regras de destino (limites do e-mail em Outlook/Gmail, desempenho do site)
  ficam dentro dos componentes, não com o usuário.
- O documento `version: 1` do e-mail precisa de um conversor para o novo
  formato; templates `LEGACY` seguem como estão.
- Coedição em tempo real fica para a fase S4; o formato normalizado foi
  escolhido para não fechar essa porta.
- Fases e escopo: `docs/canvas/README.md`.
