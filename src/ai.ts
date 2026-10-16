/**
 * The AI boundary: one door, currently closed.
 *
 * The quota plumbing (recordAiQuestion, 300/mo cap, PRO gate) already exists.
 * What was missing was the seam where a real model call plugs in. `configureAi`
 * sets it (once, at startup, from wherever the key lives); until then
 * `explainAnswer` throws `AiNotConfigured`, and the UI shows exactly what
 * *would* be sent instead of faking a paragraph.
 *
 * The contract the concept note makes is enforced here by construction: the
 * provider only ever receives a headline plus already-computed figures, never
 * the raw ledger.
 */

export interface AiEvidenceItem {
  label: string
  value: string
}

export interface AiExplainInput {
  headline: string
  evidence: AiEvidenceItem[]
  lang: 'en' | 'fil'
}

export type AiExplain = (input: AiExplainInput) => Promise<string>

let provider: AiExplain | null = null

export function configureAi(next: AiExplain | null): void {
  provider = next
}

export function isAiConfigured(): boolean {
  return provider !== null
}

export class AiNotConfigured extends Error {
  constructor() {
    super('ai.notConfigured')
    this.name = 'AiNotConfigured'
  }
}

export async function explainAnswer(input: AiExplainInput): Promise<string> {
  if (!provider) throw new AiNotConfigured()
  return provider(input)
}
