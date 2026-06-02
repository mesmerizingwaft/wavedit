export type AudioEffects = {
  volume: number
  lowpassEnabled: boolean
  lowpassFrequency: number
  reverbEnabled: boolean
  reverbMix: number
}

export function formatTime(seconds: number, compact = false) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const minutes = Math.floor(safeSeconds / 60)
  const rest = safeSeconds % 60
  return compact
    ? `${minutes}:${rest.toFixed(2).padStart(5, '0')}`
    : `${minutes}:${rest.toFixed(3).padStart(6, '0')}`
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function createReverbImpulse(context: BaseAudioContext, duration = 1.8, decay = 2.4) {
  const length = Math.ceil(context.sampleRate * duration)
  const impulse = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const samples = impulse.getChannelData(channel)
    for (let index = 0; index < length; index += 1) {
      samples[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, decay)
    }
  }
  return impulse
}

export function connectEffects(
  context: BaseAudioContext,
  source: AudioNode,
  destination: AudioNode,
  effects: AudioEffects,
) {
  const gain = context.createGain()
  gain.gain.value = effects.volume
  source.connect(gain)

  let tail: AudioNode = gain
  if (effects.lowpassEnabled) {
    const lowpass = context.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = effects.lowpassFrequency
    lowpass.Q.value = 0.7
    tail.connect(lowpass)
    tail = lowpass
  }

  if (!effects.reverbEnabled) {
    tail.connect(destination)
    return
  }

  const dry = context.createGain()
  const wet = context.createGain()
  const convolver = context.createConvolver()
  dry.gain.value = 1 - effects.reverbMix
  wet.gain.value = effects.reverbMix
  convolver.buffer = createReverbImpulse(context)
  tail.connect(dry)
  tail.connect(convolver)
  convolver.connect(wet)
  dry.connect(destination)
  wet.connect(destination)
}

export function encodeWav(buffer: AudioBuffer) {
  const frameCount = buffer.length
  const channels = buffer.numberOfChannels
  const bytesPerSample = 2
  const dataLength = frameCount * channels * bytesPerSample
  const wav = new ArrayBuffer(44 + dataLength)
  const view = new DataView(wav)

  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
  }

  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true)
  view.setUint16(32, channels * bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataLength, true)

  let offset = 44
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame]))
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true)
      offset += bytesPerSample
    }
  }

  return new Blob([wav], { type: 'audio/wav' })
}

export async function createProcessedWav(buffer: AudioBuffer, start: number, end: number, effects: AudioEffects) {
  const clipDuration = Math.max(0, end - start)
  const reverbTail = effects.reverbEnabled ? 1.8 : 0
  const frameCount = Math.max(1, Math.ceil((clipDuration + reverbTail) * buffer.sampleRate))
  const context = new OfflineAudioContext(buffer.numberOfChannels, frameCount, buffer.sampleRate)
  const source = context.createBufferSource()
  source.buffer = buffer
  connectEffects(context, source, context.destination, effects)
  source.start(0, start, clipDuration)
  return encodeWav(await context.startRendering())
}
