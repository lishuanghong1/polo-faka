import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) throw new BadRequestException('用户名已被占用');
    if (dto.email) {
      const e = await this.prisma.user.findUnique({ where: { email: dto.email } });
      // 不暴露邮箱占用，避免邮箱枚举攻击；统一提示
      if (e) throw new BadRequestException('该邮箱无法用于注册');
    }
    const hash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        password: hash,
        email: dto.email,
        nickname: dto.nickname || dto.username,
      },
    });
    return this.issue(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: dto.username }] },
    });
    if (!user) throw new UnauthorizedException('账号或密码错误');
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('账号已被禁用');
    const ok = await argon2.verify(user.password, dto.password);
    if (!ok) throw new UnauthorizedException('账号或密码错误');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });
    return this.issue(user);
  }

  async profile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        nickname: true,
        avatar: true,
        balance: true,
        role: true,
        createdAt: true,
        lastLogin: true,
      },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  private issue(user: { id: number; username: string; role: string }) {
    const token = this.jwt.sign({
      sub: user.id,
      username: user.username,
      role: user.role,
    });
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };
  }
}
