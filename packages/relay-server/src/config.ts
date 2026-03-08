/**
 * 服务配置
 * 从环境变量加载配置
 */
import { config as dotenvConfig } from 'dotenv';
import type { LogLevel } from '@playwright-mvp/shared';

// 加载 .env 文件
dotenvConfig();

/** 服务配置接口 */
export interface ServerConfig {
  /** 服务端口 */
  port: number;
  /** 监听地址 */
  host: string;
  /** 身份验证 Token */
  authToken: string;
  /** 日志级别 */
  logLevel: LogLevel;
  /** 心跳间隔（毫秒） */
  heartbeatInterval: number;
  /** 连接超时（毫秒） */
  connectionTimeout: number;
  /** 服务版本 */
  version: string;
}

/**
 * 获取环境变量，支持默认值
 */
function getEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

/**
 * 获取数字类型环境变量
 */
function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * 验证日志级别
 */
function validateLogLevel(level: string): LogLevel {
  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  return validLevels.includes(level as LogLevel) ? (level as LogLevel) : 'info';
}

/** 服务配置实例 */
export const config: ServerConfig = {
  port: getEnvNumber('RELAY_SERVER_PORT', 9230),
  host: getEnv('RELAY_SERVER_HOST', '0.0.0.0'),
  authToken: getEnv('RELAY_AUTH_TOKEN', ''),
  logLevel: validateLogLevel(getEnv('LOG_LEVEL', 'info')),
  heartbeatInterval: getEnvNumber('HEARTBEAT_INTERVAL', 30000),
  connectionTimeout: getEnvNumber('CONNECTION_TIMEOUT', 60000),
  version: '1.0.0',
};

/**
 * 验证配置
 */
export function validateConfig(): string[] {
  const errors: string[] = [];
  
  if (config.port < 1 || config.port > 65535) {
    errors.push(`无效的端口号: ${config.port}`);
  }
  
  if (!config.authToken) {
    errors.push('警告: RELAY_AUTH_TOKEN 未设置，任何客户端都可以连接');
  }
  
  if (config.heartbeatInterval < 5000) {
    errors.push(`心跳间隔过短: ${config.heartbeatInterval}ms（最小 5000ms）`);
  }
  
  return errors;
}
