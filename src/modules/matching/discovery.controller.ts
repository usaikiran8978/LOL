import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { likeRequest, pageQuery, recommendationFeedbackRequest, recommendationsQuery, searchQuery, travelPlanCreate } from '@amora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { requestLocale } from '../../common/http/locale';
import { clientContext } from '../../common/http/request-context';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentUser, UserAuthGuard, type AuthContext } from '../auth/auth.guard';
import { DiscoveryService } from './discovery.service';
import { RecommendationsService } from './recommendations.service';
import { SwipesService } from './swipes.service';

type B<T extends z.ZodType> = z.infer<T>;

@ApiTags('discovery')
@Controller()
@UseGuards(UserAuthGuard)
export class DiscoveryController {
  constructor(
    private readonly recs: RecommendationsService,
    private readonly swipes: SwipesService,
    private readonly discovery: DiscoveryService,
  ) {}

  /** Swipe deck, AI Smart Matches, daily picks, nearby, travel, interest, intent, event attendees, crossed paths. */
  @Get('recommendations')
  feed(@CurrentUser() u: AuthContext, @Query(new ZodPipe(recommendationsQuery)) q: B<typeof recommendationsQuery>, @Req() req: Request) {
    return this.recs.feed(u.userId, q.surface, q.limit, { interestId: q.interestId, intentId: q.intentId, travelPlanId: q.travelPlanId, eventId: q.eventId }, requestLocale(req));
  }

  @Post('recommendations/feedback')
  @HttpCode(204)
  async feedback(@CurrentUser() u: AuthContext, @Body(new ZodPipe(recommendationFeedbackRequest)) b: B<typeof recommendationFeedbackRequest>) {
    await this.swipes.feedback(u.userId, b.candidateId, b.outcome, b.reasonKey);
  }

  @Post('likes')
  like(@CurrentUser() u: AuthContext, @Body(new ZodPipe(likeRequest)) b: B<typeof likeRequest>) {
    return this.swipes.act(u.userId, b);
  }

  @Post('likes/rewind')
  @HttpCode(200)
  rewind(@CurrentUser() u: AuthContext) {
    return this.swipes.rewind(u.userId);
  }

  @Get('likes/received')
  received(@CurrentUser() u: AuthContext, @Query(new ZodPipe(pageQuery)) q: B<typeof pageQuery>, @Req() req: Request) {
    return this.swipes.likesReceived(u.userId, requestLocale(req), q.limit, q.cursor);
  }

  @Get('likes/sent')
  sent(@CurrentUser() u: AuthContext, @Query(new ZodPipe(pageQuery)) q: B<typeof pageQuery>, @Req() req: Request) {
    return this.swipes.likesSent(u.userId, requestLocale(req), q.limit, q.cursor);
  }

  @Get('favorites')
  favorites(@CurrentUser() u: AuthContext, @Query(new ZodPipe(pageQuery)) q: B<typeof pageQuery>, @Req() req: Request) {
    return this.swipes.listFavorites(u.userId, requestLocale(req), q.limit, q.cursor);
  }

  @Put('favorites/:userId')
  @HttpCode(204)
  async addFavorite(@CurrentUser() u: AuthContext, @Param('userId', new ParseUUIDPipe()) targetId: string) {
    await this.swipes.addFavorite(u.userId, targetId);
  }

  @Delete('favorites/:userId')
  @HttpCode(204)
  async removeFavorite(@CurrentUser() u: AuthContext, @Param('userId', new ParseUUIDPipe()) targetId: string) {
    await this.swipes.removeFavorite(u.userId, targetId);
  }

  @Get('matches')
  matches(@CurrentUser() u: AuthContext, @Query(new ZodPipe(pageQuery)) q: B<typeof pageQuery>, @Req() req: Request) {
    return this.swipes.listMatches(u.userId, requestLocale(req), q.limit, q.cursor);
  }

  @Post('matches/:id/unmatch')
  @HttpCode(204)
  async unmatch(@CurrentUser() u: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    await this.swipes.unmatch(u.userId, id, clientContext(req));
  }

  @Get('search/users')
  search(@CurrentUser() u: AuthContext, @Query(new ZodPipe(searchQuery)) q: B<typeof searchQuery>, @Req() req: Request) {
    return this.discovery.search(u.userId, q, requestLocale(req));
  }

  @Get('travel-plans')
  travel(@CurrentUser() u: AuthContext) {
    return this.discovery.listTravelPlans(u.userId);
  }

  @Post('travel-plans')
  createTravel(@CurrentUser() u: AuthContext, @Body(new ZodPipe(travelPlanCreate)) b: B<typeof travelPlanCreate>) {
    return this.discovery.createTravelPlan(u.userId, b);
  }

  @Delete('travel-plans/:id')
  @HttpCode(204)
  async cancelTravel(@CurrentUser() u: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.discovery.cancelTravelPlan(u.userId, id);
  }
}
