import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) {
      // 公开路由：尝试附加用户（如果带了 token），但不强制
      return this.tryAttachUser(ctx);
    }
    return super.canActivate(ctx);
  }

  private async tryAttachUser(ctx: ExecutionContext) {
    try {
      await super.canActivate(ctx);
    } catch {
      /* ignore */
    }
    return true;
  }

  /**
   * Nest passport 的 handleRequest 默认在没有 user 时抛 401，这里加一个
   * 公开路由判断：公开时允许 user 为空（返回 null），其余必须强制登录。
   */
  handleRequest(err: any, user: any, _info: any, ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) {
      // 公开路由：有就返回，没有就 null（@CurrentUser 取到 undefined）
      return user || null;
    }
    if (err || !user) {
      throw err || new UnauthorizedException('未登录');
    }
    return user;
  }
}
