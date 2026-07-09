import { useCallback, useEffect, useMemo, useState } from 'react'
import { RecordingList } from './components/RecordingList'
import { WaveformVisualizer } from './components/WaveformVisualizer'
import { useSpeechToText } from './hooks/useSpeechToText'
import { copyText } from './lib/download'
import { LANGUAGES } from './lib/languages'
import type { SavedRecording } from './types/recording'

type StoredRecording = {
  id: string
  text: string
  correctedText?: string
  languageTag: string
  languageLabel: string
  createdAt: number
  audioType: string
  audioDataUrl: string
}

const STORAGE_KEY = 'speech-to-text:recordings:v1'
const MAX_STORED_CLIPS = 25

function formatWithPunctuation(rawText: string): string {
  const normalized = rawText.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  const withCapitalizedStart = normalized.charAt(0).toUpperCase() + normalized.slice(1)
  const endsWithPunctuation = /[.!?]$/.test(withCapitalizedStart)
  return endsWithPunctuation ? withCapitalizedStart : `${withCapitalizedStart}.`
}

function getStorageErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'Browser storage is full. Old clips were trimmed to keep recent ones.'
  }
  return 'Could not persist all clips in browser storage.'
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (!blob.size) return ''
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('Failed to read audio blob.'))
    reader.readAsDataURL(blob)
  })
}

function dataUrlToBlob(dataUrl: string, fallbackType: string) {
  if (!dataUrl) return new Blob([], { type: fallbackType || 'audio/webm' })
  const [metadata, base64 = ''] = dataUrl.split(',')
  const mimeTypeMatch = metadata.match(/data:(.*?);base64/)
  const mimeType = mimeTypeMatch?.[1] || fallbackType || 'audio/webm'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}

function dedupeMicrophones(devices: MediaDeviceInfo[]) {
  const filtered = devices.filter(
    (device) =>
      device.kind === 'audioinput' &&
      device.deviceId !== 'default' &&
      device.deviceId !== 'communications',
  )

  const seen = new Set<string>()
  return filtered.filter((device) => {
    const normalizedLabel = device.label.trim().toLowerCase()
    const key = normalizedLabel
      ? `${device.groupId || ''}::${normalizedLabel}`
      : `id::${device.deviceId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function getCorrectedText(rawText: string, languageTag: string) {
  const normalized = rawText.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''

  try {
    const response = await fetch(
      'https://api-inference.huggingface.co/models/oliverguhr/fullstop-punctuation-multilang-large',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer HF_API_KEY',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: normalized,
        }),
      }
    )

    if (!response.ok) {
      throw new Error('Punctuation service unavailable')
    }

    const data = await response.json()

    let corrected = normalized

    if (Array.isArray(data) && data.length > 0) {
      corrected =
        data[0]?.generated_text ||
        data[0]?.translation_text ||
        data[0]?.summary_text ||
        normalized
    } else if (typeof data?.generated_text === 'string') {
      corrected = data.generated_text
    } else if (typeof data === 'string') {
      corrected = data
    }

    return corrected || formatWithPunctuation(normalized)
  } catch (error) {
    console.error(error)
    return formatWithPunctuation(normalized)
  }
}

function App() {
  const [initialRecordings] = useState<SavedRecording[]>(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as StoredRecording[]
      return parsed
        .map((recording) => ({
          id: recording.id,
          text: recording.text,
          correctedText: recording.correctedText,
          languageTag: recording.languageTag,
          languageLabel: recording.languageLabel,
          createdAt: recording.createdAt,
          audioBlob: dataUrlToBlob(recording.audioDataUrl, recording.audioType),
        }))
        .slice(0, MAX_STORED_CLIPS)
    } catch {
      localStorage.removeItem(STORAGE_KEY)
      return []
    }
  })

  const [languageTag, setLanguageTag] = useState(LANGUAGES[0].tag)
  const [recordings, setRecordings] = useState<SavedRecording[]>(initialRecordings)
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([])
  const [selectedMicId, setSelectedMicId] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [showCorrectedLiveText, setShowCorrectedLiveText] = useState(false)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [isCorrectingLiveText, setIsCorrectingLiveText] = useState(false)
  const [correctedSessionText, setCorrectedSessionText] = useState('')
  const {
    isListening,
    isPaused,
    isProcessing,
    transcript,
    interimTranscript,
    error,
    warning,
    isReconnecting,
    audioStream,
    setTranscript,
    clearTranscript,
    start,
    stop,
    togglePause,
  } = useSpeechToText(languageTag)

  const selectedLanguage = LANGUAGES.find((lang) => lang.tag === languageTag)

  const liveText = useMemo(
    () => [transcript, interimTranscript].filter(Boolean).join(' ').trim(),
    [interimTranscript, transcript],
  )
  const hasTranscriptText = liveText.length > 0
  const correctedLiveText = correctedSessionText || formatWithPunctuation(liveText)

  const refreshMicrophones = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const mics = dedupeMicrophones(devices)
      setAvailableMics(mics)
      setSelectedMicId((current) => {
        if (current && mics.some((mic) => mic.deviceId === current)) return current
        return mics[0]?.deviceId ?? ''
      })
    } catch {
      setAvailableMics([])
    }
  }, [])

  useEffect(() => {
    window.setTimeout(() => {
      void refreshMicrophones()
    }, 0)
    const mediaDevices = navigator.mediaDevices
    if (!mediaDevices) return

    const handleDevicesChanged = () => {
      void refreshMicrophones()
    }
    mediaDevices.addEventListener('devicechange', handleDevicesChanged)
    return () => mediaDevices.removeEventListener('devicechange', handleDevicesChanged)
  }, [refreshMicrophones])

  useEffect(() => {
    const persist = async () => {
      setStorageWarning(null)
      for (let clipCount = recordings.length; clipCount >= 0; clipCount--) {
        const subset = recordings.slice(0, clipCount)
        const stored: StoredRecording[] = await Promise.all(
          subset.map(async (recording) => ({
            id: recording.id,
            text: recording.text,
            correctedText: recording.correctedText,
            languageTag: recording.languageTag,
            languageLabel: recording.languageLabel,
            createdAt: recording.createdAt,
            audioType: recording.audioBlob.type || 'audio/webm',
            audioDataUrl: await blobToDataUrl(recording.audioBlob),
          })),
        )
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
          if (clipCount !== recordings.length) {
            setStorageWarning('Some older clips were removed to fit browser storage limits.')
            setRecordings(subset)
          }
          return
        } catch (error) {
          if (clipCount === 0) {
            localStorage.removeItem(STORAGE_KEY)
            setStorageWarning(getStorageErrorMessage(error))
            return
          }
        }
      }
    }

    void persist()
  }, [recordings])

  const handleStop = useCallback(async () => {
    const recording = await stop()
    if (recording && (recording.text || recording.audioBlob.size > 0)) {
      setIsCorrectingLiveText(true)
      const correctedText = await getCorrectedText(recording.text, recording.languageTag)
      setIsCorrectingLiveText(false)
      setCorrectedSessionText(correctedText)
      setRecordings((prev) => [{ ...recording, correctedText }, ...prev].slice(0, MAX_STORED_CLIPS))
      setShowCorrectedLiveText(false)
    }
  }, [stop])

  const handleRemoveRecording = useCallback((id: string) => {
    setRecordings((prev) => prev.filter((recording) => recording.id !== id))
  }, [])

  const handleRemoveAllRecordings = useCallback(() => {
    setRecordings([])
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const handleCopyTranscript = useCallback(async () => {
    const text = showCorrectedLiveText ? correctedLiveText : liveText
    if (!text) return
    try {
      await copyText(text)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1500)
    } catch {
      setCopyState('failed')
      window.setTimeout(() => setCopyState('idle'), 1500)
    }
  }, [correctedLiveText, liveText, showCorrectedLiveText])

  const handleStart = useCallback(() => {
    setShowCorrectedLiveText(false)
    setCorrectedSessionText('')
    void start(selectedMicId || undefined)
  }, [selectedMicId, start])

  const statusLabel = isReconnecting
    ? 'Reconnecting…'
    : isPaused
      ? 'Paused'
    : isListening
      ? 'Listening'
      : isProcessing
        ? 'Saving…'
        : 'Idle'

  const statusClass = isReconnecting
    ? 'bg-amber-500/15 text-amber-300'
    : isPaused
      ? 'bg-slate-700 text-slate-300'
    : isListening
      ? 'bg-emerald-500/15 text-emerald-300'
      : isProcessing
        ? 'bg-amber-500/15 text-amber-300'
        : 'bg-slate-800 text-slate-400'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-6 lg:py-10">
        <header className="mb-8 text-center">
          <p className="mb-2 text-sm font-medium uppercase tracking-widest text-indigo-400">
            Speech to Text
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Live Transcription Studio
          </h1>
          <p className="mt-3 text-slate-400">
            Edit transcript while recording. Each stopped session is saved to the list on the
            right — download MP3 only when you choose.
          </p>
        </header>

        <div className="flex flex-1 flex-col gap-6 lg:flex-row lg:items-start">
          <main className="flex min-w-0 flex-1 flex-col">
            <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-black/20">
              <label
                htmlFor="language"
                className="mb-2 block text-sm font-medium text-slate-300"
              >
                Language (BCP-47 tag)
              </label>
              <select
                id="language"
                value={languageTag}
                disabled={isListening || isProcessing}
                onChange={(event) => setLanguageTag(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {LANGUAGES.map((language) => (
                  <option key={language.tag} value={language.tag}>
                    {language.label} ({language.tag})
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">
                Active tag: <code className="text-indigo-300">{selectedLanguage?.tag}</code>
              </p>
            </section>

            <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-black/20">
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="microphone" className="block text-sm font-medium text-slate-300">
                  Microphone
                </label>
                <button
                  type="button"
                  onClick={() => void refreshMicrophones()}
                  disabled={isListening || isProcessing}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>
              <select
                id="microphone"
                value={selectedMicId}
                disabled={isListening || isProcessing || availableMics.length === 0}
                onChange={(event) => setSelectedMicId(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {availableMics.length === 0 ? (
                  <option value="">No microphone found</option>
                ) : (
                  availableMics.map((mic, index) => (
                    <option key={mic.deviceId} value={mic.deviceId}>
                      {mic.label || `Microphone ${index + 1}`}
                    </option>
                  ))
                )}
              </select>
            </section>

            <section className="mb-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleStart}
                disabled={isListening || isProcessing || availableMics.length === 0}
                className="inline-flex flex-1 items-center justify-center rounded-xl bg-emerald-500 px-6 py-3 font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              >
                {isListening ? 'Recording…' : 'Start'}
              </button>
              <button
                type="button"
                onClick={togglePause}
                disabled={!isListening || isProcessing}
                className="inline-flex flex-1 items-center justify-center rounded-xl bg-amber-400 px-6 py-3 font-medium text-amber-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              >
                {isPaused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                onClick={handleStop}
                disabled={!isListening || isProcessing}
                className="inline-flex flex-1 items-center justify-center rounded-xl bg-rose-500 px-6 py-3 font-medium text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              >
                Stop
              </button>
            </section>

            <WaveformVisualizer stream={audioStream} active={isListening && !isPaused} />

            {warning && !error && (
              <div
                role="status"
                className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
              >
                {warning}
              </div>
            )}

            {storageWarning && (
              <div
                role="status"
                className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
              >
                {storageWarning}
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
              >
                {error}
              </div>
            )}

            <section className="flex flex-1 flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-black/20">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-medium text-slate-200">Live Transcript</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyTranscript}
                    disabled={!hasTranscriptText}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {copyState === 'copied'
                      ? 'Copied!'
                      : copyState === 'failed'
                        ? 'Failed'
                        : 'Copy'}
                  </button>
                  {/* {hasTranscriptText && !isListening && (
                    <button
                      type="button"
                      onClick={() => setShowCorrectedLiveText((prev) => !prev)}
                      className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/20"
                    >
                      {showCorrectedLiveText ? 'Show Original' : 'Show Corrected'}
                    </button>
                  )} */}
                  {hasTranscriptText && (
                    <button
                      type="button"
                      onClick={() => {
                        clearTranscript()
                        setShowCorrectedLiveText(false)
                      }}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20"
                    >
                      Clear All Text
                    </button>
                  )}
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusClass}`}>
                    {statusLabel}
                  </span>
                </div>
              </div>

              {isCorrectingLiveText && !isListening && (
                <p className="mb-3 text-xs text-indigo-300">
                  Correcting punctuation for the final transcript...
                </p>
              )}

              <textarea
                value={showCorrectedLiveText ? correctedLiveText : transcript}
                onChange={(event) => {
                  if (showCorrectedLiveText) return
                  setTranscript(event.target.value)
                }}
                readOnly={showCorrectedLiveText}
                placeholder="Press Start and speak. You can edit this text anytime — even while recording."
                className="min-h-[280px] flex-1 resize-y rounded-xl border border-slate-800 bg-slate-950 p-4 text-left leading-relaxed text-slate-100 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />

              {interimTranscript && isListening && (
                <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-400">
                  <span className="mr-2 text-xs uppercase tracking-wide text-slate-500">
                    Live
                  </span>
                  {interimTranscript}
                </p>
              )}
            </section>

            <footer className="mt-8 text-center text-xs text-slate-500 lg:text-left">
              Best results in Chrome or Edge. Microphone permission and an active internet
              connection are required for live transcription.
            </footer>
          </main>

          <RecordingList
            recordings={recordings}
            onRemove={handleRemoveRecording}
            onRemoveAll={handleRemoveAllRecordings}
          />
        </div>
      </div>
    </div>
  )
}

export default App
