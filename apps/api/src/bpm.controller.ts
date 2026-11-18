/**
 * HTTP 边界：解析路径、演示身份和 JSON 请求，调用共享 Zod schema 后交给应用服务。
 * 控制器不实现流程算法、不直接访问 SQL；这样接口层与业务层可以独立学习。
 * x-user-id 只用于本地演示身份切换，不能当作生产环境认证。
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { actionSchema, createSchema, saveSchema, startSchema, users, z } from '@bpm/core';
import { BpmService } from './bpm.service';

// Demo identities are intentionally explicit; this is not an authentication mechanism.
function actor(value: string | undefined) {
  if (!value || !users.some((u) => u.id === value))
    throw new UnauthorizedException('请选择有效的演示用户');
  return value;
}
@Controller('api')
export class BpmController {
  constructor(@Inject(BpmService) private readonly bpm: BpmService) {}
  @Get('health') health() {
    return { ok: true, storage: 'postgresql' };
  }
  @Get('dashboard') dashboard(@Headers('x-user-id') user?: string) {
    actor(user);
    return this.bpm.dashboard();
  }
  @Get('workflows/:id') workflow(@Param('id') id: string, @Headers('x-user-id') user?: string) {
    actor(user);
    return this.bpm.workflow(id);
  }
  @Post('workflows') create(@Body() body: unknown, @Headers('x-user-id') user?: string) {
    actor(user);
    const input = createSchema.parse(body);
    return this.bpm.create(input.name, input.template);
  }
  @Patch('workflows/:id') save(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-user-id') user?: string,
  ) {
    actor(user);
    const input = saveSchema.parse(body);
    return this.bpm.save(id, input.revision, input.definition);
  }
  @Post('workflows/:id/publish') publish(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-user-id') user?: string,
  ) {
    actor(user);
    return this.bpm.publish(
      id,
      z.object({ revision: z.number().int().min(1) }).parse(body).revision,
    );
  }
  @Patch('workflows/:id/enabled') enabled(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-user-id') user?: string,
  ) {
    actor(user);
    const input = z.object({ revision: z.number().int().min(1), enabled: z.boolean() }).parse(body);
    return this.bpm.setEnabled(id, input.revision, input.enabled);
  }
  @Post('workflows/:id/instances') start(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-user-id') user?: string,
  ) {
    const userId = actor(user);
    const input = startSchema.parse(body);
    return this.bpm.start(id, userId, input.title, input.data);
  }
  @Get('instances/:id') instance(@Param('id') id: string, @Headers('x-user-id') user?: string) {
    actor(user);
    return this.bpm.instance(id);
  }
  @Post('tasks/:id/actions') act(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-user-id') user?: string,
  ) {
    const userId = actor(user);
    const input = actionSchema.parse(body);
    return this.bpm.act(id, userId, input.action, input.comment, input.data);
  }
}
