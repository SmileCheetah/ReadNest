import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth() {
    const database = await this.prisma.checkConnection();

    return {
      status: 'ok',
      service: 'readnest-api',
      scope: 'threads-mvp',
      database,
      timestamp: new Date().toISOString(),
    };
  }
}
