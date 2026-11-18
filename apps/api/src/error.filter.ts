/**
 * 统一异常输出：Zod → 400，Nest 业务异常 → 对应 4xx，未知错误 → 500。
 * 只在服务端记录未知错误，避免把数据库细节直接暴露给页面。
 */
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { z } from '@bpm/core';

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (error instanceof z.ZodError) {
      response
        .status(400)
        .json({ message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；') });
      return;
    }
    if (error instanceof HttpException) {
      const body = error.getResponse();
      response.status(error.getStatus()).json(typeof body === 'string' ? { message: body } : body);
      return;
    }
    console.error(error);
    response.status(500).json({ message: '服务处理失败，请稍后重试' });
  }
}
