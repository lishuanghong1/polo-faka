import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { urlencoded, json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AdminIpAllowlistMiddleware } from './common/middleware/admin-ip-allowlist.middleware';

async function bootstrap() {
  // ── 启动前安全自检 ──
  // 生产环境绝不允许开启 MockPay（会导致 0 元购）
  if (
    process.env.NODE_ENV === 'production'
    && String(process.env.ENABLE_MOCK_PAY).toLowerCase() === 'true'
  ) {
    // 用 console 而不是 Logger，因为 Logger 还没初始化
    // eslint-disable-next-line no-console
    console.error('[FATAL] ENABLE_MOCK_PAY must NOT be true in production. Aborting.');
    process.exit(1);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const prefix = config.get<string>('API_PREFIX', '/api');
  app.setGlobalPrefix(prefix.replace(/^\//, ''));

  // 反向代理后取真实 IP（throttler 限流靠它）
  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false, // SPA 由前端控制
      crossOriginEmbedderPolicy: false,
    }),
  );

  // 支付宝异步通知是 application/x-www-form-urlencoded
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  // Admin IP 白名单 - 注册为全局中间件，中间件内部按 path 过滤
  const allowlist = app.get(AdminIpAllowlistMiddleware);
  app.use((req: any, res: any, next: any) => allowlist.use(req, res, next));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // 生产开启 forbidNonWhitelisted：DTO 不允许的字段直接 400，防止类似 role/balance 之类的属性透传
      forbidNonWhitelisted: process.env.NODE_ENV === 'production',
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  const origins = (config.get<string>('CORS_ORIGINS') || '').split(',').filter(Boolean);
  if (process.env.NODE_ENV === 'production' && !origins.length) {
    logger.warn('CORS_ORIGINS 未配置：生产环境将拒绝跨域请求，请明确指定允许的域名');
  }
  app.enableCors({
    // 生产模式没配置时收紧到同源；开发模式仍允许全开方便联调
    origin: origins.length
      ? origins
      : process.env.NODE_ENV === 'production'
        ? false
        : true,
    credentials: true,
  });

  // Swagger：仅在显式开启时挂载（默认在生产关闭，避免暴露路由结构）
  const swaggerEnabled =
    process.env.ENABLE_SWAGGER === 'true' || process.env.NODE_ENV !== 'production';
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Polo Faka API')
      .setDescription('AI 账号 / 卡密自动发货商城')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${prefix.replace(/^\//, '')}/docs`, app, doc);
  }

  const port = Number(config.get('PORT') || 4000);
  await app.listen(port);
  logger.log(`🚀 API ready at http://localhost:${port}${prefix}`);
  logger.log(`📚 Swagger at  http://localhost:${port}${prefix}/docs`);
}

bootstrap();
