/**
 * 统一日志工具
 * 支持日志级别、前缀、格式化输出和文件日志
 * 
 * 参考 playwright-view 的日志系统，添加了：
 * - TRACE 级别用于高频事件
 * - 文件日志支持
 * - 更详细的格式化
 * 
 * 日志级别（从最详细到最简略）：
 *   TRACE → DEBUG → INFO → WARN → ERROR
 * 
 * 环境变量控制：
 *   LOG_LEVEL=trace|debug|info|warn|error  (默认: info)
 *   LOG_TO_FILE=1  (启用文件日志)
 *   LOG_DIR=<path>  (日志文件目录)
 */

import type { LogLevel, LogConfig } from '../types/index.js';

/** 日志级别优先级 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

/** 日志级别对应的控制台方法 */
const LOG_METHODS: Record<LogLevel, 'log' | 'info' | 'warn' | 'error'> = {
  trace: 'log',
  debug: 'log',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

/** 日志级别对应的颜色（终端） */
const LOG_COLORS: Record<LogLevel, string> = {
  trace: '\x1b[90m', // gray
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
};

const RESET_COLOR = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

/** 文件系统引用（仅在 Node.js 环境可用） */
let fs: typeof import('fs') | null = null;
let path: typeof import('path') | null = null;

/** 日志目录 */
let logsDir: string | null = null;

/**
 * 初始化文件日志（仅在 Node.js 环境）
 */
async function initFileLogging(): Promise<void> {
  if (typeof process === 'undefined' || !process.versions?.node) {
    return;
  }
  
  try {
    fs = await import('fs');
    path = await import('path');
    
    // 获取日志目录
    const envLogDir = process.env.LOG_DIR;
    if (envLogDir) {
      logsDir = envLogDir;
    } else {
      // 默认日志目录：当前工作目录下的 logs 文件夹
      logsDir = path.join(process.cwd(), 'logs');
    }
    
    // 创建日志目录
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (e) {
    // 忽略错误，继续使用控制台日志
  }
}

// 在 Node.js 环境中初始化
if (typeof process !== 'undefined' && process.versions?.node) {
  initFileLogging();
}

/**
 * 获取当前日志文件路径
 */
function getLogFilePath(prefix: string): string | null {
  if (!logsDir || !path) return null;
  const date = new Date().toISOString().slice(0, 10);
  const safePrefix = prefix.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
  return path.join(logsDir, `${safePrefix}-${date}.log`);
}

/**
 * 写入日志到文件
 */
function writeToFile(filePath: string, line: string): void {
  if (!fs) return;
  try {
    fs.appendFileSync(filePath, line + '\n');
  } catch (e) {
    // 静默忽略文件写入错误
  }
}

/**
 * 日志记录器类
 */
export class Logger {
  private config: LogConfig & { enableFileLog?: boolean };
  private isNode: boolean;
  private logFilePath: string | null = null;
  
  constructor(config: Partial<LogConfig & { enableFileLog?: boolean }> = {}) {
    this.config = {
      level: config.level ?? this.getEnvLogLevel(),
      prefix: config.prefix ?? 'App',
      enableFileLog: config.enableFileLog ?? this.getEnvFileLogEnabled(),
    };
    // 检测是否在 Node.js 环境
    this.isNode = typeof process !== 'undefined' && process.versions?.node !== undefined;
    
    // 初始化文件日志路径
    if (this.config.enableFileLog && this.isNode) {
      this.logFilePath = getLogFilePath(this.config.prefix);
    }
  }
  
  /**
   * 从环境变量获取日志级别
   */
  private getEnvLogLevel(): LogLevel {
    if (typeof process === 'undefined') return 'info';
    const env = process.env.LOG_LEVEL?.toLowerCase();
    if (env && env in LOG_LEVEL_PRIORITY) return env as LogLevel;
    // 向后兼容
    if (process.env.CDP_BRIDGE_DEBUG === '1' || process.env.DEBUG === '1') return 'debug';
    return 'info';
  }
  
  /**
   * 从环境变量获取是否启用文件日志
   */
  private getEnvFileLogEnabled(): boolean {
    if (typeof process === 'undefined') return false;
    return process.env.LOG_TO_FILE === '1' || process.env.LOG_TO_FILE === 'true';
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
    // 更新日志文件路径
    if (this.config.enableFileLog && this.isNode) {
      this.logFilePath = getLogFilePath(prefix);
    }
  }
  
  /**
   * 启用/禁用文件日志
   */
  setFileLogEnabled(enabled: boolean): void {
    this.config.enableFileLog = enabled;
    if (enabled && this.isNode && !this.logFilePath) {
      this.logFilePath = getLogFilePath(this.config.prefix);
    }
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
   * 格式化参数为字符串
   */
  private formatArgs(args: unknown[]): string {
    return args.map(arg => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg, null, 0);
      } catch {
        return String(arg);
      }
    }).join(' ');
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
    const argsStr = args.length > 0 ? ' ' + this.formatArgs(args) : '';
    
    // 写入文件日志
    if (this.config.enableFileLog && this.logFilePath) {
      const fileLine = `[${timestamp}] [${levelTag}] [${prefix}] ${message}${argsStr}`;
      writeToFile(this.logFilePath, fileLine);
    }
    
    // 控制台输出
    if (this.isNode) {
      // Node.js 环境，使用颜色
      const color = LOG_COLORS[level];
      const levelColor = level === 'error' ? `${BOLD}${color}` : color;
      const formattedMessage = `${levelColor}[${timestamp}] [${levelTag}] [${prefix}]${RESET_COLOR} ${message}`;
      console[LOG_METHODS[level]](formattedMessage, ...args);
    } else {
      // 浏览器环境
      const formattedMessage = `[${timestamp}] [${levelTag}] [${prefix}] ${message}`;
      console[LOG_METHODS[level]](formattedMessage, ...args);
    }
  }
  
  /**
   * 跟踪日志（高频事件，如 CDP 事件转发）
   */
  trace(message: string, ...args: unknown[]): void {
    this.log('trace', message, ...args);
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
   * 分隔线日志（用于标记重要节点）
   */
  separator(title?: string): void {
    if (!this.shouldLog('info')) return;
    
    const line = '─'.repeat(50);
    if (title) {
      this.info(`${line} ${title} ${line}`);
    } else {
      this.info(line);
    }
  }
  
  /**
   * 方向箭头日志（用于表示消息流向）
   */
  arrow(direction: 'in' | 'out', target: string, message: string, ...args: unknown[]): void {
    const arrow = direction === 'in' ? '←' : '→';
    this.debug(`${arrow} ${target}: ${message}`, ...args);
  }
  
  /**
   * 创建子日志记录器
   */
  child(childPrefix: string): Logger {
    return new Logger({
      level: this.config.level,
      prefix: `${this.config.prefix}:${childPrefix}`,
      enableFileLog: this.config.enableFileLog,
    });
  }
}

/** 默认日志记录器实例 */
export const logger = new Logger({ prefix: 'PlaywrightMVP' });

/**
 * 创建模块专属日志记录器
 */
export function createLogger(prefix: string, level?: LogLevel, enableFileLog?: boolean): Logger {
  return new Logger({ 
    prefix, 
    level: level ?? 'info',
    enableFileLog: enableFileLog ?? false,
  });
}
