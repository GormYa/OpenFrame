import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { apiErrors, successResponse } from '@/lib/api-response';
import { startCardlessTrial } from '@/lib/billing';
import { rateLimit } from '@/lib/rate-limit';
import { isStripeFeatureEnabled } from '@/lib/feature-flags';
import { isTrustedSameOriginRequest } from '@/lib/request-origin';
import { logError } from '@/lib/logger';
import { db } from '@/lib/db';

/**
 * The explicit claim of a deferred cardless trial.
 *
 * An invited collaborator has their trial held back at signup; nothing else in
 * the product is allowed to start it as a side effect, because the clock spends
 * the account's only trial. This endpoint is the one place the user says "start
 * it now", from the workspace-creation and billing screens.
 */
export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    if (!isTrustedSameOriginRequest(request)) {
      return apiErrors.forbidden('Invalid request origin');
    }

    const session = await auth();
    if (!session?.user?.id) {
      return apiErrors.unauthorized();
    }

    if (!isStripeFeatureEnabled()) {
      return apiErrors.badRequest('Stripe billing is disabled by this host');
    }

    const started = await startCardlessTrial(session.user.id);
    if (!started) {
      return apiErrors.conflict('Your free trial has already been used');
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { trialEndsAt: true },
    });

    return successResponse({ trialEndsAt: user?.trialEndsAt ?? null });
  } catch (error) {
    logError('billing.trial.start', error);
    return apiErrors.internalError();
  }
}
