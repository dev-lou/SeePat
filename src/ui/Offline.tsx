import { useEffect, useRef, useState } from 'react'
import { Button, Card, Pill, SectionTitle } from './components.tsx'
import { exportLedger, importLedger } from '../backup.ts'
import type { Negosyo } from '../store.ts'
import { Pat } from './Pat.tsx'
import {
  OFFLINE_MODELS,
  RUNTIME_APPROX_MB,
  installVoiceModel,
  removeVoiceModel,
  useVoiceModel,
} from '../asr-offline.ts'
import type { InstallPhase, InstallProgress } from '../asr-offline.ts'
import { isCaptureSupported } from '../audio.ts'
import { formatDate, liveFeatures } from '../billing.ts'
import { pick, tNow, useLang, useT } from '../i18n/index.ts'

/**
 * Offline at Boses — where "does this work without internet?" is answered
 * plainly, instead of being a claim in a pitch deck.
 *
 * Three things live here, in order of how often an owner needs them: what the
 * app can already do with no signal, how to add offline voice to it, and why
 * the answer is not simply "download the 320MB Filipino model".
 */

function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}

function useShellStatus(): { installed: boolean; cached: boolean } {
  const [status, setStatus] = useState({ installed: false, cached: false })

  useEffect(() => {
    const installed =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(display-mode: standalone)').matches === true
    const cached =
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      navigator.serviceWorker.controller !== null
    setStatus({ installed, cached })
  }, [])

  return status
}

/**
 * How much space this app is taking on the phone.
 *
 * Re-measured whenever the installed voice changes. It used to be read once at
 * mount, which meant the screen still said "0 B" after a 76MB download — the one
 * figure here that is supposed to prove the download really happened.
 *
 * The storage quota is deliberately not shown. "30 GB" tells the owner nothing
 * and makes a small number look like a warning; the useful fact is only how much
 * of her phone is gone.
 */
function useStorageEstimate(refreshKey: string): string | null {
  const [bytes, setBytes] = useState<number | null>(null)

  useEffect(() => {
    const storage = navigator.storage
    if (!storage?.estimate) return
    let live = true
    void storage
      .estimate()
      .then((estimate) => {
        if (!live || typeof estimate.usage !== 'number') return
        setBytes(estimate.usage)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [refreshKey])

  if (bytes === null) return null
  return bytes < 1024 * 1024 ? tNow('offline.storageAlmostNothing') : megabytes(bytes)
}

const WHISPER_TOTAL_MB =
  (OFFLINE_MODELS.find((m) => m.installable)?.approxMB ?? 75) + RUNTIME_APPROX_MB

function megabytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function OfflineScreen({ negosyo, goToPlan }: { negosyo: Negosyo; goToPlan: () => void }) {
  const lang = useLang()
  const t = useT()
  const online = useOnline()
  const shell = useShellStatus()
  const { model, installed, megabytes: installedMB } = useVoiceModel()
  // Keyed on what is installed: installing or removing the offline voice is the
  // only thing on this screen that changes how much space is used.
  const storage = useStorageEstimate(`${model?.key ?? 'none'}:${installed ? installedMB : 0}`)

  const [phase, setPhase] = useState<InstallPhase | 'idle' | 'error'>('idle')
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [error, setError] = useState('')

  // Only live features are listed: planned items are a roadmap, not a promise.
  const worksOffline = liveFeatures().filter((f) => f.onDevice)
  const needsServer = liveFeatures().filter((f) => !f.onDevice)
  const [backupMsg, setBackupMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function saveBackup() {
    const blob = new Blob([exportLedger(negosyo.ledger)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `seepat-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setBackupMsg('')
  }

  async function loadBackup(file: File) {
    try {
      const raw = await file.text()
      const { ledger } = importLedger(raw)
      negosyo.restore(ledger)
      setBackupMsg(t('backup.restored'))
    } catch (caught) {
      setBackupMsg(
        caught instanceof Error && caught.message === 'backup.tooNew'
          ? t('backup.tooNew')
          : t('backup.invalid'),
      )
    }
  }
  const canRecord = isCaptureSupported()

  async function download() {
    setPhase('downloading')
    setError('')
    setProgress(null)
    try {
      await installVoiceModel(setProgress, (next) => setPhase(next))
      setPhase('idle')
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t('offline.downloadFailed'),
      )
      setPhase('error')
    }
  }

  async function remove() {
    setPhase('idle')
    setProgress(null)
    await removeVoiceModel()
  }

  const busy = phase === 'downloading' || phase === 'warming'

  return (
    <div className="space-y-4">
      <Card flat={!online} className={online ? '' : 'border-amber-200 bg-amber-50'}>
        {/* Pat in the beanie: the outfit for when the signal drops, which is the
            whole subject of this screen. */}
        <div className="flex items-start gap-1">
          <div className="shrink-0 -mb-2 -ml-2 -mt-1">
            <Pat wardrobe="offline" mood={online ? 'steady' : 'concerned'} size={82} />
          </div>
          <div className="min-w-0 flex-1">
            <SectionTitle hint={online ? t('offline.hintConnected') : t('offline.hintNotConnected')}>
              {t('offline.statusTitle')}
            </SectionTitle>
          </div>
        </div>
        {/* The state in words, with the dot as decoration beside it. The dot is
            hidden from assistive tech because the sentence already says it. */}
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`h-3 w-3 shrink-0 rounded-full ${online ? 'bg-emerald-600' : 'bg-amber-600'}`}
          />
          <span className="eyebrow text-fg-subtle">
            {online ? t('offline.connected') : t('offline.disconnected')}
          </span>
        </div>

        {/*
         * Label … value rows. Each one wraps rather than squeezing: the label
         * ("Can be opened with no internet") takes the width it needs and wraps
         * to a second line, and the value keeps its own width and drops onto its
         * own line when the two cannot share one. Before this, the value was
         * being cut to "Not yet — open it once with…" on a 320px phone.
         */}
        <ul className="mt-3 divide-y divide-line border-t border-line text-[0.8125rem] leading-snug">
          <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="min-w-0 text-fg-subtle">{t('offline.shellCached')}</span>
            <span className={`shrink-0 text-right ${shell.cached ? 'text-emerald-700' : 'text-fg-subtle'}`}>
              {shell.cached ? t('offline.cachedYes') : t('offline.cachedNo')}
            </span>
          </li>
          <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="min-w-0 text-fg-subtle">{t('offline.installedAsApp')}</span>
            <span className="shrink-0 text-right text-fg-subtle">
              {shell.installed ? t('offline.yes') : t('offline.inBrowser')}
            </span>
          </li>
          <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="min-w-0 text-fg-subtle">{t('offline.micForModel')}</span>
            <span className={`shrink-0 text-right ${canRecord ? 'text-emerald-700' : 'text-red-700'}`}>
              {canRecord ? t('offline.supported') : t('offline.notSupported')}
            </span>
          </li>
          {storage ? (
            <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
              <span className="min-w-0 text-fg-subtle">{t('offline.storageUsed')}</span>
              <span className="num shrink-0 text-right text-fg-subtle">{storage}</span>
            </li>
          ) : null}
        </ul>

        {/*
         * There used to be a paragraph here naming build commands and a service
         * worker, shown whenever the shell was not cached. It was the only place
         * in the product that spoke to a developer instead of to the owner, and
         * it was the least readable line on the screen. The build-time note now
         * lives where it belongs, in README.md.
         */}
      </Card>

      <Card>
        <SectionTitle hint={t('offline.worksHint')}>{t('offline.worksTitle')}</SectionTitle>
        <ul className="divide-y divide-line">
          {worksOffline.map((feature) => (
            <li key={feature.key} className="flex gap-2 py-2.5 text-[0.875rem] leading-relaxed text-fg-muted">
              <span className="text-brand-700">✓</span>
              <span>{pick(lang, feature.label)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-3 text-[0.875rem] leading-relaxed text-fg-subtle">
          {t('offline.worksBody')}
        </p>
      </Card>

      <Card>
        <SectionTitle hint={t('backup.hint')}>{t('backup.title')}</SectionTitle>
        <p className="text-[0.875rem] leading-relaxed text-fg-subtle">{t('backup.body')}</p>
        <div className="mt-3 flex flex-col gap-2.5">
          <Button variant="brand" className="w-full rounded-full" onClick={saveBackup}>
            {t('backup.export')}
          </Button>
          <Button variant="ghost" className="w-full rounded-full" onClick={() => fileRef.current?.click()}>
            {t('backup.import')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label={t('backup.import')}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void loadBackup(file)
            }}
          />
        </div>
        {backupMsg ? (
          <p className="mt-2.5 text-[0.875rem] leading-relaxed text-fg-subtle">{backupMsg}</p>
        ) : null}
      </Card>

      <Card>
        <SectionTitle hint={t('offline.needsHint')}>{t('offline.needsTitle')}</SectionTitle>
        <ul className="divide-y divide-line">
          {needsServer.map((feature) => (
            <li key={feature.key} className="flex gap-2 py-2.5 text-[0.875rem] leading-relaxed text-fg-subtle">
              <span className="text-fg-faint">•</span>
              <span>{pick(lang, feature.label)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-3 text-[0.875rem] leading-relaxed text-fg-subtle">
          {t('offline.needsBody')}
        </p>
        <Button variant="ghost" className="mt-3 w-full rounded-full" onClick={goToPlan}>
          {t('shared.seePlans')}
        </Button>
      </Card>

      <Card>
        <SectionTitle hint={t('offline.onceHint')}>{t('offline.voiceModelTitle')}</SectionTitle>
        <p className="mb-3 text-[0.875rem] leading-relaxed text-fg-subtle">
          {t('offline.modelIntro')}
        </p>

        {OFFLINE_MODELS.map((info) => {
          const isWhisper = info.installable

          return (
            <div
              key={info.key}
              className={`rounded-2xl border p-3.5 ${
                isWhisper ? 'border-brand-200 bg-sunken' : 'border-line bg-sunken'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 text-[0.875rem] leading-snug font-medium text-fg">
                      {pick(lang, info.label)}
                    </span>
                    {isWhisper ? (
                      <Pill tone="good">{t('offline.freePill')}</Pill>
                    ) : (
                      <Pill tone="bad">{t('offline.cannotShip')}</Pill>
                    )}
                  </div>
                  <div className="mt-0.5 text-[0.8125rem] leading-snug text-fg-faint">
                    <span className="num">≈{info.approxMB}MB</span> · {pick(lang, info.languages)}
                  </div>
                </div>
                {isWhisper && installed ? (
                  <Pill tone="good">{t('offline.installedPill')}</Pill>
                ) : null}
              </div>

              <p className="mt-2 text-[0.875rem] leading-relaxed text-fg-subtle">
                {pick(lang, info.why)}
              </p>
              <p className="mt-1 text-[0.8125rem] leading-snug text-fg-faint">
                {t('offline.licensePrefix')} {pick(lang, info.license)}
              </p>
              {isWhisper ? (
                <p className="mt-1 text-[0.8125rem] leading-snug text-fg-faint">
                  {t('offline.sizeNote', { mb: info.approxMB })}
                </p>
              ) : null}

              {isWhisper ? (
                <div className="mt-3">
                  {busy ? (
                    <>
                      <div className="h-1.5 overflow-hidden rounded-full bg-line">
                        <div
                          className="h-full rounded-full bg-brand-500 transition-[width]"
                          style={{
                            width:
                              phase === 'warming'
                                ? '100%'
                                : `${Math.max(2, Math.min(100, progress?.filePercent ?? 4))}%`,
                          }}
                        />
                      </div>
                      <p className="mt-1.5 text-[0.8125rem] text-fg-subtle">
                        {phase === 'warming'
                          ? t('offline.warming')
                          : progress
                            ? `${progress.totalBytes ? t('offline.downloadedOf', { done: megabytes(progress.downloadedBytes), total: megabytes(progress.totalBytes) }) : megabytes(progress.downloadedBytes)} · ${progress.file.split('/').pop() ?? ''}`
                            : t('offline.starting')}
                      </p>
                      <p className="mt-1 text-[0.8125rem] text-fg-faint">
                        {t('offline.keepOpen')}
                      </p>
                    </>
                  ) : installed ? (
                    <div className="flex flex-wrap gap-2">
                      <div className="min-w-0 flex-1 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[0.8125rem] leading-snug text-emerald-700">
                        {t('offline.worksNow')}
                        {installedMB > 0 ? <span className="num">{` · ${installedMB}MB`}</span> : null}
                      </div>
                      <Button variant="ghost" className="rounded-full" onClick={remove}>
                        {t('offline.remove')}
                      </Button>
                    </div>
                  ) : (
                    <>
                      {/* Brand blue, not ink: this is the one action on the screen
                          that is about the product's own capability, and the blue is
                          the colour it owns in the rest of the app. */}
                      <Button
                        variant="brand"
                        className="w-full rounded-full"
                        onClick={download}
                        disabled={!canRecord || !online}
                      >
                        {t('offline.download', { mb: WHISPER_TOTAL_MB })}
                      </Button>
                    </>
                  )}

                  {!online && !installed ? (
                    <p className="mt-2 text-[0.8125rem] text-amber-700">
                      {t('offline.needInternetFirst')}
                    </p>
                  ) : null}
                  {!canRecord ? (
                    <p className="mt-2 text-[0.8125rem] text-red-700">
                      {t('offline.noAudioSupport')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}

        {error ? <p className="mt-3 text-[0.8125rem] text-red-700">{error}</p> : null}

        {model ? (
          <p className="mt-3 border-t border-line pt-3 text-[0.8125rem] text-fg-faint">
            {t('offline.installedOn', {
              date: formatDate(model.installedAt, lang),
              mb: megabytes(model.bytes),
            })}
          </p>
        ) : null}
      </Card>
    </div>
  )
}
