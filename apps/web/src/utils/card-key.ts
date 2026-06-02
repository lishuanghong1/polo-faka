/** 卡密展示/复制：直接输出原始内容，不做任何追加。 */
export function formatCardKeyContent(content: string) {
  return content;
}

export function formatCardKeysForCopy(items: Array<{ content: string }>) {
  return items.map((item) => item.content).join('\n\n');
}
