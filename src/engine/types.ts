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
  source?: 'manual' | 'voice'
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

export interface CashSaleTxn extends TxnBase {
  kind: 'cash_sale'
  lines: SaleLine[]
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
  cashCentavos: Centavos
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
}
