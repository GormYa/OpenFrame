import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { POST as startTrialRoute } from '@/app/api/billing/trial/route';
import { apiRequest, callRoute, readData } from '../helpers/request';
import { signedInAs, signedOut } from '../helpers/session';
import { addWorkspaceMember, createExpiredUser, createUser, seedProject } from '../factories';

const ORIGIN_HEADERS = { origin: 'http://localhost:3000' };

function startTrialRequest() {
  return apiRequest('/api/billing/trial', { method: 'POST', headers: ORIGIN_HEADERS });
}

describe('POST /api/billing/trial', () => {
  it('returns 401 without a session', async () => {
    signedOut();

    const response = await callRoute(startTrialRoute, startTrialRequest());

    expect(response.status).toBe(401);
  });

  it('rejects a cross-origin request', async () => {
    const response = await callRoute(
      startTrialRoute,
      apiRequest('/api/billing/trial', { method: 'POST', headers: { origin: 'https://evil.test' } })
    );

    expect(response.status).toBe(403);
  });

  // The whole point of the endpoint: an invited collaborator whose trial was
  // deferred at signup claims it here, explicitly, and nowhere else.
  it('starts the deferred trial for a collaborator who asks for it', async () => {
    const host = await seedProject();
    const invited = await createUser({ trialEndsAt: null, billingTrialConsumedAt: null });
    await addWorkspaceMember({ workspaceId: host.workspace.id, userId: invited.id });
    signedInAs(invited);

    const response = await callRoute(startTrialRoute, startTrialRequest());

    expect(response.status).toBe(200);
    const data = await readData<{ trialEndsAt: string | null }>(response);
    expect(data.trialEndsAt).not.toBeNull();

    const after = await db.user.findUniqueOrThrow({ where: { id: invited.id } });
    expect(after.billingTrialConsumedAt).not.toBeNull();
    expect(after.trialEndsAt!.getTime()).toBeGreaterThan(Date.now());
  });

  // Once per account. An expired user already spent theirs; asking again must
  // not reset the clock.
  it('refuses a second trial to an account that already spent one', async () => {
    const expired = await createExpiredUser();
    signedInAs(expired);

    const response = await callRoute(startTrialRoute, startTrialRequest());

    expect(response.status).toBe(409);
    const after = await db.user.findUniqueOrThrow({ where: { id: expired.id } });
    expect(after.trialEndsAt?.getTime()).toBeLessThan(Date.now());
  });
});
