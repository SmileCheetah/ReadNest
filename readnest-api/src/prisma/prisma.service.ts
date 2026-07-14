import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async checkConnection() {
    try {
      await this.$queryRaw`SELECT 1`;

      return {
        status: 'ok',
      };
    } catch (error) {
      this.logger.error(
        `Database health check failed. Check DATABASE_URL or KoDeploy DB_* environment variables. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
