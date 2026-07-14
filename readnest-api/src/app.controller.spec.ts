import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: PrismaService,
          useValue: {
            checkConnection: jest.fn().mockResolvedValue({ status: 'ok' }),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
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
      });
    });
  });
});
