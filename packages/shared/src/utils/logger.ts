/**
 * 统一日志工具
 * 支持日志级别、前缀和格式化输出
 */

import type { LogLevel, LogConfig } from '../types/index.js';

/** 日志级别优先级 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** 日志级别对应的控制台方法 */
const LOG_METHODS: Record<LogLevel, 'log' | 'info' | 'warn' | 'error'> = {
  debug: 'log',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

/** 日志级别对应的颜色（终端） */
const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
};

const RESET_COLOR = '\x1b[0m';

/**
 * 日志记录器类
 */
export class Logger {
  private config: LogConfig;
  private isNode: boolean;
  
  constructor(config: Partial<LogConfig> = {}) {
    this.config = {
      level: config.level ?? 'info',
      prefix: config.prefix ?? 'App',
    };
    // 检测是否在 Node.js 环境
    this.isNode = typeof process !== 'undefined' && process.versions?.node !== undefined;
  }
  
  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }
  
  /**
   * 设置前缀
   */
  setPrefix(prefix: string): void {
    this.config.prefix = prefix;
  }
  
  /**
   * 检查是否应该输出该级别的日志
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.level];
  }
  
  /**
   * 格式化时间戳
   */
  private formatTimestamp(): string {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substring(0, 23);
  }
  
  /**
   * 输出日志
   */
  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.shouldLog(level)) {
      return;
    }
    
    const timestamp = this.formatTimestamp();
    const levelTag = level.toUpperCase().padEnd(5);
    const prefix = this.config.prefix;
    
    if (this.isNode) {
      // Node.js 环境，使用颜色
      const color = LOG_COLORS[level];
      const formattedMessage = `${color}[${timestamp}] [${levelTag}] [${prefix}]${RESET_COLOR} ${message}`;
      console[LOG_METHODS[level]](formattedMessage, ...args);
    } else {
      // 浏览器环境
      const formattedMessage = `[${timestamp}] [${levelTag}] [${prefix}] ${message}`;
      console[LOG_METHODS[level]](formattedMessage, ...args);
    }
  }
  
  /**
   * 调试日志
   */
  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args);
  }
  
  /**
   * 信息日志
   */
  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args);
  }
  
  /**
   * 警告日志
   */
  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args);
  }
  
  /**
   * 错误日志
   */
  error(message: string, ...args: unknown[]): void {
    this.log('error', message, ...args);
  }
  
  /**
   * 创建子日志记录器
   */
  child(childPrefix: string): Logger {
    return new Logger({
      level: this.config.level,
      prefix: `${this.config.prefix}:${childPrefix}`,
    });
  }
}

/** 默认日志记录器实例 */
export const logger = new Logger({ prefix: 'PlaywrightMVP' });

/**
 * 创建模块专属日志记录器
 */
export function createLogger(prefix: string, level?: LogLevel): Logger {
  return new Logger({ prefix, level: level ?? 'info' });
}
