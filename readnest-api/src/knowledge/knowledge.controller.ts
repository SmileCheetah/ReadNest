import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/types/auth-user';
import { KnowledgeService } from './knowledge.service';
import { AutoConnectionsService } from './auto-connections.service';
import {
  CreateTopicDto,
  ListTopicsQueryDto,
  UpdateTopicDto,
} from './dto/topic.dto';

@UseGuards(JwtAuthGuard)
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly connections: AutoConnectionsService,
  ) {}

  @Get('connections')
  connectionsList(@CurrentUser() user: AuthUser) {
    return this.connections.list(user.id);
  }

  @Post('connections/scan')
  scanConnections(@CurrentUser() user: AuthUser) {
    return this.connections.startPending(user.id);
  }

  @Post('connections/:articleId/retry')
  retryConnection(
    @CurrentUser() user: AuthUser,
    @Param('articleId') articleId: string,
  ) {
    return this.connections.retry(user.id, articleId);
  }

  @Get('topics')
  list(@CurrentUser() user: AuthUser, @Query() query: ListTopicsQueryDto) {
    return this.knowledge.listTopics(user.id, query);
  }

  @Post('topics')
  create(@CurrentUser() user: AuthUser, @Body() body: CreateTopicDto) {
    return this.knowledge.createTopic(user.id, body);
  }

  @Get('topics/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.knowledge.getTopic(user.id, id);
  }

  @Patch('topics/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateTopicDto,
  ) {
    return this.knowledge.updateTopic(user.id, id, body);
  }

  @Delete('topics/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.knowledge.deleteTopic(user.id, id);
  }

  @Get('topics/:id/articles')
  articles(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: ListTopicsQueryDto,
  ) {
    return this.knowledge.listTopicArticles(user.id, id, query);
  }

  @Put('topics/:id/articles/:articleId')
  link(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('articleId') articleId: string,
  ) {
    return this.knowledge.setMembership(user.id, id, articleId, true);
  }

  @Delete('topics/:id/articles/:articleId')
  unlink(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('articleId') articleId: string,
  ) {
    return this.knowledge.setMembership(user.id, id, articleId, false);
  }

  @Get('articles/:articleId/topics')
  articleTopics(
    @CurrentUser() user: AuthUser,
    @Param('articleId') articleId: string,
    @Query() query: ListTopicsQueryDto,
  ) {
    return this.knowledge.listArticleTopics(user.id, articleId, query);
  }
}
