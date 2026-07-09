import { useCallback, useEffect, useRef, useState } from 'react'
import type { SavedRecording } from '../types/recording'
import { LANGUAGES } from '../lib/languages'

const MAX_NETWORK_RETRIES = 12
const RECOVERABLE_ERRORS = new Set(['network', 'service-not-available', 'aborted'])

function getSpeechRecognition(): SpeechRecognition | null {
  const SpeechRecognitionCtor =
    window.SpeechRecognition ?? window.webkitSpeechRecognition
  if (!SpeechRecognitionCtor) return null
  return new SpeechRecognitionCtor()
}

function getRecorderMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

function getLanguageLabel(languageTag: string) {
  return LANGUAGES.find((language) => language.tag === languageTag)?.label ?? languageTag
}

export function useSpeechToText(languageTag: string) {
  const [isListening, setIsListening] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const shouldContinueRef = useRef(false)
  const retryTimeoutRef = useRef<number | null>(null)
  const networkRetryCountRef = useRef(0)
  const transcriptRef = useRef('')
  const interimTranscriptRef = useRef('')

  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

  useEffect(() => {
    interimTranscriptRef.current = interimTranscript
  }, [interimTranscript])

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current !== null) {
      window.clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
  }, [])

  const stopRecognitionInstance = useCallback(() => {
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (!recognition) return
    try {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.abort()
    } catch {
      try {
        recognition.stop()
      } catch {
        // Instance may already be stopped after a network error.
      }
    }
  }, [])

  const stopMedia = useCallback(() => {
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current?.stop()
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
    setAudioStream(null)
  }, [])

  const stopRecognition = useCallback(() => {
    shouldContinueRef.current = false
    clearRetryTimeout()
    stopRecognitionInstance()
    setIsReconnecting(false)
  }, [clearRetryTimeout, stopRecognitionInstance])

  const pauseRecognition = useCallback(() => {
    clearRetryTimeout()
    stopRecognitionInstance()
    setIsReconnecting(false)
  }, [clearRetryTimeout, stopRecognitionInstance])

  const appendFinalTranscript = useCallback((finalText: string) => {
    const trimmed = finalText.trim()
    if (!trimmed) return

    setTranscript((prev) => {
      const spacer = prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : ''
      return prev + spacer + trimmed
    })
  }, [])

  const attachRecognition = useCallback(function attachRecognitionImpl() {
    if (!shouldContinueRef.current) return

    stopRecognitionInstance()

    const recognition = getSpeechRecognition()
    if (!recognition) {
      setError('Speech recognition is not supported in this browser. Use Chrome or Edge.')
      return
    }

    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = languageTag
    recognition.maxAlternatives = 1

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      networkRetryCountRef.current = 0
      setError(null)
      setWarning(null)
      setIsReconnecting(false)

      let interim = ''
      let finalText = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) {
          finalText += text
        } else {
          interim += text
        }
      }

      if (finalText) {
        appendFinalTranscript(finalText)
      }
      setInterimTranscript(interim.trim())
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech') return

      if (RECOVERABLE_ERRORS.has(event.error) && shouldContinueRef.current) {
        networkRetryCountRef.current += 1

        if (networkRetryCountRef.current <= MAX_NETWORK_RETRIES) {
          setIsReconnecting(true)
          setWarning(
            `Speech service connection lost. Reconnecting (${networkRetryCountRef.current}/${MAX_NETWORK_RETRIES})…`,
          )
          stopRecognitionInstance()
          clearRetryTimeout()
          retryTimeoutRef.current = window.setTimeout(
            () => attachRecognitionImpl(),
            Math.min(400 * networkRetryCountRef.current, 2500),
          )
          return
        }

        setIsReconnecting(false)
        setError(
          'Could not reach the speech recognition service. Live transcription needs an active internet connection in Chrome/Edge (audio is sent to Google). Check your network, VPN, or firewall, then click Start again.',
        )
        return
      }

      if (event.error === 'not-allowed') {
        setError('Microphone permission was blocked for speech recognition.')
        return
      }

      setError(`Speech recognition error: ${event.error}`)
    }

    recognition.onend = () => {
      if (!shouldContinueRef.current || recognitionRef.current !== recognition) return
      clearRetryTimeout()
      retryTimeoutRef.current = window.setTimeout(() => attachRecognitionImpl(), 200)
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
      setIsReconnecting(false)
    } catch {
      if (!shouldContinueRef.current) return
      setIsReconnecting(true)
      clearRetryTimeout()
      retryTimeoutRef.current = window.setTimeout(() => attachRecognitionImpl(), 400)
    }
  }, [appendFinalTranscript, clearRetryTimeout, languageTag, stopRecognitionInstance])

  const start = useCallback(async (deviceId?: string) => {
    setError(null)
    setWarning(null)
    setTranscript('')
    setInterimTranscript('')
    setIsReconnecting(false)
    setIsPaused(false)
    audioChunksRef.current = []
    networkRetryCountRef.current = 0
    shouldContinueRef.current = true

    if (!navigator.onLine) {
      setError(
        'You appear to be offline. Live transcription requires an internet connection because Chrome sends audio to Google speech servers.',
      )
      shouldContinueRef.current = false
      return
    }

    if (!getSpeechRecognition()) {
      setError('Speech recognition is not supported in this browser. Use Chrome or Edge.')
      shouldContinueRef.current = false
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone access is not supported in this browser.')
      shouldContinueRef.current = false
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        deviceId
          ? {
              audio: {
                deviceId: { exact: deviceId },
              },
            }
          : { audio: true },
      )
      mediaStreamRef.current = stream
      setAudioStream(stream)

      const mimeType = getRecorderMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start(250)
      attachRecognition()
      setIsListening(true)
    } catch {
      shouldContinueRef.current = false
      stopMedia()
      setError('Microphone permission denied or unavailable.')
    }
  }, [attachRecognition, stopMedia])

  const stop = useCallback(async (): Promise<SavedRecording | null> => {
    if (!isListening && !shouldContinueRef.current) return null

    setIsListening(false)
    setIsPaused(false)
    stopRecognition()

    const pendingInterim = interimTranscriptRef.current
    const currentTranscript = transcriptRef.current
    const finalText = [currentTranscript, pendingInterim].filter(Boolean).join(' ').trim()
    setTranscript(finalText)
    setInterimTranscript('')

    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      stopMedia()
      if (!finalText) return null

      return {
        id: crypto.randomUUID(),
        text: finalText,
        languageTag,
        languageLabel: getLanguageLabel(languageTag),
        createdAt: Date.now(),
        audioBlob: new Blob(),
      }
    }

    setIsProcessing(true)

    const audioBlob = await new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        stopMedia()
        const chunks = audioChunksRef.current
        if (chunks.length === 0) {
          resolve(null)
          return
        }
        const type = recorder.mimeType || chunks[0]?.type || 'audio/webm'
        resolve(new Blob(chunks, { type }))
      }
      recorder.stop()
    })

    setIsProcessing(false)

    if (!finalText && (!audioBlob || audioBlob.size === 0)) {
      return null
    }

    return {
      id: crypto.randomUUID(),
      text: finalText,
      languageTag,
      languageLabel: getLanguageLabel(languageTag),
      createdAt: Date.now(),
      audioBlob: audioBlob ?? new Blob(),
    }
  }, [isListening, languageTag, stopMedia, stopRecognition])

  const togglePause = useCallback(() => {
    if (!isListening) return

    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return

    if (isPaused) {
      try {
        recorder.resume()
      } catch {
        return
      }
      setIsPaused(false)
      shouldContinueRef.current = true
      attachRecognition()
      return
    }

    try {
      recorder.pause()
    } catch {
      return
    }
    setIsPaused(true)
    pauseRecognition()
    setInterimTranscript('')
  }, [attachRecognition, isListening, isPaused, pauseRecognition])

  const clearTranscript = useCallback(() => {
    setTranscript('')
    setInterimTranscript('')
    transcriptRef.current = ''
    interimTranscriptRef.current = ''
  }, [])

  useEffect(() => {
    return () => {
      shouldContinueRef.current = false
      clearRetryTimeout()
      stopRecognitionInstance()
      stopMedia()
    }
  }, [clearRetryTimeout, stopMedia, stopRecognitionInstance])

  return {
    isListening,
    isPaused,
    isProcessing,
    isReconnecting,
    audioStream,
    transcript,
    interimTranscript,
    error,
    warning,
    setTranscript,
    clearTranscript,
    start,
    stop,
    togglePause,
  }
}
