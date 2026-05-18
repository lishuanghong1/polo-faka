import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  list(includeHidden = false) {
    return this.prisma.category.findMany({
      where: includeHidden ? {} : { visible: true },
      orderBy: [{ sort: 'desc' }, { id: 'asc' }],
    });
  }

  async detail(idOrSlug: string) {
    const id = Number(idOrSlug);
    const where = Number.isFinite(id) ? { id } : { slug: idOrSlug };
    const c = await this.prisma.category.findFirst({ where });
    if (!c) throw new NotFoundException('分类不存在');
    return c;
  }

  create(data: {
    name: string;
    slug: string;
    icon?: string;
    sort?: number;
    visible?: boolean;
  }) {
    return this.prisma.category.create({ data });
  }

  update(
    id: number,
    data: Partial<{ name: string; slug: string; icon: string; sort: number; visible: boolean }>,
  ) {
    return this.prisma.category.update({ where: { id }, data });
  }

  remove(id: number) {
    return this.prisma.category.delete({ where: { id } });
  }
}
