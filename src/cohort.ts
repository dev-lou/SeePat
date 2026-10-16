/**
 * The institutional product in miniature: cohort aggregates, never raw ledgers.
 *
 * An LGU, coop or livelihood program does not buy one store's books — it buys
 * a measurable outcome across N stores. Each store contributes only opt-in
 * indicators (recording days, profit trend direction, completion), and this
 * module folds them into the cohort view. No transaction, customer name or
 * amount ever leaves the store in this path — that is the line an NPC privacy
 * review wants to see drawn in code, not in prose.
 */

export interface StoreIndicators {
  storeId: string
  recordingDays: number
  profitUp: boolean
  completedOnboarding: boolean
  scoreLatest: number
}

export interface CohortSummary {
  stores: number
  activeStores: number
  recordingDaysTotal: number
  profitUpShare: number
  completionShare: number
  scoreMedian: number
}

export function summarizeCohort(stores: StoreIndicators[]): CohortSummary {
  const n = stores.length
  if (n === 0) {
    return {
      stores: 0,
      activeStores: 0,
      recordingDaysTotal: 0,
      profitUpShare: 0,
      completionShare: 0,
      scoreMedian: 0,
    }
  }
  const active = stores.filter((s) => s.recordingDays > 0)
  const scores = [...stores.map((s) => s.scoreLatest)].sort((a, b) => a - b)
  const mid = Math.floor(scores.length / 2)
  const median =
    scores.length % 2 === 1 ? scores[mid] : Math.round((scores[mid - 1] + scores[mid]) / 2)
  return {
    stores: n,
    activeStores: active.length,
    recordingDaysTotal: stores.reduce((sum, s) => sum + s.recordingDays, 0),
    profitUpShare: stores.filter((s) => s.profitUp).length / n,
    completionShare: stores.filter((s) => s.completedOnboarding).length / n,
    scoreMedian: median,
  }
}
