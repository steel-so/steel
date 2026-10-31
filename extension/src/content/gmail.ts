import { accountFromGmailTitle, buildGmailContact, type MailAddress } from '../lib/extract'
import { watchContact } from './watch'

function addresses(selector: string): MailAddress[] {
  return [...document.querySelectorAll<HTMLElement>(selector)].map((element) => ({
    email: element.getAttribute('email') ?? '',
    name: element.getAttribute('name'),
  }))
}

// `.gD` is the sender of a message in an open thread, `.g2` a recipient.
watchContact(() =>
  buildGmailContact({
    senders: addresses('span.gD[email]'),
    recipients: addresses('span.g2[email]'),
    account: accountFromGmailTitle(document.title),
  }),
)
