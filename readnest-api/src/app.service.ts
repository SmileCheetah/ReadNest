import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return {
      status: 'ok',
      service: 'readnest-api',
      scope: 'threads-mvp',
      timestamp: new Date().toISOString(),
    };
  }
}
