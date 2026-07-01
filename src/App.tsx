import { useCallback, useState } from 'react'
import { RecordingList } from './components/RecordingList'
import { WaveformVisualizer } from './components/WaveformVisualizer'
import { useSpeechToText } from './hooks/useSpeechToText'
import { copyText } from './lib/download'
import { LANGUAGES } from './lib/languages'
import type { SavedRecording } from './types/recording'

function App() {
  const [languageTag, setLanguageTag] = useState(LANGUAGES[0].tag)
  const [recordings, setRecordings] = useState<SavedRecording[]>([])
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const {
    isListening,
    isProcessing,
    transcript,
    interimTranscript,
    error,
    warning,
    isReconnecting,
    audioStream,
    setTranscript,
    start,
    stop,
  } = useSpeechToText(languageTag)

  const selectedLanguage = LANGUAGES.find((lang) => lang.tag === languageTag)

  const handleStop = useCallback(async () => {
    const recording = await stop()
    if (recording && (recording.text || recording.audioBlob.size > 0)) {
      setRecordings((prev) => [recording, ...prev])
      setTranscript('')
    }
  }, [setTranscript, stop])

  const handleRemoveRecording = useCallback((id: string) => {
    setRecordings((prev) => prev.filter((recording) => recording.id !== id))
  }, [])

  const handleCopyTranscript = useCallback(async () => {
    const text = [transcript, interimTranscript].filter(Boolean).join(' ').trim()
    if (!text) return
    try {
      await copyText(text)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1500)
    } catch {
      setCopyState('failed')
      window.setTimeout(() => setCopyState('idle'), 1500)
    }
  }, [interimTranscript, transcript])

  const statusLabel = isReconnecting
    ? 'Reconnecting…'
    : isListening
      ? 'Listening'
      : isProcessing
        ? 'Saving…'
        : 'Idle'

  const statusClass = isReconnecting
    ? 'bg-amber-500/15 text-amber-300'
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
                disabled={isListening}
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

            <section className="mb-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={start}
                disabled={isListening || isProcessing}
                className="inline-flex flex-1 items-center justify-center rounded-xl bg-emerald-500 px-6 py-3 font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              >
                {isListening ? 'Recording…' : 'Start'}
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

            <WaveformVisualizer stream={audioStream} active={isListening} />

            {warning && !error && (
              <div
                role="status"
                className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
              >
                {warning}
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
                    disabled={!transcript && !interimTranscript}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {copyState === 'copied'
                      ? 'Copied!'
                      : copyState === 'failed'
                        ? 'Failed'
                        : 'Copy'}
                  </button>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusClass}`}>
                    {statusLabel}
                  </span>
                </div>
              </div>

              <textarea
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
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

          <RecordingList recordings={recordings} onRemove={handleRemoveRecording} />
        </div>
      </div>
    </div>
  )
}

export default App
