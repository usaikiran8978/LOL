import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  adminEventCreate, adminEventDecision, adminEventUpdate, aiDatePlanRequest, callStart, dateFeedbackCreate, dateIdeasQuery, datePlanCreate, datePlanRespond, datePlanUpdate, eventCheckIn, eventCreate, eventFeedback,
  eventRegister, eventsQuery, pageQuery, safetyLocationPing, safetySessionStart, safetySos, trustedContactCreate,
} from '@amora/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import { requestLocale } from '../../common/http/locale';
import { ZodPipe } from '../../common/http/zod.pipe';
import type { AdminContext } from '../admin/auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermissions } from '../admin/auth/admin.guard';
import { CurrentUser, UserAuthGuard, type AuthContext } from '../auth/auth.guard';
import { CallsService } from '../calls/calls.service';
import { CoupleService } from '../calls/couple.service';
import { EventsService } from '../events/events.service';
import { DateSafetyService } from './date-safety.service';
import { DatesService } from './dates.service';

type B<T extends z.ZodType> = z.infer<T>;
const id = new ParseUUIDPipe();

@ApiTags('events')
@Controller('events')
@UseGuards(UserAuthGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query(new ZodPipe(eventsQuery)) q: B<typeof eventsQuery>, @Req() req: Request) {
    return this.events.list(u.userId, q, requestLocale(req));
  }

  @Post()
  create(@CurrentUser() u: AuthContext, @Body(new ZodPipe(eventCreate)) b: B<typeof eventCreate>) {
    return this.events.create(u.userId, b);
  }

  @Get('recommended')
  recommended(@CurrentUser() u: AuthContext, @Req() req: Request) {
    return this.events.recommended(u.userId, requestLocale(req));
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', id) eid: string) {
    return this.events.get(u.userId, eid);
  }

  @Delete(':id')
  @HttpCode(204)
  async cancel(@CurrentUser() u: AuthContext, @Param('id', id) eid: string) {
    await this.events.cancelEvent(u.userId, eid);
  }

  @Post(':id/registration')
  register(@CurrentUser() u: AuthContext, @Param('id', id) eid: string, @Body(new ZodPipe(eventRegister)) b: B<typeof eventRegister>) {
    return this.events.register(u.userId, eid, b.openToMeet, b);
  }

  @Delete(':id/registration')
  @HttpCode(204)
  async unregister(@CurrentUser() u: AuthContext, @Param('id', id) eid: string) {
    await this.events.cancelRegistration(u.userId, eid);
  }

  @Get(':id/attendees')
  attendees(@CurrentUser() u: AuthContext, @Param('id', id) eid: string) {
    return this.events.attendees(u.userId, eid);
  }

  @Post(':id/check-in')
  @HttpCode(204)
  async checkIn(@CurrentUser() u: AuthContext, @Param('id', id) eid: string, @Body(new ZodPipe(eventCheckIn)) b: B<typeof eventCheckIn>) {
    await this.events.checkIn(u.userId, eid, b.userId, b.code);
  }

  @Post(':id/feedback')
  @HttpCode(204)
  async feedback(@CurrentUser() u: AuthContext, @Param('id', id) eid: string, @Body(new ZodPipe(eventFeedback)) b: B<typeof eventFeedback>) {
    await this.events.feedback(u.userId, eid, b);
  }
}

@ApiTags('dates')
@Controller('dates')
@UseGuards(UserAuthGuard)
export class DatesController {
  constructor(
    private readonly dates: DatesService,
    private readonly safety: DateSafetyService,
  ) {}

  @Get('ideas')
  ideas(@CurrentUser() u: AuthContext, @Query(new ZodPipe(dateIdeasQuery)) q: B<typeof dateIdeasQuery>, @Req() req: Request) {
    return this.dates.ideas(u.userId, q, requestLocale(req));
  }

  @Post('ideas/ai')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  aiIdeas(@CurrentUser() u: AuthContext, @Body(new ZodPipe(aiDatePlanRequest)) b: B<typeof aiDatePlanRequest>, @Req() req: Request) {
    return this.dates.aiPlan(u.userId, b, requestLocale(req));
  }

  @Post()
  create(@CurrentUser() u: AuthContext, @Body(new ZodPipe(datePlanCreate)) b: B<typeof datePlanCreate>) {
    return this.dates.create(u.userId, b);
  }

  @Get('match/:matchId')
  forMatch(@CurrentUser() u: AuthContext, @Param('matchId', id) mid: string) {
    return this.dates.listForMatch(u.userId, mid);
  }

  @Get('journey/:matchId')
  journey(@CurrentUser() u: AuthContext, @Param('matchId', id) mid: string) {
    return this.dates.journey(u.userId, mid);
  }

  // ---- safety (declared before ':id' routes)

  @Get('safety/contacts')
  contacts(@CurrentUser() u: AuthContext) {
    return this.safety.listContacts(u.userId);
  }

  @Post('safety/contacts')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  addContact(@CurrentUser() u: AuthContext, @Body(new ZodPipe(trustedContactCreate)) b: B<typeof trustedContactCreate>) {
    return this.safety.addContact(u.userId, b);
  }

  @Post('safety/contacts/:id/resend')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  resendContact(@CurrentUser() u: AuthContext, @Param('id', id) cid: string) {
    return this.safety.resendInvite(u.userId, cid);
  }

  @Delete('safety/contacts/:id')
  @HttpCode(204)
  async removeContact(@CurrentUser() u: AuthContext, @Param('id', id) cid: string) {
    await this.safety.removeContact(u.userId, cid);
  }

  @Post('safety/sessions')
  startSession(@CurrentUser() u: AuthContext, @Body(new ZodPipe(safetySessionStart)) b: B<typeof safetySessionStart>) {
    return this.safety.start(u.userId, b);
  }

  @Get('safety/sessions/active')
  activeSession(@CurrentUser() u: AuthContext) {
    return this.safety.activeSession(u.userId);
  }

  @Get('safety/sessions/:id')
  session(@CurrentUser() u: AuthContext, @Param('id', id) sid: string) {
    return this.safety.session(u.userId, sid);
  }

  @Post('safety/sessions/:id/check-in')
  @HttpCode(200)
  checkIn(@CurrentUser() u: AuthContext, @Param('id', id) sid: string, @Body(new ZodPipe(z.object({ extendMin: z.number().int().min(5).max(600).optional() }))) b: { extendMin?: number }) {
    return this.safety.checkIn(u.userId, sid, b.extendMin);
  }

  @Post('safety/sessions/:id/check-out')
  @HttpCode(200)
  checkOut(@CurrentUser() u: AuthContext, @Param('id', id) sid: string) {
    return this.safety.checkOut(u.userId, sid);
  }

  @Post('safety/sessions/:id/location')
  @HttpCode(204)
  async ping(@CurrentUser() u: AuthContext, @Param('id', id) sid: string, @Body(new ZodPipe(safetyLocationPing)) b: B<typeof safetyLocationPing>) {
    await this.safety.ping(u.userId, sid, b);
  }

  @Post('safety/sessions/:id/sos')
  @HttpCode(200)
  sos(@CurrentUser() u: AuthContext, @Param('id', id) sid: string, @Body(new ZodPipe(safetySos)) b: B<typeof safetySos>) {
    return this.safety.sos(u.userId, sid, b);
  }

  // ---- plans

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', id) pid: string) {
    return this.dates.get(u.userId, pid);
  }

  @Put(':id')
  update(@CurrentUser() u: AuthContext, @Param('id', id) pid: string, @Body(new ZodPipe(datePlanUpdate)) b: B<typeof datePlanUpdate>) {
    return this.dates.update(u.userId, pid, b);
  }

  @Post(':id/response')
  @HttpCode(200)
  respond(@CurrentUser() u: AuthContext, @Param('id', id) pid: string, @Body(new ZodPipe(datePlanRespond)) b: B<typeof datePlanRespond>) {
    return this.dates.respond(u.userId, pid, b.response);
  }

  @Delete(':id')
  @HttpCode(204)
  async cancel(@CurrentUser() u: AuthContext, @Param('id', id) pid: string) {
    await this.dates.cancel(u.userId, pid);
  }

  @Put(':id/reminders')
  @HttpCode(204)
  async reminders(@CurrentUser() u: AuthContext, @Param('id', id) pid: string, @Body(new ZodPipe(z.object({ minutesBefore: z.array(z.number().int().min(5).max(2880)).max(4) }))) b: { minutesBefore: number[] }) {
    await this.dates.setReminders(u.userId, pid, b.minutesBefore);
  }

  @Get(':id/calendar.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  ics(@CurrentUser() u: AuthContext, @Param('id', id) pid: string) {
    return this.dates.ics(u.userId, pid);
  }

  @Post(':id/feedback')
  @HttpCode(204)
  async feedback(@CurrentUser() u: AuthContext, @Param('id', id) pid: string, @Body(new ZodPipe(dateFeedbackCreate)) b: B<typeof dateFeedbackCreate>) {
    await this.dates.feedback(u.userId, pid, b);
  }
}

/** Unauthenticated endpoints for trusted contacts (they don't have accounts). Token is the credential. */
@ApiTags('safety-public')
@Controller('public/safety')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class PublicSafetyController {
  constructor(private readonly safety: DateSafetyService) {}

  @Post('trusted-contacts/:id/confirm')
  @HttpCode(204)
  async confirm(@Param('id', id) cid: string, @Body(new ZodPipe(z.object({ token: z.string().min(20).max(100) }))) b: { token: string }) {
    await this.safety.confirmContact(cid, b.token);
  }

  @Get('sessions/:token')
  view(@Param('token') token: string) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new AppError('NOT_FOUND');
    return this.safety.contactView(token);
  }
}

@ApiTags('calls')
@Controller()
@UseGuards(UserAuthGuard)
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly couple: CoupleService,
  ) {}

  @Post('conversations/:id/calls')
  start(@CurrentUser() u: AuthContext, @Param('id', id) cid: string, @Body(new ZodPipe(callStart)) b: B<typeof callStart>) {
    return this.calls.start(u.userId, cid, b.kind);
  }

  @Post('calls/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() u: AuthContext, @Param('id', id) callId: string) {
    return this.calls.accept(u.userId, callId);
  }

  @Post('calls/:id/decline')
  @HttpCode(204)
  async decline(@CurrentUser() u: AuthContext, @Param('id', id) callId: string) {
    await this.calls.decline(u.userId, callId);
  }

  @Post('calls/:id/end')
  @HttpCode(204)
  async end(@CurrentUser() u: AuthContext, @Param('id', id) callId: string) {
    await this.calls.end(u.userId, callId);
  }

  @Get('matches/:id/couple-space')
  coupleGet(@CurrentUser() u: AuthContext, @Param('id', id) mid: string) {
    return this.couple.get(u.userId, mid);
  }

  @Post('matches/:id/couple-space')
  @HttpCode(200)
  coupleConsent(@CurrentUser() u: AuthContext, @Param('id', id) mid: string, @Body(new ZodPipe(z.object({ pauseDiscovery: z.boolean().default(false) }))) b: { pauseDiscovery: boolean }) {
    return this.couple.consent(u.userId, mid, b.pauseDiscovery);
  }

  @Delete('matches/:id/couple-space')
  @HttpCode(204)
  async coupleClose(@CurrentUser() u: AuthContext, @Param('id', id) mid: string) {
    await this.couple.close(u.userId, mid);
  }
}

@ApiTags('admin-events')
@Controller('admin/events')
@UseGuards(AdminGuard)
export class AdminEventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @RequirePermissions('events.view')
  list(@CurrentAdmin() a: AdminContext, @Query(new ZodPipe(pageQuery.extend({ status: z.enum(['draft', 'pending_review', 'published', 'cancelled', 'completed', 'rejected']).optional() }))) q: { limit: number; cursor?: string; status?: string }) {
    return this.events.adminList(q.status, a.countryScope, q.limit, q.cursor);
  }

  @Post()
  @RequirePermissions('events.manage')
  async create(@CurrentAdmin() a: AdminContext, @Body(new ZodPipe(adminEventCreate)) b: B<typeof adminEventCreate>) {
    if (a.countryScope) {
      const city = await this.events.cityCountry(b.cityId);
      if (!city || !a.countryScope.includes(city)) throw new AppError('FORBIDDEN', 'City outside your country scope');
    }
    return this.events.adminCreate(a.adminId, b);
  }

  @Put(':id')
  @RequirePermissions('events.manage')
  async update(@CurrentAdmin() a: AdminContext, @Param('id', id) eid: string, @Body(new ZodPipe(adminEventUpdate)) b: B<typeof adminEventUpdate>) {
    await this.events.assertEventInScope(eid, a.countryScope);
    if (b.cityId && a.countryScope) {
      const city = await this.events.cityCountry(b.cityId);
      if (!city || !a.countryScope.includes(city)) throw new AppError('FORBIDDEN', 'City outside your country scope');
    }
    return this.events.adminUpdate(a.adminId, eid, b);
  }

  @Get(':id')
  @RequirePermissions('events.view')
  async detail(@CurrentAdmin() a: AdminContext, @Param('id', id) eid: string) {
    await this.events.assertEventInScope(eid, a.countryScope);
    return this.events.adminDetail(eid);
  }

  @Get(':id/attendees')
  @RequirePermissions('events.view')
  async attendees(@CurrentAdmin() a: AdminContext, @Param('id', id) eid: string) {
    await this.events.assertEventInScope(eid, a.countryScope);
    return this.events.roster(eid);
  }

  @Post(':id/decision')
  @HttpCode(204)
  @RequirePermissions('events.manage')
  async decide(@CurrentAdmin() a: AdminContext, @Param('id', id) eid: string, @Body(new ZodPipe(adminEventDecision)) b: B<typeof adminEventDecision>) {
    await this.events.assertEventInScope(eid, a.countryScope);
    await this.events.adminDecide(a.adminId, eid, b.decision, b.note);
  }

  @Post(':id/check-in')
  @HttpCode(204)
  @RequirePermissions('events.manage')
  async checkIn(@CurrentAdmin() a: AdminContext, @Param('id', id) eid: string, @Body(new ZodPipe(eventCheckIn)) b: B<typeof eventCheckIn>) {
    await this.events.assertEventInScope(eid, a.countryScope);
    await this.events.checkIn(null, eid, b.userId, b.code, a.adminId);
  }
}
