import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { adminCategorySignalsInput, adminMatchingConfigInput, adminMatchTestRequest } from '@amora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { clientContext } from '../../common/http/request-context';
import { ZodPipe } from '../../common/http/zod.pipe';
import type { AdminContext } from '../admin/auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermissions } from '../admin/auth/admin.guard';
import { MatchingAdminService } from './matching-admin.service';

type B<T extends z.ZodType> = z.infer<T>;
const id = new ParseUUIDPipe();

@ApiTags('admin-matching')
@Controller('admin/matching')
@UseGuards(AdminGuard)
export class AdminMatchingController {
  constructor(private readonly svc: MatchingAdminService) {}

  @Get('configs')
  @RequirePermissions('matching.view')
  list() {
    return this.svc.list();
  }

  @Get('configs/:id')
  @RequirePermissions('matching.view')
  get(@Param('id', id) cid: string) {
    return this.svc.get(cid);
  }

  @Post('configs')
  @RequirePermissions('matching.edit')
  create(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Body() raw: unknown) {
    const empty = !raw || (typeof raw === 'object' && Object.keys(raw as object).length === 0);
    return this.svc.createDraft(a, clientContext(req), empty ? undefined : new ZodPipe(adminMatchingConfigInput).transform(raw));
  }

  @Put('configs/:id')
  @RequirePermissions('matching.edit')
  update(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) cid: string, @Body(new ZodPipe(adminMatchingConfigInput)) body: B<typeof adminMatchingConfigInput>) {
    return this.svc.updateDraft(a, clientContext(req), cid, body);
  }

  @Delete('configs/:id')
  @HttpCode(204)
  @RequirePermissions('matching.edit')
  async remove(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) cid: string) {
    await this.svc.deleteDraft(a, clientContext(req), cid);
  }

  @Get('configs/:id/validate')
  @RequirePermissions('matching.view')
  async validate(@Param('id', id) cid: string) {
    return { issues: await this.svc.validate(cid) };
  }

  @Post('configs/:id/publish')
  @HttpCode(200)
  @RequirePermissions('matching.publish')
  publish(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) cid: string) {
    return this.svc.publish(a, clientContext(req), cid);
  }

  @Put('categories/:key/signals')
  @HttpCode(204)
  @RequirePermissions('matching.edit')
  async signals(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminCategorySignalsInput)) body: B<typeof adminCategorySignalsInput>) {
    await this.svc.updateCategorySignals(a, clientContext(req), key, body);
  }

  @Post('test')
  @HttpCode(200)
  @RequirePermissions('matching.test')
  test(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminMatchTestRequest)) body: B<typeof adminMatchTestRequest>) {
    return this.svc.test(a, clientContext(req), body.userA, body.userB, body.configVersionId);
  }
}
