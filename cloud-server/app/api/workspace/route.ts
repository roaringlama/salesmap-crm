import { authenticated, checkWriteRequest, handle, readJson } from '../../../lib/crm-http';
import { manageWorkspace, workspaceDetails } from '../../../lib/crm-service';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return handle(async () => {
    const { user, db } = await authenticated();
    return workspaceDetails(db, user, new URL(request.url).searchParams.get('workspaceId'));
  });
}

export function POST(request: Request) {
  return handle(async () => {
    checkWriteRequest(request);
    const { user, db } = await authenticated();
    const url = new URL(request.url);
    return manageWorkspace(db, user, url.searchParams.get('workspaceId'), await readJson(request, 64_000), url.origin);
  });
}
