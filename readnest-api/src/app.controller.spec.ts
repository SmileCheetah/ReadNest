import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { QueueSafetyService } from './queue/queue-safety.service';

describe('AppController', () => {
  let appController: AppController;
  let safety: QueueSafetyService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        QueueSafetyService,
        {
          provide: PrismaService,
          useValue: {
            checkConnection: jest.fn().mockResolvedValue({ status: 'ok' }),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    safety = app.get(QueueSafetyService);
  });

  describe('root', () => {
    it('should return root health status', () => {
      expect(appController.getRoot()).toEqual({
        status: 'ok',
      });
    });

    it('should return health status', async () => {
      await expect(appController.getHealth()).resolves.toMatchObject({
        status: 'ok',
        service: 'readnest-api',
        scope: 'threads-mvp',
        database: {
          status: 'ok',
        },
        queues: { status: 'not_blocked', recoveryRequiresRestart: false },
      });
    });

    it('reports a quota-blocked queue without changing root liveness', async () => {
      safety.reportError(new Error('ERR max requests limit exceeded.'));
      await expect(appController.getHealth()).resolves.toMatchObject({
        queues: { status: 'quota_blocked', recoveryRequiresRestart: true },
      });
      expect(appController.getRoot()).toEqual({ status: 'ok' });
    });
  });
});
