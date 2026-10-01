import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { CursorUsageService } from '../cursor-quota/cursor-usage.service';
import { UsageCheckController } from './usage-check.controller';
import { UsageCheckService } from './usage-check.service';

@Module({
  controllers: [UsageCheckController],
  providers: [CursorUsageService, UsageCheckService],
})
export class UsageCheckModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Middleware runs before guards and validation, covering error responses too.
    consumer
      .apply((_req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
      })
      .forRoutes(UsageCheckController);
  }
}
