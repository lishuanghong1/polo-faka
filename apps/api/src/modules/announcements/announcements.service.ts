import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnnouncementsService {
  constructor(private prisma: PrismaService) {}

  active() {
    const now = new Date();
    return this.prisma.announcement.findMany({
      where: {
        active: true,
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gte: now } }] },
        ],
      },
      orderBy: [{ sort: 'desc' }, { id: 'desc' }],
    });
  }

  listAll() {
    return this.prisma.announcement.findMany({ orderBy: [{ sort: 'desc' }, { id: 'desc' }] });
  }

  create(data: any) {
    return this.prisma.announcement.create({ data });
  }

  update(id: number, data: any) {
    return this.prisma.announcement.update({ where: { id }, data });
  }

  remove(id: number) {
    return this.prisma.announcement.delete({ where: { id } });
  }
}
