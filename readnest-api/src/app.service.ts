import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getRootHealth() {
    return {
      status: 'ok',
      service: 'readnest-api',
      timestamp: new Date().toISOString(),
    };
  }

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
