import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium } from 'playwright';

export type ExtractedContent = {
  title?: string;
  text: string;
  extractionStatus: 'SUCCESS' | 'FALLBACK_SUCCESS' | 'FAILED';
  extractionConfidence: number;
};

@Injectable()
export class ContentExtractorService {
  private readonly logger = new Logger(ContentExtractorService.name);

  constructor(private readonly configService: ConfigService) {}

  async extract(url: string): Promise<ExtractedContent> {
    try {
      if (this.isThreadsUrl(url)) {
        const renderedContent = await this.extractThreadsWithBrowser(url);

        if (renderedContent.text.length > 200) {
          return renderedContent;
        }
      }

      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; ReadNestBot/0.1; +https://readnest.local)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (!response.ok) {
        throw new Error(`Fetch failed with status ${response.status}`);
      }

      const html = await response.text();
      const title =
        this.extractMeta(html, 'og:title') ??
        this.extractTagContent(html, 'title') ??
        undefined;
      const description =
        this.extractMeta(html, 'og:description') ??
        this.extractMeta(html, 'description') ??
        '';
      const bodyText = this.extractBodyText(html);
      const text = [description, bodyText]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 12000);

      return {
        title,
        text,
        extractionStatus: text.length > 80 ? 'FALLBACK_SUCCESS' : 'FAILED',
        extractionConfidence: text.length > 80 ? 0.55 : 0.15,
      };
    } catch (error) {
      this.logger.warn(
        `Content extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      return {
        text: '',
        extractionStatus: 'FAILED',
        extractionConfidence: 0,
      };
    }
  }

  private async extractThreadsWithBrowser(
    url: string,
  ): Promise<ExtractedContent> {
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

    try {
      browser = await this.launchBrowser();

      const page = await browser.newPage({
        locale: 'ko-KR',
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      });

      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: Number(
          this.configService.get<string>('PLAYWRIGHT_PAGE_TIMEOUT_MS') ?? 45000,
        ),
      });

      const scrollCount = Number(
        this.configService.get<string>('PLAYWRIGHT_SCROLL_COUNT') ?? 3,
      );

      for (let index = 0; index < scrollCount; index += 1) {
        await page.mouse.wheel(0, 1400);
        await page.waitForTimeout(700);
      }

      const title = await page.title().catch(() => undefined);
      const bodyText = await page
        .locator('body')
        .innerText({
          timeout: 5000,
        })
        .catch(() => '');

      return {
        title: title ? this.cleanThreadsTitle(title) : undefined,
        text: this.cleanThreadsText(bodyText).slice(
          0,
          Number(this.configService.get<string>('EXTRACT_TEXT_LIMIT') ?? 50000),
        ),
        extractionStatus: bodyText.length > 200 ? 'SUCCESS' : 'FAILED',
        extractionConfidence: bodyText.length > 200 ? 0.9 : 0.2,
      };
    } catch (error) {
      this.logger.warn(
        `Threads browser extraction failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return {
        text: '',
        extractionStatus: 'FAILED',
        extractionConfidence: 0,
      };
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }

  private async launchBrowser() {
    const channel = this.configService.get<string>('PLAYWRIGHT_CHANNEL');

    try {
      return await chromium.launch({
        ...(channel ? { channel } : { channel: 'chrome' }),
        headless: true,
      });
    } catch (error) {
      this.logger.warn(
        `Playwright launch with channel failed, retrying bundled Chromium: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return chromium.launch({
        headless: true,
      });
    }
  }

  private extractMeta(html: string, name: string) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(
        `<meta[^>]+property=["']${escapedName}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        'i',
      ),
      new RegExp(
        `<meta[^>]+name=["']${escapedName}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        'i',
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapedName}["'][^>]*>`,
        'i',
      ),
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        return this.decodeHtml(match[1]).trim();
      }
    }

    return null;
  }

  private extractTagContent(html: string, tag: string) {
    const match = html.match(
      new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'),
    );
    return match?.[1] ? this.decodeHtml(match[1]).trim() : null;
  }

  private extractBodyText(html: string) {
    const withoutScripts = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

    return this.decodeHtml(withoutScripts.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isThreadsUrl(url: string) {
    try {
      const parsedUrl = new URL(url);
      return [
        'threads.com',
        'www.threads.com',
        'threads.net',
        'www.threads.net',
      ].includes(parsedUrl.hostname);
    } catch {
      return false;
    }
  }

  private cleanThreadsTitle(title: string) {
    return title
      .replace(/\s+on\s+Threads.*$/i, '')
      .replace(/\s+\|\s+Threads.*$/i, '')
      .trim();
  }

  private cleanThreadsText(text: string) {
    const stopPatterns = [
      /^관련 스레드$/,
      /^로그인하여 더 많은 답글을 확인해보세요\.$/,
      /^Threads에 로그인 또는 가입하기$/,
      /^사람들의 이야기를 확인하고 대화에 참여해보세요\.$/,
      /^Instagram으로 계속하기$/,
      /^사용자 이름으로 로그인$/,
      /^Threads 약관$/,
      /^개인정보처리방침$/,
      /^쿠키 정책$/,
      /^문제 신고$/,
      /^Threads에서 소통해보세요$/,
      /^Threads에 가입하여 생각을 공유하거나/,
      /^©\s*\d{4}$/,
    ];

    const noisePatterns = [
      /^스레드$/,
      /^조회\s/,
      /^·$/,
      /^작성자$/,
      /^@?[\w.]{2,40}$/,
      /^\d+\s*(초|분|시간|일|주)$/,
      /^(방금|어제|오늘)$/,
      /^\d+$/,
      /^답글 남기기/,
      /님에게 답글 남기기/,
    ];

    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const cleanedLines: string[] = [];

    for (const line of lines) {
      if (stopPatterns.some((pattern) => pattern.test(line))) {
        break;
      }

      if (noisePatterns.some((pattern) => pattern.test(line))) {
        continue;
      }

      cleanedLines.push(line);
    }

    return cleanedLines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private decodeHtml(value: string) {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }
}
