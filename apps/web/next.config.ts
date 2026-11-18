/**
 * Next.js 配置：共享包参与编译，/api 请求由 Next 代理到 NestJS。
 * 浏览器始终请求同源路径，避免在客户端散落 API 地址和跨域配置。
 */
import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

// monorepo 的 .env 放在根目录，Next 默认只找 apps/web，需要显式补充根配置。
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

const config: NextConfig = {
  // 隐藏开发状态浮标；诊断信息仍保留在开发终端和浏览器控制台。
  devIndicators: false,
  transpilePackages: ['@bpm/core'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL || 'http://127.0.0.1:4000'}/api/:path*`,
      },
    ];
  },
};
export default config;
