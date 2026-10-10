import { Controller, Get, HttpCode, Inject, Put, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error';
import { LocalDiskObjectStorage } from './local-disk-storage';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage';

/** Serves LocalDiskObjectStorage's signed URLs (development only; 404 with any other storage). */
@ApiExcludeController()
@Controller('dev-storage')
@SkipThrottle()
export class DevStorageController {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  private local(): LocalDiskObjectStorage {
    if (!(this.storage instanceof LocalDiskObjectStorage)) throw new AppError('NOT_FOUND');
    return this.storage;
  }

  private key(req: Request, op: 'get' | 'put'): string {
    const prefix = `/v1/dev-storage/${op}/`;
    return req.path.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
  }

  @Put('put/*key')
  @HttpCode(200)
  async put(@Req() req: Request, @Query() q: Record<string, string>) {
    const s = this.local();
    const key = this.key(req, 'put');
    const exp = Number(q.exp);
    if (!s.verify('put', key, exp, String(q.sig ?? ''), `${q.ct}\n${q.max}`)) throw new AppError('FORBIDDEN', 'Invalid or expired upload URL');
    const ct = String(req.headers['content-type'] ?? '').split(';')[0]!.trim();
    if (ct !== q.ct) throw new AppError('VALIDATION_FAILED', 'Content-Type does not match the signed upload');
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length || body.length > Number(q.max)) throw new AppError('MEDIA_TOO_LARGE', 'Body size does not match the signed upload');
    await s.put(key, body, ct);
    return { ok: true };
  }

  @Get('get/*key')
  async get(@Req() req: Request, @Query() q: Record<string, string>, @Res() res: Response) {
    const s = this.local();
    const key = this.key(req, 'get');
    if (!s.verify('get', key, Number(q.exp), String(q.sig ?? ''))) throw new AppError('FORBIDDEN', 'Invalid or expired download URL');
    const head = await s.head(key);
    if (!head) throw new AppError('NOT_FOUND');
    res.setHeader('Content-Type', head.contentType ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    // Signed URLs are the access control; let the admin console (another origin) display them.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(await s.get(key));
  }
}
