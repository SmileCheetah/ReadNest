import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

const now = new Date('2026-09-29T00:00:00.000Z');

function setup(environment = 'development') {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const jwt = { sign: jest.fn(({ sub }) => `token:${sub}`) };
  const config = new ConfigService({
    NODE_ENV: environment,
    JWT_SECRET: 'guest-test-secret-with-at-least-32-characters',
  });
  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwt as unknown as JwtService,
    config,
  );
  return { service, prisma, jwt };
}

describe('AuthService development guest session', () => {
  it('returns the same isolated user for the same device identifier', async () => {
    const { service, prisma } = setup();
    const user = {
      id: 'guest-user',
      email: 'derived@guest.unwind.local',
      nickname: '게스트',
      passwordHash: 'hash',
      createdAt: now,
      updatedAt: now,
    };
    prisma.user.findUnique.mockResolvedValue(user);

    const response = await service.guest({
      deviceId: '7c857d5e-5083-40d9-a8d0-a641837a8849',
    });

    expect(response).toMatchObject({
      accessToken: 'token:guest-user',
      user: { id: 'guest-user', nickname: '게스트' },
    });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('creates different users without persisting the raw device identifier', async () => {
    const { service, prisma } = setup();
    const createdUsers: Array<{
      email: string;
      nickname: string;
      passwordHash: string;
    }> = [];
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.upsert.mockImplementation(
      ({
        create,
      }: {
        create: { email: string; nickname: string; passwordHash: string };
      }) => {
        createdUsers.push(create);
        return {
          id: create.email,
          ...create,
          createdAt: now,
          updatedAt: now,
        };
      },
    );
    const firstDevice = '7c857d5e-5083-40d9-a8d0-a641837a8849';
    const secondDevice = 'd9bfc025-81a7-48ee-b13b-2910e356b865';

    const first = await service.guest({ deviceId: firstDevice });
    const second = await service.guest({ deviceId: secondDevice });

    expect(first.user.id).not.toBe(second.user.id);
    for (const create of createdUsers) {
      const serialized = JSON.stringify(create);
      expect(serialized).not.toContain(firstDevice);
      expect(serialized).not.toContain(secondDevice);
      expect(create.email).toMatch(/^guest-[a-f0-9]{40}@guest\.unwind\.local$/);
    }
  });

  it('always rejects guest session creation in production', async () => {
    const { service, prisma } = setup('production');

    await expect(
      service.guest({
        deviceId: '7c857d5e-5083-40d9-a8d0-a641837a8849',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
