import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { appealCreate, blockCreate, relationshipControl, reportCreate, verificationEvidenceUpload, verificationStart } from '@amora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { clientContext } from '../../common/http/request-context';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentUser, UserAuthGuard, type AuthContext } from '../auth/auth.guard';
import { SafetyService } from './safety.service';
import { VerificationService } from './verification.service';

type B<T extends z.ZodType> = z.infer<T>;
const id = new ParseUUIDPipe();

@ApiTags('safety')
@Controller()
@UseGuards(UserAuthGuard)
export class SafetyController {
  constructor(
    private readonly safety: SafetyService,
    private readonly verification: VerificationService,
  ) {}

  @Post('reports')
  report(@CurrentUser() u: AuthContext, @Body(new ZodPipe(reportCreate)) b: B<typeof reportCreate>, @Req() req: Request) {
    return this.safety.report(u.userId, b, clientContext(req));
  }

  @Get('blocks')
  blocks(@CurrentUser() u: AuthContext) {
    return this.safety.listBlocks(u.userId);
  }

  @Post('blocks')
  @HttpCode(204)
  async block(@CurrentUser() u: AuthContext, @Body(new ZodPipe(blockCreate)) b: B<typeof blockCreate>, @Req() req: Request) {
    await this.safety.block(u.userId, b.userId, b.reasonKey, clientContext(req));
  }

  @Delete('blocks/:userId')
  @HttpCode(204)
  async unblock(@CurrentUser() u: AuthContext, @Param('userId', id) target: string, @Req() req: Request) {
    await this.safety.unblock(u.userId, target, clientContext(req));
  }

  @Put('relationship-controls')
  @HttpCode(204)
  async control(@CurrentUser() u: AuthContext, @Body(new ZodPipe(relationshipControl)) b: B<typeof relationshipControl>) {
    await this.safety.setControl(u.userId, b.userId, b.control, b.enabled);
  }

  @Get('account/status')
  status(@CurrentUser() u: AuthContext) {
    return this.safety.accountStatus(u.userId);
  }

  @Post('appeals')
  appeal(@CurrentUser() u: AuthContext, @Body(new ZodPipe(appealCreate)) b: B<typeof appealCreate>, @Req() req: Request) {
    return this.safety.appeal(u.userId, b.actionId, b.statement, clientContext(req));
  }

  @Get('verification')
  verificationStatus(@CurrentUser() u: AuthContext) {
    return this.verification.status(u.userId);
  }

  @Post('verification')
  startVerification(@CurrentUser() u: AuthContext, @Body(new ZodPipe(verificationStart)) b: B<typeof verificationStart>) {
    return this.verification.start(u.userId, b.kind);
  }

  @Post('verification/:id/evidence')
  evidence(@CurrentUser() u: AuthContext, @Param('id', id) rid: string, @Body(new ZodPipe(verificationEvidenceUpload)) b: B<typeof verificationEvidenceUpload>) {
    return this.verification.evidenceUpload(u.userId, rid, b.mimeType, b.byteSize);
  }

  @Post('verification/:id/submit')
  @HttpCode(200)
  submit(@CurrentUser() u: AuthContext, @Param('id', id) rid: string) {
    return this.verification.submit(u.userId, rid);
  }
}
