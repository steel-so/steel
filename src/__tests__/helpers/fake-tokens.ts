/**
 * Fake provider tokens for tests. Built at runtime so the source never holds
 * a literal that matches the secret scanners' patterns (gitleaks
 * `gitlab-pat`), while still looking like the real format.
 */
export function fakeGitlabToken(body = 'x'.repeat(20)): string {
  return ['glpat', body].join('-')
}

/**
 * Fake PABX secret of the voice attendant (ADR 0046). Low entropy and built at
 * runtime, so no literal looks like a generic API key to the secret scanners.
 */
export function fakeVoiceAgentSecret(tag = 'x'): string {
  return ['vk', `${tag}`.repeat(26)].join('_')
}
