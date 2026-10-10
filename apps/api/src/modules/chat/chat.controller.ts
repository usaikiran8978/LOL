import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { chatUploadRequest, messagesQuery, pageQuery, reactionRequest, readRequest, sendMessage } from '@amora/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { requestLocale } from '../../common/http/locale';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentUser, UserAuthGuard, type AuthContext } from '../auth/auth.guard';
import { ChatService } from './chat.service';

type B<T extends z.ZodType> = z.infer<T>;
const id = new ParseUUIDPipe();
const muteBody = z.object({ until: z.iso.datetime().nullable() });

@ApiTags('chat')
@Controller()
@UseGuards(UserAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('conversations')
  list(@CurrentUser() u: AuthContext, @Query(new ZodPipe(pageQuery)) q: B<typeof pageQuery>) {
    return this.chat.listConversations(u.userId, q.limit, q.cursor);
  }

  @Get('conversations/:id')
  conversation(@CurrentUser() u: AuthContext, @Param('id', id) cid: string) {
    return this.chat.conversation(u.userId, cid);
  }

  @Get('conversations/:id/messages')
  messages(@CurrentUser() u: AuthContext, @Param('id', id) cid: string, @Query(new ZodPipe(messagesQuery)) q: B<typeof messagesQuery>) {
    return this.chat.messages(u.userId, cid, q.limit, q.before);
  }

  @Post('conversations/:id/messages')
  send(@CurrentUser() u: AuthContext, @Param('id', id) cid: string, @Body(new ZodPipe(sendMessage)) body: B<typeof sendMessage>) {
    return this.chat.send(u.userId, cid, body);
  }

  @Post('conversations/:id/uploads')
  upload(@CurrentUser() u: AuthContext, @Param('id', id) cid: string, @Body(new ZodPipe(chatUploadRequest)) b: B<typeof chatUploadRequest>) {
    return this.chat.requestUpload(u.userId, cid, b.kind, b.mimeType, b.byteSize, b.durationMs);
  }

  @Post('conversations/:id/read')
  @HttpCode(204)
  async read(@CurrentUser() u: AuthContext, @Param('id', id) cid: string, @Body(new ZodPipe(readRequest)) b: B<typeof readRequest>) {
    await this.chat.markRead(u.userId, cid, b.messageId);
  }

  @Put('conversations/:id/mute')
  @HttpCode(204)
  async mute(@CurrentUser() u: AuthContext, @Param('id', id) cid: string, @Body(new ZodPipe(muteBody)) b: B<typeof muteBody>) {
    await this.chat.setMuted(u.userId, cid, b.until ? new Date(b.until) : null);
  }

  @Get('conversations/:id/icebreakers')
  icebreakers(@CurrentUser() u: AuthContext, @Param('id', id) cid: string, @Req() req: Request) {
    return this.chat.icebreakers(u.userId, cid, requestLocale(req));
  }

  @Post('messages/:id/reactions')
  @HttpCode(204)
  async react(@CurrentUser() u: AuthContext, @Param('id', id) mid: string, @Body(new ZodPipe(reactionRequest)) b: B<typeof reactionRequest>) {
    await this.chat.react(u.userId, mid, b.emoji, true);
  }

  @Delete('messages/:id/reactions/:emoji')
  @HttpCode(204)
  async unreact(@CurrentUser() u: AuthContext, @Param('id', id) mid: string, @Param('emoji') emoji: string) {
    await this.chat.react(u.userId, mid, decodeURIComponent(emoji).slice(0, 16), false);
  }

  @Delete('messages/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthContext, @Param('id', id) mid: string) {
    await this.chat.deleteMessage(u.userId, mid);
  }
}
