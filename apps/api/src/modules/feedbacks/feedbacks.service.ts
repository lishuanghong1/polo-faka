import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FeedbacksService {
  constructor(private prisma: PrismaService) {}

  submit(data: { type?: string; content: string; contact?: string }) {
    return this.prisma.feedback.create({ data });
  }

  list(page = 1, pageSize = 30) {
    return this.prisma.$transaction([
      this.prisma.feedback.count(),
      this.prisma.feedback.findMany({
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]).then(([total, items]) => ({ total, page, pageSize, items }));
  }

  update(id: number, data: any) {
    return this.prisma.feedback.update({ where: { id }, data });
  }
}
