import { authenticated, checkWriteRequest, handle, readJson } from '../../../lib/crm-http';
import { MAX_SNAPSHOT_BYTES, readSnapshot, writeSnapshot } from '../../../lib/crm-service';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return handle(async () => {
    const { user, db } = await authenticated();
    return readSnapshot(db, user, new URL(request.url).searchParams.get('workspaceId'));
  });
}

export function PUT(request: Request) {
  return handle(async () => {
    checkWriteRequest(request);
    const { user, db } = await authenticated();
    const body = await readJson(request, MAX_SNAPSHOT_BYTES + 64_000);
    return writeSnapshot(db, user, new URL(request.url).searchParams.get('workspaceId'), body);
  });
}
