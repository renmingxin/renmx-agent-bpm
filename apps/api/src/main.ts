/** 阶段 0 的最小 Nest 入口；数据库连接和业务接口在后续章节引入。 */
import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
const envPath = resolve(process.cwd(), '../../.env');
if (existsSync(envPath)) loadEnvFile(envPath);
@Controller('api')
class HealthController {
  @Get('health') health() {
    return { ok: true, stage: 'workspace' };
  }
}
@Module({ controllers: [HealthController] })
class AppModule {}
async function main() {
  const app = await NestFactory.create(AppModule);
  await app.listen(Number(process.env.API_PORT || 4000), '127.0.0.1');
}
void main();
