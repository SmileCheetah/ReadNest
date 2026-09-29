import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHmac, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GuestSessionDto } from './dto/guest-session.dto';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { AuthResponse } from './types/auth-response';
import { AuthUser } from './types/auth-user';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async signup(dto: SignupDto): Promise<AuthResponse> {
    const passwordHash = await bcrypt.hash(dto.password, 12);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          passwordHash,
          nickname: dto.nickname,
        },
      });

      return this.createAuthResponse(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('이미 가입된 이메일입니다.');
      }

      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: {
        email: dto.email.toLowerCase(),
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }

    return this.createAuthResponse(user);
  }

  async guest(dto: GuestSessionDto): Promise<AuthResponse> {
    const environment =
      this.configService.get<string>('NODE_ENV') ?? 'development';
    const explicitlyDisabled =
      this.configService.get<string>('GUEST_AUTH_ENABLED') === 'false';
    if (environment === 'production' || explicitlyDisabled) {
      throw new ForbiddenException(
        '개발용 게스트 로그인이 비활성화되어 있습니다.',
      );
    }

    const identity = createHmac(
      'sha256',
      this.configService.getOrThrow<string>('JWT_SECRET'),
    )
      .update(dto.deviceId)
      .digest('hex');
    const email = `guest-${identity.slice(0, 40)}@guest.unwind.local`;
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) return this.createAuthResponse(existing);

    const passwordHash = await bcrypt.hash(randomUUID(), 12);
    const user = await this.prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash,
        nickname: '게스트',
      },
    });

    return this.createAuthResponse(user);
  }

  async me(currentUser: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: {
        id: currentUser.id,
      },
      select: {
        id: true,
        email: true,
        nickname: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  private createAuthResponse(user: {
    id: string;
    email: string;
    nickname: string;
    createdAt: Date;
    updatedAt: Date;
  }): AuthResponse {
    const safeUser = {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    const accessToken = this.jwtService.sign({
      sub: safeUser.id,
      email: safeUser.email,
    });

    return {
      accessToken,
      user: safeUser,
    };
  }
}
