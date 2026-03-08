/**
 * 白名单拦截模块
 * 使用 chrome.webRequest API 拦截不在白名单内的请求
 */
import { isUrlWhitelisted } from '@playwright-mvp/shared';
import { getConfig } from '../storage/config-storage.js';

/** 当前白名单缓存 */
let whitelistCache: string[] = [];

/**
 * 初始化白名单拦截
 */
export async function initWhitelistInterceptor(): Promise<void> {
  // 加载初始白名单
  const config = await getConfig();
  whitelistCache = config.whitelist;
  
  console.log('[Whitelist] 初始化白名单拦截器', whitelistCache);
}

/**
 * 更新白名单缓存
 */
export function updateWhitelist(whitelist: string[]): void {
  whitelistCache = whitelist;
  console.log('[Whitelist] 更新白名单', whitelistCache);
}

/**
 * 检查 URL 是否被允许
 * @param url 要检查的 URL
 * @returns 是否允许访问
 */
export function isUrlAllowed(url: string): boolean {
  // 空白名单表示允许所有
  if (whitelistCache.length === 0) {
    return true;
  }
  
  return isUrlWhitelisted(url, whitelistCache);
}

/**
 * 检查导航目标是否被允许
 * 在执行 CDP 导航命令前调用
 */
export function checkNavigationAllowed(url: string): { allowed: boolean; reason?: string } {
  if (isUrlAllowed(url)) {
    return { allowed: true };
  }
  
  return {
    allowed: false,
    reason: `URL 不在白名单内: ${url}`,
  };
}

/**
 * 获取当前白名单
 */
export function getWhitelist(): string[] {
  return [...whitelistCache];
}
