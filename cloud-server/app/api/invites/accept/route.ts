import { authenticated, checkWriteRequest, handle, readJson } from '../../../../lib/crm-http';
import { acceptInvite } from '../../../../lib/crm-service';

export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return handle(async () => {
    checkWriteRequest(request);
    const { user, db } = await authenticated();
    return acceptInvite(db, user, await readJson(request, 64_000));
  });
}
