import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { QueueSafetyService } from './queue/queue-safety.service';

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueSafety: QueueSafetyService,
  ) {}

  getRootHealth() {
    return {
      status: 'ok',
    };
  }

  async getHealth() {
    const database = await this.prisma.checkConnection();

    return {
      status: 'ok',
      service: 'readnest-api',
      scope: 'threads-mvp',
      database,
      // Local guard state only: do not spend Redis requests on health polling.
      // Root liveness stays unchanged to avoid restart storms on quota errors.
      queues: {
        status: this.queueSafety.isQuotaBlocked
          ? 'quota_blocked'
          : 'not_blocked',
        recoveryRequiresRestart: this.queueSafety.isQuotaBlocked,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
