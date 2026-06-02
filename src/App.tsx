import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react'
import { createClippedWav, formatFileSize, formatTime } from './audio'

type Handle = 'start' | 'end' | null

type AudioFile = {
  file: File
  buffer: AudioBuffer
}

const MIN_CLIP_SECONDS = 0.03

function Icon({ name }: { name: 'upload' | 'play' | 'pause' | 'download' | 'scissors' | 'audio' | 'close' }) {
  const paths = {
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></>,
    play: <path d="m9 7 8 5-8 5V7Z" />,
    pause: <><path d="M9 7v10"/><path d="M15 7v10"/></>,
    download: <><path d="M12 4v11"/><path d="m8 11 4 4 4-4"/><path d="M5 20h14"/></>,
    scissors: <><circle cx="6" cy="7" r="2"/><circle cx="6" cy="17" r="2"/><path d="m8 8.5 10 6.5"/><path d="m8 15.5 10-6.5"/></>,
    audio: <><path d="M5 9v6"/><path d="M9 6v12"/><path d="M13 4v16"/><path d="M17 7v10"/><path d="M21 10v4"/></>,
    close: <><path d="m7 7 10 10"/><path d="m17 7-10 10"/></>,
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>
}

function Waveform({ buffer, start, end, currentTime, duration, onSelectionChange }: {
  buffer: AudioBuffer
  start: number
  end: number
  currentTime: number
  duration: number
  onSelectionChange: (start: number, end: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<Handle>(null)
  const pointsRef = useRef<{ min: number; max: number }[]>([])

  const getTime = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((event.clientX - rect.left) / rect.width) * duration))
  }, [duration])

  const moveHandle = useCallback((handle: Handle, time: number) => {
    if (handle === 'start') onSelectionChange(Math.min(time, end - MIN_CLIP_SECONDS), end)
    if (handle === 'end') onSelectionChange(start, Math.max(time, start + MIN_CLIP_SECONDS))
  }, [end, onSelectionChange, start])

  useEffect(() => {
    const makePoints = () => {
      const samples = buffer.getChannelData(0)
      const count = 900
      const blockSize = Math.max(1, Math.floor(samples.length / count))
      pointsRef.current = Array.from({ length: count }, (_, index) => {
        let min = 1
        let max = -1
        const offset = index * blockSize
        for (let sampleIndex = 0; sampleIndex < blockSize; sampleIndex += 1) {
          const sample = samples[offset + sampleIndex] ?? 0
          min = Math.min(min, sample)
          max = Math.max(max, sample)
        }
        return { min, max }
      })
    }
    makePoints()
  }, [buffer])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    const width = rect.width
    const height = rect.height
    const center = height / 2
    const amplitude = height * 0.38
    const startX = (start / duration) * width
    const endX = (end / duration) * width
    const playX = (currentTime / duration) * width

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#f7f6f1'
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = '#dad9d2'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 5])
    ctx.beginPath()
    ctx.moveTo(0, center)
    ctx.lineTo(width, center)
    ctx.stroke()
    ctx.setLineDash([])

    pointsRef.current.forEach(({ min, max }, index) => {
      const x = (index / pointsRef.current.length) * width
      const isSelected = x >= startX && x <= endX
      ctx.fillStyle = isSelected ? '#ef6a38' : '#c2c4bd'
      ctx.fillRect(x, center + min * amplitude, Math.max(1, width / 1100), Math.max(1, (max - min) * amplitude))
    })

    ctx.fillStyle = 'rgba(70, 74, 71, 0.12)'
    ctx.fillRect(0, 0, startX, height)
    ctx.fillRect(endX, 0, width - endX, height)

    ctx.strokeStyle = '#ef6a38'
    ctx.lineWidth = 2
    ctx.strokeRect(startX, 1, Math.max(0, endX - startX), height - 2)

    ;[startX, endX].forEach((x) => {
      ctx.fillStyle = '#ef6a38'
      ctx.fillRect(x - 5, 0, 10, height)
      ctx.fillStyle = 'rgba(255,255,255,.9)'
      ctx.fillRect(x - 1.5, height / 2 - 8, 1, 16)
      ctx.fillRect(x + 1.5, height / 2 - 8, 1, 16)
    })

    if (currentTime > 0) {
      ctx.strokeStyle = '#26312d'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(playX, 0)
      ctx.lineTo(playX, height)
      ctx.stroke()
      ctx.fillStyle = '#26312d'
      ctx.beginPath()
      ctx.moveTo(playX - 5, 0)
      ctx.lineTo(playX + 5, 0)
      ctx.lineTo(playX, 6)
      ctx.fill()
    }
  }, [currentTime, duration, end, start])

  return (
    <canvas
      aria-label="波形エディター。左右のハンドルをドラッグして切り出す範囲を指定できます。"
      className="waveform-canvas"
      onPointerDown={(event) => {
        const time = getTime(event)
        dragRef.current = Math.abs(time - start) < Math.abs(time - end) ? 'start' : 'end'
        event.currentTarget.setPointerCapture(event.pointerId)
        moveHandle(dragRef.current, time)
      }}
      onPointerMove={(event) => dragRef.current && moveHandle(dragRef.current, getTime(event))}
      onPointerUp={() => { dragRef.current = null }}
      ref={canvasRef}
    />
  )
}

function App() {
  const [audio, setAudio] = useState<AudioFile | null>(null)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const startedAtRef = useRef(0)
  const animationRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const stopPlayback = useCallback((reset = false) => {
    sourceRef.current?.stop()
    sourceRef.current = null
    cancelAnimationFrame(animationRef.current)
    setIsPlaying(false)
    if (reset) setCurrentTime(start)
  }, [start])

  useEffect(() => () => {
    sourceRef.current?.stop()
    cancelAnimationFrame(animationRef.current)
    audioContextRef.current?.close()
  }, [])

  const loadFile = async (file?: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.wav') && file.type !== 'audio/wav' && file.type !== 'audio/wave') {
      setError('WAV ファイルを選択してください。')
      return
    }
    try {
      stopPlayback()
      const context = audioContextRef.current ?? new AudioContext()
      audioContextRef.current = context
      const buffer = await context.decodeAudioData(await file.arrayBuffer())
      setAudio({ file, buffer })
      setStart(0)
      setEnd(buffer.duration)
      setCurrentTime(0)
      setError('')
    } catch {
      setError('ファイルを読み込めませんでした。別の WAV ファイルをお試しください。')
    }
  }

  const play = () => {
    if (!audio) return
    if (isPlaying) {
      stopPlayback()
      return
    }
    const context = audioContextRef.current ?? new AudioContext()
    audioContextRef.current = context
    void context.resume()
    const offset = currentTime >= start && currentTime < end ? currentTime : start
    const source = context.createBufferSource()
    source.buffer = audio.buffer
    source.connect(context.destination)
    source.start(0, offset, end - offset)
    sourceRef.current = source
    startedAtRef.current = context.currentTime - offset
    setCurrentTime(offset)
    setIsPlaying(true)

    const update = () => {
      const next = context.currentTime - startedAtRef.current
      if (next >= end) {
        setCurrentTime(start)
        setIsPlaying(false)
        sourceRef.current = null
        return
      }
      setCurrentTime(next)
      animationRef.current = requestAnimationFrame(update)
    }
    animationRef.current = requestAnimationFrame(update)
  }

  const updateSelection = (nextStart: number, nextEnd: number) => {
    stopPlayback()
    setStart(nextStart)
    setEnd(nextEnd)
    setCurrentTime(nextStart)
  }

  const download = () => {
    if (!audio) return
    const blob = createClippedWav(audio.buffer, start, end)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${audio.file.name.replace(/\.wav$/i, '')}-clip.wav`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const reset = () => {
    stopPlayback()
    setAudio(null)
    setCurrentTime(0)
    setStart(0)
    setEnd(0)
    setError('')
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    void loadFile(event.dataTransfer.files[0])
  }

  return (
    <>
      <header className="site-header">
        <div className="brand"><span className="brand-mark"><Icon name="audio" /></span><span>Wav<span>Edit</span></span></div>
        <div className="header-note">SIMPLE AUDIO CLIPPING</div>
      </header>
      <main>
        {!audio ? (
          <section className="landing">
            <div className="eyebrow">WAV CLIPPER</div>
            <h1>音を、必要な<br /><em>ところだけ。</em></h1>
            <p className="hero-copy">ブラウザだけで完結する、シンプルな WAV エディター。<br />ファイルをドロップして、すぐに切り出せます。</p>
            <div
              className={`drop-zone ${isDragging ? 'dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => event.key === 'Enter' && fileInputRef.current?.click()}
            >
              <span className="upload-icon"><Icon name="upload" /></span>
              <strong>WAV ファイルをドロップ</strong>
              <span className="or"><i /> または <i /></span>
              <button type="button">ファイルを選択</button>
              <small>.wav のみ · ファイルはサーバーに送信されません</small>
            </div>
            {error && <p className="error">{error}</p>}
          </section>
        ) : (
          <section className="workspace">
            <div className="workspace-heading">
              <div>
                <div className="eyebrow">NOW EDITING</div>
                <h1>切り出す範囲を<br /><em>選択してください。</em></h1>
              </div>
              <button className="new-file" type="button" onClick={reset}><Icon name="close" /> 別のファイル</button>
            </div>
            <div className="editor-card">
              <div className="file-row">
                <div className="file-icon"><Icon name="audio" /></div>
                <div className="file-name"><strong>{audio.file.name}</strong><span>{formatFileSize(audio.file.size)} · {audio.buffer.sampleRate.toLocaleString()} Hz · {audio.buffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}</span></div>
                <span className="duration">{formatTime(audio.buffer.duration, true)}</span>
              </div>
              <div className="waveform-wrap">
                <Waveform buffer={audio.buffer} currentTime={currentTime} duration={audio.buffer.duration} end={end} onSelectionChange={updateSelection} start={start} />
                <div className="time-axis"><span>0:00</span><span>{formatTime(audio.buffer.duration / 2, true)}</span><span>{formatTime(audio.buffer.duration, true)}</span></div>
              </div>
              <p className="wave-help"><Icon name="scissors" /> オレンジ色のハンドルをドラッグして範囲を調整</p>
              <div className="controls">
                <button aria-label={isPlaying ? '一時停止' : '再生'} className="play-button" onClick={play} type="button"><Icon name={isPlaying ? 'pause' : 'play'} /></button>
                <div className="play-time"><strong>{formatTime(currentTime, true)}</strong><span>/ {formatTime(audio.buffer.duration, true)}</span></div>
                <div className="selection-fields">
                  <label><span>START</span><strong>{formatTime(start)}</strong></label>
                  <div className="field-rule" />
                  <label><span>END</span><strong>{formatTime(end)}</strong></label>
                  <div className="field-rule" />
                  <label><span>LENGTH</span><strong>{formatTime(end - start)}</strong></label>
                </div>
                <button className="download-button" onClick={download} type="button"><Icon name="download" /><span>クリップを保存<small>WAV でダウンロード</small></span></button>
              </div>
            </div>
          </section>
        )}
        <input accept=".wav,audio/wav" hidden onChange={(event: ChangeEvent<HTMLInputElement>) => void loadFile(event.target.files?.[0])} ref={fileInputRef} type="file" />
      </main>
      <footer><span>WAVEDIT</span><p>YOUR AUDIO STAYS IN YOUR BROWSER.</p><span>2026</span></footer>
    </>
  )
}

export default App
