import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const crmWorkspaces = sqliteTable('crm_workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull().unique(),
  createdAt: text('created_at').notNull(),
});

export const crmMembers = sqliteTable('crm_members', {
  workspaceId: text('workspace_id').notNull().references(() => crmWorkspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  role: text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull(),
  email: text('email').notNull(),
  name: text('name').notNull(),
}, table => [primaryKey({ columns: [table.workspaceId, table.userId] })]);

export const crmSnapshots = sqliteTable('crm_snapshots', {
  workspaceId: text('workspace_id').primaryKey().references(() => crmWorkspaces.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const crmInvites = sqliteTable('crm_invites', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => crmWorkspaces.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  email: text('email').notNull(),
  role: text('role', { enum: ['editor', 'viewer'] }).notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
  cancelled: integer('cancelled', { mode: 'boolean' }).notNull().default(false),
  acceptedBy: text('accepted_by'),
}, table => [uniqueIndex('crm_invites_token_hash_unique').on(table.tokenHash)]);
