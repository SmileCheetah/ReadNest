import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SummaryTaskState } from '@prisma/client';
import { Queue } from 'bullmq';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';

export const AUTO_CONNECTION_QUEUE = 'auto-connections';
export type ConnectionJob = { articleId: string; sourceGeneration: number };
type Candidate = {
  id: string;
  title: string | null;
  rawText: string;
  resultGeneration: number;
};

function terms(value: string) {
  return new Set(
    (value.toLowerCase().match(/[가-힣a-z0-9]{2,}/g) ?? []).filter(
      (term) =>
        term.length < 32 &&
        ![
          '그리고',
          '하지만',
          '때문에',
          '있다',
          '하는',
          '통해',
          'the',
          'and',
          'with',
        ].includes(term),
    ),
  );
}

export function rankCandidates(source: string, candidates: Candidate[]) {
  const sourceTerms = terms(source.slice(0, 5000));
  return [...candidates]
    .sort((left, right) => {
      const score = (candidate: Candidate) => {
        const candidateTerms = terms(
          `${candidate.title ?? ''} ${candidate.rawText.slice(0, 2400)}`,
        );
        let common = 0;
        for (const term of candidateTerms) if (sourceTerms.has(term)) common++;
        return common;
      };
      return score(right) - score(left);
    })
    .slice(0, 8);
}
type ProposedLink = {
  articleId: string;
  type: string;
  reason: string;
  sourceEvidence: string;
  relatedEvidence: string;
};

const linkSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          articleId: { type: 'string' },
          type: { type: 'string', enum: ['SIMILAR', 'COMPLEMENT', 'CONTRAST'] },
          reason: { type: 'string' },
          sourceEvidence: { type: 'string' },
          relatedEvidence: { type: 'string' },
        },
        required: [
          'articleId',
          'type',
          'reason',
          'sourceEvidence',
          'relatedEvidence',
        ],
      },
    },
  },
  required: ['links'],
} as const;

// Exact excerpts, rather than model confidence, are the acceptance condition.
export function verifiedLinks(
  sourceText: string,
  candidates: Candidate[],
  proposed: unknown,
): Array<{ candidate: Candidate; link: ProposedLink }> {
  if (!proposed || typeof proposed !== 'object') return [];
  const links = (proposed as { links?: unknown }).links;
  if (!Array.isArray(links)) return [];
  const used = new Set<string>();
  const accepted: Array<{ candidate: Candidate; link: ProposedLink }> = [];
  for (const value of links.slice(0, 12)) {
    if (!value || typeof value !== 'object') continue;
    const link = value as ProposedLink;
    const candidate = candidates.find((item) => item.id === link.articleId);
    if (!candidate || used.has(candidate.id)) continue;
    if (!['SIMILAR', 'COMPLEMENT', 'CONTRAST'].includes(link.type)) continue;
    if (
      typeof link.reason !== 'string' ||
      link.reason.trim().length < 10 ||
      link.reason.length > 280
    )
      continue;
    if (
      typeof link.sourceEvidence !== 'string' ||
      typeof link.relatedEvidence !== 'string'
    )
      continue;
    const first = link.sourceEvidence.trim();
    const second = link.relatedEvidence.trim();
    if (
      first.length < 10 ||
      first.length > 180 ||
      second.length < 10 ||
      second.length > 180
    )
      continue;
    if (!sourceText.includes(first) || !candidate.rawText.includes(second))
      continue;
    used.add(candidate.id);
    accepted.push({
      candidate,
      link: {
        ...link,
        reason: link.reason.trim(),
        sourceEvidence: first,
        relatedEvidence: second,
      },
    });
    if (accepted.length === 3) break;
  }
  return accepted;
}

@Injectable()
export class AutoConnectionsService {
  private readonly logger = new Logger(AutoConnectionsService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(AUTO_CONNECTION_QUEUE)
    private readonly queue: Queue<ConnectionJob>,
  ) {
    const key = config.get<string>('OPENAI_API_KEY')?.trim();
    this.client = key
      ? new OpenAI({ apiKey: key, timeout: 60000, maxRetries: 0 })
      : null;
    this.model = config.get<string>('OPENAI_MODEL')?.trim() || 'gpt-6-luna';
  }

  async schedule(articleId: string, retryFailed = false) {
    const article = await this.prisma.savedArticle.findUnique({
      where: { id: articleId },
      select: {
        id: true,
        rawText: true,
        resultGeneration: true,
        processStatus: true,
      },
    });
    if (
      !article?.rawText ||
      article.resultGeneration === null ||
      !['SUMMARY_DONE', 'CONTEXT_INSUFFICIENT'].includes(article.processStatus)
    )
      return false;
    const generation = article.resultGeneration;
    const current = await this.prisma.connectionScan.findUnique({
      where: { articleId },
    });
    if (!current) {
      await this.prisma.connectionScan
        .create({ data: { articleId, sourceGeneration: generation } })
        .catch(() => undefined);
    } else if (
      current.sourceGeneration !== generation ||
      (retryFailed && current.state === SummaryTaskState.FAILED)
    ) {
      await this.prisma.connectionScan.updateMany({
        where: {
          articleId,
          sourceGeneration: current.sourceGeneration,
          state: current.state,
        },
        data: {
          sourceGeneration: generation,
          state: SummaryTaskState.PENDING,
          attempts: 0,
          errorCode: null,
        },
      });
    }
    const scan = await this.prisma.connectionScan.findUnique({
      where: { articleId },
    });
    if (
      scan?.sourceGeneration !== generation ||
      scan.state !== SummaryTaskState.PENDING
    )
      return false;
    await this.queue.add(
      'connect',
      { articleId, sourceGeneration: generation },
      {
        jobId: `${articleId}-${generation}`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    return true;
  }

  async startPending(userId: string) {
    const staleBefore = new Date(Date.now() - 5 * 60_000);
    await this.prisma.connectionScan.updateMany({
      where: {
        state: SummaryTaskState.RUNNING,
        updatedAt: { lt: staleBefore },
        article: { userId },
      },
      data: { state: SummaryTaskState.PENDING, errorCode: 'INTERRUPTED' },
    });
    const articles = await this.prisma.savedArticle.findMany({
      where: {
        userId,
        rawText: { not: null },
        resultGeneration: { not: null },
        processStatus: { in: ['SUMMARY_DONE', 'CONTEXT_INSUFFICIENT'] },
        OR: [
          { connectionScan: { is: null } },
          { connectionScan: { is: { state: SummaryTaskState.PENDING } } },
        ],
      },
      select: {
        id: true,
        resultGeneration: true,
        connectionScan: { select: { sourceGeneration: true, state: true } },
      },
      orderBy: { savedAt: 'desc' },
      take: 6,
    });
    const needingScan = articles.filter(
      (article) =>
        !article.connectionScan ||
        article.connectionScan.sourceGeneration !== article.resultGeneration ||
        article.connectionScan.state === SummaryTaskState.PENDING,
    );
    const eligible = needingScan.slice(0, 5);
    let queued = 0;
    for (const article of eligible) {
      try {
        if (await this.schedule(article.id)) queued++;
      } catch {
        this.logger.warn(`Connection scheduling failed: article=${article.id}`);
      }
    }
    return {
      queued,
      remaining: Math.max(0, needingScan.length - eligible.length),
    };
  }

  async list(userId: string) {
    const articles = await this.prisma.savedArticle.findMany({
      where: { userId },
      orderBy: { savedAt: 'desc' },
      take: 80,
      select: {
        id: true,
        title: true,
        summaryPreview: true,
        savedAt: true,
        resultGeneration: true,
        processStatus: true,
        connectionScan: { select: { state: true, sourceGeneration: true } },
      },
    });
    const byId = new Map(articles.map((article) => [article.id, article]));
    const connections = await this.prisma.autoConnection.findMany({
      where: {
        userId,
        leftArticleId: { in: articles.map((article) => article.id) },
        rightArticleId: { in: articles.map((article) => article.id) },
      },
      orderBy: { createdAt: 'desc' },
      take: 240,
    });
    const valid = connections.filter(
      (edge) =>
        byId.get(edge.leftArticleId)?.resultGeneration ===
          edge.leftGeneration &&
        byId.get(edge.rightArticleId)?.resultGeneration ===
          edge.rightGeneration,
    );
    return {
      articles: articles.map(({ connectionScan, ...article }) => ({
        ...article,
        scanState:
          connectionScan?.sourceGeneration === article.resultGeneration
            ? connectionScan.state
            : null,
      })),
      connections: valid.map(
        ({
          id,
          leftArticleId,
          rightArticleId,
          relationType,
          reason,
          leftEvidence,
          rightEvidence,
        }) => ({
          id,
          leftArticleId,
          rightArticleId,
          relationType,
          reason,
          leftEvidence,
          rightEvidence,
        }),
      ),
    };
  }

  async retry(userId: string, articleId: string) {
    const exists = await this.prisma.savedArticle.findFirst({
      where: { id: articleId, userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('저장한 글을 찾을 수 없습니다.');
    return { queued: await this.schedule(articleId, true) };
  }

  async process({ articleId, sourceGeneration }: ConnectionJob) {
    const claimed = await this.prisma.connectionScan.updateMany({
      where: { articleId, sourceGeneration, state: SummaryTaskState.PENDING },
      data: {
        state: SummaryTaskState.RUNNING,
        attempts: { increment: 1 },
        errorCode: null,
      },
    });
    if (!claimed.count) return;
    try {
      const source = await this.prisma.savedArticle.findUnique({
        where: { id: articleId },
        select: {
          id: true,
          userId: true,
          title: true,
          rawText: true,
          resultGeneration: true,
        },
      });
      if (!source?.rawText || source.resultGeneration !== sourceGeneration)
        return;
      const candidates = rankCandidates(
        source.rawText,
        (
          await this.prisma.savedArticle.findMany({
            where: {
              userId: source.userId,
              id: { not: articleId },
              rawText: { not: null },
              resultGeneration: { not: null },
              processStatus: { in: ['SUMMARY_DONE', 'CONTEXT_INSUFFICIENT'] },
            },
            orderBy: { savedAt: 'desc' },
            take: 40,
            select: {
              id: true,
              title: true,
              rawText: true,
              resultGeneration: true,
            },
          })
        ).filter(
          (item): item is Candidate =>
            !!item.rawText && item.resultGeneration !== null,
        ),
      );
      let links: ReturnType<typeof verifiedLinks> = [];
      if (candidates.length && !this.client)
        throw new Error('OPENAI_KEY_MISSING');
      if (candidates.length && this.client) {
        const response = await this.client.responses.create({
          model: this.model,
          store: false,
          input: `두 저장글 사이에 실제로 의미 있는 연관, 보완 또는 대조가 있을 때만 연결하세요. 단순히 분야가 같다는 이유로 연결하지 마세요. 연결은 최대 3개입니다. reason은 두 글이 어떻게 이어지는지 한 문장으로 쓰세요. sourceEvidence와 relatedEvidence는 각 원문에서 공백·문장부호까지 그대로 복사한 10~180자의 짧은 부분 문자열이어야 합니다. 관련 글이 없으면 links를 빈 배열로 반환하세요.\n\n기준 글: ${JSON.stringify({ title: source.title, text: source.rawText.slice(0, 4500) })}\n\n후보 글: ${JSON.stringify(candidates.map(({ id, title, rawText }) => ({ id, title, text: rawText.slice(0, 1800) })))}`,
          text: {
            format: {
              type: 'json_schema',
              name: 'article_connections',
              strict: true,
              schema: linkSchema,
            },
          },
        });
        links = verifiedLinks(
          source.rawText,
          candidates,
          JSON.parse(response.output_text),
        );
      }
      await this.prisma.$transaction(async (tx) => {
        const latest = await tx.savedArticle.findUnique({
          where: { id: articleId },
          select: { resultGeneration: true },
        });
        if (latest?.resultGeneration !== sourceGeneration) return;
        const completed = await tx.connectionScan.updateMany({
          where: {
            articleId,
            sourceGeneration,
            state: SummaryTaskState.RUNNING,
          },
          data: { state: SummaryTaskState.SUCCEEDED },
        });
        if (!completed.count) return;
        await tx.autoConnection.deleteMany({
          where: {
            userId: source.userId,
            OR: [
              {
                leftArticleId: articleId,
                leftGeneration: { not: sourceGeneration },
              },
              {
                rightArticleId: articleId,
                rightGeneration: { not: sourceGeneration },
              },
            ],
          },
        });
        for (const { candidate, link } of links) {
          const fresh = await tx.savedArticle.findUnique({
            where: { id: candidate.id },
            select: { resultGeneration: true, userId: true },
          });
          if (
            fresh?.userId !== source.userId ||
            fresh.resultGeneration !== candidate.resultGeneration
          )
            continue;
          const sourceFirst = articleId < candidate.id;
          const data = {
            userId: source.userId,
            leftArticleId: sourceFirst ? articleId : candidate.id,
            rightArticleId: sourceFirst ? candidate.id : articleId,
            leftGeneration: sourceFirst
              ? sourceGeneration
              : candidate.resultGeneration,
            rightGeneration: sourceFirst
              ? candidate.resultGeneration
              : sourceGeneration,
            relationType: link.type,
            reason: link.reason,
            leftEvidence: sourceFirst
              ? link.sourceEvidence
              : link.relatedEvidence,
            rightEvidence: sourceFirst
              ? link.relatedEvidence
              : link.sourceEvidence,
          };
          await tx.autoConnection.upsert({
            where: {
              leftArticleId_rightArticleId: {
                leftArticleId: data.leftArticleId,
                rightArticleId: data.rightArticleId,
              },
            },
            create: data,
            update: data,
          });
        }
      });
    } catch (error) {
      this.logger.warn(
        `Connection scan failed: article=${articleId} code=${error instanceof Error ? error.name : 'UNKNOWN'}`,
      );
      await this.prisma.connectionScan.updateMany({
        where: { articleId, sourceGeneration, state: SummaryTaskState.RUNNING },
        data: {
          state: SummaryTaskState.FAILED,
          errorCode: 'CONNECTION_SCAN_FAILED',
        },
      });
    }
  }
}
