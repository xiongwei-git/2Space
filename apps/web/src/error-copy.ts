// API error codes are stable; user-facing explanations do not expose server diagnostics.
const messages: Record<string, string> = {
  INVALID_PROTECTION: "密码设置没有完成，请重新打开后再试。",
  PROTECTION_REQUIRED: "请使用当前页面重新设置密码。",
  KEY_CHANGED: "密码或访问方式已更新，请重新打开并保留未保存的修改。",
  PASSWORD_REQUIRED: "请输入空间密码后继续。",
  PASSWORD_INCORRECT: "密码不正确，请重试。",
  MAIN_PAGE: "第一个记事本需要保留，可以清空其中的内容。",
  INVALID_ORDER: "记事本顺序未保存，请重试。",
  INVALID_INPUT: "提交的信息不完整，请检查后重试。",
  INVALID_ID: "链接不完整，请重新复制后打开。",
  INVALID_TOKEN: "链接不完整，请重新复制后打开。",
  INVALID_PAYLOAD: "内容没有保存成功，请重试；离开前可先复制备份。",
  INVALID_RETENTION: "请选择保留时间后重试。",
  INVALID_REVISION: "这篇笔记已有更新，请先选择要保留的内容。",
  NOT_FOUND: "空间不存在或已到期，请向分享者确认。",
  UNAUTHORIZED: "链接已失效，请向分享者索取新链接。",
  FORBIDDEN: "此链接仅供查看，不能修改内容。",
  READ_ONLY: "此链接仅供查看，不能修改内容。",
  NAME_TAKEN: "这个名称已被使用，请换一个或打开已有空间。",
  NAME_LOCKED: "空间名称创建后不能修改。",
  RATE_LIMITED: "操作太频繁，请稍后再试。",
  CROSS_SITE: "操作未成功，请重新打开空间后重试。",
  PAYLOAD_TOO_LARGE: "内容超出限制，请分成几篇笔记后保存。",
  INTERNAL_ERROR: "暂时无法完成操作，请稍后重试。",
  PAGE_LIMIT: "最多创建6个记事本，请先整理现有内容。",
  PAGE_EXISTS: "这篇笔记已存在，请刷新后查看。",
  PAGE_NOT_FOUND: "这篇笔记已被删除，你仍可复制此页的内容。",
  REVISION_CONFLICT: "其他设备也修改了这篇笔记，请先选择要保留的内容。",
  LAST_PAGE: "请至少保留一篇笔记。",
  STREAM_LIMIT: "打开的页面太多，请关闭一些后重试。",
};
export function userErrorMessage(code: unknown): string {
  return typeof code === "string" && Object.hasOwn(messages, code)
    ? messages[code]
    : "操作没有完成，请稍后重试。";
}
