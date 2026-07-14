import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ArticlesModule } from './articles/articles.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { SummaryModule } from './summary/summary.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');

        if (redisUrl) {
          const url = new URL(redisUrl);

          return {
            connection: {
              host: url.hostname,
              port:
                Number(url.port) || (url.protocol === 'rediss:' ? 6380 : 6379),
              username: url.username
                ? decodeURIComponent(url.username)
                : undefined,
              password: url.password
                ? decodeURIComponent(url.password)
                : undefined,
              tls: url.protocol === 'rediss:' ? {} : undefined,
            },
          };
        }

        return {
          connection: {
            host: configService.get<string>('REDIS_HOST') ?? 'localhost',
            port: Number(configService.get<string>('REDIS_PORT') ?? 6379),
            username: configService.get<string>('REDIS_USERNAME') || undefined,
            password: configService.get<string>('REDIS_PASSWORD') || undefined,
            tls:
              configService.get<string>('REDIS_TLS') === 'true'
                ? {}
                : undefined,
          },
        };
      },
    }),
    PrismaModule,
    AuthModule,
    SummaryModule,
    ArticlesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
