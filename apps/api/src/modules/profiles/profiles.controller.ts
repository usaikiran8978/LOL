import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  attributesUpdate, interestsUpdate, languagesUpdate, locationUpdate, mediaConfirm, mediaReorder, mediaUploadRequest, onboardingStepUpdate,
  preferencesUpdate, privacyUpdate, profileUpdate, promptsUpdate,
} from '@amora/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { requestLocale } from '../../common/http/locale';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentUser, UserAuthGuard, type AuthContext } from '../auth/auth.guard';
import { EntitlementsService } from '../platform/entitlements.service';
import { LocationService } from './location.service';
import { MediaService } from './media.service';
import { OnboardingService } from './onboarding.service';
import { PreferencesService } from './preferences.service';
import { ProfilesService } from './profiles.service';

type Body<T extends z.ZodType> = z.infer<T>;

@ApiTags('profiles')
@Controller('profiles')
@UseGuards(UserAuthGuard)
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get('me')
  me(@CurrentUser() u: AuthContext, @Req() req: Request) {
    return this.profiles.getOwn(u.userId, requestLocale(req));
  }

  @Put('me')
  update(@CurrentUser() u: AuthContext, @Body(new ZodPipe(profileUpdate)) body: Body<typeof profileUpdate>, @Req() req: Request) {
    return this.profiles.update(u.userId, body, requestLocale(req));
  }

  @Put('me/attributes')
  attributes(@CurrentUser() u: AuthContext, @Body(new ZodPipe(attributesUpdate)) body: Body<typeof attributesUpdate>, @Req() req: Request) {
    return this.profiles.setAttributes(u.userId, body.attributes, requestLocale(req));
  }

  @Put('me/interests')
  interests(@CurrentUser() u: AuthContext, @Body(new ZodPipe(interestsUpdate)) body: Body<typeof interestsUpdate>, @Req() req: Request) {
    return this.profiles.setInterests(u.userId, body.interestIds, requestLocale(req));
  }

  @Put('me/languages')
  languages(@CurrentUser() u: AuthContext, @Body(new ZodPipe(languagesUpdate)) body: Body<typeof languagesUpdate>, @Req() req: Request) {
    return this.profiles.setLanguages(u.userId, body.languages, requestLocale(req));
  }

  @Put('me/prompts')
  prompts(@CurrentUser() u: AuthContext, @Body(new ZodPipe(promptsUpdate)) body: Body<typeof promptsUpdate>, @Req() req: Request) {
    return this.profiles.setPrompts(u.userId, body.prompts, requestLocale(req));
  }

  @Get('me/privacy')
  privacy(@CurrentUser() u: AuthContext) {
    return this.profiles.privacy(u.userId);
  }

  @Put('me/privacy')
  async updatePrivacy(@CurrentUser() u: AuthContext, @Body(new ZodPipe(privacyUpdate)) body: Body<typeof privacyUpdate>) {
    return this.profiles.updatePrivacy(u.userId, body, body.incognito ? await this.entitlements.has(u.userId, 'incognito') : true);
  }

  @Get(':id')
  view(@CurrentUser() u: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Query('surface') surface: string | undefined, @Req() req: Request) {
    const s = surface && /^[a-z_]{1,30}$/.test(surface) ? surface : 'profile';
    return this.profiles.view(u.userId, id, s, requestLocale(req));
  }
}

@ApiTags('media')
@Controller('media')
@UseGuards(UserAuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  list(@CurrentUser() u: AuthContext) {
    return this.media.list(u.userId);
  }

  @Post('uploads')
  upload(@CurrentUser() u: AuthContext, @Body(new ZodPipe(mediaUploadRequest)) body: Body<typeof mediaUploadRequest>) {
    return this.media.requestUpload(u.userId, body.kind, body.mimeType, body.byteSize);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() u: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(mediaConfirm)) body: Body<typeof mediaConfirm>) {
    return this.media.confirm(u.userId, id, body.caption);
  }

  @Put('order')
  reorder(@CurrentUser() u: AuthContext, @Body(new ZodPipe(mediaReorder)) body: Body<typeof mediaReorder>) {
    return this.media.reorder(u.userId, body.mediaIds);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.media.remove(u.userId, id);
  }
}

@ApiTags('preferences')
@Controller('preferences')
@UseGuards(UserAuthGuard)
export class PreferencesController {
  constructor(
    private readonly prefs: PreferencesService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get()
  get(@CurrentUser() u: AuthContext) {
    return this.prefs.get(u.userId);
  }

  @Put()
  async update(@CurrentUser() u: AuthContext, @Body(new ZodPipe(preferencesUpdate)) body: Body<typeof preferencesUpdate>) {
    return this.prefs.update(u.userId, body, { advancedFilters: await this.entitlements.has(u.userId, 'advanced_filters') });
  }
}

@ApiTags('location')
@Controller('location')
@UseGuards(UserAuthGuard)
export class LocationController {
  constructor(private readonly location: LocationService) {}

  @Put()
  update(@CurrentUser() u: AuthContext, @Body(new ZodPipe(locationUpdate)) body: Body<typeof locationUpdate>) {
    return this.location.update(u.userId, body);
  }
}

@ApiTags('onboarding')
@Controller('onboarding')
@UseGuards(UserAuthGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  get(@CurrentUser() u: AuthContext) {
    return this.onboarding.state_(u.userId);
  }

  @Put('step')
  step(@CurrentUser() u: AuthContext, @Body(new ZodPipe(onboardingStepUpdate)) body: Body<typeof onboardingStepUpdate>) {
    return this.onboarding.saveStep(u.userId, body.step, body.draft, body.complete, body.skip);
  }

  @Post('complete')
  @HttpCode(200)
  complete(@CurrentUser() u: AuthContext) {
    return this.onboarding.complete(u.userId);
  }
}
