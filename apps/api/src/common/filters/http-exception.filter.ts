import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let isUnhandled = false;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      if (typeof r === 'string') message = r;
      else if (typeof r === 'object' && r !== null) {
        const anyR = r as Record<string, any>;
        message = anyR.message ?? anyR.error ?? 'Error';
      }
    } else if (exception instanceof Error) {
      isUnhandled = true;
      // 全程记录原始 message + stack 到服务端日志，但不返给客户端
      this.logger.error(
        `[unhandled] ${req.method} ${req.originalUrl} → ${exception.message}`,
        exception.stack,
      );
      // 生产模式：仅返通用提示，避免泄漏 Prisma 字段名 / SQL / 内部路径等
      message =
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : exception.message;
    }

    const errMsg = Array.isArray(message) ? message.join('; ') : message;

    res.status(status).json({
      success: false,
      error: errMsg,
      data: null,
      // 仅在非 HttpException 兜底分支返回简短 trace id，便于排查
      ...(isUnhandled ? { traceId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` } : {}),
    });
  }
}
