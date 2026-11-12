const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

/**
 * The database initalisation
 */
class WebDatabase {

  constructor() {
    this.db = null;
  }

  /**
   * Opens the database and ensures the schema exists.
   *
   * @param {string=} dbPathOverride Absolute path to a database file. Defaults
   *   to data/web-database.db. Tests pass a throwaway path so they never touch
   *   real user data.
   */
  async init(dbPathOverride) {
    // Use a web-specific database path in the data directory
    const dbPath = dbPathOverride || path.join(__dirname, "../../data", "web-database.db");
    const dataDir = path.dirname(dbPath);

    // Ensure the data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log("Created data directory:", dataDir);
    }

    // Check if database file exists
    const dbExists = fs.existsSync(dbPath);
    
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error("Error opening database:", err);
          reject(err);
        } else {
          if (!dbExists) {
            console.log("Database file not found - creating new database:", dbPath);
          } else {
            console.log("Connected to existing SQLite database:", dbPath);
          }
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createTables() {
    const tables = [
      // Goals table
      `CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('annual', 'monthly', 'weekly')),
        title TEXT NOT NULL,
        description TEXT,
        parent_id INTEGER,
        progress REAL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
        priority TEXT DEFAULT 'medium' CHECK(priority IN ('high', 'medium', 'low')),
        success_criteria TEXT,
        target_date TEXT,
        target_year INTEGER,
        target_month INTEGER,
        target_week INTEGER,
        focus_area_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES goals (id),
        FOREIGN KEY (focus_area_id) REFERENCES focus_areas (id)
      )`,

      // Goal notes table
      `CREATE TABLE IF NOT EXISTS goal_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('general', 'what_worked', 'what_didnt_work')),
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (goal_id) REFERENCES goals (id) ON DELETE CASCADE
      )`,

      // Focus areas table
      `CREATE TABLE IF NOT EXISTS focus_areas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        month TEXT,
        theme TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Monthly focus assignments table
      `CREATE TABLE IF NOT EXISTS monthly_focus_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        focus_area_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (focus_area_id) REFERENCES focus_areas (id),
        UNIQUE(year, month)
      )`,

      // Habits table
      `CREATE TABLE IF NOT EXISTS habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        frequency TEXT DEFAULT 'daily' CHECK(frequency IN ('daily', 'weekdays', 'weekends', 'custom')),
        custom_days TEXT,
        target_streak INTEGER DEFAULT 30,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Habit logs table
      `CREATE TABLE IF NOT EXISTS habit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        habit_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        completed BOOLEAN DEFAULT 0,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (habit_id) REFERENCES habits (id) ON DELETE CASCADE,
        UNIQUE(habit_id, date)
      )`,

      // Morning notes table
      `CREATE TABLE IF NOT EXISTS morning_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        priorities TEXT,
        mood INTEGER CHECK(mood >= 1 AND mood <= 10),
        energy INTEGER CHECK(energy >= 1 AND energy <= 10),
        gratitude TEXT,
        challenges TEXT,
        intention TEXT,
        template_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES templates (id)
      )`,

      // Evening reflection table
      `CREATE TABLE IF NOT EXISTS evening_reflections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        what_went_well TEXT,
        what_could_improve TEXT,
        lessons_learned TEXT,
        tomorrow_priority TEXT,
        gratitude TEXT,
        day_rating INTEGER CHECK(day_rating >= 1 AND day_rating <= 10),
        accomplishments TEXT,
        template_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES templates (id)
      )`,

      // Wisdom library table
      `CREATE TABLE IF NOT EXISTS wisdom (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        author TEXT,
        source TEXT,
        tags TEXT,
        category TEXT,
        personal_notes TEXT,
        is_favorite BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Templates table
      `CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('morning', 'evening')),
        questions TEXT NOT NULL,
        is_default BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // AI chat history table
      `CREATE TABLE IF NOT EXISTS ai_chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        message TEXT NOT NULL,
        context TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Moods table
      `CREATE TABLE IF NOT EXISTS moods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        rating INTEGER NOT NULL
      )`,
    ];

    for (const table of tables) {
      await this.run(table);
    }
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /** Closes the underlying connection. Used on shutdown and between tests. */
  close() {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve();
      this.db.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

module.exports = WebDatabase;