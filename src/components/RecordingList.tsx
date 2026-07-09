import { useEffect, useMemo } from 'react'
import { blobToMp3 } from '../lib/audioToMp3'
import { copyText, downloadBlob, formatRecordingFilename } from '../lib/download'
import { LANGUAGES } from '../lib/languages'
import type { SavedRecording } from '../types/recording'

type RecordingListProps = {
  recordings: SavedRecording[]
  onRemove: (id: string) => void
  onRemoveAll: () => void
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function AudioPreview({ blob }: { blob: Blob }) {
  const audioUrl = useMemo(() => {
    if (!blob || blob.size === 0) return ''
    return URL.createObjectURL(blob)
  }, [blob])

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  if (!audioUrl) {
    return <p className="text-xs text-slate-500">No audio data available.</p>
  }

  return <audio controls preload="metadata" className="w-full" src={audioUrl} />
}

export function RecordingList({ recordings, onRemove, onRemoveAll }: RecordingListProps) {
  const handleDownload = async (recording: SavedRecording, button: HTMLButtonElement) => {
    button.disabled = true
    const originalLabel = button.textContent
    button.textContent = 'Converting…'

    try {
      const mp3 = await blobToMp3(recording.audioBlob)
      downloadBlob(mp3, formatRecordingFilename(recording.createdAt, 'mp3'))
    } catch {
      const extension = recording.audioBlob.type.includes('webm') ? 'webm' : 'audio'
      downloadBlob(
        recording.audioBlob,
        formatRecordingFilename(recording.createdAt, extension),
      )
    } finally {
      button.disabled = false
      button.textContent = originalLabel
    }
  }

  const handleCopy = async (text: string, button: HTMLButtonElement) => {
    try {
      await copyText(text)
      const originalLabel = button.textContent
      button.textContent = 'Copied!'
      window.setTimeout(() => {
        button.textContent = originalLabel
      }, 1500)
    } catch {
      button.textContent = 'Failed'
      window.setTimeout(() => {
        button.textContent = 'Copy'
      }, 1500)
    }
  }

  return (
    <aside className="flex w-full flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl shadow-black/20 lg:w-80 lg:shrink-0">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-slate-200">Recordings</h2>
        <div className="flex items-center gap-2">
          {recordings.length > 0 && (
            <button
              type="button"
              onClick={onRemoveAll}
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20"
            >
              Remove All
            </button>
          )}
          <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-400">
            {recordings.length}
          </span>
        </div>
      </div>

      {recordings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-500">
          Stopped recordings appear here. Clips stay in browser storage and can be played here.
        </p>
      ) : (
        <ul className="flex max-h-[calc(100vh-12rem)] flex-col gap-3 overflow-y-auto pr-1">
          {recordings.map((recording, index) => {
            const language =
              LANGUAGES.find((item) => item.tag === recording.languageTag)?.label ??
              recording.languageLabel

            return (
              <li
                key={recording.id}
                className="rounded-xl border border-slate-800 bg-slate-950 p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-200">
                      Clip {recordings.length - index}
                    </p>
                    <p className="text-xs text-slate-500">{formatTime(recording.createdAt)}</p>
                  </div>
                  <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                    {language}
                  </span>
                </div>

                <p className="mb-3 line-clamp-3 text-sm leading-relaxed text-slate-300">
                  {recording.text || '(No transcript)'}
                </p>

                <div className="space-y-2">
                  {recording.correctedText && recording.correctedText !== recording.text && (
                    <p className="text-xs leading-relaxed text-slate-400">
                      Corrected: {recording.correctedText}
                    </p>
                  )}
                  <AudioPreview blob={recording.audioBlob} />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={(event) => handleCopy(recording.text, event.currentTarget)}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={(event) => handleDownload(recording, event.currentTarget)}
                      className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/20"
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(recording.id)}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
