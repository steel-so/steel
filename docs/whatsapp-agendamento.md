# WhatsApp: agendamento nativo (Z10)

O agendamento nasce **desligado** por workspace. O que depende de aprovação de terceiros fica atrás
de uma chave que o dono liga depois de cumprir os passos abaixo.

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
- Reuso do C5: o cálculo de horários livres e de fuso usa `src/lib/scheduling/slots.ts` e `tz.ts` (motor único, ADR 0059)
  por meio de adaptadores finos em `src/lib/whatsapp/scheduling/`. Não coube reaproveitar: as
  reservas (tabelas, links públicos, e-mail e .ics do C5 são por vendedor e por reunião) e o
  limite de conflito, que o C5 aplica com o intervalo do serviço oferecido nos dois lados,
  enquanto a reserva do WhatsApp confere cada agendamento com o intervalo do seu próprio
  serviço no banco (`createIfFree`), porque aqui vários profissionais e serviços dividem a agenda.
- Fora desta entrega: aviso ao cliente quando o atendente cancela, folgas e feriados por
  profissional, sincronização com calendário externo.

### Passos do dono

1. Criar e aprovar os templates de confirmação e lembrete.
2. Cadastrar serviços e profissionais, escolher conexão e templates, ligar.
