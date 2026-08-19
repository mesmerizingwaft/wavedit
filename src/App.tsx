import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react'
import { applyEffects, connectEffects, createProcessedWav, formatFileSize, formatTime, type AudioEffects, type EffectChain } from './audio'

type Handle = 'start' | 'end' | null

type AudioTrack = {
  id: string
  file: File
  buffer: AudioBuffer
  volume: number
  muted: boolean
}

const MIN_CLIP_SECONDS = 0.03

const DEFAULT_EFFECTS: AudioEffects = {
  volume: 1,
  lowpassEnabled: false,
  lowpassFrequency: 4000,
  reverbEnabled: false,
  reverbMix: 0.3,
}

function Icon({ name }: { name: 'upload' | 'play' | 'pause' | 'download' | 'scissors' | 'audio' | 'close' | 'loop' | 'plus' }) {
  const paths = {
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></>,
    play: <path d="m9 7 8 5-8 5V7Z" />,
    pause: <><path d="M9 7v10"/><path d="M15 7v10"/></>,
    download: <><path d="M12 4v11"/><path d="m8 11 4 4 4-4"/><path d="M5 20h14"/></>,
    scissors: <><circle cx="6" cy="7" r="2"/><circle cx="6" cy="17" r="2"/><path d="m8 8.5 10 6.5"/><path d="m8 15.5 10-6.5"/></>,
    audio: <><path d="M5 9v6"/><path d="M9 6v12"/><path d="M13 4v16"/><path d="M17 7v10"/><path d="M21 10v4"/></>,
    close: <><path d="m7 7 10 10"/><path d="m17 7-10 10"/></>,
    loop: <><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>,
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
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
      const x = (index / pointsRef.current.length) * (buffer.duration / duration) * width
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
  }, [buffer.duration, currentTime, duration, end, start])

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
  const [tracks, setTracks] = useState<AudioTrack[]>([])
  const [activeTrackId, setActiveTrackId] = useState('')
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLooping, setIsLooping] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')
  const [effects, setEffects] = useState(DEFAULT_EFFECTS)
  const [isExporting, setIsExporting] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  const effectChainsRef = useRef<Map<string, EffectChain>>(new Map())
  const startedAtRef = useRef(0)
  const animationRef = useRef(0)
  const isLoopingRef = useRef(isLooping)
  const startRef = useRef(start)
  const endRef = useRef(end)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const duration = tracks.reduce((longest, track) => Math.max(longest, track.buffer.duration), 0)
  const activeTrack = tracks.find((track) => track.id === activeTrackId) ?? tracks[0]

  const stopPlayback = useCallback((reset = false) => {
    sourcesRef.current.forEach((source) => { try { source.stop() } catch { /* already stopped */ } })
    sourcesRef.current = []
    effectChainsRef.current.clear()
    cancelAnimationFrame(animationRef.current)
    setIsPlaying(false)
    if (reset) setCurrentTime(startRef.current)
  }, [])

  useEffect(() => { isLoopingRef.current = isLooping }, [isLooping])
  useEffect(() => { startRef.current = start; endRef.current = end }, [end, start])
  useEffect(() => {
    const context = audioContextRef.current
    if (!context) return
    tracks.forEach((track) => {
      const chain = effectChainsRef.current.get(track.id)
      if (chain) applyEffects(context, chain, { ...effects, volume: effects.volume * track.volume * (track.muted ? 0 : 1) })
    })
  }, [effects, tracks])
  useEffect(() => () => { stopPlayback(); void audioContextRef.current?.close() }, [stopPlayback])

  const loadFiles = async (files: FileList | File[], append = false) => {
    const candidates = Array.from(files)
    const wavFiles = candidates.filter((file) => file.name.toLowerCase().endsWith('.wav') || file.type === 'audio/wav' || file.type === 'audio/wave')
    if (!wavFiles.length) { setError('WAV ファイルを選択してください。'); return }
    try {
      stopPlayback()
      const context = audioContextRef.current ?? new AudioContext()
      audioContextRef.current = context
      const loaded = await Promise.all(wavFiles.map(async (file) => ({
        id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        buffer: await context.decodeAudioData(await file.arrayBuffer()),
        volume: 1,
        muted: false,
      })))
      setTracks((current) => {
        const next = append ? [...current, ...loaded] : loaded
        const nextDuration = next.reduce((value, track) => Math.max(value, track.buffer.duration), 0)
        setStart(0); setEnd(nextDuration); setCurrentTime(0)
        return next
      })
      setActiveTrackId(loaded[0].id)
      setError(candidates.length !== wavFiles.length ? 'WAV 以外のファイルは読み込みませんでした。' : '')
    } catch { setError('ファイルを読み込めませんでした。別の WAV ファイルをお試しください。') }
  }

  const play = () => {
    if (!tracks.length) return
    if (isPlaying) { stopPlayback(); return }
    const context = audioContextRef.current ?? new AudioContext()
    audioContextRef.current = context
    void context.resume()
    const offset = currentTime >= start && currentTime < end ? currentTime : start
    const sessionSources: AudioBufferSourceNode[] = []
    effectChainsRef.current.clear()
    tracks.forEach((track) => {
      const source = context.createBufferSource()
      if (track.buffer.duration < duration) {
        const padded = context.createBuffer(track.buffer.numberOfChannels, Math.ceil(duration * track.buffer.sampleRate), track.buffer.sampleRate)
        for (let channel = 0; channel < track.buffer.numberOfChannels; channel += 1) padded.copyToChannel(track.buffer.getChannelData(channel), channel)
        source.buffer = padded
      } else source.buffer = track.buffer
      source.loop = isLooping
      source.loopStart = start
      source.loopEnd = end
      effectChainsRef.current.set(track.id, connectEffects(context, source, context.destination, {
        ...effects, volume: effects.volume * track.volume * (track.muted ? 0 : 1),
      }))
      source.start(0, offset)
      sessionSources.push(source)
    })
    sourcesRef.current = sessionSources
    startedAtRef.current = context.currentTime - offset
    setCurrentTime(offset); setIsPlaying(true)
    const update = () => {
      const rangeStart = startRef.current
      const rangeEnd = endRef.current
      const rangeDuration = Math.max(MIN_CLIP_SECONDS, rangeEnd - rangeStart)
      const next = context.currentTime - startedAtRef.current
      if (isLoopingRef.current) {
        setCurrentTime(rangeStart + ((((next - rangeStart) % rangeDuration) + rangeDuration) % rangeDuration))
      } else if (next >= rangeEnd) {
        sourcesRef.current.forEach((source) => { try { source.stop() } catch { /* already stopped */ } })
        sourcesRef.current = []; effectChainsRef.current.clear(); setCurrentTime(rangeStart); setIsPlaying(false); return
      } else setCurrentTime(next)
      animationRef.current = requestAnimationFrame(update)
    }
    animationRef.current = requestAnimationFrame(update)
  }

  const updateSelection = (nextStart: number, nextEnd: number) => { stopPlayback(); setStart(nextStart); setEnd(nextEnd); setCurrentTime(nextStart) }
  const updateTrack = (id: string, changes: Partial<Pick<AudioTrack, 'volume' | 'muted'>>) => setTracks((current) => current.map((track) => track.id === id ? { ...track, ...changes } : track))
  const removeTrack = (id: string) => {
    stopPlayback()
    setTracks((current) => {
      const next = current.filter((track) => track.id !== id)
      const nextDuration = next.reduce((value, track) => Math.max(value, track.buffer.duration), 0)
      setEnd(nextDuration); setCurrentTime(0); setActiveTrackId((active) => active === id ? (next[0]?.id ?? '') : active)
      return next
    })
  }
  const download = async () => {
    if (!activeTrack || isExporting) return
    setIsExporting(true)
    try {
      const blob = await createProcessedWav(activeTrack.buffer, Math.min(start, activeTrack.buffer.duration), Math.min(end, activeTrack.buffer.duration), { ...effects, volume: effects.volume * activeTrack.volume })
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url
      anchor.download = `${activeTrack.file.name.replace(/\.wav$/i, '')}-clip.wav`; anchor.click(); URL.revokeObjectURL(url)
    } catch { setError('クリップを処理できませんでした。設定を変更してもう一度お試しください。') } finally { setIsExporting(false) }
  }
  const reset = () => { stopPlayback(); setTracks([]); setActiveTrackId(''); setCurrentTime(0); setStart(0); setEnd(0); setError(''); setEffects(DEFAULT_EFFECTS) }
  const updateEffect = <Key extends keyof AudioEffects>(key: Key, value: AudioEffects[Key]) => setEffects((current) => ({ ...current, [key]: value }))
  const updateTime = (field: 'start' | 'end', value: string) => {
    const time = Number(value); if (!Number.isFinite(time)) return
    if (field === 'start') updateSelection(Math.max(0, Math.min(time, end - MIN_CLIP_SECONDS)), end)
    else updateSelection(start, Math.min(duration, Math.max(time, start + MIN_CLIP_SECONDS)))
  }
  const handleDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setIsDragging(false); void loadFiles(event.dataTransfer.files, tracks.length > 0) }

  return <>
    <header className="site-header"><div className="brand"><span className="brand-mark"><Icon name="audio" /></span><span>Wav<span>Edit</span></span></div><div className="header-note">MULTITRACK WAV EDITOR</div></header>
    <main>{!tracks.length ? <section className="landing">
      <div className="eyebrow">WAV MULTITRACK PLAYER</div><h1>音を、重ねて<br /><em>再生する。</em></h1>
      <p className="hero-copy">複数の WAV ファイルをブラウザだけで同時再生。<br />ファイルをまとめてドロップして、すぐに始められます。</p>
      <div className={`drop-zone ${isDragging ? 'dragging' : ''}`} onClick={() => fileInputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }} onDragLeave={() => setIsDragging(false)} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} role="button" tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && fileInputRef.current?.click()}>
        <span className="upload-icon"><Icon name="upload" /></span><strong>WAV ファイルをまとめてドロップ</strong><span className="or"><i /> または <i /></span><button type="button">ファイルを選択</button><small>.wav のみ · 複数選択できます · サーバーには送信されません</small>
      </div>{error && <p className="error">{error}</p>}
    </section> : <section className="workspace">
      <div className="workspace-heading"><div><div className="eyebrow">{tracks.length} TRACKS LOADED</div><h1>トラックを重ねて<br /><em>再生しましょう。</em></h1></div><button className="new-file" type="button" onClick={reset}><Icon name="close" /> すべて閉じる</button></div>
      <div className="editor-card">
        <div className="track-list">{tracks.map((track, index) => <div className={`file-row track-row ${activeTrack?.id === track.id ? 'active' : ''}`} key={track.id} onClick={() => setActiveTrackId(track.id)}>
          <div className="track-number">{String(index + 1).padStart(2, '0')}</div><div className="file-icon"><Icon name="audio" /></div>
          <div className="file-name"><strong>{track.file.name}</strong><span>{formatFileSize(track.file.size)} · {track.buffer.sampleRate.toLocaleString()} Hz · {track.buffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}</span></div>
          <label className="track-volume" onClick={(event) => event.stopPropagation()}><span>VOL {Math.round(track.volume * 100)}%</span><input aria-label={`${track.file.name} の音量`} max="100" min="0" onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) / 100 })} type="range" value={track.volume * 100} /></label>
          <button aria-pressed={track.muted} className={`mute-button ${track.muted ? 'active' : ''}`} onClick={(event) => { event.stopPropagation(); updateTrack(track.id, { muted: !track.muted }) }} type="button">M</button>
          <span className="duration">{formatTime(track.buffer.duration, true)}</span><button aria-label={`${track.file.name} を削除`} className="remove-track" onClick={(event) => { event.stopPropagation(); removeTrack(track.id) }} type="button"><Icon name="close" /></button>
        </div>)}</div>
        <button className="add-track" onClick={() => fileInputRef.current?.click()} type="button"><Icon name="plus" /> トラックを追加</button>
        {activeTrack && <><div className="waveform-label"><span>SELECTED TRACK</span><strong>{activeTrack.file.name}</strong></div><div className="waveform-wrap"><Waveform buffer={activeTrack.buffer} currentTime={currentTime} duration={duration} end={end} onSelectionChange={updateSelection} start={start} /><div className="time-axis"><span>0:00</span><span>{formatTime(duration / 2, true)}</span><span>{formatTime(duration, true)}</span></div></div></>}
        <p className="wave-help"><Icon name="scissors" /> 選択中のトラックの波形を表示 · 再生範囲はすべてのトラックに適用されます</p>
        <div className="effect-panel"><div className="effect-heading"><span>マスターエフェクト</span><small>すべてのトラックのプレビューに反映</small></div>
          <label className="effect-control"><span>音量 <b>{Math.round(effects.volume * 100)}%</b></span><input max="100" min="0" onChange={(event) => updateEffect('volume', Number(event.target.value) / 100)} type="range" value={effects.volume * 100} /></label>
          <label className="effect-control toggle-control"><span><input checked={effects.lowpassEnabled} onChange={(event) => updateEffect('lowpassEnabled', event.target.checked)} type="checkbox" /> ローパス</span><small>高音をカット</small></label>
          <label className={`effect-control ${effects.lowpassEnabled ? '' : 'disabled'}`}><span>周波数 <b>{effects.lowpassFrequency.toLocaleString()} Hz</b></span><input disabled={!effects.lowpassEnabled} max="12000" min="200" onChange={(event) => updateEffect('lowpassFrequency', Number(event.target.value))} step="100" type="range" value={effects.lowpassFrequency} /></label>
          <label className="effect-control toggle-control"><span><input checked={effects.reverbEnabled} onChange={(event) => updateEffect('reverbEnabled', event.target.checked)} type="checkbox" /> リバーブ</span><small>残響を追加</small></label>
          <label className={`effect-control ${effects.reverbEnabled ? '' : 'disabled'}`}><span>深さ <b>{Math.round(effects.reverbMix * 100)}%</b></span><input disabled={!effects.reverbEnabled} max="70" min="0" onChange={(event) => updateEffect('reverbMix', Number(event.target.value) / 100)} type="range" value={effects.reverbMix * 100} /></label>
        </div>
        <div className="controls"><button aria-label={isPlaying ? '一時停止' : '再生'} className="play-button" onClick={play} type="button"><Icon name={isPlaying ? 'pause' : 'play'} /></button><button aria-pressed={isLooping} className={`loop-button ${isLooping ? 'active' : ''}`} onClick={() => { stopPlayback(); setIsLooping((current) => !current) }} type="button"><Icon name="loop" /><span>LOOP</span></button><div className="play-time"><strong>{formatTime(currentTime, true)}</strong><span>/ {formatTime(duration, true)}</span></div>
          <div className="selection-fields"><label><span>START · 秒</span><input aria-label="開始位置（秒）" max={Math.max(0, end - MIN_CLIP_SECONDS)} min="0" onChange={(event) => updateTime('start', event.target.value)} step="0.001" type="number" value={start.toFixed(3)} /></label><div className="field-rule" /><label><span>END · 秒</span><input aria-label="終了位置（秒）" max={duration} min={start + MIN_CLIP_SECONDS} onChange={(event) => updateTime('end', event.target.value)} step="0.001" type="number" value={end.toFixed(3)} /></label><div className="field-rule" /><label><span>LENGTH</span><strong>{formatTime(end - start)}</strong></label></div>
          <button className="download-button" disabled={isExporting || !activeTrack} onClick={() => void download()} type="button"><Icon name="download" /><span>{isExporting ? '処理中…' : '選択トラックを保存'}<small>WAV でダウンロード</small></span></button>
        </div>
      </div>{error && <p className="error">{error}</p>}
    </section>}
    <input accept=".wav,audio/wav" hidden multiple onChange={(event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) void loadFiles(event.target.files, tracks.length > 0); event.target.value = '' }} ref={fileInputRef} type="file" />
    </main><footer><span>WAVEDIT</span><p>YOUR AUDIO STAYS IN YOUR BROWSER.</p><span>2026</span></footer>
  </>
}

export default App
