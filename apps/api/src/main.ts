/**
 * NestJS 进程入口。
 * 加载根目录 .env → 创建模块容器 → 注册统一异常响应 → 监听本地端口。
 * createApp 单独导出供 HTTP 集成测试复用；导入本文件不会自动启动监听。
 */
import 'reflect-metadata';
import type { NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { AppModule } from './app.module';
import { ErrorFilter } from './error.filter';
import type { NestExpressApplication } from '@nestjs/platform-express';

for (const path of [resolve(process.cwd(), '../../.env'), resolve(process.cwd(), '.env')])
  if (existsSync(path)) loadEnvFile(path);

export async function createApp(options: NestApplicationOptions = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    ...options,
  });
  // 4MB 文件以 base64 上传会膨胀约 1/3；保持有界 JSON 体积，不开放任意大请求。
  app.useBodyParser('json', { limit: '8mb' });
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
async function main() {
  const app = await createApp();
  const port = Number(process.env.API_PORT || 4000);
  await app.listen(port, '127.0.0.1');
  console.log(`BPM API ready at http://127.0.0.1:${port}/api/health`);
}
if (require.main === module) void main();
