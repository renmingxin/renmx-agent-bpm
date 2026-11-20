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

/** 验证本地演示用户。这里只识别已有演示 ID，不提供生产登录或可信会话认证。 */
function actor(value?: string) {
  if (!value || !users.some((user) => user.id === value))
    throw new UnauthorizedException('请选择有效演示用户');
  return value;
}
/** 制度写操作的额外角色门禁；普通申请人仍可以查询适用制度。 */
function editor(value?: string) {
  const user = actor(value);
  if (user !== 'u-chen' && user !== 'u-wang')
    throw new ForbiddenException('仅部门负责人或财务负责人可管理制度');
  return user;
}
@Controller('api/assistant')
export class AssistantController {
  /** Controller 只处理 HTTP 与输入边界，模型/检索/报告保存统一交给应用服务。 */
  constructor(@Inject(AssistantService) private readonly assistant: AssistantService) {}
  /** 读取不含密钥的配置；不会在此连接模型或自动拉取模型。 */
  @Get('config') config(@Headers('x-user-id') user?: string) {
    actor(user);
    return this.assistant.model.config();
  }
  /** provider 路径参数也必须校验，不能直接作为任意服务 URL 使用。 */
  @Get('models/:provider') models(
    @Param('provider') provider: string,
    @Headers('x-user-id') user?: string,
  ) {
    actor(user);
    return this.assistant.model.listModels(z.enum(['ollama', 'openai']).parse(provider));
  }
  /** 五项能力共用入口；schema 检查结构，Service 再检查申请参与人及当前处理权限。 */
  @Post('run') run(@Body() body: unknown, @Headers('x-user-id') user?: string) {
    return this.assistant.run(assistantInputSchema.parse(body), actor(user));
  }
  /** 制度列表返回元信息，不把整份正文和向量作为列表响应发送。 */
  @Get('policies') policies(@Headers('x-user-id') user?: string) {
    actor(user);
    return this.assistant.policies.list();
  }
  /** 导入先检查管理角色，再校验上传结构；解码、解析、索引成功后才保存文档。 */
  @Post('policies') import(@Body() body: unknown, @Headers('x-user-id') user?: string) {
    const userId = editor(user);
    return this.assistant.policies.import(policyInputSchema.parse(body), userId);
  }
  /** 启停只改检索可见性，保留原制度版本，可通过相同入口恢复启用。 */
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
