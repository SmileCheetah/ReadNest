import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/types/auth-user';
import { SummaryService } from './summary.service';

@UseGuards(JwtAuthGuard)
@Controller('articles/:articleId/summary')
export class SummaryController {
  constructor(private readonly summaryService: SummaryService) {}

  @Post()
  retry(@CurrentUser() user: AuthUser, @Param('articleId') articleId: string) {
    return this.summaryService.retryArticleSummary(user.id, articleId);
  }

  @Post('retry')
  retryAlias(@CurrentUser() user: AuthUser, @Param('articleId') articleId: string) {
    return this.summaryService.retryArticleSummary(user.id, articleId);
  }

  @Get('status')
  status(@CurrentUser() user: AuthUser, @Param('articleId') articleId: string) {
    return this.summaryService.getArticleSummaryStatus(user.id, articleId);
  }
}
