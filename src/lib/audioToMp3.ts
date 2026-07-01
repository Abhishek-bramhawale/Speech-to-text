// lamejs expects MPEGMode on global scope in bundled builds
import lamejs from 'lamejs'

function floatTo16BitPCM(float32: Float32Array): Int16Array {
  const pcm = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32[i]))
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return pcm
}

function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  const { length, numberOfChannels } = audioBuffer
  if (numberOfChannels === 1) {
    return audioBuffer.getChannelData(0)
  }

  const mixed = new Float32Array(length)
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelData = audioBuffer.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      mixed[i] += channelData[i] / numberOfChannels
    }
  }
  return mixed
}

export async function blobToMp3(audioBlob: Blob): Promise<Blob> {
  const arrayBuffer = await audioBlob.arrayBuffer()
  const audioContext = new AudioContext()

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    const mono = mixToMono(audioBuffer)
    const pcm = floatTo16BitPCM(mono)
    const sampleRate = audioBuffer.sampleRate

    const mp3encoder = new lamejs.Mp3Encoder(1, sampleRate, 128)
    const mp3Chunks: Int8Array[] = []
    const blockSize = 1152

    for (let i = 0; i < pcm.length; i += blockSize) {
      const chunk = pcm.subarray(i, i + blockSize)
      const encoded = mp3encoder.encodeBuffer(chunk)
      if (encoded.length > 0) {
        mp3Chunks.push(encoded)
      }
    }

    const flushed = mp3encoder.flush()
    if (flushed.length > 0) {
      mp3Chunks.push(flushed)
    }

    return new Blob(mp3Chunks as BlobPart[], { type: 'audio/mpeg' })
  } finally {
    await audioContext.close()
  }
}
