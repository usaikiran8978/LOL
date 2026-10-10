import { analyticsApi } from '../api';
import { platformName } from '../auth/device';
import { env } from '../config/env';
import { Analytics } from './analytics';

export * from './analytics';

export const analytics = new Analytics({
  send: (batch) => analyticsApi.send(batch),
  platform: platformName(),
  appVersion: env.appVersion,
});
