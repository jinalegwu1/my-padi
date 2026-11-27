/** Leave the formatted reply intact in chat; speak its readable words. */
function spokenText(text) {
  return text.replace(/```[^\n]*\n[\s\S]*?```/g, 'Code is available in the chat transcript.').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, '').replace(/(?:\*\*|__|~~|`)/g, '').replace(/\*([^*\n]+)\*/g, '$1').replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1').replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D\u20E3]/gu, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { spokenText };
