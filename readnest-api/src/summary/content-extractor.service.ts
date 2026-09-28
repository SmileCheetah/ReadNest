import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium } from 'playwright';
import { parseThreadsUrl } from '../articles/utils/normalize-url';
import { safeSourceRequest, type SourceBudget } from './safe-source-http';
import { positiveInteger } from '../articles/utils/summary-preview';

export type ExtractedContent = {
  title?: string;
  text: string;
  extractionStatus: 'SUCCESS' | 'FALLBACK_SUCCESS' | 'FAILED';
  extractionConfidence: number;
  sourceCompleteness?: 'UNKNOWN' | 'PARTIAL' | 'COMPLETE';
};

@Injectable()
export class ContentExtractorService {
  private readonly logger = new Logger(ContentExtractorService.name);

  constructor(private readonly configService: ConfigService) {}

  async extract(url: string): Promise<ExtractedContent> {
    try {
      url = parseThreadsUrl(url).canonical;
      const budget: SourceBudget = {
        remainingBytes: 8 * 1024 * 1024,
        deadline: Date.now() + 45000,
      };
      if (this.isThreadsUrl(url)) {
        const renderedContent = await this.extractThreadsWithBrowser(
          url,
          budget,
        );

        if (renderedContent.text.length > 200) {
          return renderedContent;
        }

        this.logger.warn(
          `Threads browser extraction returned only ${renderedContent.text.length} characters. Using HTTP fallback.`,
        );
      }

      const response = await safeSourceRequest(url, { budget });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Fetch failed with status ${response.status}`);
      }

      const html = response.body.toString('utf8');
      const title =
        this.extractMeta(html, 'og:title') ??
        this.extractTagContent(html, 'title') ??
        undefined;
      const description =
        this.extractMeta(html, 'og:description') ??
        this.extractMeta(html, 'description') ??
        '';
      // Fallback metadata is safer than treating every comment/navigation label as source.
      const text = this.cleanThreadsText(description).slice(0, 12000);
      const isAccessScreen =
        /^(?:log in|login|sign up|join threads|로그인|가입하기|페이지를 찾을 수 없|요청한 페이지|sorry[,!]?|content (?:isn't|is not) available)/i.test(
          text,
        );
      // Length is not evidence: a legitimate short post remains usable when its
      // metadata identifies the requested post. Never treat a login/error page as it.
      const metadataUrl =
        this.extractMeta(html, 'og:url') ?? this.extractCanonicalUrl(html);
      let samePost = false;
      if (metadataUrl) {
        try {
          samePost =
            parseThreadsUrl(metadataUrl).identity ===
            parseThreadsUrl(url).identity;
        } catch {
          /* Non-post metadata is not source evidence. */
        }
      }
      const usable = Boolean(
        text &&
        !isAccessScreen &&
        (samePost || (!metadataUrl && text.length > 80)),
      );

      return {
        title,
        text,
        extractionStatus: usable ? 'FALLBACK_SUCCESS' : 'FAILED',
        extractionConfidence: usable ? 0.55 : 0.15,
        sourceCompleteness: usable ? 'PARTIAL' : 'UNKNOWN',
      };
    } catch {
      this.logger.warn('Content extraction failed; no source returned.');

      return {
        text: '',
        extractionStatus: 'FAILED',
        extractionConfidence: 0,
        sourceCompleteness: 'UNKNOWN',
      };
    }
  }

  private async extractThreadsWithBrowser(
    url: string,
    budget: SourceBudget,
  ): Promise<ExtractedContent> {
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

    try {
      browser = await this.launchBrowser(budget.deadline);

      const page = await browser.newPage({
        serviceWorkers: 'block',
        locale: 'ko-KR',
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      });

      // Intercept *all* browser traffic, including redirects/subresources, and pin DNS.
      await page.context().route('**/*', async (route) => {
        const req = route.request();
        if (
          ['image', 'media', 'font', 'websocket'].includes(
            req.resourceType(),
          ) ||
          !['GET', 'POST'].includes(req.method())
        ) {
          await route.abort();
          return;
        }
        try {
          const response = await safeSourceRequest(req.url(), {
            budget,
            subresource: !req.isNavigationRequest(),
            method: req.method() as 'GET' | 'POST',
            body: req.postData() ?? undefined,
            contentType: req.headers()['content-type'],
          });
          await route.fulfill({
            status: response.status,
            headers: response.headers,
            body: response.body,
          });
        } catch {
          await route.abort().catch(() => undefined);
        }
      });
      await page.context().routeWebSocket('**/*', (socket) => socket.close());

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: Math.max(1, Math.min(30000, budget.deadline - Date.now())),
      });
      await page.waitForTimeout(1000);

      const scrollCount = Math.min(
        5,
        Math.max(
          0,
          Number(
            this.configService.get<string>('PLAYWRIGHT_SCROLL_COUNT') ?? 3,
          ),
        ),
      );

      for (
        let index = 0;
        index < scrollCount && Date.now() < budget.deadline - 1500;
        index += 1
      ) {
        await page.mouse.wheel(0, 1400);
        await page.waitForTimeout(700);
      }

      const title = await page.title().catch(() => undefined);
      const bodyText = await page
        .locator('body')
        .innerText({
          timeout: Math.max(1, Math.min(5000, budget.deadline - Date.now())),
        })
        .catch(() => '');
      const cleanedText = this.cleanThreadsText(bodyText).slice(
        0,
        Math.min(
          50000,
          positiveInteger(
            this.configService.get<string>('EXTRACT_TEXT_LIMIT'),
            50000,
          ),
        ),
      );
      const hasUsefulText = cleanedText.length > 200;

      return {
        title: title ? this.cleanThreadsTitle(title) : undefined,
        text: cleanedText,
        extractionStatus: hasUsefulText ? 'SUCCESS' : 'FAILED',
        extractionConfidence: hasUsefulText ? 0.9 : 0.2,
        // body text alone cannot prove same-author/root ownership or complete collection.
        sourceCompleteness: /로그인하여 더 많은 답글|로그인 또는 가입/.test(
          bodyText,
        )
          ? 'PARTIAL'
          : 'UNKNOWN',
      };
    } catch {
      this.logger.warn(
        'Threads browser extraction failed; using bounded fallback if budget remains.',
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

  private async launchBrowser(deadline: number) {
    const channel = this.configService.get<string>('PLAYWRIGHT_CHANNEL');
    const launchOptions = {
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
      timeout: Math.max(1, Math.min(8000, deadline - Date.now())),
    };

    if (channel) {
      try {
        return await chromium.launch({
          ...launchOptions,
          channel,
        });
      } catch {
        this.logger.warn(
          'Playwright channel unavailable; retrying bundled Chromium.',
        );
      }
    }

    return chromium.launch(launchOptions);
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

  private extractCanonicalUrl(html: string): string | null {
    const links = html.match(/<link\b[^>]*>/gi) ?? [];
    for (const link of links) {
      if (!/\brel\s*=\s*["']canonical["']/i.test(link)) continue;
      const href = link.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
      if (href) return this.decodeHtml(href);
    }
    return null;
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
      /^\d+\s*(초|분|시간|일|주)$/,
      /^(방금|어제|오늘)$/,
      /^답글 남기기/,
      /님에게 답글 남기기/,
    ];

    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const cleanedLines: string[] = [];

    for (const [index, line] of lines.entries()) {
      if (stopPatterns.some((pattern) => pattern.test(line))) {
        break;
      }

      if (noisePatterns.some((pattern) => pattern.test(line))) {
        continue;
      }
      if (
        /^@?[\w.]{2,40}$/.test(line) &&
        /^\d+\s*(초|분|시간|일|주)$/.test(lines[index + 1] ?? '')
      )
        continue;

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
