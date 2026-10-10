import { OutboxService } from '../src/common/outbox/outbox.service';
import { QuestionnaireAdminService } from '../src/modules/questionnaire/questionnaire-admin.service';
import { activeUser, adminSession, createTestApp, drainOutbox, type TestApp } from './helpers';

type Admin = Awaited<ReturnType<typeof adminSession>>;

function choiceVersion(text: string, options: string[], extra: Record<string, unknown> = {}) {
  return {
    answerType: 'single_choice',
    translations: { en: { text } },
    options: options.map((k) => ({ key: k, translations: { en: { label: k.toUpperCase() } } })),
    ...extra,
  };
}

describe('Questionnaire engine (e2e)', () => {
  let t: TestApp;
  let product: Admin;
  let categoryId: string;
  let outbox: OutboxService;

  beforeAll(async () => {
    t = await createTestApp();
    outbox = t.app.get(OutboxService);
    product = await adminSession(t, 'product_admin');
    categoryId = (await t.db.selectFrom('question_categories').select('id').where('key', '=', 'lifestyle').executeTakeFirstOrThrow()).id;
  });
  afterAll(() => t.close());

  async function createAndPublish(key: string, version: Record<string, unknown>) {
    const created = await product.as(t.http.post('/v1/admin/questions')).send({ key, categoryId, version }).expect(201);
    await product.as(t.http.post(`/v1/admin/questions/versions/${created.body.versionId}/publish`)).send({}).expect(200);
    return created.body as { questionId: string; versionId: string };
  }

  async function myQuestion(auth: Record<string, string>, questionId: string) {
    return ((await t.http.get('/v1/questions').set(auth).expect(200)).body as Array<{ questionId: string; versionId: string; answer: unknown; needsReanswer: boolean }>).find((q) => q.questionId === questionId);
  }

  describe('answering', () => {
    it('serves seeded questions with localized text and accepts valid answers only', async () => {
      const u = await activeUser(t);
      const qs = (await t.http.get('/v1/questions').set(u.auth).expect(200)).body;
      const kids = qs.find((q: { key: string }) => q.key === 'wants_children');
      expect(kids).toMatchObject({ answerType: 'single_choice', isRequired: true, allowSkip: false, text: 'Do you want children?' });

      expect((await t.http.post('/v1/answers').set(u.auth).send({ questionId: kids.questionId, versionId: kids.versionId, value: { optionKey: 'maybe' } }).expect(400)).body.error.details.reason).toBe('unknown_option:maybe');
      expect((await t.http.post('/v1/answers').set(u.auth).send({ questionId: kids.questionId, versionId: kids.versionId, skip: true }).expect(400)).body.error.details.reason).toBe('skip_not_allowed');
      await t.http.post('/v1/answers').set(u.auth).send({ questionId: kids.questionId, versionId: kids.versionId, value: { optionKey: 'want' }, importance: 3, isDealbreaker: true, acceptableOptionKeys: ['want', 'open'] }).expect(201);

      const after = (await t.http.get('/v1/questions').set(u.auth)).body.find((q: { key: string }) => q.key === 'wants_children');
      expect(after.answer).toMatchObject({ importance: 3, isDealbreaker: true, value: { optionKey: 'want' } });
      const events = await t.db.selectFrom('analytics_events').select('name').where('user_id', '=', u.id).execute();
      expect(events.map((e) => e.name)).toEqual(expect.arrayContaining(['questionnaire_started', 'question_answered']));
    });

    it('re-answering supersedes the previous answer but keeps it as history', async () => {
      const u = await activeUser(t);
      const q = (await t.http.get('/v1/questions').set(u.auth)).body.find((x: { key: string }) => x.key === 'tidiness');
      await t.http.post('/v1/answers').set(u.auth).send({ questionId: q.questionId, versionId: q.versionId, value: { value: 2 } }).expect(201);
      await t.http.post('/v1/answers').set(u.auth).send({ questionId: q.questionId, versionId: q.versionId, value: { value: 5 } }).expect(201);
      const rows = await t.db.selectFrom('question_answers').select(['superseded_at', 'normalized_value']).where('user_id', '=', u.id).where('question_id', '=', q.questionId).orderBy('answered_at').execute();
      expect(rows).toHaveLength(2);
      expect(rows[0]!.superseded_at).not.toBeNull();
      expect(rows[1]!.normalized_value).toEqual({ t: 'scale', value: 5, ratio: 1 });
    });

    it('shows conditional questions only when the condition is met', async () => {
      const parent = await createAndPublish('e2e_has_pets', choiceVersion('Do you have pets?', ['yes', 'no'], { answerType: 'yes_no' }));
      await createAndPublish('e2e_pet_type', choiceVersion('What pet?', ['dog', 'cat'], { conditions: [{ dependsOnQuestionId: parent.questionId, operator: 'includes_any', optionKeys: ['yes'] }] }));
      const u = await activeUser(t);
      const keys = async () => ((await t.http.get('/v1/questions').set(u.auth)).body as Array<{ key: string }>).map((q) => q.key);
      expect(await keys()).not.toContain('e2e_pet_type');
      await t.http.post('/v1/answers').set(u.auth).send({ questionId: parent.questionId, versionId: parent.versionId, value: { optionKey: 'yes' } }).expect(201);
      expect(await keys()).toContain('e2e_pet_type');
    });

    it('rejects answers to a stale version so the client refetches', async () => {
      const q = await createAndPublish('e2e_stale', choiceVersion('Stale?', ['a', 'b']));
      const draft = await product.as(t.http.post(`/v1/admin/questions/${q.questionId}/drafts`)).send({}).expect(201);
      await product.as(t.http.post(`/v1/admin/questions/versions/${draft.body.versionId}/publish`)).send({}).expect(200);
      const u = await activeUser(t);
      const res = await t.http.post('/v1/answers').set(u.auth).send({ questionId: q.questionId, versionId: q.versionId, value: { optionKey: 'a' } }).expect(409);
      expect(res.body.error).toMatchObject({ code: 'VERSION_STALE', details: { currentVersionId: draft.body.versionId } });
    });

    it('applies targeting predicates', async () => {
      await createAndPublish('e2e_india_only', choiceVersion('India only?', ['x', 'y'], { targeting: { field: 'countryCode', op: 'eq', value: 'IN' } }));
      const u = await activeUser(t); // registered in US
      expect(((await t.http.get('/v1/questions').set(u.auth)).body as Array<{ key: string }>).map((q) => q.key)).not.toContain('e2e_india_only');
    });
  });

  describe('builder', () => {
    it('blocks publishing invalid versions with structured issues', async () => {
      const created = await product.as(t.http.post('/v1/admin/questions')).send({ key: 'e2e_invalid', categoryId, version: choiceVersion('Only one option', ['solo']) }).expect(201);
      const res = await product.as(t.http.post(`/v1/admin/questions/versions/${created.body.versionId}/publish`)).send({}).expect(422);
      expect(res.body.error.details.issues.map((i: { code: string }) => i.code)).toContain('too_few_options');
    });

    it('refuses to edit published versions (API and database)', async () => {
      const q = await createAndPublish('e2e_immutable', choiceVersion('Immutable?', ['a', 'b']));
      const res = await product.as(t.http.put(`/v1/admin/questions/versions/${q.versionId}`)).send(choiceVersion('Changed', ['a', 'b'])).expect(409);
      expect(res.body.error.code).toBe('VERSION_IMMUTABLE');
      await expect(t.db.updateTable('question_versions').set({ weight: 9 }).where('id', '=', q.versionId).execute()).rejects.toThrow(/immutable/);
    });

    it('detects condition cycles', async () => {
      const a = await createAndPublish('e2e_cycle_a', choiceVersion('A?', ['y', 'n']));
      const b = await createAndPublish('e2e_cycle_b', choiceVersion('B?', ['y', 'n'], { conditions: [{ dependsOnQuestionId: a.questionId, operator: 'answered' }] }));
      const draft = await product.as(t.http.post(`/v1/admin/questions/${a.questionId}/drafts`)).send(choiceVersion('A?', ['y', 'n'], { conditions: [{ dependsOnQuestionId: b.questionId, operator: 'answered' }] })).expect(201);
      const v = await product.as(t.http.get(`/v1/admin/questions/versions/${draft.body.versionId}/validate`)).expect(200);
      expect(v.body.issues.map((i: { code: string }) => i.code)).toContain('dependency_cycle');
    });

    it('requires acknowledging impact, then carries answers over via explicit option mappings', async () => {
      const q = await createAndPublish('e2e_carry', choiceVersion('Coffee or tea?', ['coffee', 'tea', 'neither']));
      const users = [await activeUser(t), await activeUser(t), await activeUser(t)];
      for (const [i, u] of users.entries()) {
        await t.http.post('/v1/answers').set(u.auth).send({ questionId: q.questionId, versionId: q.versionId, value: { optionKey: ['coffee', 'tea', 'neither'][i] } }).expect(201);
      }
      // v2 renames "neither" away and splits coffee into espresso; tea maps to tea; "neither" is unmapped → re-asked.
      const draft = await product.as(t.http.post(`/v1/admin/questions/${q.questionId}/drafts`)).send(choiceVersion('Coffee or tea?', ['espresso', 'tea', 'water'], {
        answerCarryOver: 'mapped', optionMappings: [{ fromOptionKey: 'coffee', toOptionKey: 'espresso' }, { fromOptionKey: 'tea', toOptionKey: 'tea' }],
      })).expect(201);

      const impact = await product.as(t.http.get(`/v1/admin/questions/versions/${draft.body.versionId}/impact`)).expect(200);
      expect(impact.body).toMatchObject({ usersWithCurrentAnswer: 3, answersCarriedOver: 2, usersReasked: 1 });
      expect(impact.body.issues.map((i: { code: string }) => i.code)).toContain('unmapped_options');

      const needsAck = await product.as(t.http.post(`/v1/admin/questions/versions/${draft.body.versionId}/publish`)).send({}).expect(422);
      expect(needsAck.body.error.details.requiresAcknowledgement).toBe(true);
      await product.as(t.http.post(`/v1/admin/questions/versions/${draft.body.versionId}/publish`)).send({ acknowledgeImpact: true }).expect(200);
      await drainOutbox(t);

      const q0 = await myQuestion(users[0]!.auth, q.questionId);
      expect(q0).toMatchObject({ versionId: draft.body.versionId, answer: { value: { optionKey: 'espresso' } }, needsReanswer: false });
      const q2 = await myQuestion(users[2]!.auth, q.questionId);
      expect(q2).toMatchObject({ answer: null, needsReanswer: true });
      const carried = await t.db.selectFrom('question_answers').select(['carried_over_from', 'question_version_id']).where('user_id', '=', users[1]!.id).where('superseded_at', 'is', null).where('question_id', '=', q.questionId).executeTakeFirstOrThrow();
      expect(carried).toMatchObject({ question_version_id: draft.body.versionId, carried_over_from: expect.any(String) });

      const hist = await product.as(t.http.get(`/v1/admin/questions/${q.questionId}`)).expect(200);
      expect(hist.body.versions.map((v: { status: string }) => v.status)).toEqual(['published', 'superseded']);
      expect(hist.body.history[0]).toMatchObject({ action: 'publish', impact_summary: expect.objectContaining({ answersCarriedOver: 2 }) });
    });

    it('rolls back by publishing a copy of an earlier version', async () => {
      const q = await createAndPublish('e2e_rollback', choiceVersion('Original text', ['a', 'b']));
      const d = await product.as(t.http.post(`/v1/admin/questions/${q.questionId}/drafts`)).send(choiceVersion('New text', ['a', 'b'], { answerCarryOver: 'same_options' })).expect(201);
      await product.as(t.http.post(`/v1/admin/questions/versions/${d.body.versionId}/publish`)).send({}).expect(200);
      const rb = await product.as(t.http.post(`/v1/admin/questions/${q.questionId}/rollback/${q.versionId}`)).send({}).expect(200);
      const detail = await product.as(t.http.get(`/v1/admin/questions/${q.questionId}`)).expect(200);
      expect(detail.body.versions[0]).toMatchObject({ id: rb.body.versionId, version: 3, status: 'published' });
      expect(detail.body.versions[0].translations[0].text).toBe('Original text');
      expect(detail.body.history[0].action).toBe('rollback');
    });

    it('schedules a version and publishes it when due', async () => {
      const q = await createAndPublish('e2e_schedule', choiceVersion('Now', ['a', 'b']));
      const d = await product.as(t.http.post(`/v1/admin/questions/${q.questionId}/drafts`)).send(choiceVersion('Later', ['a', 'b'], { answerCarryOver: 'same_options' })).expect(201);
      const future = new Date(Date.now() + 3_600_000).toISOString();
      expect((await product.as(t.http.post(`/v1/admin/questions/versions/${d.body.versionId}/publish`)).send({ effectiveAt: future }).expect(200)).body.status).toBe('scheduled');
      await t.db.updateTable('question_versions').set({ effective_at: new Date(Date.now() - 1000) }).where('id', '=', d.body.versionId).execute();
      await t.app.get(QuestionnaireAdminService).publishDue();
      const row = await t.db.selectFrom('questions').select('published_version_id').where('id', '=', q.questionId).executeTakeFirstOrThrow();
      expect(row.published_version_id).toBe(d.body.versionId);
    });

    it('previews as a user, deletes only drafts, archives and reports analytics', async () => {
      const q = await createAndPublish('e2e_misc', choiceVersion('Misc?', ['a', 'b'], { targeting: { field: 'age', op: 'gte', value: 30 } }));
      const prev = await product.as(t.http.post(`/v1/admin/questions/versions/${q.versionId}/preview`)).send({ locale: 'fr', facts: { age: 25 } }).expect(200);
      expect(prev.body).toMatchObject({ targetingMatches: false, rendered: { text: 'Misc?' } });
      await product.as(t.http.delete(`/v1/admin/questions/versions/${q.versionId}`)).expect(409);
      const d = await product.as(t.http.post(`/v1/admin/questions/${q.questionId}/drafts`)).send({}).expect(201);
      await product.as(t.http.delete(`/v1/admin/questions/versions/${d.body.versionId}`)).expect(204);
      const an = await product.as(t.http.get(`/v1/admin/questions/${q.questionId}/analytics`)).expect(200);
      expect(an.body.versions[0]).toMatchObject({ answered: 0, distribution: [] });
      await product.as(t.http.post(`/v1/admin/questions/${q.questionId}/archive`)).send({}).expect(204);
      expect((await product.as(t.http.get('/v1/admin/questions?status=archived')).expect(200)).body.map((x: { key: string }) => x.key)).toContain('e2e_misc');
    });

    it('enforces builder permissions', async () => {
      const content = await adminSession(t, 'content_admin'); // has questions.view only
      await content.as(t.http.get('/v1/admin/questions')).expect(200);
      await content.as(t.http.post('/v1/admin/questions')).send({ key: 'e2e_denied', categoryId, version: choiceVersion('x', ['a', 'b']) }).expect(403);
      const audit = await t.db.selectFrom('audit_logs').select('action').where('actor_id', '=', product.id).execute();
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['questions.created', 'questions.published', 'questions.rolled_back', 'questions.archived']));
    });
  });
});
