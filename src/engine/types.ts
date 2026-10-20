import type { Centavos } from './money.ts'

export type SkuId = string
export type CustomerId = string
export type TxnId = string

/**
 * Quantities are integers in the SKU's base unit.
 * Items sold by weight set `unit: 'kg'` with `baseUnit: 'g'`, so 1.5 kg is
 * recorded as 1500 g. This keeps quantities exact without floats.
 */
export type Qty = number

export interface Sku {
  id: SkuId
  name: string
  /** Display unit, e.g. "pc" or "kg". */
  unit: string
  /** Base unit quantities are counted in, e.g. "pc" or "g". */
  baseUnit: string
  /** Spoken/typed aliases used by the constrained voice matcher. */
  aliases: string[]
  /**
   * Owner-typed defaults, per BASE unit in centavos — "bought for 21, sell
   * for 24". Set in My Items; used as the prefill when no transaction has
   * set a price yet. Optional so old ledgers and backups load unchanged.
   */
  buyPriceCentavos?: Centavos
  sellPriceCentavos?: Centavos
}

export interface Customer {
  id: CustomerId
  name: string
  aliases: string[]
}

export interface PurchaseLine {
  skuId: SkuId
  qty: Qty
  unitCostCentavos: Centavos
}

export interface SaleLine {
  skuId: SkuId
  qty: Qty
  unitPriceCentavos: Centavos
}

interface TxnBase {
  id: TxnId
  /** ISO 8601 timestamp of when the transaction happened. */
  at: string
  /**
   * The owner's own words, kept verbatim. Never translated, because it is a
   * record of what was said rather than copy the app chose.
   */
  note?: string
  /**
   * How the record was captured. Stored as a key rather than the word "Boses"
   * so a ledger written in one language still reads correctly in the other.
   */
  source?: 'manual' | 'voice' | 'camera'
}

/**
 * A purchase may be part-paid: `paidCentavos < total` raises supplier payables
 * (utang sa supplier). `paidCentavos === 0` is a pure credit purchase.
 */
export interface PurchaseTxn extends TxnBase {
  kind: 'purchase'
  lines: PurchaseLine[]
  paidCentavos: Centavos
}

/**
 * Where money actually went, as opposed to who it came from.
 *
 * This exists because "cash sale" had become a lie in the Philippine market:
 * Packworks' own survey of its store network reports 85% of surveyed owners
 * using GCash and 40% taking e-wallet payments in store, and a sale paid by
 * GCash is *received* money that is not in the drawer. Counting it as cash made
 * the drawer figure wrong for every store that accepts e-wallets — and the
 * drawer is the one number an owner can check against reality.
 *
 * `cash` is the default everywhere, so every record written before this field
 * existed still reads correctly.
 *
 * What it is NOT: a payment integration. SeePay records how the money arrived, as
 * the owner tells it. No app at this level can confirm a GCash or Maya transfer
 * (GCash's API is partner-only, and Maya's status APIs belong to payments the
 * integrator itself created), and a payments acquirer needs BSP authorization
 * under Circular 1198 — so this stays a bookkeeping fact, never a settlement
 * claim.
 */
export type PaymentChannel = 'cash' | 'gcash' | 'maya' | 'bank'

export interface CashSaleTxn extends TxnBase {
  kind: 'cash_sale'
  lines: SaleLine[]
  /** Money received now, but where? Absent means the box. */
  channel?: PaymentChannel
}

/** Utang: revenue is recognised now, but cash is not received. */
export interface CreditSaleTxn extends TxnBase {
  kind: 'credit_sale'
  lines: SaleLine[]
  customerId: CustomerId
}

export interface PaymentReceivedTxn extends TxnBase {
  kind: 'payment_received'
  customerId: CustomerId
  amountCentavos: Centavos
  /** A customer settling utang by GCash lands in the wallet, not the drawer. */
  channel?: PaymentChannel
}

export interface ExpenseTxn extends TxnBase {
  kind: 'expense'
  amountCentavos: Centavos
  /** 'cash' pays immediately; 'credit' raises supplier payables. */
  paid: 'cash' | 'credit'
}

export interface PayablePaymentTxn extends TxnBase {
  kind: 'payable_payment'
  amountCentavos: Centavos
}

export interface CapitalInjectionTxn extends TxnBase {
  kind: 'capital_injection'
  amountCentavos: Centavos
}

export interface OwnerWithdrawalTxn extends TxnBase {
  kind: 'owner_withdrawal'
  amountCentavos: Centavos
}

export interface FixedAssetPurchaseTxn extends TxnBase {
  kind: 'fixed_asset_purchase'
  amountCentavos: Centavos
}

/**
 * Stock adjustment. Negative `qtyDelta` is a write-off (shrinkage, spoilage):
 * the inventory value removed is booked as a loss. Positive `qtyDelta` requires
 * an explicit cost basis, since there is no purchase to derive one from.
 */
export interface StockAdjustmentTxn extends TxnBase {
  kind: 'stock_adjustment'
  skuId: SkuId
  qtyDelta: Qty
  unitCostCentavos?: Centavos
}

export type Transaction =
  | PurchaseTxn
  | CashSaleTxn
  | CreditSaleTxn
  | PaymentReceivedTxn
  | ExpenseTxn
  | PayablePaymentTxn
  | CapitalInjectionTxn
  | OwnerWithdrawalTxn
  | FixedAssetPurchaseTxn
  | StockAdjustmentTxn

/**
 * A void is recorded as a separate, auditable marker rather than by deleting or
 * mutating a transaction: the twin is recomputed from the log, so the void is
 * reproducible and traceable.
 */
export interface VoidRecord {
  txnId: TxnId
  at: string
  reason?: string
  by?: string
}

export interface Ledger {
  skus: Sku[]
  customers: Customer[]
  transactions: Transaction[]
  voids: VoidRecord[]
}

export interface SkuStock {
  qty: Qty
  valueCentavos: Centavos
  /** Last known unit cost — fallback basis when selling stock with no purchase history. */
  lastUnitCostCentavos: Centavos
}

export interface SkuPeriodStats {
  qtySold: Qty
  revenueCentavos: Centavos
  cogsCentavos: Centavos
  marginCentavos: Centavos
}

export interface Warning {
  code:
    | 'oversold_stock'
    | 'unknown_sku'
    | 'unknown_customer'
    | 'payment_exceeds_receivable'
    | 'payment_exceeds_payable'
    | 'overpaid_purchase'
    | 'voided_txn_not_found'
    | 'box_overdrawn'
  message: string
  /**
   * The same diagnostic in Filipino. Carried inline rather than looked up at
   * display time because the values (`${skuId}`, amounts) are only in scope where
   * the warning is raised — so the twin stays language-free and is never
   * recomputed just because the owner switched languages.
   */
  messageFil: string
  txnId?: TxnId
}

/**
 * The Microenterprise Business Twin: the current financial state of the negosyo,
 * produced by folding the ledger. Every field is derived — nothing here is
 * hand-set, so it can always be rebuilt from the transaction log.
 */
export interface BusinessTwin {
  /**
   * Money on hand — the drawer *and* the e-wallet float, together.
   *
   * It stays one number on purpose: it is what the owner can spend, and every
   * identity in `deriveTwin` is written against it. `walletCentavos` below is
   * the part of it that is in GCash/Maya, which is what makes the drawer figure
   * separable without a second account system.
   */
  cashCentavos: Centavos
  /**
   * The part of `cashCentavos` sitting in an e-wallet rather than the box.
   *
   * Never larger than `cashCentavos` unless the box has been overdrawn on paper,
   * which is itself reported as a warning: money recorded as leaving the drawer
   * can only have come from somewhere else. Outflows are assumed to come from the
   * box (see `applyTransaction`), so a store that pays a supplier through GCash
   * understates its float until it records that payment as cash.
   */
  walletCentavos: Centavos
  payablesCentavos: Centavos
  fixedAssetsCentavos: Centavos

  capitalInjectedCentavos: Centavos
  withdrawalsCentavos: Centavos

  revenueCentavos: Centavos
  cogsCentavos: Centavos
  expensesCentavos: Centavos
  shrinkageCentavos: Centavos

  inventory: Record<SkuId, SkuStock>
  receivables: Record<CustomerId, Centavos>
  salesBySku: Record<SkuId, SkuPeriodStats>

  warnings: Warning[]
}

export interface DerivedTwin {
  grossProfitCentavos: Centavos
  netProfitCentavos: Centavos
  grossMargin: number
  netMargin: number

  inventoryValueCentavos: Centavos
  receivablesCentavos: Centavos
  totalAssetsCentavos: Centavos
  totalLiabilitiesCentavos: Centavos
  equityCentavos: Centavos
  workingCapitalCentavos: Centavos
  /** `cashCentavos` minus `walletCentavos`: the number a drawer count is against. */
  cashInBoxCentavos: Centavos
  /** The same figure said plainly: money in e-wallets, GCash/Maya. */
  walletCentavos: Centavos
}
