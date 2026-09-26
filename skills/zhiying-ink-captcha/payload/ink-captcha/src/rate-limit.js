/**
 * 极简内存限流器 —— 零依赖，适用于单进程部署。
 *
 * 【适用范围】单实例（PM2 fork 模式 / 单台服务器 / 单容器）。
 *   多实例部署时各进程的计数互相独立，实际放行量 = 单实例限制 × 实例数。
 *
 * 【多实例怎么办】两种方案，都不改调用方代码：
 *   1. 生产环境前面加 nginx 的 limit_req（推荐，成本最低）
 *   2. 换成 Redis 实现：把 incr()/reset() 两个方法换成 Redis 的 INCR + EXPIRE
 *      即可，接口签名保持一致。
 */

/**
 * 创建一个限流器。
 *
 * @param {object} [opts]
 * @param {number} [opts.maxKeys=20000] 最多追踪多少个 key，超了整体清空（防内存泄漏）
 * @returns {{check:(key:string,limit:number,windowMs:number)=>{allowed:boolean,remaining:number,retryAfterMs:number}}}
 */
export function createRateLimiter(opts = {}) {
  const maxKeys = opts.maxKeys ?? 20000;
  /** key → { count, resetAt } */
  const buckets = new Map();

  function check(key, limit, windowMs) {
    const now = Date.now();
    let b = buckets.get(key);

    if (!b || now >= b.resetAt) {
      // 新窗口
      if (buckets.size >= maxKeys) buckets.clear();
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }

    b.count += 1;

    if (b.count > limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, b.resetAt - now),
      };
    }

    return {
      allowed: true,
      remaining: limit - b.count,
      retryAfterMs: 0,
    };
  }

  return { check, _size: () => buckets.size };
}

/**
 * 从请求中提取客户端 IP。
 * 兼容各种反代配置；取不到时返回 "unknown"（此时所有未知来源共享一个桶）。
 *
 * 【安全提醒】只有当你的应用**确实部署在可信反向代理之后**时，
 * 信任 x-forwarded-for 才是安全的。裸奔在公网时，客户端可以伪造该头，
 * 从而绕过 IP 限流（但绕不过「单挑战尝试次数上限」这道关）。
 *
 * @param {import('node:http').IncomingMessage|Request|object} req
 * @returns {string}
 */
export function getClientIp(req) {
  if (!req) return "unknown";

  // 兼容 Web 标准 Request（Next.js / Deno / Bun）与 Node IncomingMessage
  const headers =
    typeof req.headers?.get === "function"
      ? {
          get: (n) => req.headers.get(n),
        }
      : req.headers || {};

  const read = (name) => {
    const v = typeof headers.get === "function" ? headers.get(name) : headers[name];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : "";
  };

  const xff = read("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();

  return (
    read("x-real-ip") ||
    read("cf-connecting-ip") ||
    read("x-client-ip") ||
    // Node 原生
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    "unknown"
  );
}

export default createRateLimiter;
