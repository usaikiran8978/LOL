import { Global, Module } from '@nestjs/common';
import { TextModerationService } from './text-moderation';

/** Cross-cutting safety primitives used by many modules (chat, profiles, AI, events). */
@Global()
@Module({ providers: [TextModerationService], exports: [TextModerationService] })
export class SafetyCoreModule {}
