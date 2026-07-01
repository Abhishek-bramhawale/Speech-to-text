export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function formatRecordingFilename(createdAt: number, extension: string) {
  const stamp = new Date(createdAt).toISOString().replace(/[:.]/g, '-')
  return `recording-${stamp}.${extension}`
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
}
