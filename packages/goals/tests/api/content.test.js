/** Focus areas, wisdom, reflections, moods — the remaining content endpoints. */

'use strict';

const request = require('supertest');
const { createTestApp, cleanupTestApps, createFocusArea } = require('../helpers/testApp');
const { wisdom, isoDate, thisYear, thisMonth } = require('../helpers/fixtures');

let app, database;

beforeEach(async () => {
  ({ app, database } = await createTestApp());
});

afterEach(cleanupTestApps);

describe('focus areas', () => {
  test('are empty on a new database', async () => {
    const res = await request(app).get('/api/focus-areas').expect(200);
    expect(res.body).toHaveLength(0);
  });

  test('are de-duplicated by name', async () => {
    await createFocusArea(database, 'Health & Fitness');
    await createFocusArea(database, 'Health & Fitness');

    const res = await request(app).get('/api/focus-areas').expect(200);
    const health = res.body.filter((a) => a.name === 'Health & Fitness');
    expect(health).toHaveLength(1);
  });

  test('monthly assignments round-trip', async () => {
    const areaId = await createFocusArea(database);
    await request(app)
      .post('/api/monthly-focus')
      .send({ year: thisYear, month: thisMonth, focus_area_id: areaId })
      .expect(200);

    const res = await request(app)
      .get(`/api/monthly-focus?year=${thisYear}&month=${thisMonth}`)
      .expect(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('wisdom', () => {
  test('creates, lists, updates and deletes an entry', async () => {
    const created = await request(app).post('/api/wisdom').send(wisdom()).expect(200);
    expect(created.body.id).toEqual(expect.any(Number));

    const listed = await request(app).get('/api/wisdom').expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].author).toBe('Will Durant');

    await request(app)
      .put(`/api/wisdom/${created.body.id}`)
      .send(wisdom({ content: 'Updated quote', author: 'Aristotle' }))
      .expect(200);
    const updated = await database.get('SELECT * FROM wisdom WHERE id = ?', [created.body.id]);
    expect(updated.content).toBe('Updated quote');

    await request(app).delete(`/api/wisdom/${created.body.id}`).expect(200);
    const after = await request(app).get('/api/wisdom').expect(200);
    expect(after.body).toHaveLength(0);
  });
});

describe('reflections', () => {
  test('morning notes save and read back for a date', async () => {
    const date = isoDate();
    await request(app).post('/api/morning-notes').send({
      date,
      priorities: 'Long run; call Mom',
      mood: 7,
      energy: 6,
      gratitude: 'Clear morning',
      challenges: 'Sore legs',
      intention: 'Keep it easy',
      template_id: null
    }).expect(200);

    const res = await request(app).get(`/api/morning-notes?date=${date}`).expect(200);
    const note = Array.isArray(res.body) ? res.body[0] : res.body;
    expect(note.intention).toBe('Keep it easy');
    expect(note.mood).toBe(7);
  });

  test('evening reflections save and read back for a date', async () => {
    const date = isoDate();
    await request(app).post('/api/evening-reflections').send({
      date,
      what_went_well: 'Finished the long run',
      what_could_improve: 'Earlier start',
      lessons_learned: 'Hydrate the night before',
      tomorrow_priority: 'Rest day',
      gratitude: 'Legs held up',
      day_rating: 8,
      accomplishments: '14 miles',
      template_id: null
    }).expect(200);

    const res = await request(app).get(`/api/evening-reflections?date=${date}`).expect(200);
    const row = Array.isArray(res.body) ? res.body[0] : res.body;
    expect(row.day_rating).toBe(8);
    expect(row.what_went_well).toBe('Finished the long run');
  });

  test('re-saving the same date does not create a duplicate', async () => {
    const date = isoDate();
    const payload = { date, priorities: 'First', mood: 5, energy: 5, gratitude: '', challenges: '', intention: '', template_id: null };
    await request(app).post('/api/morning-notes').send(payload);
    await request(app).post('/api/morning-notes').send(Object.assign({}, payload, { priorities: 'Second' }));

    const rows = await database.all('SELECT * FROM morning_notes WHERE date = ?', [date]);
    expect(rows).toHaveLength(1);
    expect(rows[0].priorities).toBe('Second');
  });
});

describe('moods', () => {
  test('records a daily rating and reads it back', async () => {
    const date = isoDate();
    await request(app).post('/api/moods').send({ date, rating: 8 }).expect(200);

    const res = await request(app).get(`/api/moods?month=${date.slice(0, 7)}`).expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.find((m) => m.date === date).rating).toBe(8);
  });

  test('re-rating the same day replaces the entry', async () => {
    const date = isoDate();
    await request(app).post('/api/moods').send({ date, rating: 3 });
    await request(app).post('/api/moods').send({ date, rating: 9 });

    const rows = await database.all('SELECT * FROM moods WHERE date = ?', [date]);
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(9);
  });
});

describe('AI chat history', () => {
  test('stores and clears messages by session', async () => {
    await request(app).post('/api/ai-chats').send({
      session_id: 's1', role: 'user', message: 'How am I doing?', context: ''
    }).expect(200);

    const res = await request(app).get('/api/ai-chats?session_id=s1').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].message).toBe('How am I doing?');

    await request(app).delete('/api/ai-chats?session_id=s1').expect(200);
    const after = await request(app).get('/api/ai-chats?session_id=s1').expect(200);
    expect(after.body).toHaveLength(0);
  });
});

describe('Claude proxy', () => {
  // These assert the proxy's own validation. They never call the real API —
  // no key is supplied, so the request is rejected before any network call.
  test('rejects a request with no API key', async () => {
    const res = await request(app)
      .post('/api/claude')
      .send({ messages: [{ role: 'user', content: 'hello' }] })
      .expect(400);
    expect(res.body.error).toMatch(/API key/i);
  });

  test('rejects a request with no messages array', async () => {
    const res = await request(app)
      .post('/api/claude')
      .send({ apiKey: 'test-key-not-real' })
      .expect(400);
    expect(res.body.error).toMatch(/messages/i);
  });

  test('the connection test rejects a missing key', async () => {
    await request(app).post('/api/claude/test').send({}).expect(400);
  });
});

describe('health', () => {
  test('reports ok', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).toBeDefined();
  });
});
