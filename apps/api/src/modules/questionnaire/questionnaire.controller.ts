import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { submitAnswer, submitAnswersBatch } from '@amora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { requestLocale } from '../../common/http/locale';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentUser, UserAuthGuard, type AuthContext } from '../auth/auth.guard';
import { QuestionnaireService } from './questionnaire.service';

@ApiTags('questionnaire')
@Controller()
@UseGuards(UserAuthGuard)
export class QuestionnaireController {
  constructor(private readonly q: QuestionnaireService) {}

  /** Applicable questions in order, with current answers and needsReanswer flags. */
  @Get('questions')
  list(@CurrentUser() u: AuthContext, @Req() req: Request) {
    return this.q.applicable(u.userId, requestLocale(req));
  }

  @Get('questions/status')
  status(@CurrentUser() u: AuthContext) {
    return this.q.status(u.userId);
  }

  @Post('answers')
  submit(@CurrentUser() u: AuthContext, @Body(new ZodPipe(submitAnswer)) body: z.infer<typeof submitAnswer>) {
    return this.q.submit(u.userId, body);
  }

  /** Sequential so conditional questions unlocked by earlier answers in the batch are accepted. */
  @Post('answers/batch')
  async batch(@CurrentUser() u: AuthContext, @Body(new ZodPipe(submitAnswersBatch)) body: z.infer<typeof submitAnswersBatch>) {
    const results = [];
    for (const a of body.answers) results.push(await this.q.submit(u.userId, a));
    return { saved: results.length, status: await this.q.status(u.userId) };
  }
}
