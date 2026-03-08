/**
 * Chrome Storage 封装
 * 用于读写扩展配置
 */
import { DEFAULT_EXTENSION_CONFIG, type ExtensionConfig } from '@playwright-mvp/shared';
import type { StoredConfig } from '../types/index.js';

/** 存储 Key */
const STORAGE_KEY = 'playwright_mvp_config';

/**
 * 获取配置
 */
export async function getConfig(): Promise<ExtensionConfig> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const stored = result[STORAGE_KEY] as StoredConfig | undefined;
      if (stored) {
        resolve({
          ...DEFAULT_EXTENSION_CONFIG,
          ...stored,
        });
      } else {
        resolve(DEFAULT_EXTENSION_CONFIG);
      }
    });
  });
}

/**
 * 保存配置
 */
export async function saveConfig(config: Partial<ExtensionConfig>): Promise<void> {
  const current = await getConfig();
  const updated: StoredConfig = {
    ...current,
    ...config,
    lastUsed: Date.now(),
  };
  
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: updated }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * 获取特定配置项
 */
export async function getConfigValue<K extends keyof ExtensionConfig>(
  key: K
): Promise<ExtensionConfig[K]> {
  const config = await getConfig();
  return config[key];
}

/**
 * 设置特定配置项
 */
export async function setConfigValue<K extends keyof ExtensionConfig>(
  key: K,
  value: ExtensionConfig[K]
): Promise<void> {
  await saveConfig({ [key]: value });
}

/**
 * 重置配置为默认值
 */
export async function resetConfig(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove([STORAGE_KEY], () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * 监听配置变化
 */
export function onConfigChange(
  callback: (oldConfig: ExtensionConfig, newConfig: ExtensionConfig) => void
): void {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes[STORAGE_KEY]) {
      const oldConfig = {
        ...DEFAULT_EXTENSION_CONFIG,
        ...(changes[STORAGE_KEY].oldValue as StoredConfig | undefined),
      };
      const newConfig = {
        ...DEFAULT_EXTENSION_CONFIG,
        ...(changes[STORAGE_KEY].newValue as StoredConfig | undefined),
      };
      callback(oldConfig, newConfig);
    }
  });
}
