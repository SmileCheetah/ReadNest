import { Global, Module } from '@nestjs/common';
import { QueueSafetyService } from './queue-safety.service';

@Global()
@Module({
  providers: [QueueSafetyService],
  exports: [QueueSafetyService],
})
export class QueueSafetyModule {}
