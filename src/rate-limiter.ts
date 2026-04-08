/**
 * rate-limiter.ts
 *
 * 简单的内存速率限制器
 */

import * as http from 'http';

// ============================================
// 配置
// ============================================
const WINDOW_MS = 60 * 1000; // 1 分钟窗口

// ============================================
// 类型
// ============================================
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// ============================================
// 存储
// ============================================
const rateLimitStore = new Map<string, RateLimitEntry>();

// 定期清理过期条目
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  rateLimitStore.forEach((entry, key) => {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  });
}, 60 * 1000);

cleanupInterval.unref?.();

// ============================================
// 导出函数
// ============================================

/**
 * 获取客户端真实 IP
 */
export function getClientIP(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded)) {
    return forwarded[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * 检查速率限制
 * @param key 限制键（通常是 IP 或组合键）
 * @param maxRequests 窗口期内最大请求数
 * @returns 是否允许、剩余次数
 */
export function checkRateLimit(
  key: string,
  maxRequests: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    const newEntry: RateLimitEntry = {
      count: 1,
      resetAt: now + WINDOW_MS
    };
    rateLimitStore.set(key, newEntry);
    return { allowed: true, remaining: maxRequests - 1, resetAt: newEntry.resetAt };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

/**
 * 获取速率限制状态（不增加计数）
 */
export function getRateLimitStatus(key: string): { count: number; resetAt: number } | null {
  const entry = rateLimitStore.get(key);
  if (!entry || Date.now() > entry.resetAt) {
    return null;
  }
  return { count: entry.count, resetAt: entry.resetAt };
}

/**
 * 重置某个键的速率限制
 */
export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}
