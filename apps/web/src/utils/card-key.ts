const EXTRA_LOGIN_LINE = 'https://youxiang.buyudazuozhan.com/         验证码登录';

/** 客户侧展示/复制卡密时附加邮箱验证码登录入口，保留为单独一行。 */
export function formatCardKeyContent(content: string) {
  return `${content}\n${EXTRA_LOGIN_LINE}`;
}

export function formatCardKeysForCopy(items: Array<{ content: string }>) {
  return items.map((item) => formatCardKeyContent(item.content)).join('\n\n');
}
