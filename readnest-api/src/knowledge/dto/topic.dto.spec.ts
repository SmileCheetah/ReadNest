import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateTopicDto,
  ListTopicsQueryDto,
  UpdateTopicDto,
} from './topic.dto';

describe('knowledge HTTP DTOs', () => {
  it('rejects missing/null names and revision strings instead of coercing edit intent', async () => {
    expect(
      await validate(plainToInstance(CreateTopicDto, {})),
    ).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(CreateTopicDto, { name: null })),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(UpdateTopicDto, { name: null, expectedRevision: 1 }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(UpdateTopicDto, { name: 'AI', expectedRevision: '1' }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(UpdateTopicDto, {
          description: null,
          expectedRevision: 1,
        }),
      ),
    ).toHaveLength(0);
  });
  it('transforms bounded query limits and preserves supplementary-plane characters for service validation', async () => {
    const query = plainToInstance(ListTopicsQueryDto, {
      limit: '100',
      cursor: 'cursor',
    });
    expect(query.limit).toBe(100);
    expect(await validate(query)).toHaveLength(0);
    expect(
      await validate(plainToInstance(ListTopicsQueryDto, { limit: '101' })),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(ListTopicsQueryDto, { cursor: 'x'.repeat(2049) }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(CreateTopicDto, {
          name: '😀'.repeat(80),
          description: '😀'.repeat(2000),
        }),
      ),
    ).toHaveLength(0);
  });
});
