/**
 * NestJS 依赖注册表：Controller 接收 HTTP，Service 编排业务，Store 提供数据库连接。
 * 业务依赖通过注入传递，不在控制器里直接 new 数据库或引擎。
 */
import { Module } from '@nestjs/common';
import { BpmController } from './bpm.controller';
import { BpmService } from './bpm.service';
import { Store } from './store';

@Module({ controllers: [BpmController], providers: [Store, BpmService] })
export class AppModule {}
