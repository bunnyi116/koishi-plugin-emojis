import { EmojiData, EmojiMetadata } from './types'

let emojiMetadata: EmojiMetadata

export function setEmojiMetadata(metadata: EmojiMetadata) {
  emojiMetadata = metadata
}

export function getEmojiCodepoint(emoji: string): string {
  const codePoints = []
  for (let i = 0; i < emoji.length; i++) {
    const code = emoji.codePointAt(i)
    codePoints.push(code.toString(16))
    if (code > 0xffff) i++
  }
  return codePoints.join('-').toLowerCase()
}

export function getEmojiData(emojiCodepoint: string): EmojiData {
  if (!emojiMetadata) throw new Error('元数据未加载')
  return emojiMetadata.data[emojiCodepoint]
}

export function getSupportedEmoji(): string[] {
  if (!emojiMetadata) throw new Error('元数据未加载')
  return emojiMetadata.knownSupportedEmoji
}

// 保持原有工具函数
export function toPrintableEmoji(emojiCodepoint: string): string {
  return String.fromCodePoint(
    ...emojiCodepoint.split('-').map(p => parseInt(p, 16))
  )
}