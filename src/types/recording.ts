export type SavedRecording = {
  id: string
  text: string
  correctedText?: string
  languageTag: string
  languageLabel: string
  createdAt: number
  audioBlob: Blob
}
