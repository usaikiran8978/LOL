import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { geohashEncode, haversineKm } from '../../common/geo/geo';
import { FlagsService } from '../platform/flags.service';
import { UserFactsService } from '../platform/user-facts.service';
import { ProfileStateService } from './profile-state.service';

/**
 * Stores the user's precise location privately (user_locations) and publishes only a coarse geohash-5 cell on the
 * profile (DEC-008). Requires the `location` consent. Also snaps the profile to the nearest known city.
 */
@Injectable()
export class LocationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly state: ProfileStateService,
    private readonly flags: FlagsService,
    private readonly facts: UserFactsService,
  ) {}

  async update(userId: string, input: { latitude: number; longitude: number; accuracyM?: number; source: 'gps' | 'network' | 'manual_city' }) {
    const consent = await this.db
      .selectFrom('consent_records')
      .select('granted')
      .where('user_id', '=', userId)
      .where('consent_type', '=', 'location')
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!consent?.granted) throw new AppError('CONSENT_REQUIRED', 'Location consent required', { consentType: 'location' });

    const geohash7 = geohashEncode(input.latitude, input.longitude, 7);
    const geohash5 = geohash7.slice(0, 5);
    const city = await this.nearestCity(input.latitude, input.longitude, geohash5);

    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('user_locations')
        .values({ user_id: userId, latitude: input.latitude, longitude: input.longitude, accuracy_m: input.accuracyM ?? null, geohash7, source: input.source, captured_at: new Date() })
        .onConflict((oc) => oc.column('user_id').doUpdateSet({ latitude: input.latitude, longitude: input.longitude, accuracy_m: input.accuracyM ?? null, geohash7, source: input.source, captured_at: new Date() }))
        .execute();
      await trx.updateTable('user_profiles').set({ geohash5, ...(city ? { city_id: city.id } : {}) }).where('user_id', '=', userId).execute();
    });
    await this.state.recompute(userId);
    if (input.source === 'gps' || input.source === 'network') await this.recordSighting(userId, geohash7.slice(0, 6));
    // The client only learns its own coarse cell + city, never anything about others.
    return { cityId: city?.id ?? null, cityName: city?.name ?? null };
  }

  /**
   * Crossed paths (DEC-009): only with the feature flag, a country that allows it and the user's explicit consent.
   * Stores a ~1.2 km cell and the hour — never coordinates — and the retention job deletes rows after 14 days.
   */
  private async recordSighting(userId: string, geohash6: string): Promise<void> {
    const facts = await this.facts.load(userId);
    if (!(await this.flags.isEnabled('crossed_paths', facts))) return;
    const country = await this.db.selectFrom('users as u').innerJoin('country_configs as cc', 'cc.country_code', 'u.country_code').select('cc.crossed_paths_allowed').where('u.id', '=', userId).executeTakeFirst();
    if (!country?.crossed_paths_allowed) return;
    const consent = await this.db.selectFrom('consent_records').select('granted').where('user_id', '=', userId).where('consent_type', '=', 'crossed_paths').orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    if (!consent?.granted) return;
    const hour = new Date();
    hour.setUTCMinutes(0, 0, 0);
    await this.db.insertInto('crossed_path_sightings').values({ user_id: userId, geohash6, hour_bucket: hour }).onConflict((oc) => oc.doNothing()).execute();
  }

  private async nearestCity(lat: number, lon: number, geohash5: string) {
    const candidates = await this.db
      .selectFrom('cities')
      .select(['id', 'name', 'latitude', 'longitude'])
      .where('is_active', '=', true)
      .where('geohash5', 'like', `${geohash5.slice(0, 3)}%`)
      .limit(200)
      .execute();
    let best: { id: string; name: string; km: number } | null = null;
    for (const c of candidates) {
      const km = haversineKm(lat, lon, c.latitude, c.longitude);
      if (km < 60 && (!best || km < best.km)) best = { id: c.id, name: c.name, km };
    }
    return best;
  }
}
