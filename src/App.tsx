import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react'
import { applyEffects, connectEffects, copyAudioRegion, createProcessedWav, cutAudioRegion, formatFileSize, formatTime, pasteAudioRegion, type AudioClipboard, type AudioEffects, type EffectChain } from './audio'

type AudioTrack = {
  id: string
  file: File
  buffer: AudioBuffer
  volume: number
  muted: boolean
  editStart: number
  editEnd: number
}

const MIN_CLIP_SECONDS = 0.03

const DEFAULT_EFFECTS: AudioEffects = {
  volume: 1,
  lowpassEnabled: false,
  lowpassFrequency: 4000,
  reverbEnabled: false,
  reverbMix: 0.3,
}

function Icon({ name }: { name: 'upload' | 'play' | 'pause' | 'stop' | 'download' | 'scissors' | 'audio' | 'close' | 'loop' | 'plus' | 'copy' | 'paste' }) {
  const paths = {
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></>,
    play: <path d="m9 7 8 5-8 5V7Z" />,
    pause: <><path d="M9 7v10"/><path d="M15 7v10"/></>,
    stop: <rect x="8" y="8" width="8" height="8" rx=".5" />,
    download: <><path d="M12 4v11"/><path d="m8 11 4 4 4-4"/><path d="M5 20h14"/></>,
    scissors: <><circle cx="6" cy="7" r="2"/><circle cx="6" cy="17" r="2"/><path d="m8 8.5 10 6.5"/><path d="m8 15.5 10-6.5"/></>,
    audio: <><path d="M5 9v6"/><path d="M9 6v12"/><path d="M13 4v16"/><path d="M17 7v10"/><path d="M21 10v4"/></>,
    close: <><path d="m7 7 10 10"/><path d="m17 7-10 10"/></>,
    loop: <><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>,
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="1"/><path d="M16 8V5H5v11h3"/></>,
    paste: <><path d="M9 5h6"/><path d="M9 3h6v4H9z"/><path d="M7 5H5v16h14V5h-2"/></>,
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>
}

function Waveform({ buffer, playbackStart, playbackEnd, editStart, editEnd, currentTime, duration, zoom, isActive, onActivate, onEditSelectionChange, onZoomChange }: {
  buffer: AudioBuffer
  playbackStart: number
  playbackEnd: number
  editStart: number
  editEnd: number
  currentTime: number
  duration: number
  zoom: number
  isActive: boolean
  onActivate: () => void
  onEditSelectionChange: (start: number, end: number) => void
  onZoomChange: (zoom: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<number | null>(null)
  const pointsRef = useRef<{ min: number; max: number }[]>([])
  const pendingScrollRef = useRef<{ anchor: number; x: number; previousZoom: number } | null>(null)

  useEffect(() => {
    const pending = pendingScrollRef.current
    const viewport = viewportRef.current
    if (!pending || !viewport) return
    viewport.scrollLeft = pending.anchor * (zoom / pending.previousZoom) - pending.x
    pendingScrollRef.current = null
  }, [zoom])

  const handleWheel = useCallback((event: globalThis.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const x = event.clientX - rect.left
    const nextZoom = Math.max(1, Math.min(8, zoom * Math.exp(-event.deltaY * 0.01)))
    if (Math.abs(nextZoom - zoom) < 0.001) return
    pendingScrollRef.current = { anchor: viewport.scrollLeft + x, x, previousZoom: zoom }
    onZoomChange(nextZoom)
  }, [onZoomChange, zoom])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    // Trackpad pinch is exposed as a ctrl/meta + wheel gesture. React's delegated
    // wheel listener can be passive, so register directly to reliably stop the
    // browser from zooming the whole page while the waveform handles the gesture.
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const getTime = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(buffer.duration, ((event.clientX - rect.left) / rect.width) * duration))
  }, [buffer.duration, duration])

  const selectTo = useCallback((time: number) => {
    const anchor = dragStartRef.current
    if (anchor === null) return
    const nextStart = Math.min(anchor, time)
    const nextEnd = Math.max(anchor, time)
    if (nextEnd - nextStart >= MIN_CLIP_SECONDS) onEditSelectionChange(nextStart, nextEnd)
    else if (anchor + MIN_CLIP_SECONDS <= buffer.duration) onEditSelectionChange(anchor, anchor + MIN_CLIP_SECONDS)
    else onEditSelectionChange(Math.max(0, anchor - MIN_CLIP_SECONDS), anchor)
  }, [buffer.duration, onEditSelectionChange])

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
    const playbackStartX = (playbackStart / duration) * width
    const playbackEndX = (playbackEnd / duration) * width
    const editStartX = (editStart / duration) * width
    const editEndX = (editEnd / duration) * width
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
      const isEditSelected = isActive && x >= editStartX && x <= editEndX
      const isInPlaybackRange = x >= playbackStartX && x <= playbackEndX
      ctx.fillStyle = isEditSelected ? '#287f8f' : isInPlaybackRange ? '#ef6a38' : '#c2c4bd'
      ctx.fillRect(x, center + min * amplitude, Math.max(1, width / 1100), Math.max(1, (max - min) * amplitude))
    })

    ctx.fillStyle = 'rgba(70, 74, 71, 0.12)'
    ctx.fillRect(0, 0, playbackStartX, height)
    ctx.fillRect(playbackEndX, 0, width - playbackEndX, height)

    ctx.strokeStyle = '#ef6a38'
    ctx.lineWidth = 2
    ctx.strokeRect(playbackStartX, 1, Math.max(0, playbackEndX - playbackStartX), height - 2)

    ;[playbackStartX, playbackEndX].forEach((x) => {
      ctx.fillStyle = '#ef6a38'
      ctx.fillRect(x - 5, 0, 10, height)
      ctx.fillStyle = 'rgba(255,255,255,.9)'
      ctx.fillRect(x - 1.5, height / 2 - 8, 1, 16)
      ctx.fillRect(x + 1.5, height / 2 - 8, 1, 16)
    })

    if (isActive) {
      ctx.fillStyle = 'rgba(40, 127, 143, .12)'
      ctx.fillRect(editStartX, 0, Math.max(0, editEndX - editStartX), height)
      ctx.strokeStyle = '#287f8f'
      ctx.lineWidth = 2
      ctx.setLineDash([5, 4])
      ctx.strokeRect(editStartX, 3, Math.max(0, editEndX - editStartX), height - 6)
      ctx.setLineDash([])
    }

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
  }, [buffer.duration, currentTime, duration, editEnd, editStart, isActive, playbackEnd, playbackStart])

  return (
    <div
      aria-label={`波形の表示倍率 ${Math.round(zoom * 100)}%。タッチパッドでピンチして拡大縮小できます。`}
      className="waveform-viewport"
      ref={viewportRef}
    >
      <div className="waveform-content" style={{ width: `${zoom * 100}%` }}><canvas
      aria-label="波形エディター。波形上をドラッグして、このトラックだけのコピー・切り取り範囲を指定できます。"
      className="waveform-canvas"
      onPointerDown={(event) => {
        const time = getTime(event)
        onActivate()
        dragStartRef.current = time
        event.currentTarget.setPointerCapture(event.pointerId)
        selectTo(time)
      }}
      onPointerMove={(event) => dragStartRef.current !== null && selectTo(getTime(event))}
      onPointerUp={() => { dragStartRef.current = null }}
      onPointerCancel={() => { dragStartRef.current = null }}
      ref={canvasRef}
      /></div>
    </div>
  )
}

function PlaybackTimeInput({ ariaLabel, value, min, max, onCommit }: {
  ariaLabel: string
  value: number
  min: number
  max: number
  onCommit: (value: number) => number
}) {
  const formatValue = (time: number) => time.toFixed(3)
  const [draft, setDraft] = useState(formatValue(value))

  const commit = () => {
    const next = Number(draft)
    if (!draft.trim() || !Number.isFinite(next)) {
      setDraft(formatValue(value))
      return
    }
    setDraft(formatValue(onCommit(next)))
  }

  return <input
    aria-label={ariaLabel}
    max={max}
    min={min}
    onBlur={commit}
    onChange={(event) => setDraft(event.target.value)}
    onKeyDown={(event) => {
      if (event.key === 'Enter') event.currentTarget.blur()
      if (event.key === 'Escape') setDraft(formatValue(value))
    }}
    step="0.001"
    type="number"
    value={draft}
  />
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
  const [clipboard, setClipboard] = useState<AudioClipboard | null>(null)
  const [editMessage, setEditMessage] = useState('')
  const [waveformZoom, setWaveformZoom] = useState(1)
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
        editStart: 0,
        editEnd: 0,
      })))
      loaded.forEach((track) => { track.editEnd = track.buffer.duration })
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
  const updateEditSelection = (id: string, editStart: number, editEnd: number) => {
    setTracks((current) => current.map((track) => track.id === id ? { ...track, editStart, editEnd } : track))
  }
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
  const reset = () => { stopPlayback(); setTracks([]); setActiveTrackId(''); setCurrentTime(0); setStart(0); setEnd(0); setError(''); setEffects(DEFAULT_EFFECTS); setWaveformZoom(1) }
  const updateEffect = <Key extends keyof AudioEffects>(key: Key, value: AudioEffects[Key]) => setEffects((current) => ({ ...current, [key]: value }))
  const updateTime = (field: 'start' | 'end', time: number) => {
    if (field === 'start') {
      const nextStart = Math.max(0, Math.min(time, end - MIN_CLIP_SECONDS))
      updateSelection(nextStart, end)
      return nextStart
    }
    const nextEnd = Math.min(duration, Math.max(time, start + MIN_CLIP_SECONDS))
    updateSelection(start, nextEnd)
    return nextEnd
  }
  const handleDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setIsDragging(false); void loadFiles(event.dataTransfer.files, tracks.length > 0) }

  const copySelection = useCallback(() => {
    if (!activeTrack) return
    const copied = copyAudioRegion(activeTrack.buffer, activeTrack.editStart, Math.min(activeTrack.editEnd, activeTrack.buffer.duration))
    if (!copied) { setEditMessage('コピーできる範囲を選択してください。'); return }
    setClipboard(copied); setEditMessage(`${formatTime(copied.channels[0].length / copied.sampleRate)} をコピーしました。`)
  }, [activeTrack])

  const cutSelection = useCallback(() => {
    if (!activeTrack) return
    const copied = copyAudioRegion(activeTrack.buffer, activeTrack.editStart, Math.min(activeTrack.editEnd, activeTrack.buffer.duration))
    if (!copied) { setEditMessage('切り取れる範囲を選択してください。'); return }
    stopPlayback()
    const context = audioContextRef.current ?? new AudioContext(); audioContextRef.current = context
    const nextBuffer = cutAudioRegion(context, activeTrack.buffer, activeTrack.editStart, activeTrack.editEnd)
    setClipboard(copied)
    setTracks((current) => current.map((track) => track.id === activeTrack.id ? { ...track, buffer: nextBuffer } : track))
    setCurrentTime(activeTrack.editStart)
    setEditMessage(`${formatTime(copied.channels[0].length / copied.sampleRate)} を切り取り、無音にしました。`)
  }, [activeTrack, stopPlayback])

  const pasteSelection = useCallback(() => {
    if (!activeTrack || !clipboard) return
    stopPlayback()
    const context = audioContextRef.current ?? new AudioContext(); audioContextRef.current = context
    const at = Math.min(activeTrack.editStart, activeTrack.buffer.duration)
    const pasted = pasteAudioRegion(context, activeTrack.buffer, at, clipboard)
    setTracks((current) => current.map((track) => track.id === activeTrack.id ? { ...track, buffer: pasted.buffer, editStart: at, editEnd: at + pasted.duration } : track))
    setCurrentTime(at)
    setEditMessage(`${formatTime(pasted.duration)} を ${formatTime(at)} に貼り付けました。`)
  }, [activeTrack, clipboard, stopPlayback])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement) return
      if (event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection() }
      if (event.key.toLowerCase() === 'x') { event.preventDefault(); cutSelection() }
      if (event.key.toLowerCase() === 'v' && clipboard) { event.preventDefault(); pasteSelection() }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [clipboard, copySelection, cutSelection, pasteSelection])

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
        <div className="track-list">{tracks.map((track, index) => <div className={`track ${activeTrack?.id === track.id ? 'active' : ''}`} key={track.id}>
          <div className="file-row track-row" onClick={() => setActiveTrackId(track.id)}>
            <div className="track-number">{String(index + 1).padStart(2, '0')}</div><div className="file-icon"><Icon name="audio" /></div>
            <div className="file-name"><strong>{track.file.name}</strong><span>{formatFileSize(track.file.size)} · {track.buffer.sampleRate.toLocaleString()} Hz · {track.buffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}</span></div>
            <label className="track-volume" onClick={(event) => event.stopPropagation()}><span>VOL {Math.round(track.volume * 100)}%</span><input aria-label={`${track.file.name} の音量`} max="100" min="0" onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) / 100 })} type="range" value={track.volume * 100} /></label>
            <button aria-pressed={track.muted} className={`mute-button ${track.muted ? 'active' : ''}`} onClick={(event) => { event.stopPropagation(); updateTrack(track.id, { muted: !track.muted }) }} type="button">M</button>
            <span className="duration">{formatTime(track.buffer.duration, true)}</span><button aria-label={`${track.file.name} を削除`} className="remove-track" onClick={(event) => { event.stopPropagation(); removeTrack(track.id) }} type="button"><Icon name="close" /></button>
          </div>
          <div className="track-waveform"><Waveform buffer={track.buffer} currentTime={currentTime} duration={duration} editEnd={track.editEnd} editStart={track.editStart} isActive={activeTrack?.id === track.id} onActivate={() => setActiveTrackId(track.id)} onEditSelectionChange={(editStart, editEnd) => updateEditSelection(track.id, editStart, editEnd)} onZoomChange={setWaveformZoom} playbackEnd={end} playbackStart={start} zoom={waveformZoom} /><div className="time-axis"><span>0:00</span><span>{formatTime(duration / 2, true)}</span><span>{formatTime(duration, true)}</span></div></div>
        </div>)}</div>
        <button className="add-track" onClick={() => fileInputRef.current?.click()} type="button"><Icon name="plus" /> トラックを追加</button>
        <div className="edit-toolbar" role="toolbar" aria-label="波形編集"><div className="edit-selection"><span>編集範囲 · 選択トラックのみ</span><strong>{activeTrack ? `${formatTime(activeTrack.editStart)} — ${formatTime(activeTrack.editEnd)}` : '—'}</strong></div><button onClick={copySelection} type="button"><Icon name="copy" /><span>コピー<small>⌘/Ctrl+C</small></span></button><button onClick={cutSelection} type="button"><Icon name="scissors" /><span>切り取り<small>⌘/Ctrl+X</small></span></button><button disabled={!clipboard} onClick={pasteSelection} type="button"><Icon name="paste" /><span>貼り付け<small>編集範囲の先頭へ</small></span></button>{editMessage && <p aria-live="polite">{editMessage}</p>}</div>
        <p className="wave-help"><Icon name="scissors" /> <span><b>青</b>：選択トラックの編集範囲（ドラッグで指定） · <em>オレンジ</em>：全トラック共通の再生範囲（下の秒数で指定）</span></p>
        <div className="effect-panel"><div className="effect-heading"><span>マスターエフェクト</span><small>すべてのトラックのプレビューに反映</small></div>
          <label className="effect-control"><span>音量 <b>{Math.round(effects.volume * 100)}%</b></span><input max="100" min="0" onChange={(event) => updateEffect('volume', Number(event.target.value) / 100)} type="range" value={effects.volume * 100} /></label>
          <label className="effect-control toggle-control"><span><input checked={effects.lowpassEnabled} onChange={(event) => updateEffect('lowpassEnabled', event.target.checked)} type="checkbox" /> ローパス</span><small>高音をカット</small></label>
          <label className={`effect-control ${effects.lowpassEnabled ? '' : 'disabled'}`}><span>周波数 <b>{effects.lowpassFrequency.toLocaleString()} Hz</b></span><input disabled={!effects.lowpassEnabled} max="12000" min="200" onChange={(event) => updateEffect('lowpassFrequency', Number(event.target.value))} step="100" type="range" value={effects.lowpassFrequency} /></label>
          <label className="effect-control toggle-control"><span><input checked={effects.reverbEnabled} onChange={(event) => updateEffect('reverbEnabled', event.target.checked)} type="checkbox" /> リバーブ</span><small>残響を追加</small></label>
          <label className={`effect-control ${effects.reverbEnabled ? '' : 'disabled'}`}><span>深さ <b>{Math.round(effects.reverbMix * 100)}%</b></span><input disabled={!effects.reverbEnabled} max="70" min="0" onChange={(event) => updateEffect('reverbMix', Number(event.target.value) / 100)} type="range" value={effects.reverbMix * 100} /></label>
        </div>
        <div className="controls"><button aria-label={isPlaying ? '一時停止' : '再生'} className="play-button" onClick={play} type="button"><Icon name={isPlaying ? 'pause' : 'play'} /></button><button aria-label="停止して再生開始位置に戻る" className="stop-button" onClick={() => stopPlayback(true)} type="button"><Icon name="stop" /></button><button aria-pressed={isLooping} className={`loop-button ${isLooping ? 'active' : ''}`} onClick={() => { stopPlayback(); setIsLooping((current) => !current) }} type="button"><Icon name="loop" /><span>LOOP</span></button><div className="play-time"><strong>{formatTime(currentTime, true)}</strong><span>/ {formatTime(duration, true)}</span></div>
          <div className="selection-fields"><label><span>再生 START · 秒</span><PlaybackTimeInput ariaLabel="再生開始位置（秒）" key={`start-${start}`} max={Math.max(0, end - MIN_CLIP_SECONDS)} min={0} onCommit={(value) => updateTime('start', value)} value={start} /></label><div className="field-rule" /><label><span>再生 END · 秒</span><PlaybackTimeInput ariaLabel="再生終了位置（秒）" key={`end-${end}`} max={duration} min={start + MIN_CLIP_SECONDS} onCommit={(value) => updateTime('end', value)} value={end} /></label><div className="field-rule" /><label><span>再生 LENGTH</span><strong>{formatTime(end - start)}</strong></label></div>
          <button className="download-button" disabled={isExporting || !activeTrack} onClick={() => void download()} type="button"><Icon name="download" /><span>{isExporting ? '処理中…' : '選択トラックを保存'}<small>WAV でダウンロード</small></span></button>
        </div>
      </div>{error && <p className="error">{error}</p>}
    </section>}
    <input accept=".wav,audio/wav" hidden multiple onChange={(event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) void loadFiles(event.target.files, tracks.length > 0); event.target.value = '' }} ref={fileInputRef} type="file" />
    </main><footer><span>WAVEDIT</span><p>YOUR AUDIO STAYS IN YOUR BROWSER.</p><span>2026</span></footer>
  </>
}

export default App
