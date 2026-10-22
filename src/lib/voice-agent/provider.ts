/**
 * Contract between the call bridge and a realtime voice model (ADR 0046).
 * Audio crossing this interface is always 16-bit little endian mono PCM at
 * 8 kHz (what Asterisk speaks); each provider converts to its own format.
 * Replacing OpenAI means writing another implementation of
 * {@link RealtimeVoiceProvider}; nothing else changes.
 */

export interface VoiceToolDefinition {
  name: string
  description: string
  /** JSON Schema of an object. */
  parameters: Record<string, unknown>
}

export interface VoiceSessionConfig {
  instructions: string
  voice: string
  tools: VoiceToolDefinition[]
  /** Language hint for the caller transcription (BCP 47). */
  language: string
}

/** Token usage of one model response, split the way the provider bills it. */
export interface VoiceUsage {
  inputAudioTokens: number
  inputTextTokens: number
  cachedInputTokens: number
  outputAudioTokens: number
  outputTextTokens: number
}

export interface VoiceToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface VoiceProviderEvents {
  /** Speech of the model, ready to play to the caller. */
  onAudio(pcm8k: Buffer): void
  /** The caller started talking: whatever is queued to play must stop. */
  onSpeechStarted(): void
  /**
   * The provider decided the caller finished the turn (end of speech already
   * detected). The latency of the attendant is measured from here to the
   * first audio of the answer.
   */
  onSpeechStopped(): void
  onCallerTranscript(text: string): void
  onAssistantTranscript(text: string): void
  onToolCall(call: VoiceToolCall): void
  /** The model finished a response (audio fully generated). */
  onResponseDone(): void
  onUsage(usage: VoiceUsage): void
  /** Unrecoverable provider problem; the bridge falls back to a human. */
  onError(error: Error): void
  onClose(): void
}

export interface VoiceProviderSession {
  /** Caller audio. */
  sendAudio(pcm8k: Buffer): void
  /** Makes the model speak `text` word for word (the mandatory notice). */
  speak(text: string): void
  /** Answers a tool call and lets the model continue. */
  sendToolResult(callId: string, output: string): void
  /** Makes the model say something following `instruction` (goodbye...). */
  respond(instruction: string): void
  close(): void
}

export interface RealtimeVoiceProvider {
  readonly name: string
  readonly model: string
  connect(
    config: VoiceSessionConfig,
    events: VoiceProviderEvents,
  ): Promise<VoiceProviderSession>
}
