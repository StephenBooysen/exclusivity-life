/** Habits and habit logs — the data behind the Habits screen's grid and streaks. */

'use strict';

const request = require('supertest');
const { createTestApp, cleanupTestApps } = require('../helpers/testApp');
const { habit, isoDate } = require('../helpers/fixtures');

let app, database;

beforeEach(async () => {
  ({ app, database } = await createTestApp());
});

afterEach(cleanupTestApps);

describe('GET /api/habits', () => {
  test('returns an empty array on a fresh database', async () => {
    const res = await request(app).get('/api/habits').expect(200);
    expect(res.body).toEqual([]);
  });

  test('returns only active habits', async () => {
    await request(app).post('/api/habits').send(habit({ name: 'Active habit' }));
    const archived = await request(app).post('/api/habits').send(habit({ name: 'Archived habit' }));
    await database.run('UPDATE habits SET is_active = 0 WHERE id = ?', [archived.body.id]);

    const res = await request(app).get('/api/habits').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Active habit');
  });
});

describe('POST /api/habits', () => {
  test('creates a habit with its category and frequency', async () => {
    const res = await request(app).post('/api/habits').send(habit()).expect(200);

    const row = await database.get('SELECT * FROM habits WHERE id = ?', [res.body.id]);
    expect(row.name).toBe('Morning pages');
    expect(row.category).toBe('Personal Development');
    expect(row.frequency).toBe('daily');
    expect(row.is_active).toBe(1);
  });

  test('rejects a frequency the schema does not allow', async () => {
    await request(app).post('/api/habits').send(habit({ frequency: 'fortnightly' })).expect(500);
  });
});

describe('habit logs', () => {
  let habitId;

  beforeEach(async () => {
    const created = await request(app).post('/api/habits').send(habit());
    habitId = created.body.id;
  });

  test('records a completion for a day', async () => {
    await request(app)
      .post('/api/habit-logs')
      .send({ habit_id: habitId, date: isoDate(), completed: true, notes: '' })
      .expect(200);

    const res = await request(app).get('/api/habit-logs').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].completed).toBe(1);
    expect(res.body[0].habit_name).toBe('Morning pages');
  });

  test('toggling the same day replaces rather than duplicates', async () => {
    const today = isoDate();
    await request(app).post('/api/habit-logs')
      .send({ habit_id: habitId, date: today, completed: true, notes: '' });
    await request(app).post('/api/habit-logs')
      .send({ habit_id: habitId, date: today, completed: false, notes: '' });

    const rows = await database.all(
      'SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?', [habitId, today]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].completed).toBe(0);
  });

  test('filters logs by date range', async () => {
    for (const back of [0, 1, 10]) {
      await request(app).post('/api/habit-logs')
        .send({ habit_id: habitId, date: isoDate(back), completed: true, notes: '' });
    }

    const res = await request(app)
      .get(`/api/habit-logs?start_date=${isoDate(2)}&end_date=${isoDate(0)}`)
      .expect(200);

    expect(res.body).toHaveLength(2); // today and yesterday, not the 10-day-old one
  });

  test('filters logs by habit', async () => {
    const other = await request(app).post('/api/habits').send(habit({ name: 'Stretch' }));
    await request(app).post('/api/habit-logs')
      .send({ habit_id: habitId, date: isoDate(), completed: true, notes: '' });
    await request(app).post('/api/habit-logs')
      .send({ habit_id: other.body.id, date: isoDate(), completed: true, notes: '' });

    const res = await request(app).get(`/api/habit-logs?habit_id=${habitId}`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].habit_id).toBe(habitId);
  });
});
