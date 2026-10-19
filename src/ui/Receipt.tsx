import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Chip, CustomSelect, Field, SectionTitle, Sheet, inputClass } from './components.tsx'
import { useToast } from './Toast.tsx'
import {
  formatPHP,
  parseReceiptText,
  pesos,
  pricePerBaseUnit,
  pricePerDisplayUnit,
  receiptToTransaction,
} from '../engine/index.ts'
import type { ReceiptDraft } from '../engine/index.ts'
import { downscaleImage, explainOcrError, isOcrReady, runOcr, warmOcrEngine } from '../ocr.ts'
import type { OcrEngineId } from '../ocr.ts'
import { markReceipt, newReceiptId, saveReceipt, useReceipts } from '../receipts.ts'
import { newTxnId } from '../store.ts'
import type { Negosyo } from '../store.ts'
import { useLang, useT } from '../i18n/index.ts'

interface EditableRow {
  key: string
  rawText: string
  skuId: string
  newSkuName: string
  newSkuChecked: boolean
  qtyDisplay: string
  priceDisplay: string
  needsReview: boolean
  reason?: string
}

function rowKey(prefix: string, i: number, raw: string): string {
  let h = 0
  for (let k = 0; k < raw.length; k++) h = (h * 31 + raw.charCodeAt(k)) >>> 0
  return `${prefix}-${Date.now().toString(36)}-${i}-${h.toString(36)}`
}

function draftToRows(draft: ReceiptDraft): EditableRow[] {
  return draft.lines.map((l, i) => {
    const skuId = l.skuId ?? ''
    return {
      key: rowKey('ocr', i, l.rawText),
      rawText: l.rawText,
      skuId,
      newSkuName: skuId ? '' : l.nameCandidate,
      newSkuChecked: !skuId,
      qtyDisplay: String(l.qty),
      priceDisplay: l.unitPriceCentavos > 0 ? String(l.unitPriceCentavos / 100) : '',
      needsReview: l.needsReview,
      reason: l.reason,
    }
  })
}

function toBaseQty(displayQty: number): number {
  return Math.round(displayQty)
}

function newManualRow(): EditableRow {
  return {
    key: rowKey('manual', 0, Math.random().toString(36)),
    rawText: '',
    skuId: '',
    newSkuName: '',
    newSkuChecked: true,
    qtyDisplay: '1',
    priceDisplay: '',
    needsReview: true,
    reason: 'new-item',
  }
}

type Facing = 'environment' | 'user'

/**
 * Fullscreen camera: live viewfinder → capture → preview with
 * Retake / Use-photo. Front/back switch flips `facingMode` and restarts the
 * stream. If the browser has no camera (or permission is denied) the sheet
 * explains and offers the file picker instead — the photo path never dead-ends.
 */
function CameraSheet({
  open,
  facing,
  onFacing,
  onCapture,
  onFallback,
  onClose,
}: {
  open: boolean
  facing: Facing
  onFacing: (f: Facing) => void
  onCapture: (blob: Blob) => void
  onFallback: () => void
  onClose: () => void
}) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null)
  const [denied, setDenied] = useState(false)
  const supported =
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'

  useEffect(() => {
    if (!open) return
    setPreview(null)
    setDenied(false)
    let dead = false
    async function start() {
      if (!supported) return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        })
        if (dead) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        streamRef.current?.getTracks().forEach((tr) => tr.stop())
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => {})
        }
      } catch {
        if (!dead) setDenied(true)
      }
    }
    void start()
    return () => {
      dead = true
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
    }
  }, [open, facing, supported])

  useEffect(() => {
    if (!open && preview) {
      URL.revokeObjectURL(preview.url)
      setPreview(null)
    }
  }, [open, preview])

  /*
   * Retake went black because the <video> unmounted while the preview image
   * showed, and the remounted <video> never got the stream re-attached.
   * Re-attach whenever we return to live view with a stream still held.
   */
  useEffect(() => {
    if (open && !preview && streamRef.current && videoRef.current) {
      const v = videoRef.current
      if (v.srcObject !== streamRef.current) {
        v.srcObject = streamRef.current
        v.play().catch(() => {})
      }
    }
  }, [open, preview])

  if (!open) return null

  function capture() {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c || v.videoWidth === 0) return
    c.width = v.videoWidth
    c.height = v.videoHeight
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0)
    c.toBlob(
      (blob) => {
        if (!blob) return
        setPreview((prev) => {
          if (prev) URL.revokeObjectURL(prev.url)
          return { url: URL.createObjectURL(blob), blob }
        })
      },
      'image/jpeg',
      0.85,
    )
  }

  return (
    <Sheet title={t('receipt.cameraTitle')} closeLabel={t('receipt.cameraCancel')} onClose={onClose}>
      {!supported || denied ? (
        <div className="space-y-3">
          <p className="text-[0.875rem] leading-relaxed text-fg-subtle">{t('receipt.cameraDenied')}</p>
          <Button variant="ghost" className="w-full" onClick={onFallback}>
            {t('receipt.cameraChooseFile')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* The video stays mounted under the preview so the stream is never
              lost on retake — hiding, not unmounting, is what keeps it live. */}
          <video
            ref={videoRef}
            playsInline
            muted
            className={`max-h-[50vh] w-full rounded-2xl border border-line object-cover bg-black ${preview ? 'hidden' : ''}`}
          />
          {preview ? (
            <img src={preview.url} alt="" className="max-h-[50vh] w-full rounded-2xl border border-line object-contain bg-black" />
          ) : null}
          <canvas ref={canvasRef} className="hidden" />
          {preview ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  URL.revokeObjectURL(preview.url)
                  setPreview(null)
                }}
              >
                {t('receipt.cameraRetake')}
              </Button>
              <Button
                className="w-full"
                onClick={() => {
                  onCapture(preview.blob)
                  URL.revokeObjectURL(preview.url)
                  setPreview(null)
                }}
              >
                {t('receipt.cameraUse')}
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="ghost" className="w-full" onClick={() => onFacing(facing === 'environment' ? 'user' : 'environment')}>
                  {t('receipt.cameraSwitch')}
                </Button>
                <Button className="w-full" onClick={capture}>
                  {t('receipt.cameraCapture')}
                </Button>
              </div>
              <Button variant="ghost" className="w-full" onClick={onFallback}>
                {t('receipt.cameraChooseFile')}
              </Button>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}

export function ReceiptScreen({ negosyo }: { negosyo: Negosyo }) {
  const { ledger, add, addSku, removeTransaction } = negosyo
  const lang = useLang()
  const t = useT()
  const toast = useToast()
  const undoLabel = lang === 'fil' ? 'I-undo' : 'Undo'
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [engine, setEngine] = useState<OcrEngineId>('mock')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoId, setPhotoId] = useState<string>('')
  const [ocrText, setOcrText] = useState('')
  const [working, setWorking] = useState(false)
  const [ocrError, setOcrError] = useState('')
  const [supplier, setSupplier] = useState('')
  const [rows, setRows] = useState<EditableRow[] | null>(null)
  const [receiptTotal, setReceiptTotal] = useState<number | null>(null)
  const [totalsMismatch, setTotalsMismatch] = useState(false)
  const [posted, setPosted] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [facing, setFacing] = useState<Facing>('environment')
  // Real-OCR readiness: null while warming, true once WASM+weights are cached.
  const [ocrReady, setOcrReady] = useState<boolean | null>(isOcrReady() ? true : null)

  // Warm the reader while the owner is still framing the photo — a real scan
  // then starts instantly instead of downloading mid-tap. Fire-and-forget:
  // offline on first open just stays unready until a scan succeeds.
  useEffect(() => {
    if (engine !== 'tesseract' || isOcrReady()) {
      if (isOcrReady()) setOcrReady(true)
      return
    }
    let live = true
    void warmOcrEngine().then((ready) => {
      if (live && ready) setOcrReady(true)
      else if (live) setOcrReady(false)
    })
    return () => {
      live = false
    }
  }, [engine])
  const { receipts } = useReceipts(refreshKey)

  const draft = useMemo(
    () => (ocrText ? parseReceiptText(ocrText, ledger, lang) : null),
    // Re-parse when the catalogue changes so new SKUs re-match instantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ocrText, ledger.skus, lang],
  )

  async function handleFile(file: File) {
    setOcrError('')
    setPosted('')
    setRows(null)
    const small = await downscaleImage(file)
    setPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(small)
    })
    const id = newReceiptId()
    setPhotoId(id)
    setWorking(true)
    try {
      // A real photo must never use the mock engine: mock returns the canned
      // sample text for ANY image, which is why a selfie drafted Lucky Me.
      // Mock is only for "Try a sample" — photos always get real OCR.
      const realEngine: OcrEngineId = engine === 'mock' ? 'tesseract' : engine
      const result = await runOcr(small, realEngine)
      setOcrReady(true)
      if (!result.text.trim()) {
        setOcrText('')
        setRows(null)
        setOcrError(t('receipt.noText'))
        return
      }
      const parsedPreview = parseReceiptText(result.text, ledger, lang)
      // A face (or any non-receipt) reads as words with no prices and no
      // goods — drafting "Shampoo Sachet" off the fragment "po" is how the
      // last phantom happened. Say so and ask for a retake instead.
      if (parsedPreview.lines.length === 0) {
        setOcrText('')
        setRows(null)
        setOcrError(t('receipt.noText'))
        return
      }
      setOcrText(result.text)
      const parsed = parseReceiptText(result.text, ledger, lang)
      setRows(draftToRows(parsed))
      setSupplier(parsed.supplierGuess)
      setReceiptTotal(parsed.receiptTotalCentavos !== null ? parsed.receiptTotalCentavos / 100 : null)
      setTotalsMismatch(parsed.totalsMismatch)
      await saveReceipt({
        id,
        createdAt: new Date().toISOString(),
        photo: small,
        ocrText: result.text,
        ocrConfidence: result.confidence,
        ocrEngine: result.engine,
        supplierGuess: parsed.supplierGuess,
        status: 'draft',
      })
      setRefreshKey((k) => k + 1)
    } catch (error) {
      setOcrError(explainOcrError(error, lang))
    } finally {
      setWorking(false)
    }
  }

  async function useSample() {
    setOcrError('')
    setPosted('')
    setRows(null)
    setPhotoUrl(null)
    const id = newReceiptId()
    setPhotoId(id)
    setWorking(true)
    try {
      const result = await runOcr(new Blob(), 'mock')
      setOcrText(result.text)
      const parsed = parseReceiptText(result.text, ledger, lang)
      setRows(draftToRows(parsed))
      setSupplier(parsed.supplierGuess)
      setReceiptTotal(parsed.receiptTotalCentavos !== null ? parsed.receiptTotalCentavos / 100 : null)
      setTotalsMismatch(parsed.totalsMismatch)
    } finally {
      setWorking(false)
    }
  }

  const rowTotal = (r: EditableRow): number => {
    const qty = Number(r.qtyDisplay)
    const price = Number(r.priceDisplay)
    if (!(qty > 0) || !(price >= 0)) return 0
    return qty * price
  }
  const draftSum = (rows ?? []).reduce((s, r) => s + rowTotal(r), 0)

  const invalid = (rows ?? []).filter(
    (r) => !(Number(r.qtyDisplay) > 0) || r.priceDisplay === '' || !(Number(r.priceDisplay) > 0) || (!r.skuId && !(r.newSkuChecked && r.newSkuName.trim())),
  )
  const reviewCount = (rows ?? []).filter((r) => r.needsReview).length
  const canConfirm = rows !== null && rows.length > 0 && invalid.length === 0 && !working

  function confirm() {
    if (!rows || !canConfirm) return
    const confirmed = rows.map((r) => {
      const sku = ledger.skus.find((s) => s.id === r.skuId)
      return {
        skuId: r.skuId || '',
        newSkuName: r.skuId ? undefined : r.newSkuName.trim(),
        newSkuUnit: 'pc',
        qty: sku?.baseUnit === 'g' ? toBaseQty(Number(r.qtyDisplay) * 1000) / 1000 : toBaseQty(Number(r.qtyDisplay)),
        unitPriceCentavos: pricePerBaseUnit(sku?.baseUnit ?? 'pc', pesos(Number(r.priceDisplay))),
      }
    })
    // Kg rows: review qty is in kilos, ledger stores grams.
    const fixed = rows.map((r, i) => {
      const sku = ledger.skus.find((s) => s.id === r.skuId)
      if (sku?.baseUnit === 'g') {
        return { ...confirmed[i], qty: Math.round(Number(r.qtyDisplay) * 1000) }
      }
      return confirmed[i]
    })
    const txn = receiptToTransaction(fixed, {
      id: newTxnId('pur'),
      at: new Date().toISOString(),
      photoId,
      supplier: supplier.trim() || undefined,
      createSku: (name, unit) => addSku({ name, unit }),
      lang,
    })
    if (txn.lines.length === 0) return
    add(txn as never)
    if (photoId) {
      markReceipt(photoId, 'confirmed', txn.id).catch(() => {})
      setRefreshKey((k) => k + 1)
    }
    const total = txn.lines.reduce((s, l) => s + l.qty * l.unitCostCentavos, 0)
    const msg =
      lang === 'fil'
        ? `Naitala ang bili — ${formatPHP(total)}. ${reviewCount > 0 ? `(${reviewCount} ni-review mo.)` : ''}`
        : `Purchase recorded — ${formatPHP(total)}.`
    setPosted(msg)
    toast.show({ title: msg, tone: 'success', undoLabel, onUndo: () => removeTransaction(txn.id) })
    setRows(null)
    setOcrText('')
    setPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle hint={t('receipt.step1Hint')}>{t('receipt.captureTitle')}</SectionTitle>
        <p className="text-[0.875rem] leading-relaxed text-fg-subtle">{t('receipt.captureBody')}</p>
        <div className="mt-3 flex flex-wrap gap-1.5 rounded-2xl border border-white/80 bg-white/60 p-1.5 shadow-xs backdrop-blur-md">
          {(['mock', 'tesseract'] as OcrEngineId[]).map((id) => (
            <Chip key={id} active={engine === id} onClick={() => setEngine(id)}>
              {id === 'mock' ? t('receipt.engineMock') : t('receipt.engineTesseract')}
            </Chip>
          ))}
        </div>
        {engine === 'tesseract' ? (
          <>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-faint">{t('receipt.engineNote')}</p>
            <p className="mt-1 text-[0.8125rem] font-semibold text-fg-subtle">
              {ocrReady === true
                ? `✓ ${t('receipt.ocrReady')}`
                : ocrReady === null
                  ? t('receipt.ocrWarming')
                  : t('receipt.ocrNotReady')}
            </p>
          </>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          aria-label={t('receipt.captureTitle')}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void handleFile(file)
          }}
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            className="w-full"
            onClick={() => {
              if (typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function') {
                setCameraOpen(true)
              } else {
                fileRef.current?.click()
              }
            }}
            disabled={working}
          >
            {working ? t('receipt.working') : t('receipt.takePhoto')}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => void useSample()} disabled={working}>
            {t('receipt.trySample')}
          </Button>
        </div>
        {photoUrl ? (
          <img src={photoUrl} alt="" className="mt-3 max-h-56 w-full rounded-2xl border border-line object-cover" />
        ) : null}
        {ocrError ? <p className="mt-2 text-[0.875rem] font-semibold text-red-700">{ocrError}</p> : null}
      </Card>

      {rows !== null && draft ? (
        <Card material={totalsMismatch ? 'gold' : 'plain'} flat={totalsMismatch}>
          <SectionTitle hint={`${rows.length}`}>{t('receipt.reviewTitle')}</SectionTitle>
          <p className="text-[0.875rem] leading-relaxed text-fg-subtle">{draft.summary}</p>
          {totalsMismatch ? (
            <p className="mt-2 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-[0.875rem] font-semibold text-amber-900">
              {t('receipt.totalsMismatch', {
                amount: formatPHP(Math.round(draftSum * 100)),
                total: receiptTotal !== null ? formatPHP(Math.round(receiptTotal * 100)) : '—',
              })}
            </p>
          ) : null}
          <Field label={t('receipt.supplier')}>
            <input
              className={inputClass}
              value={supplier}
              placeholder={t('receipt.supplierPh')}
              onChange={(e) => setSupplier(e.target.value)}
            />
          </Field>
          <div className="mt-3 space-y-3">
            {rows.map((r, idx) => {
              const sku = ledger.skus.find((s) => s.id === r.skuId)
              const perKilo = sku?.baseUnit === 'g'
              return (
                <div key={r.key} className="rounded-2xl border border-line/70 bg-white/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[0.9375rem] font-bold text-fg">{r.skuId ? (sku?.name ?? r.rawText) : (r.newSkuName || t('receipt.newItem'))}</div>
                      <div className="num mt-0.5 truncate text-[0.75rem] text-fg-faint">{r.rawText}</div>
                      {r.needsReview ? (
                        <div className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[0.75rem] font-bold text-amber-900">
                          {r.reason === 'new-item' ? t('receipt.flagNew') : r.reason === 'no-price' ? t('receipt.flagPrice') : t('receipt.flagCheck')}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center px-2 text-[0.8125rem] font-bold text-red-700"
                      onClick={() => setRows((cur) => (cur ?? []).filter((x) => x.key !== r.key))}
                      aria-label={t('receipt.removeLine')}
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Field label={t('receipt.qty')}>
                      <input
                        className={inputClass}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={r.qtyDisplay}
                        onChange={(e) =>
                          setRows((cur) => (cur ?? []).map((x) => (x.key === r.key ? { ...x, qtyDisplay: e.target.value } : x)))
                        }
                      />
                    </Field>
                    <Field label={perKilo ? t('receipt.costKilo') : t('receipt.costEach')}>
                      <input
                        className={inputClass}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={r.priceDisplay}
                        onChange={(e) =>
                          setRows((cur) => (cur ?? []).map((x) => (x.key === r.key ? { ...x, priceDisplay: e.target.value } : x)))
                        }
                      />
                    </Field>
                    <Field label={t('receipt.lineTotal')}>
                      <div className="num flex min-h-11 items-center text-[0.9375rem] font-bold text-fg">
                        {formatPHP(Math.round(rowTotal(r) * 100))}
                      </div>
                    </Field>
                  </div>
                  <Field label={t('receipt.match')}>
                    <CustomSelect
                      value={r.skuId}
                      onChange={(val) =>
                        setRows((cur) =>
                          (cur ?? []).map((x) =>
                            x.key === r.key
                              ? {
                                  ...x,
                                  skuId: val,
                                  newSkuChecked: val === '' ? x.newSkuChecked : false,
                                  priceDisplay:
                                    x.priceDisplay ||
                                    (val
                                      ? String(pricePerDisplayUnit(ledger.skus.find((s) => s.id === val)?.baseUnit ?? 'pc', 0) / 100 || '')
                                      : x.priceDisplay),
                                }
                              : x,
                          ),
                        )
                      }
                      placeholder={t('receipt.newItemOpt')}
                      options={ledger.skus.map((s) => ({ value: s.id, label: s.name }))}
                    />
                  </Field>
                  {r.skuId === '' ? (
                    <label className="mt-2 flex min-h-11 items-center gap-3 text-[0.875rem] text-fg-muted">
                      <input
                        type="checkbox"
                        checked={r.newSkuChecked}
                        onChange={(e) =>
                          setRows((cur) => (cur ?? []).map((x) => (x.key === r.key ? { ...x, newSkuChecked: e.target.checked } : x)))
                        }
                        className="h-5 w-5 shrink-0 accent-brand-700"
                      />
                      {t('receipt.createNew', { name: r.newSkuName || t('receipt.newItem') })}
                    </label>
                  ) : null}
                  {idx === rows.length - 1 && perKilo ? (
                    <p className="mt-1 text-[0.75rem] text-fg-faint">{t('receipt.kiloNote')}</p>
                  ) : null}
                </div>
              )
            })}
          </div>
          <Button variant="ghost" className="mt-3 w-full" onClick={() => setRows((cur) => [...(cur ?? []), newManualRow()])}>
            {t('receipt.addLine')}
          </Button>
          {invalid.length > 0 ? (
            <p className="mt-2 text-[0.875rem] font-semibold text-red-700">{t('receipt.needAll')}</p>
          ) : null}
          <Button className="mt-3 w-full" onClick={confirm} disabled={!canConfirm}>
            {t('receipt.confirm', { amount: formatPHP(Math.round(draftSum * 100)) })}
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => { setRows(null); setOcrText('') }}>
            {t('receipt.discard')}
          </Button>
          {posted ? <p className="mt-2 text-[0.875rem] font-bold text-brand-800">{posted}</p> : null}
        </Card>
      ) : null}

      <CameraSheet
        open={cameraOpen}
        facing={facing}
        onFacing={setFacing}
        onFallback={() => {
          setCameraOpen(false)
          fileRef.current?.click()
        }}
        onCapture={(blob) => {
          setCameraOpen(false)
          void handleFile(new File([blob], 'receipt.jpg', { type: 'image/jpeg' }))
        }}
        onClose={() => setCameraOpen(false)}
      />

      {receipts.length > 0 ? (
        <Card>
          <SectionTitle hint={`${receipts.length}`}>{t('receipt.recentTitle')}</SectionTitle>
          <ul className="space-y-1">
            {receipts.slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 border-b border-line/50 py-2 last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-[0.875rem] text-fg">{r.supplierGuess || r.id}</span>
                <span className="num text-[0.75rem] text-fg-faint">{r.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}
