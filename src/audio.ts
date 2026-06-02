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

export function createClippedWav(buffer: AudioBuffer, start: number, end: number) {
  const startFrame = Math.max(0, Math.floor(start * buffer.sampleRate))
  const endFrame = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate))
  const frameCount = Math.max(0, endFrame - startFrame)
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
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame]))
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true)
      offset += bytesPerSample
    }
  }

  return new Blob([wav], { type: 'audio/wav' })
}
