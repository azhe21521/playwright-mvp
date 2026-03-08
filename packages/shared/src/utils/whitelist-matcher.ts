/**
 * 白名单 URL 匹配工具
 * 支持通配符匹配，如 *.example.com, https://*.google.com/*
 */

/** 预编译的正则表达式缓存 */
const regexCache = new Map<string, RegExp>();

/**
 * 将通配符模式转换为正则表达式
 * @param pattern 通配符模式
 * @returns 正则表达式
 */
export function patternToRegex(pattern: string): RegExp {
  // 检查缓存
  const cached = regexCache.get(pattern);
  if (cached) {
    return cached;
  }
  
  // 转义特殊字符，但保留 * 作为通配符
  let regexStr = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
    .replace(/\*/g, '.*'); // 将 * 转换为 .*
  
  // 如果模式不以协议开头，添加协议匹配
  if (!pattern.startsWith('http://') && !pattern.startsWith('https://') && !pattern.startsWith('*://')) {
    regexStr = '(https?://)?' + regexStr;
  }
  
  // 创建正则表达式（忽略大小写）
  const regex = new RegExp(`^${regexStr}$`, 'i');
  
  // 缓存结果
  regexCache.set(pattern, regex);
  
  return regex;
}

/**
 * 检查 URL 是否匹配白名单中的任一规则
 * @param url 要检查的 URL
 * @param whitelist 白名单规则列表
 * @returns 是否匹配
 */
export function isUrlWhitelisted(url: string, whitelist: string[]): boolean {
  if (whitelist.length === 0) {
    // 空白名单表示不限制
    return true;
  }
  
  // 规范化 URL
  let normalizedUrl: string;
  try {
    const urlObj = new URL(url);
    // 移除末尾斜杠以便匹配
    normalizedUrl = urlObj.href.replace(/\/$/, '');
  } catch {
    // 如果 URL 无效，直接使用原始值
    normalizedUrl = url;
  }
  
  // 检查是否匹配任一规则
  return whitelist.some((pattern) => {
    const regex = patternToRegex(pattern);
    return regex.test(normalizedUrl);
  });
}

/**
 * 检查 URL 是否被白名单阻止
 * @param url 要检查的 URL
 * @param whitelist 白名单规则列表
 * @returns 是否被阻止
 */
export function isUrlBlocked(url: string, whitelist: string[]): boolean {
  return !isUrlWhitelisted(url, whitelist);
}

/**
 * 验证白名单规则格式是否有效
 * @param pattern 白名单规则
 * @returns 是否有效
 */
export function isValidWhitelistPattern(pattern: string): boolean {
  if (!pattern || pattern.trim().length === 0) {
    return false;
  }
  
  // 检查基本格式
  const trimmed = pattern.trim();
  
  // 不允许只有通配符
  if (trimmed === '*' || trimmed === '**') {
    return false;
  }
  
  // 尝试转换为正则表达式，看是否会抛出错误
  try {
    patternToRegex(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * 格式化白名单规则（去除多余空白）
 * @param pattern 白名单规则
 * @returns 格式化后的规则
 */
export function normalizeWhitelistPattern(pattern: string): string {
  return pattern.trim().toLowerCase();
}

/**
 * 清除正则表达式缓存
 */
export function clearRegexCache(): void {
  regexCache.clear();
}

/**
 * 获取缓存大小
 */
export function getRegexCacheSize(): number {
  return regexCache.size;
}
