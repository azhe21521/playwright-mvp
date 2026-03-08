/**
 * Token 验证服务
 */
import { createLogger } from '@playwright-mvp/shared';
import { config } from '../config.js';

const logger = createLogger('AuthService', config.logLevel);

/** 验证结果 */
export interface AuthValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * 验证 Token
 * @param token 客户端提供的 Token
 * @returns 验证结果
 */
export function validateToken(token: string): AuthValidationResult {
  // 如果服务端没有配置 Token，接受所有连接（开发模式）
  if (!config.authToken) {
    logger.warn('服务端未配置 Token，接受所有连接');
    return { valid: true, message: '开发模式：无 Token 验证' };
  }
  
  // Token 为空
  if (!token) {
    logger.warn('客户端未提供 Token');
    return { valid: false, message: 'Token 不能为空' };
  }
  
  // Token 长度校验
  if (token.length < 8) {
    logger.warn('Token 长度过短');
    return { valid: false, message: 'Token 长度必须至少 8 个字符' };
  }
  
  // Token 匹配校验（使用时序安全的比较方式）
  const isValid = timingSafeEqual(token, config.authToken);
  
  if (!isValid) {
    logger.warn('Token 验证失败');
    return { valid: false, message: 'Token 无效' };
  }
  
  logger.debug('Token 验证成功');
  return { valid: true };
}

/**
 * 时序安全的字符串比较
 * 防止时序攻击
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * 生成随机 Token（用于测试）
 */
export function generateToken(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
