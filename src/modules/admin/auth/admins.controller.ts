import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req, UseGuards, Delete } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { adminAcceptInvite, adminMfaConfirm, adminRoleUpsert, adminUserInvite, adminUserRolesUpdate, PERMISSIONS, SYSTEM_ROLES } from '@amora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { AuditService } from '../../../common/audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../../common/config/config';
import { FIELD_ENCRYPTION, FieldEncryption } from '../../../common/crypto/field-encryption';
import { randomToken, sha256 } from '../../../common/crypto/tokens';
import { DATABASE, type Database, type Tx } from '../../../common/db/database';
import { AppError } from '../../../common/errors/app-error';
import { clientContext } from '../../../common/http/request-context';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { MessagingService } from '../../../common/messaging/messaging';
import { PasswordService } from '../../auth/password.service';
import type { AdminContext } from './admin-auth.service';
import { AdminGuard, AllowWithoutMfa, CurrentAdmin, RequirePermissions, SkipCsrf } from './admin.guard';
import { base32Decode, verifyTotp } from './totp';
import { newTotpSecret, otpauthUrl } from './totp-secret';

type B<T extends z.ZodType> = z.infer<T>;
const id = new ParseUUIDPipe();
const INVITE_TTL_MS = 72 * 3_600_000;

/** Own-account security: MFA enrolment / disable. */
@ApiTags('admin-auth')
@Controller('admin/auth/mfa')
@UseGuards(AdminGuard)
export class AdminMfaController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FIELD_ENCRYPTION) private readonly enc: FieldEncryption,
    private readonly audit: AuditService,
  ) {}

  /** Starts enrolment; the secret stays pending until a valid code confirms it. */
  @Post('setup')
  @HttpCode(200)
  @RequirePermissions()
  @AllowWithoutMfa()
  async setup(@CurrentAdmin() a: AdminContext) {
    const row = await this.db.selectFrom('admin_users').select(['mfa_enabled_at']).where('id', '=', a.adminId).executeTakeFirstOrThrow();
    if (row.mfa_enabled_at) throw new AppError('CONFLICT', 'MFA already enabled');
    const secret = newTotpSecret();
    await this.db.updateTable('admin_users').set({ mfa_secret_enc: this.enc.encrypt(secret) }).where('id', '=', a.adminId).execute();
    return { secret, otpauthUrl: otpauthUrl(secret, a.email, 'LOL Admin') };
  }

  @Post('confirm')
  @HttpCode(204)
  @RequirePermissions()
  @AllowWithoutMfa()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async confirm(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminMfaConfirm)) b: B<typeof adminMfaConfirm>) {
    const row = await this.db.selectFrom('admin_users').select(['mfa_secret_enc', 'mfa_enabled_at']).where('id', '=', a.adminId).executeTakeFirstOrThrow();
    if (!row.mfa_secret_enc || row.mfa_enabled_at) throw new AppError('CONFLICT', 'Start MFA setup first');
    if (!verifyTotp(base32Decode(this.enc.decrypt(row.mfa_secret_enc as Buffer)), b.code)) throw new AppError('OTP_INVALID', 'Incorrect authenticator code');
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('admin_users').set({ mfa_enabled_at: new Date() }).where('id', '=', a.adminId).execute();
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'admin.mfa_enabled', targetType: 'admin_user', targetId: a.adminId, client: clientContext(req) }, trx);
    });
  }

  @Post('disable')
  @HttpCode(204)
  @RequirePermissions()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async disable(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminMfaConfirm)) b: B<typeof adminMfaConfirm>) {
    const row = await this.db.selectFrom('admin_users').select(['mfa_secret_enc', 'mfa_enabled_at']).where('id', '=', a.adminId).executeTakeFirstOrThrow();
    if (!row.mfa_enabled_at || !row.mfa_secret_enc) throw new AppError('CONFLICT', 'MFA is not enabled');
    if (!verifyTotp(base32Decode(this.enc.decrypt(row.mfa_secret_enc as Buffer)), b.code)) throw new AppError('OTP_INVALID', 'Incorrect authenticator code');
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('admin_users').set({ mfa_enabled_at: null, mfa_secret_enc: null }).where('id', '=', a.adminId).execute();
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'admin.mfa_disabled', targetType: 'admin_user', targetId: a.adminId, client: clientContext(req) }, trx);
    });
  }
}

/** Accepting an invite is unauthenticated (the one-time token is the credential). */
@ApiTags('admin-auth')
@Controller('admin/auth')
export class AdminInviteAcceptController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  @Post('accept-invite')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async accept(@Req() req: Request, @Body(new ZodPipe(adminAcceptInvite)) b: B<typeof adminAcceptInvite>) {
    const inv = await this.db.selectFrom('admin_invites').selectAll().where('token_hash', '=', sha256(b.token)).executeTakeFirst();
    if (!inv || inv.used_at || new Date(inv.expires_at) < new Date()) throw new AppError('TOKEN_INVALID');
    const hash = await this.passwords.hash(b.password);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('admin_invites').set({ used_at: new Date() }).where('id', '=', inv.id).execute();
      await trx.updateTable('admin_users').set({ password_hash: hash, status: 'active' }).where('id', '=', inv.admin_user_id).where('status', '=', 'invited').execute();
      await this.audit.record({ actorType: 'admin', actorId: inv.admin_user_id, action: 'admin.invite_accepted', targetType: 'admin_user', targetId: inv.admin_user_id, client: clientContext(req) }, trx);
    });
  }
}

/** Admin users & roles (BRD §19 "Roles and permissions"; TECH §13). */
@ApiTags('admin-admins')
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly messaging: MessagingService,
  ) {}

  @Get('admins')
  @RequirePermissions('admins.manage')
  async list() {
    const admins = await this.db.selectFrom('admin_users').select(['id', 'email', 'display_name', 'status', 'mfa_enabled_at', 'last_login_at', 'created_at']).orderBy('email').execute();
    const roles = await this.db.selectFrom('admin_user_roles as ur').innerJoin('admin_roles as r', 'r.id', 'ur.role_id').select(['ur.admin_user_id', 'r.key', 'ur.country_scope']).execute();
    return admins.map((a) => ({ ...a, mfaEnabled: !!a.mfa_enabled_at, roles: roles.filter((r) => r.admin_user_id === a.id).map((r) => ({ key: r.key, countryScope: r.country_scope })) }));
  }

  @Post('admins')
  @RequirePermissions('admins.manage')
  async invite(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminUserInvite)) b: B<typeof adminUserInvite>) {
    await this.assertCanGrant(a, b.roleKeys);
    const token = randomToken(32);
    const created = await this.db.transaction().execute(async (trx) => {
      const exists = await trx.selectFrom('admin_users').select('id').where('email', '=', b.email.toLowerCase()).executeTakeFirst();
      if (exists) throw new AppError('CONFLICT', 'An admin with this email exists');
      const admin = await trx.insertInto('admin_users').values({ email: b.email.toLowerCase(), display_name: b.displayName, status: 'invited', created_by: a.adminId }).returning('id').executeTakeFirstOrThrow();
      await this.setRoles(trx, admin.id, b.roleKeys, b.countryScope, a.adminId);
      await trx.insertInto('admin_invites').values({ admin_user_id: admin.id, token_hash: sha256(token), invited_by: a.adminId, expires_at: new Date(Date.now() + INVITE_TTL_MS) }).execute();
      const link = `${this.cfg.ADMIN_CONSOLE_URL.replace(/\/$/, '')}/accept-invite?token=${encodeURIComponent(token)}`;
      // The email is sent from the 'admin.invite' template by NotificationsService (no module cycle; retried by the outbox).
      await this.outbox.enqueue(trx, 'admin.invite_email', { email: b.email, link, hours: INVITE_TTL_MS / 3_600_000 }, { aggregateId: admin.id });
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'admins.invited', targetType: 'admin_user', targetId: admin.id, after: { email: b.email, roles: b.roleKeys, countryScope: b.countryScope }, client: clientContext(req) }, trx);
      return admin;
    });
    return { id: created.id, inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString() };
  }

  @Put('admins/:id/roles')
  @RequirePermissions('admins.manage')
  async roles(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) adminId: string, @Body(new ZodPipe(adminUserRolesUpdate)) b: B<typeof adminUserRolesUpdate>) {
    await this.assertCanGrant(a, b.roleKeys);
    if (adminId === a.adminId && !b.roleKeys.includes('super_admin') && a.permissions.has('admins.manage')) {
      const mine = await this.db.selectFrom('admin_user_roles as ur').innerJoin('admin_roles as r', 'r.id', 'ur.role_id').select('r.key').where('ur.admin_user_id', '=', a.adminId).execute();
      if (mine.some((m) => m.key === 'super_admin')) throw new AppError('CONFLICT', 'You cannot remove your own Super Admin role');
    }
    await this.db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('admin_user_roles as ur').innerJoin('admin_roles as r', 'r.id', 'ur.role_id').select('r.key').where('ur.admin_user_id', '=', adminId).execute();
      await this.setRoles(trx, adminId, b.roleKeys, b.countryScope, a.adminId);
      await this.assertSuperAdminRemains(trx);
      // Permission changes take effect immediately: end the admin's sessions.
      await trx.updateTable('admin_sessions').set({ revoked_at: new Date() }).where('admin_user_id', '=', adminId).where('revoked_at', 'is', null).execute();
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'admins.roles_updated', targetType: 'admin_user', targetId: adminId, before: before.map((r) => r.key), after: { roles: b.roleKeys, countryScope: b.countryScope }, client: clientContext(req) }, trx);
    });
  }

  @Post('admins/:id/:op')
  @HttpCode(204)
  @RequirePermissions('admins.manage')
  async op(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) adminId: string, @Param('op') op: string) {
    if (!['disable', 'enable', 'reset-mfa'].includes(op)) throw new AppError('NOT_FOUND');
    if (adminId === a.adminId && op === 'disable') throw new AppError('CONFLICT', 'You cannot disable yourself');
    await this.db.transaction().execute(async (trx) => {
      if (op === 'disable') await trx.updateTable('admin_users').set({ status: 'disabled' }).where('id', '=', adminId).execute();
      // An admin disabled before accepting their invite has no password: re-enabling returns them to 'invited' so the
      // invite flow (re-send from the console) still works, instead of an 'active' account nobody can sign in to.
      if (op === 'enable') await trx.updateTable('admin_users').set((eb) => ({ status: eb.case().when('password_hash', 'is', null).then('invited').else('active').end(), failed_login_count: 0, locked_until: null })).where('id', '=', adminId).where('status', '=', 'disabled').execute();
      if (op === 'reset-mfa') await trx.updateTable('admin_users').set({ mfa_enabled_at: null, mfa_secret_enc: null }).where('id', '=', adminId).execute();
      if (op !== 'enable') await trx.updateTable('admin_sessions').set({ revoked_at: new Date() }).where('admin_user_id', '=', adminId).where('revoked_at', 'is', null).execute();
      if (op === 'disable') await this.assertSuperAdminRemains(trx);
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: `admins.${op}`, targetType: 'admin_user', targetId: adminId, client: clientContext(req) }, trx);
    });
  }

  @Get('roles')
  @RequirePermissions('admins.manage')
  async listRoles() {
    const roles = await this.db.selectFrom('admin_roles').selectAll().orderBy('key').execute();
    const perms = await this.db.selectFrom('admin_role_permissions').selectAll().execute();
    return roles.map((r) => ({ ...r, permissions: perms.filter((p) => p.role_id === r.id).map((p) => p.permission_key).sort() }));
  }

  /** Custom roles only; system roles are defined in code (@amora/shared SYSTEM_ROLES) and re-synced on deploy. */
  @Put('roles/:key')
  @RequirePermissions('admins.manage')
  async upsertRole(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminRoleUpsert)) b: B<typeof adminRoleUpsert>) {
    if (!/^[a-z0-9_]{2,64}$/.test(key) || key in SYSTEM_ROLES) throw new AppError('CONFLICT', 'System roles cannot be edited');
    const unknown = b.permissions.filter((p) => !(p in PERMISSIONS));
    if (unknown.length) throw new AppError('VALIDATION_FAILED', `Unknown permissions: ${unknown.join(', ')}`);
    const escalation = b.permissions.filter((p) => !a.permissions.has(p as keyof typeof PERMISSIONS));
    if (escalation.length) throw new AppError('FORBIDDEN', 'You cannot grant permissions you do not hold', { missing: escalation });
    return this.db.transaction().execute(async (trx) => {
      const role = await trx.insertInto('admin_roles').values({ key, name: b.name, description: b.description ?? null, is_system: false })
        .onConflict((oc) => oc.column('key').doUpdateSet({ name: b.name, description: b.description ?? null })).returning('id').executeTakeFirstOrThrow();
      await trx.deleteFrom('admin_role_permissions').where('role_id', '=', role.id).execute();
      if (b.permissions.length) await trx.insertInto('admin_role_permissions').values(b.permissions.map((permission_key) => ({ role_id: role.id, permission_key }))).execute();
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'admins.role_upserted', targetType: 'admin_role', targetId: key, after: b, client: clientContext(req) }, trx);
      return { key, permissions: b.permissions };
    });
  }

  @Delete('roles/:key')
  @HttpCode(204)
  @RequirePermissions('admins.manage')
  async deleteRole(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string) {
    const role = await this.db.selectFrom('admin_roles').select(['id', 'is_system']).where('key', '=', key).executeTakeFirst();
    if (!role) throw new AppError('NOT_FOUND');
    if (role.is_system) throw new AppError('CONFLICT', 'System roles cannot be deleted');
    if (await this.db.selectFrom('admin_user_roles').select('role_id').where('role_id', '=', role.id).executeTakeFirst()) throw new AppError('CONFLICT', 'Role is still assigned');
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('admin_roles').where('id', '=', role.id).execute();
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'admins.role_deleted', targetType: 'admin_role', targetId: key, client: clientContext(req) }, trx);
    });
  }

  private async assertCanGrant(a: AdminContext, roleKeys: string[]) {
    const rows = await this.db.selectFrom('admin_roles as r').leftJoin('admin_role_permissions as p', 'p.role_id', 'r.id').select(['r.key', 'p.permission_key']).where('r.key', 'in', roleKeys.length ? roleKeys : ['__none__']).execute();
    const found = new Set(rows.map((r) => r.key));
    const missingRoles = roleKeys.filter((k) => !found.has(k));
    if (missingRoles.length) throw new AppError('VALIDATION_FAILED', `Unknown roles: ${missingRoles.join(', ')}`);
    // No privilege escalation: you can only grant roles whose permissions you hold yourself.
    const escalation = [...new Set(rows.map((r) => r.permission_key).filter((p): p is string => !!p && !a.permissions.has(p as keyof typeof PERMISSIONS)))];
    if (escalation.length) throw new AppError('FORBIDDEN', 'You cannot grant permissions you do not hold', { missing: escalation });
  }

  private async setRoles(trx: Tx, adminId: string, roleKeys: string[], countryScope: string[] | null, grantedBy: string) {
    await trx.deleteFrom('admin_user_roles').where('admin_user_id', '=', adminId).execute();
    if (!roleKeys.length) return;
    const roles = await trx.selectFrom('admin_roles').select('id').where('key', 'in', roleKeys).execute();
    await trx.insertInto('admin_user_roles').values(roles.map((r) => ({ admin_user_id: adminId, role_id: r.id, country_scope: countryScope, granted_by: grantedBy }))).execute();
  }

  private async assertSuperAdminRemains(trx: Tx) {
    const n = await trx.selectFrom('admin_user_roles as ur').innerJoin('admin_roles as r', 'r.id', 'ur.role_id').innerJoin('admin_users as u', 'u.id', 'ur.admin_user_id')
      .select('u.id').where('r.key', '=', 'super_admin').where('u.status', '=', 'active').executeTakeFirst();
    if (!n) throw new AppError('CONFLICT', 'At least one active Super Admin must remain');
  }
}
