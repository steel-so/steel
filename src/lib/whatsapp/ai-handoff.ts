/**
 * Safety net for the AI hand-off. The model is told to include the marker
 * `[[TRANSFERIR_ATENDENTE]]` when a person must take over, but cheaper models
 * often only *say* it ("Vou transferir sua solicitação para a Viviane") and
 * forget the marker — the customer is told a person is coming and nobody is
 * notified. A reply that announces the transfer counts as one.
 *
 * Deliberately narrow: it needs a transfer verb followed by "para <someone>"
 * in the same sentence, and ignores number/line porting ("transferir o número
 * para a Stratus"), which is a normal topic in a telecom conversation.
 */
const ANNOUNCES_TRANSFER =
  /\b(?:[Tt]ransfer(?:ir|i|indo)|[Rr]epass(?:ar|ei|ando)|[Ee]ncaminh(?:ar|ei|ando|o))\b[^.!?\n]{0,60}?\bpara\s+(?:a\s+|o\s+|um\s+|uma\s+|nosso\s+|nossa\s+|nossos\s+)?(?:atendente|equipe|time|especialista|humano|consultor|consultora|vendedor|vendedora|respons[aá]vel|setor|comercial|financeiro|suporte|[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-zà-ú]+)/

const PORTING = /n[uú]mero|linha|portabilidade|chip/i

export function replyAnnouncesHandoff(reply: string): boolean {
  const match = ANNOUNCES_TRANSFER.exec(reply)
  return match !== null && !PORTING.test(match[0])
}
