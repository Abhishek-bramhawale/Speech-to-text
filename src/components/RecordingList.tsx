import { useEffect, useState } from 'react'
import { LANGUAGES } from '../lib/languages'
import type { SavedRecording } from '../types/recording'

type RecordingListProps = {
  recordings: SavedRecording[]
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
  const [audioUrl, setAudioUrl] = useState('')

  useEffect(() => {
    if (!blob || blob.size === 0) {
      setAudioUrl('')
      return
    }

    const nextUrl = URL.createObjectURL(blob)
    setAudioUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [blob])

  if (!audioUrl) {
    return <p className="text-xs text-slate-500">No audio data available.</p>
  }

  return <audio controls preload="metadata" className="w-full" src={audioUrl} />
}

export function RecordingList({ recordings }: RecordingListProps) {
  return (
    <aside className="flex w-full flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl shadow-black/20 lg:w-80 lg:shrink-0">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-slate-200">Recordings</h2>
        <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-400">
          {recordings.length}
        </span>
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
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
