import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppError } from '../errors/app-error';
import { APP_CONFIG, type AppConfig } from '../config/config';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
export interface OutboundSms {
  to: string;
  body: string;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
export const SMS_SENDER = Symbol('SMS_SENDER');

export interface EmailSender {
  send(msg: OutboundEmail): Promise<void>;
}
export interface SmsSender {
  send(msg: OutboundSms): Promise<void>;
}

/** SMTP adapter (SES/SendGrid/Postmark SMTP relays, Mailpit locally). */
export class SmtpEmailSender implements EmailSender {
  private readonly transport: Transporter;
  constructor(url: string, private readonly from: string) {
    this.transport = createTransport(url);
  }
  async send(msg: OutboundEmail): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...msg });
  }
}

/** Twilio Programmable Messaging adapter. */
export class TwilioSmsSender implements SmsSender {
  constructor(private readonly sid: string, private readonly token: string, private readonly from: string) {}
  async send(msg: OutboundSms): Promise<void> {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: msg.to, From: this.from, Body: msg.body }),
    });
    if (!res.ok) throw new AppError('CHANNEL_NOT_CONFIGURED', `Twilio send failed with ${res.status}`);
  }
}

/**
 * Development/test sink: records messages in memory and logs them. Config validation forbids it in production.
 */
@Injectable()
export class DevMessageSink implements EmailSender, SmsSender {
  private readonly logger = new Logger('DevMessageSink');
  readonly sent: Array<{ channel: 'email' | 'sms'; to: string; body: string }> = [];

  async send(msg: OutboundEmail | OutboundSms): Promise<void> {
    const channel = 'subject' in msg ? 'email' : 'sms';
    const body = 'text' in msg ? msg.text : msg.body;
    this.sent.push({ channel, to: msg.to, body });
    this.logger.log(`[${channel}] to=${msg.to} ${body}`);
  }

  lastTo(to: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to)?.body;
  }
}

export const messagingProviders = [
  DevMessageSink,
  {
    provide: EMAIL_SENDER,
    inject: [APP_CONFIG, DevMessageSink],
    useFactory: (cfg: AppConfig, dev: DevMessageSink): EmailSender =>
      cfg.EMAIL_PROVIDER === 'smtp' ? new SmtpEmailSender(cfg.SMTP_URL!, cfg.EMAIL_FROM) : dev,
  },
  {
    provide: SMS_SENDER,
    inject: [APP_CONFIG, DevMessageSink],
    useFactory: (cfg: AppConfig, dev: DevMessageSink): SmsSender =>
      cfg.SMS_PROVIDER === 'twilio' ? new TwilioSmsSender(cfg.TWILIO_ACCOUNT_SID!, cfg.TWILIO_AUTH_TOKEN!, cfg.TWILIO_FROM!) : dev,
  },
];

@Injectable()
export class MessagingService {
  constructor(
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  sendEmail(msg: OutboundEmail): Promise<void> {
    return this.email.send(msg);
  }
  sendSms(msg: OutboundSms): Promise<void> {
    return this.sms.send(msg);
  }
}
