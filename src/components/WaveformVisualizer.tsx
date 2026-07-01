import { useEffect, useRef } from 'react'

type WaveformVisualizerProps = {
  stream: MediaStream | null
  active: boolean
}

export function WaveformVisualizer({ stream, active }: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let audioContext: AudioContext | null = null
    let analyser: AnalyserNode | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let frequencyData: Uint8Array<ArrayBuffer> | null = null
    let timeData: Uint8Array<ArrayBuffer> | null = null

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(rect.width * dpr)
      canvas.height = Math.floor(rect.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const drawIdle = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight

      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#020617'
      ctx.fillRect(0, 0, width, height)

      ctx.strokeStyle = 'rgba(51, 65, 85, 0.8)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, height / 2)
      ctx.lineTo(width, height / 2)
      ctx.stroke()

      const barCount = 48
      const gap = width / barCount
      for (let i = 0; i < barCount; i++) {
        const x = i * gap + gap / 2
        ctx.fillStyle = 'rgba(51, 65, 85, 0.45)'
        ctx.fillRect(x - 1, height / 2 - 2, 2, 4)
      }
    }

    const drawLive = () => {
      if (!analyser || !frequencyData || !timeData) return

      const width = canvas.clientWidth
      const height = canvas.clientHeight

      analyser.getByteFrequencyData(frequencyData)
      analyser.getByteTimeDomainData(timeData)

      ctx.clearRect(0, 0, width, height)

      const background = ctx.createLinearGradient(0, 0, width, height)
      background.addColorStop(0, '#020617')
      background.addColorStop(1, '#0f172a')
      ctx.fillStyle = background
      ctx.fillRect(0, 0, width, height)

      const barCount = 64
      const step = Math.floor(frequencyData.length / barCount)
      const barWidth = width / barCount

      for (let i = 0; i < barCount; i++) {
        const value = frequencyData[i * step] / 255
        const barHeight = Math.max(4, value * height * 0.82)
        const x = i * barWidth + barWidth * 0.15
        const w = barWidth * 0.7
        const y = (height - barHeight) / 2

        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight)
        gradient.addColorStop(0, '#6ee7b7')
        gradient.addColorStop(0.5, '#34d399')
        gradient.addColorStop(1, '#818cf8')

        ctx.fillStyle = gradient
        ctx.fillRect(x, y, w, barHeight)
      }

      ctx.lineWidth = 2
      const waveGradient = ctx.createLinearGradient(0, 0, width, 0)
      waveGradient.addColorStop(0, 'rgba(52, 211, 153, 0.15)')
      waveGradient.addColorStop(0.5, 'rgba(129, 140, 248, 0.95)')
      waveGradient.addColorStop(1, 'rgba(52, 211, 153, 0.15)')
      ctx.strokeStyle = waveGradient
      ctx.beginPath()

      const sliceWidth = width / timeData.length
      let x = 0

      for (let i = 0; i < timeData.length; i++) {
        const normalized = timeData[i] / 128
        const y = (normalized * height) / 2
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
        x += sliceWidth
      }

      ctx.stroke()

      ctx.strokeStyle = 'rgba(100, 116, 139, 0.35)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, height / 2)
      ctx.lineTo(width, height / 2)
      ctx.stroke()
    }

    const render = () => {
      if (active && stream && analyser) {
        drawLive()
      } else {
        drawIdle()
      }
      rafRef.current = requestAnimationFrame(render)
    }

    resizeCanvas()
    drawIdle()

    if (active && stream) {
      audioContext = new AudioContext()
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.85
      analyser.minDecibels = -90
      analyser.maxDecibels = -10

      source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)

      frequencyData = new Uint8Array(analyser.frequencyBinCount)
      timeData = new Uint8Array(analyser.fftSize)

      void audioContext.resume()
    }

    const resizeObserver = new ResizeObserver(resizeCanvas)
    resizeObserver.observe(canvas)
    rafRef.current = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(rafRef.current)
      resizeObserver.disconnect()
      source?.disconnect()
      analyser?.disconnect()
      if (audioContext) {
        void audioContext.close()
      }
    }
  }, [active, stream])

  return (
    <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl shadow-black/20">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-slate-300">Live Waveform</h2>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide ${
            active
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-slate-800 text-slate-500'
          }`}
        >
          {active ? 'Live' : 'Idle'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="h-28 w-full rounded-xl border border-slate-800 bg-slate-950"
        aria-label={active ? 'Live audio waveform' : 'Audio waveform idle'}
      />
    </section>
  )
}
