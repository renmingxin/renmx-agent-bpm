/**
 * 助手 HTTP 边界：五种只读/生成能力与制度导入；身份仍是本地演示用户。
 * 制度管理只向部门负责人/财务负责人开放；分析实例时服务端再校验参与人。
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { assistantInputSchema, policyInputSchema, users, z } from '@bpm/core';
import { AssistantService } from './assistant.service';

function actor(value?: string) {
  if (!value || !users.some((user) => user.id === value))
    throw new UnauthorizedException('请选择有效演示用户');
  return value;
}
function editor(value?: string) {
  const user = actor(value);
  if (user !== 'u-chen' && user !== 'u-wang')
    throw new ForbiddenException('仅部门负责人或财务负责人可管理制度');
  return user;
}
@Controller('api/assistant')
export class AssistantController {
  constructor(@Inject(AssistantService) private readonly assistant: AssistantService) {}
  @Get('config') config(@Headers('x-user-id') user?: string) {
    actor(user);
    return this.assistant.model.config();
  }
  @Get('models/:provider') models(
    @Param('provider') provider: string,
    @Headers('x-user-id') user?: string,
  ) {
    actor(user);
    return this.assistant.model.listModels(z.enum(['ollama', 'openai']).parse(provider));
  }
  @Post('run') run(@Body() body: unknown, @Headers('x-user-id') user?: string) {
    return this.assistant.run(assistantInputSchema.parse(body), actor(user));
  }
  @Get('policies') policies(@Headers('x-user-id') user?: string) {
    actor(user);
    return this.assistant.policies.list();
  }
  @Post('policies') import(@Body() body: unknown, @Headers('x-user-id') user?: string) {
    const userId = editor(user);
    return this.assistant.policies.import(policyInputSchema.parse(body), userId);
  }
  @Patch('policies/:id') enabled(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-user-id') user?: string,
  ) {
    editor(user);
    return this.assistant.policies.setEnabled(
      id,
      z.object({ enabled: z.boolean() }).parse(body).enabled,
    );
  }
}
