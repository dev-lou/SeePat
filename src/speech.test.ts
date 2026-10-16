import { describe, expect, it } from 'vitest'
import { chooseVoice, chunkForSpeech, localeFor, speakableText, spokenAnswer } from './speech.ts'

/**
 * SeePat's voice, tested where it can be tested.
 *
 * There is no speaker in node, so what is asserted here is the part that decides
 * what gets said and in whose voice — which is also the part that can be wrong
 * *silently*: a figure read out as "peso sign four one eight three point six five"
 * sounds like a bug the owner cannot name, and no type would catch it.
 */

describe('typeset text becomes spoken text', () => {
  it('reads pesos as words, not as a symbol', () => {
    expect(speakableText('You earned ₱4,183.65 this week.', 'en')).toBe(
      'You earned 4,183 pesos and 65 centavos this week.',
    )
    expect(speakableText('Kumita ka ng ₱4,183.65.', 'fil')).toBe(
      'Kumita ka ng 4,183 piso at 65 sentimo.',
    )
  })

  it('drops the centavo clause when there are none', () => {
    // "and 0 centavos" would be appended to almost every figure in the app.
    expect(speakableText('₱70.00 left', 'en')).toBe('70 pesos left')
    expect(speakableText('₱70.00 ang natira', 'fil')).toBe('70 piso ang natira')
  })

  it('reads a whole-peso figure with no decimal point at all', () => {
    expect(speakableText('₱1,240 total', 'en')).toBe('1,240 pesos total')
  })

  it('reads a percentage as a word', () => {
    expect(speakableText('29.7% of sales', 'en')).toBe('29.7 percent of sales')
    expect(speakableText('29.7% ng benta', 'fil')).toBe('29.7 porsiyento ng benta')
  })

  it('turns the typographic separators into pauses and drops bullets', () => {
    expect(speakableText('· "Magkano kinita ko?"', 'en')).toBe('Magkano kinita ko?')
    expect(speakableText('Coke — 12 pieces · ₱240.00', 'en')).toBe('Coke, 12 pieces, 240 pesos')
  })

  it('leaves a sentence with no figures or marks alone', () => {
    expect(speakableText('Walang benta sa panahong ito.', 'fil')).toBe(
      'Walang benta sa panahong ito.',
    )
  })
})

describe('chunking a long answer', () => {
  it('keeps a short answer as one utterance', () => {
    expect(chunkForSpeech('Magkano ang kita mo ngayong linggo?')).toEqual([
      'Magkano ang kita mo ngayong linggo?',
    ])
  })

  it('says nothing when there is nothing to say', () => {
    expect(chunkForSpeech('   ')).toEqual([])
  })

  it('never exceeds the ceiling, because a long utterance gets dropped', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about the store.`).join(
      ' ',
    )
    const chunks = chunkForSpeech(long, 120)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120)
  })

  it('breaks at sentence ends when it has the choice', () => {
    expect(chunkForSpeech('One. Two. Three.', 8)).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('loses no words and no figures on the way through', () => {
    const text =
      'You sold ₱4,183.65 worth of goods in the last 7 days. What you paid for those goods was ₱2,940.00, and expenses were ₱250.00, which leaves ₱993.65 as the real profit for the week.'
    const chunks = chunkForSpeech(text, 80)
    // Punctuation and spacing are allowed to move; letters and digits are not.
    const squash = (value: string) => value.replace(/[^a-z0-9]/gi, '')
    expect(chunks.length).toBeGreaterThan(2)
    expect(squash(chunks.join(' '))).toBe(squash(text))
  })

  it('never cuts a thousands separator into a clause break', () => {
    const chunks = chunkForSpeech(
      'You kept 1,234,567 pesos and 89 centavos on that one sale today.',
      30,
    )
    expect(chunks.some((chunk) => chunk.includes('1,234,567'))).toBe(true)
    for (const chunk of chunks) expect(chunk).not.toMatch(/^,\s*\d/)
  })
})

describe('choosing the voice', () => {
  const english = { name: 'English (US)', lang: 'en-US', default: true }
  const filipino = { name: 'Filipino', lang: 'fil-PH' }

  it('asks each language for its own locale', () => {
    expect(localeFor('fil')).toBe('fil-PH')
    expect(localeFor('en')).toBe('en-PH')
  })

  it('picks the Tagalog voice for Tagalog and says it is the right one', () => {
    expect(chooseVoice([english, filipino], 'fil')).toEqual({ voice: filipino, exact: true })
  })

  it('picks the English voice for English', () => {
    expect(chooseVoice([english, filipino], 'en')).toEqual({ voice: english, exact: true })
  })

  it('treats tl-PH as Tagalog, because platforms disagree about the code', () => {
    const tagalog = { name: 'Tagalog', lang: 'tl-PH' }
    expect(chooseVoice([english, tagalog], 'fil')).toEqual({ voice: tagalog, exact: true })
  })

  it('prefers the exact locale over a bare language match', () => {
    const generic = { name: 'Filipino (generic)', lang: 'fil' }
    const regional = { name: 'Filipino (PH)', lang: 'fil_PH' }
    expect(chooseVoice([generic, regional], 'fil')?.voice.name).toBe('Filipino (PH)')
  })

  it('still reads the answer when the phone has no Tagalog voice, and says so', () => {
    // The honest case: the words come out, accented. Reporting `exact: false` is
    // what lets the card tell the owner why rather than letting her conclude the
    // app is broken.
    expect(chooseVoice([english], 'fil')).toEqual({ voice: english, exact: false })
  })

  it('reads English rather than nothing when there is no English voice', () => {
    const choice = chooseVoice([filipino], 'en')
    expect(choice).toEqual({ voice: filipino, exact: false })
  })

  it('reports no voice at all rather than inventing one', () => {
    expect(chooseVoice([], 'en')).toBeNull()
  })
})

describe('what the voice is asked to say', () => {
  const answer = {
    headline: 'You earned ₱993.65 in the last 7 days.',
    detail: [
      'You sold ₱4,183.65 worth of goods.',
      'Try these:',
      '· "Nasaan ang puhunan ko?"',
      'Expenses: ₱250.00',
      'Spoiled or missing: ₱0.00',
    ],
    actions: ['Collect the utang first, before adding a big stock order.'],
  }

  it('reads the headline, the supporting lines and the one thing to do', () => {
    const spoken = spokenAnswer(answer)
    expect(spoken.startsWith('You earned ₱993.65')).toBe(true)
    expect(spoken).toContain('Expenses: ₱250.00')
    expect(spoken.endsWith('Collect the utang first, before adding a big stock order.')).toBe(true)
  })

  it('does not read example questions out as if they were the answer', () => {
    expect(spokenAnswer(answer)).not.toContain('Nasaan')
    expect(spokenAnswer(answer)).not.toContain('Try these:')
  })

  it('caps the supporting lines so an answer stays listenable', () => {
    const spoken = spokenAnswer({
      headline: 'Headline.',
      detail: ['One.', 'Two.', 'Three.', 'Four.', 'Five.'],
      actions: [],
    })
    expect(spoken).toBe('Headline. One. Two. Three.')
  })

  it('reads a bare headline without inventing a tail', () => {
    expect(spokenAnswer({ headline: 'Walang benta sa panahong ito.', detail: [], actions: [] })).toBe(
      'Walang benta sa panahong ito.',
    )
  })
})
