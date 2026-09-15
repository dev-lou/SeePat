import { useEffect, useState } from 'react'
import { Button, Card, Pill, SectionTitle } from './components.tsx'
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
import { FEATURES, formatDate } from '../billing.ts'
import { pick, useLang, useT } from '../i18n/index.ts'

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

function useStorageEstimate(): string | null {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    const storage = navigator.storage
    if (!storage?.estimate) return
    void storage
      .estimate()
      .then((estimate) => {
        if (typeof estimate.usage !== 'number' || typeof estimate.quota !== 'number') return
        // A slash rather than "of"/"ng": a ratio needs no translation.
        setLabel(`${megabytes(estimate.usage)} / ${megabytes(estimate.quota)}`)
      })
      .catch(() => undefined)
  }, [])

  return label
}

const WHISPER_TOTAL_MB =
  (OFFLINE_MODELS.find((m) => m.installable)?.approxMB ?? 75) + RUNTIME_APPROX_MB

function megabytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function OfflineScreen({ goToPlan }: { goToPlan: () => void }) {
  const lang = useLang()
  const t = useT()
  const online = useOnline()
  const shell = useShellStatus()
  const storage = useStorageEstimate()
  const { model, installed, megabytes: installedMB } = useVoiceModel()

  const [phase, setPhase] = useState<InstallPhase | 'idle' | 'error'>('idle')
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [error, setError] = useState('')

  const worksOffline = FEATURES.filter((f) => f.onDevice)
  const needsServer = FEATURES.filter((f) => !f.onDevice)
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
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`}
          />
          <span className="text-sm text-fg-muted">
            {online ? t('offline.connected') : t('offline.disconnected')}
          </span>
        </div>

        <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs">
          <li className="flex justify-between gap-3">
            <span className="text-fg-subtle">{t('offline.shellCached')}</span>
            <span className={shell.cached ? 'text-emerald-700' : 'text-fg-subtle'}>
              {shell.cached ? t('offline.cachedYes') : t('offline.cachedNo')}
            </span>
          </li>
          <li className="flex justify-between gap-3">
            <span className="text-fg-subtle">{t('offline.installedAsApp')}</span>
            <span className="text-fg-subtle">
              {shell.installed ? t('offline.yes') : t('offline.inBrowser')}
            </span>
          </li>
          <li className="flex justify-between gap-3">
            <span className="text-fg-subtle">{t('offline.micForModel')}</span>
            <span className={canRecord ? 'text-emerald-700' : 'text-red-700'}>
              {canRecord ? t('offline.supported') : t('offline.notSupported')}
            </span>
          </li>
          {storage ? (
            <li className="flex justify-between gap-3">
              <span className="text-fg-subtle">{t('offline.storageUsed')}</span>
              <span className="text-fg-subtle">{storage}</span>
            </li>
          ) : null}
        </ul>

        {online && !shell.cached ? (
          <p className="mt-3 border-t border-line pt-3 text-[0.68rem] leading-relaxed text-amber-700">
            <strong>{t('offline.devHintLead')}</strong> {t('offline.devHintIf')}{' '}
            <code>npm run dev</code> {t('offline.devHintMid')} <code>npm run offline</code>
            {t('offline.devHintOr')} <code>npm run dev:offline</code>
            {t('offline.devHintTail')}
          </p>
        ) : null}
      </Card>

      <Card>
        <SectionTitle hint={t('offline.worksHint')}>{t('offline.worksTitle')}</SectionTitle>
        <ul className="space-y-1.5">
          {worksOffline.map((feature) => (
            <li key={feature.key} className="flex gap-2 text-xs text-fg-muted">
              <span className="text-brand-700">✓</span>
              <span>{pick(lang, feature.label)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-3 text-[0.68rem] leading-relaxed text-fg-subtle">
          {t('offline.worksBody')}
        </p>
      </Card>

      <Card>
        <SectionTitle hint={t('offline.needsHint')}>{t('offline.needsTitle')}</SectionTitle>
        <ul className="space-y-1.5">
          {needsServer.map((feature) => (
            <li key={feature.key} className="flex gap-2 text-xs text-fg-subtle">
              <span className="text-fg-faint">•</span>
              <span>{pick(lang, feature.label)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-3 text-[0.68rem] leading-relaxed text-fg-subtle">
          {t('offline.needsBody')}
        </p>
        <Button variant="ghost" className="mt-3 w-full" onClick={goToPlan}>
          {t('shared.seePlans')}
        </Button>
      </Card>

      <Card>
        <SectionTitle hint={t('offline.onceHint')}>{t('offline.voiceModelTitle')}</SectionTitle>
        <p className="mb-3 text-[0.68rem] leading-relaxed text-fg-subtle">
          {t('offline.modelIntro')}
        </p>

        {OFFLINE_MODELS.map((info) => {
          const isWhisper = info.installable

          return (
            <div
              key={info.key}
              className={`rounded-2xl border p-3 ${
                isWhisper ? 'border-brand-300 bg-sunken' : 'border-line bg-sunken'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-fg">{pick(lang, info.label)}</span>
                    {isWhisper ? (
                      <Pill tone="good">{t('offline.freePill')}</Pill>
                    ) : (
                      <Pill tone="bad">{t('offline.cannotShip')}</Pill>
                    )}
                  </div>
                  <div className="mt-0.5 text-[0.65rem] text-fg-faint">
                    ≈{info.approxMB}MB · {pick(lang, info.languages)}
                  </div>
                </div>
                {isWhisper && installed ? (
                  <Pill tone="good">{t('offline.installedPill')}</Pill>
                ) : null}
              </div>

              <p className="mt-2 text-[0.68rem] leading-relaxed text-fg-subtle">
                {pick(lang, info.why)}
              </p>
              <p className="mt-1 text-[0.65rem] text-fg-faint">
                {t('offline.licensePrefix')} {pick(lang, info.license)}
              </p>
              {isWhisper ? (
                <p className="mt-1 text-[0.65rem] text-fg-faint">
                  {t('offline.sizeNote', { mb: info.approxMB, runtime: RUNTIME_APPROX_MB })}
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
                      <p className="mt-1.5 text-[0.65rem] text-fg-subtle">
                        {phase === 'warming'
                          ? t('offline.warming')
                          : progress
                            ? `${progress.totalBytes ? t('offline.downloadedOf', { done: megabytes(progress.downloadedBytes), total: megabytes(progress.totalBytes) }) : megabytes(progress.downloadedBytes)} · ${progress.file.split('/').pop() ?? ''}`
                            : t('offline.starting')}
                      </p>
                      <p className="mt-1 text-[0.62rem] text-fg-faint">
                        {t('offline.keepOpen')}
                      </p>
                    </>
                  ) : installed ? (
                    <div className="flex gap-2">
                      <div className="flex-1 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[0.68rem] text-emerald-700">
                        {t('offline.worksNow')}
                        {installedMB > 0 ? ` · ${installedMB}MB` : ''}
                      </div>
                      <Button variant="ghost" onClick={remove}>
                        {t('offline.remove')}
                      </Button>
                    </div>
                  ) : (
                    <Button className="w-full" onClick={download} disabled={!canRecord || !online}>
                      {t('offline.download', { mb: WHISPER_TOTAL_MB })}
                    </Button>
                  )}

                  {!online && !installed ? (
                    <p className="mt-2 text-[0.65rem] text-amber-700">
                      {t('offline.needInternetFirst')}
                    </p>
                  ) : null}
                  {!canRecord ? (
                    <p className="mt-2 text-[0.65rem] text-red-700">
                      {t('offline.noAudioSupport')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}

        {error ? <p className="mt-3 text-xs text-red-700">{error}</p> : null}

        {model ? (
          <p className="mt-3 border-t border-line pt-3 text-[0.65rem] text-fg-faint">
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
