export type AudioEffects = {
  volume: number
  lowpassEnabled: boolean
  lowpassFrequency: number
  reverbEnabled: boolean
  reverbMix: number
}

export type EffectChain = {
  volume: GainNode
  lowpass: BiquadFilterNode
  dry: GainNode
  wet: GainNode
  convolver: ConvolverNode
}

export type AudioClipboard = { channels: Float32Array[]; sampleRate: number }

export function copyAudioRegion(buffer: AudioBuffer, start: number, end: number): AudioClipboard | null {
  const startFrame = Math.max(0, Math.min(buffer.length, Math.floor(start * buffer.sampleRate)))
  const endFrame = Math.max(startFrame, Math.min(buffer.length, Math.ceil(end * buffer.sampleRate)))
  if (endFrame <= startFrame) return null
  return { channels: Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel).slice(startFrame, endFrame)), sampleRate: buffer.sampleRate }
}

function resample(samples: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) return samples
  const output = new Float32Array(Math.max(1, Math.round(samples.length * targetRate / sourceRate)))
  for (let index = 0; index < output.length; index += 1) {
    const position = index * sourceRate / targetRate
    const left = Math.min(samples.length - 1, Math.floor(position))
    const right = Math.min(samples.length - 1, left + 1)
    output[index] = samples[left] + (samples[right] - samples[left]) * (position - left)
  }
  return output
}

export function cutAudioRegion(context: BaseAudioContext, buffer: AudioBuffer, start: number, end: number) {
  const startFrame = Math.max(0, Math.min(buffer.length, Math.floor(start * buffer.sampleRate)))
  const endFrame = Math.max(startFrame, Math.min(buffer.length, Math.ceil(end * buffer.sampleRate)))
  const output = context.createBuffer(buffer.numberOfChannels, Math.max(1, buffer.length - (endFrame - startFrame)), buffer.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel); const target = output.getChannelData(channel)
    target.set(source.subarray(0, startFrame)); target.set(source.subarray(endFrame), startFrame)
  }
  return output
}

export function pasteAudioRegion(context: BaseAudioContext, buffer: AudioBuffer, at: number, clipboard: AudioClipboard) {
  const insertionFrame = Math.max(0, Math.min(buffer.length, Math.round(at * buffer.sampleRate)))
  const pastedChannels = clipboard.channels.map((channel) => resample(channel, clipboard.sampleRate, buffer.sampleRate))
  const pastedLength = pastedChannels[0]?.length ?? 0
  const output = context.createBuffer(buffer.numberOfChannels, buffer.length + pastedLength, buffer.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel); const target = output.getChannelData(channel)
    const pasted = pastedChannels[Math.min(channel, pastedChannels.length - 1)] ?? new Float32Array(pastedLength)
    target.set(source.subarray(0, insertionFrame)); target.set(pasted, insertionFrame); target.set(source.subarray(insertionFrame), insertionFrame + pastedLength)
  }
  return { buffer: output, duration: pastedLength / buffer.sampleRate }
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

function setParam(context: BaseAudioContext, param: AudioParam, value: number) {
  const now = context.currentTime
  param.cancelScheduledValues(now)
  param.setTargetAtTime(value, now, 0.01)
}

export function applyEffects(context: BaseAudioContext, chain: EffectChain, effects: AudioEffects) {
  setParam(context, chain.volume.gain, effects.volume)
  setParam(context, chain.lowpass.frequency, effects.lowpassEnabled ? effects.lowpassFrequency : context.sampleRate / 2)
  setParam(context, chain.lowpass.Q, effects.lowpassEnabled ? 0.7 : 0.0001)
  setParam(context, chain.dry.gain, effects.reverbEnabled ? 1 - effects.reverbMix : 1)
  setParam(context, chain.wet.gain, effects.reverbEnabled ? effects.reverbMix : 0)
}

export function connectEffects(
  context: BaseAudioContext,
  source: AudioNode,
  destination: AudioNode,
  effects: AudioEffects,
) {
  const volume = context.createGain()
  const lowpass = context.createBiquadFilter()
  const dry = context.createGain()
  const wet = context.createGain()
  const convolver = context.createConvolver()

  lowpass.type = 'lowpass'
  convolver.buffer = createReverbImpulse(context)

  source.connect(volume)
  volume.connect(lowpass)
  lowpass.connect(dry)
  lowpass.connect(convolver)
  convolver.connect(wet)
  dry.connect(destination)
  wet.connect(destination)

  const chain = { volume, lowpass, dry, wet, convolver }
  applyEffects(context, chain, effects)
  return chain
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
