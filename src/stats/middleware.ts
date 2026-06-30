import type { MiddlewareHandler } from 'hono';

import type { WorkerConfigEnv } from '@/config';
import { recordSuccessfulRequest, type RequestKind } from './index';

export function createSuccessCounterMiddleware(kind: RequestKind): MiddlewareHandler<{ Bindings: WorkerConfigEnv }> {
  return async (c, next) => {
    await next();

    if (!c.res.ok) {
      return;
    }

    c.executionCtx.waitUntil(
      recordSuccessfulRequest(c.env, kind).catch((error) => {
        console.error(`Failed to record ${kind} stats`, error);
      }),
    );
  };
}
