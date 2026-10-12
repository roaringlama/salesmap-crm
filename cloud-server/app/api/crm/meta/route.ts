import { authenticated, handle } from '../../../../lib/crm-http';
import { ensurePersonalWorkspace, getWorkspaces, requireWorkspace } from '../../../../lib/crm-service';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return handle(async () => {
    const { user, db } = await authenticated();
    const personalId = await ensurePersonalWorkspace(db, user);
    const requested = new URL(request.url).searchParams.get('workspaceId');
    const current = await requireWorkspace(db, user, requested || personalId);
    return { cloud: true, user: { id: user.userId, email: user.email, name: user.fullName || user.displayName }, workspaces: await getWorkspaces(db, user), currentWorkspaceId: current.id };
  });
}
