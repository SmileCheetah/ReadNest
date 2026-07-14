import { Injectable } from '@nestjs/common';
import { ThreadGroupStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type DetectedThreadPart = {
  partNumber: number;
  totalParts: number;
};

@Injectable()
export class ThreadDetectionService {
  constructor(private readonly prisma: PrismaService) {}

  async detectAndLink(input: {
    articleId: string;
    userId: string;
    title: string;
    url: string;
    text: string;
  }) {
    const detected = this.detectPart(input.text || input.title);

    if (!detected) {
      return null;
    }

    let group = await this.prisma.threadGroup.findFirst({
      where: {
        userId: input.userId,
        title: input.title,
      },
    });

    group ??= await this.prisma.threadGroup.create({
      data: {
        userId: input.userId,
        title: input.title,
        status: ThreadGroupStatus.PARTIAL,
      },
    });

    await this.prisma.threadPart.upsert({
      where: {
        savedArticleId: input.articleId,
      },
      create: {
        threadGroupId: group.id,
        savedArticleId: input.articleId,
        partNumber: detected.partNumber,
        totalParts: detected.totalParts,
        url: input.url,
      },
      update: {
        threadGroupId: group.id,
        partNumber: detected.partNumber,
        totalParts: detected.totalParts,
        url: input.url,
      },
    });

    const savedParts = await this.prisma.threadPart.count({
      where: {
        threadGroupId: group.id,
      },
    });

    if (savedParts >= detected.totalParts) {
      await this.prisma.threadGroup.update({
        where: {
          id: group.id,
        },
        data: {
          status: ThreadGroupStatus.COMPLETE,
        },
      });
    }

    return detected;
  }

  private detectPart(text: string): DetectedThreadPart | null {
    const patterns = [
      /(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})(?:\s|$)/,
      /(?:^|\s)(\d{1,2})\s+of\s+(\d{1,2})(?:\s|$)/i,
      /(?:^|\s)part\s+(\d{1,2})\s*(?:\/|of)\s*(\d{1,2})(?:\s|$)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);

      if (!match) continue;

      const partNumber = Number(match[1]);
      const totalParts = Number(match[2]);

      if (
        Number.isInteger(partNumber) &&
        Number.isInteger(totalParts) &&
        totalParts > 1 &&
        partNumber >= 1 &&
        partNumber <= totalParts
      ) {
        return {
          partNumber,
          totalParts,
        };
      }
    }

    return null;
  }
}
