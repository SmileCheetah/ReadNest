import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/types/auth-user';
import { ArticlesService } from './articles.service';
import { CheckDuplicateQueryDto } from './dto/check-duplicate-query.dto';
import { CreateArticleDto } from './dto/create-article.dto';
import { ListArticlesQueryDto } from './dto/list-articles-query.dto';
import { UpdateReadStatusDto } from './dto/update-read-status.dto';

@UseGuards(JwtAuthGuard)
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateArticleDto) {
    return this.articlesService.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListArticlesQueryDto) {
    return this.articlesService.findAll(user.id, query);
  }

  @Get('home')
  getHome(@CurrentUser() user: AuthUser) {
    return this.articlesService.getHome(user.id);
  }

  @Get('check-duplicate')
  checkDuplicate(
    @CurrentUser() user: AuthUser,
    @Query() query: CheckDuplicateQueryDto,
  ) {
    return this.articlesService.checkDuplicate(user.id, query.url);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.articlesService.findOne(user.id, id);
  }

  @Patch(':id/read-status')
  updateReadStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateReadStatusDto,
  ) {
    return this.articlesService.updateReadStatus(user.id, id, dto.readStatus);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.articlesService.remove(user.id, id);
  }
}
