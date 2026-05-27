import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  /**
   * 每次请求都校验数据库里的最新用户状态/角色。
   * - 用户已删除 / 被封禁 → 立即拒绝
   * - 角色变化 → 用数据库里的为准，避免 ADMIN 被降级后旧 token 仍享有管理员权限
   */
  async validate(payload: JwtPayload) {
    const id = Number((payload as any)?.sub);
    if (!id) throw new UnauthorizedException('无效 token');
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, role: true, status: true },
    });
    if (!user) throw new UnauthorizedException('用户不存在');
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('账号已被禁用');
    return { ...payload, role: user.role, username: user.username };
  }
}
