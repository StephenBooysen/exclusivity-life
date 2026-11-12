/** Goals API — CRUD, filtering, hierarchy, progress rollup, and notes. */

'use strict';

const request = require('supertest');
const { createTestApp, cleanupTestApps, createFocusArea } = require('../helpers/testApp');
const { annualGoal, monthlyGoal, weeklyGoal } = require('../helpers/fixtures');

let app, database;

beforeEach(async () => {
  ({ app, database } = await createTestApp());
});

afterEach(cleanupTestApps);

describe('GET /api/goals', () => {
  test('returns an empty array on a fresh database', async () => {
    const res = await request(app).get('/api/goals').expect(200);
    expect(res.body).toEqual([]);
  });

  test('filters by tier', async () => {
    const parent = await request(app).post('/api/goals').send(annualGoal());
    await request(app).post('/api/goals').send(monthlyGoal(parent.body.id));

    const annual = await request(app).get('/api/goals?type=annual').expect(200);
    expect(annual.body).toHaveLength(1);
    expect(annual.body[0].type).toBe('annual');

    const monthly = await request(app).get('/api/goals?type=monthly').expect(200);
    expect(monthly.body).toHaveLength(1);
    expect(monthly.body[0].type).toBe('monthly');
  });

  test('filters top-level goals with parent_id=null', async () => {
    const parent = await request(app).post('/api/goals').send(annualGoal());
    await request(app).post('/api/goals').send(monthlyGoal(parent.body.id));

    const res = await request(app).get('/api/goals?parent_id=null').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].parent_id).toBeNull();
  });

  test('filters by target year', async () => {
    await request(app).post('/api/goals').send(annualGoal({ target_year: 2031 }));
    await request(app).post('/api/goals').send(annualGoal({ target_year: 2032 }));

    const res = await request(app).get('/api/goals?target_year=2031').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].target_year).toBe(2031);
  });
});

describe('POST /api/goals', () => {
  test('creates a goal and returns its new id', async () => {
    const res = await request(app).post('/api/goals').send(annualGoal()).expect(200);
    expect(res.body.id).toEqual(expect.any(Number));

    const row = await database.get('SELECT * FROM goals WHERE id = ?', [res.body.id]);
    expect(row.title).toBe('Run a marathon');
    expect(row.priority).toBe('high');
    expect(row.progress).toBe(0);
  });

  test('links a child to its parent', async () => {
    const parent = await request(app).post('/api/goals').send(annualGoal());
    const child = await request(app).post('/api/goals').send(monthlyGoal(parent.body.id));

    const row = await database.get('SELECT * FROM goals WHERE id = ?', [child.body.id]);
    expect(row.parent_id).toBe(parent.body.id);
  });

  test('stores the focus area assignment', async () => {
    const areaId = await createFocusArea(database);
    const res = await request(app).post('/api/goals').send(annualGoal({ focus_area_id: areaId }));

    const row = await database.get('SELECT * FROM goals WHERE id = ?', [res.body.id]);
    expect(row.focus_area_id).toBe(areaId);
  });

  test('rejects a tier the schema does not allow', async () => {
    await request(app).post('/api/goals').send(annualGoal({ type: 'decade' })).expect(500);
  });

  test('rejects a priority the schema does not allow', async () => {
    await request(app).post('/api/goals').send(annualGoal({ priority: 'urgent' })).expect(500);
  });
});

describe('PUT /api/goals/:id', () => {
  test('updates the editable fields', async () => {
    const created = await request(app).post('/api/goals').send(annualGoal());
    await request(app)
      .put(`/api/goals/${created.body.id}`)
      .send({ title: 'Run an ultra', priority: 'low', progress: 25 })
      .expect(200);

    const row = await database.get('SELECT * FROM goals WHERE id = ?', [created.body.id]);
    expect(row.title).toBe('Run an ultra');
    expect(row.priority).toBe('low');
  });
});

describe('DELETE /api/goals/:id', () => {
  test('removes the goal', async () => {
    const created = await request(app).post('/api/goals').send(annualGoal());
    await request(app).delete(`/api/goals/${created.body.id}`).expect(200);

    const res = await request(app).get('/api/goals').expect(200);
    expect(res.body).toHaveLength(0);
  });

  test('cascades to the goal\'s notes', async () => {
    const created = await request(app).post('/api/goals').send(annualGoal());
    await database.run(
      'INSERT INTO goal_notes (goal_id, type, content) VALUES (?, ?, ?)',
      [created.body.id, 'what_worked', 'Kept the Tue/Thu rhythm']
    );
    // ON DELETE CASCADE only fires when foreign keys are enforced.
    await database.run('PRAGMA foreign_keys = ON');
    await request(app).delete(`/api/goals/${created.body.id}`).expect(200);

    const notes = await database.all('SELECT * FROM goal_notes WHERE goal_id = ?', [created.body.id]);
    expect(notes).toHaveLength(0);
  });
});

describe('GET /api/goals/:id/with-children', () => {
  test('returns the goal plus its direct children', async () => {
    const parent = await request(app).post('/api/goals').send(annualGoal());
    await request(app).post('/api/goals').send(monthlyGoal(parent.body.id));
    await request(app).post('/api/goals').send(monthlyGoal(parent.body.id, { title: 'Second' }));

    const res = await request(app).get(`/api/goals/${parent.body.id}/with-children`).expect(200);
    expect(res.body.title).toBe('Run a marathon');
    expect(res.body.children).toHaveLength(2);
  });

  test('404s for a goal that does not exist', async () => {
    await request(app).get('/api/goals/99999/with-children').expect(404);
  });
});

describe('PUT /api/goals/:id/progress', () => {
  test('sets progress on the goal itself', async () => {
    const created = await request(app).post('/api/goals').send(annualGoal());
    await request(app)
      .put(`/api/goals/${created.body.id}/progress`)
      .send({ progress: 40 })
      .expect(200);

    const row = await database.get('SELECT progress FROM goals WHERE id = ?', [created.body.id]);
    expect(row.progress).toBe(40);
  });

  test('rolls a child\'s progress up into its parent as an average', async () => {
    const annual = await request(app).post('/api/goals').send(annualGoal());
    const m1 = await request(app).post('/api/goals').send(monthlyGoal(annual.body.id));
    const m2 = await request(app).post('/api/goals').send(monthlyGoal(annual.body.id, { title: 'Second' }));

    await request(app).put(`/api/goals/${m1.body.id}/progress`).send({ progress: 100 });
    await request(app).put(`/api/goals/${m2.body.id}/progress`).send({ progress: 50 });

    const parent = await database.get('SELECT progress FROM goals WHERE id = ?', [annual.body.id]);
    expect(parent.progress).toBe(75); // (100 + 50) / 2
  });

  test('rolls weekly progress up two levels to the annual goal', async () => {
    const annual = await request(app).post('/api/goals').send(annualGoal());
    const monthly = await request(app).post('/api/goals').send(monthlyGoal(annual.body.id));
    const weekly = await request(app).post('/api/goals').send(weeklyGoal(monthly.body.id));

    await request(app).put(`/api/goals/${weekly.body.id}/progress`).send({ progress: 100 }).expect(200);

    const m = await database.get('SELECT progress FROM goals WHERE id = ?', [monthly.body.id]);
    const a = await database.get('SELECT progress FROM goals WHERE id = ?', [annual.body.id]);
    expect(m.progress).toBe(100);
    expect(a.progress).toBe(100);
  });
});

describe('GET /api/goals/:id/notes', () => {
  test('groups notes by type', async () => {
    const created = await request(app).post('/api/goals').send(annualGoal());
    const id = created.body.id;
    await database.run('INSERT INTO goal_notes (goal_id, type, content) VALUES (?, ?, ?)',
      [id, 'what_worked', 'Sunday dinners stuck']);
    await database.run('INSERT INTO goal_notes (goal_id, type, content) VALUES (?, ?, ?)',
      [id, 'what_didnt_work', 'Skipped strength work']);
    await database.run('INSERT INTO goal_notes (goal_id, type, content) VALUES (?, ?, ?)',
      [id, 'general', 'Revisit in September']);

    const res = await request(app).get(`/api/goals/${id}/notes`).expect(200);
    expect(res.body.worked).toHaveLength(1);
    expect(res.body.didnt_work).toHaveLength(1);
    expect(res.body.general).toHaveLength(1);
    expect(res.body.worked[0].content).toBe('Sunday dinners stuck');
  });

  test('returns empty groups when a goal has no notes', async () => {
    const created = await request(app).post('/api/goals').send(annualGoal());
    const res = await request(app).get(`/api/goals/${created.body.id}/notes`).expect(200);
    expect(res.body).toEqual({ general: [], worked: [], didnt_work: [] });
  });
});
