const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { REGION_SEEDS, EMPLOYEE_SEEDS } = require('./seeds');

const PORT = process.env.PORT || 3000;
const DB_DIR = path.join(__dirname, 'db');
const REGISTRY_FILE = path.join(DB_DIR, 'global_registry.db');
const ROLE_NAMES = ['Admin', 'Manager', 'Viewer'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- SQLite helpers (promise-based) ---
function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
  });
}

function closeDb(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

// Opens one database file, runs fn, and always closes the connection.
async function withDb(file, fn) {
  const db = await openDb(file);
  try {
    return await fn(db);
  } finally {
    await closeDb(db);
  }
}

// --- Routing: registry lookups and shard resolution ---
function shardPath(region) {
  return path.join(DB_DIR, region.db_file);
}

function listRegions() {
  return withDb(REGISTRY_FILE, (db) =>
    all(db, 'SELECT id, name, db_file FROM regions ORDER BY name'),
  );
}

// Resolves the region's shard via the registry; the client never supplies a file path.
async function withRegionShard(regionId, fn) {
  if (!regionId) throw new HttpError(400, 'Missing region.');

  const region = await withDb(REGISTRY_FILE, (db) =>
    get(db, 'SELECT id, name, db_file FROM regions WHERE id = ?', [regionId]),
  );
  if (!region) throw new HttpError(404, `Unknown region: ${regionId}`);

  return withDb(shardPath(region), (db) => fn(db, region));
}

// --- INITIALIZATION: create registry and shard files, seed if empty ---
async function initSystem() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  await withDb(REGISTRY_FILE, async (db) => {
    await run(
      db,
      `CREATE TABLE IF NOT EXISTS regions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        db_file TEXT NOT NULL UNIQUE
      )`,
    );
    for (const t of REGION_SEEDS) {
      await run(
        db,
        `INSERT INTO regions (id, name, db_file) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, db_file = excluded.db_file`,
        [t.id, t.name, t.db_file],
      );
    }
    // Drops registry rows for regions no longer in REGION_SEEDS.
    await run(
      db,
      `DELETE FROM regions WHERE id NOT IN (${REGION_SEEDS.map(() => '?').join(', ')})`,
      REGION_SEEDS.map((t) => t.id),
    );
  });

  for (const region of await listRegions()) {
    await withDb(shardPath(region), (db) => seedShard(db, region));
  }
}

// Users are seeded separately so shards created before the users table get backfilled.
async function seedShard(db, region) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )`,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL
    )`,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      employee_id INTEGER REFERENCES employees(id)
    )`,
  );
  for (const name of ROLE_NAMES) {
    await run(db, 'INSERT OR IGNORE INTO roles (name) VALUES (?)', [name]);
  }

  const seeds = EMPLOYEE_SEEDS[region.id] || [];
  const { count: employeeCount } = await get(db, 'SELECT COUNT(*) AS count FROM employees');
  if (employeeCount === 0) {
    for (const [name, title] of seeds) {
      await run(db, 'INSERT INTO employees (name, role) VALUES (?, ?)', [name, title]);
    }
  }

  const { count: userCount } = await get(db, 'SELECT COUNT(*) AS count FROM users');
  if (userCount === 0) {
    for (const [name, , username, accessRole] of seeds) {
      await run(
        db,
        `INSERT INTO users (username, role_id, employee_id) VALUES (
          ?,
          (SELECT id FROM roles WHERE name = ?),
          (SELECT id FROM employees WHERE name = ? LIMIT 1)
        )`,
        [username, accessRole, name],
      );
    }
  }
}

// --- Input helpers ---
function parseEmployee(body) {
  const name = String(body.name ?? '').trim();
  const role = String(body.role ?? '').trim();
  if (!name || !role) throw new HttpError(400, 'Name and role are required.');
  return { name, role };
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id.');
  return id;
}

function parseUser(body) {
  const username = String(body.username ?? '').trim();
  if (!username) throw new HttpError(400, 'Username is required.');
  const roleId = parseId(body.roleId);
  const employeeId = body.employeeId ? parseId(body.employeeId) : null;
  return { username, roleId, employeeId };
}

async function writeUser(db, sql, params) {
  try {
    return await run(db, sql, params);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT') {
      throw new HttpError(400, 'Username already exists in this region.');
    }
    throw err;
  }
}

// SQLite foreign keys are not enforced here, so unknown ids must be rejected explicitly.
async function assertRoleAndEmployee(db, roleId, employeeId) {
  if (!(await get(db, 'SELECT id FROM roles WHERE id = ?', [roleId]))) {
    throw new HttpError(400, 'Unknown access role.');
  }
  if (employeeId && !(await get(db, 'SELECT id FROM employees WHERE id = ?', [employeeId]))) {
    throw new HttpError(400, 'Unknown employee.');
  }
}

function regionUrl(regionId, message) {
  return `/?region=${encodeURIComponent(regionId)}&message=${encodeURIComponent(message)}`;
}

// --- App ---
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname));
app.use(express.urlencoded({ extended: true }));

// READ: region dropdown, selected region's records, optional edit form
app.get('/', async (req, res) => {
  const regions = await listRegions();
  const regionId = req.query.region || regions[0]?.id;
  const selectedRegion = regions.find((t) => t.id === regionId);
  if (!selectedRegion) throw new HttpError(404, `Unknown region: ${regionId}`);

  const editId = req.query.edit ? parseId(req.query.edit) : null;
  const editUserId = req.query.editUser ? parseId(req.query.editUser) : null;
  const { rows, editing, roles, employees, users, editingUser } = await withDb(
    shardPath(selectedRegion),
    async (db) => ({
      rows: await all(db, 'SELECT id, name, role FROM employees ORDER BY id'),
      editing: editId
        ? await get(db, 'SELECT id, name, role FROM employees WHERE id = ?', [editId])
        : null,
      roles: await all(db, 'SELECT id, name FROM roles ORDER BY id'),
      employees: await all(db, 'SELECT id, name FROM employees ORDER BY name'),
      users: await all(
        db,
        `SELECT u.id, u.username, u.role_id, u.employee_id, r.name AS access_role, e.name AS employee
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e ON e.id = u.employee_id
         ORDER BY u.username`,
      ),
      editingUser: editUserId
        ? await get(db, 'SELECT id, username, role_id, employee_id FROM users WHERE id = ?', [
            editUserId,
          ])
        : null,
    }),
  );

  res.render('index', {
    regions,
    selectedRegion,
    rows,
    users,
    roles,
    employees,
    editing: editing || null,
    editingUser: editingUser || null,
    message: req.query.message || null,
  });
});

// CREATE
app.post('/employees', async (req, res) => {
  const { regionId } = req.body;
  const { name, role } = parseEmployee(req.body);

  await withRegionShard(regionId, (db) =>
    run(db, 'INSERT INTO employees (name, role) VALUES (?, ?)', [name, role]),
  );
  res.redirect(regionUrl(regionId, 'Employee added.'));
});

// UPDATE
app.post('/employees/:id/update', async (req, res) => {
  const { regionId } = req.body;
  const id = parseId(req.params.id);
  const { name, role } = parseEmployee(req.body);

  const result = await withRegionShard(regionId, (db) =>
    run(db, 'UPDATE employees SET name = ?, role = ? WHERE id = ?', [name, role, id]),
  );
  if (result.changes === 0) throw new HttpError(404, `Employee ${id} not found in this region.`);
  res.redirect(regionUrl(regionId, 'Employee updated.'));
});

// DELETE
app.post('/employees/:id/delete', async (req, res) => {
  const { regionId } = req.body;
  const id = parseId(req.params.id);

  const result = await withRegionShard(regionId, async (db) => {
    await run(db, 'DELETE FROM users WHERE employee_id = ?', [id]);
    return run(db, 'DELETE FROM employees WHERE id = ?', [id]);
  });
  if (result.changes === 0) throw new HttpError(404, `Employee ${id} not found in this region.`);
  res.redirect(regionUrl(regionId, 'Employee and linked users deleted.'));
});

// USER CREATE
app.post('/users', async (req, res) => {
  const { regionId } = req.body;
  const { username, roleId, employeeId } = parseUser(req.body);

  await withRegionShard(regionId, async (db) => {
    await assertRoleAndEmployee(db, roleId, employeeId);
    await writeUser(db, 'INSERT INTO users (username, role_id, employee_id) VALUES (?, ?, ?)', [
      username,
      roleId,
      employeeId,
    ]);
  });
  res.redirect(regionUrl(regionId, 'User added.'));
});

// USER UPDATE
app.post('/users/:id/update', async (req, res) => {
  const { regionId } = req.body;
  const id = parseId(req.params.id);
  const { username, roleId, employeeId } = parseUser(req.body);

  const result = await withRegionShard(regionId, async (db) => {
    await assertRoleAndEmployee(db, roleId, employeeId);
    return writeUser(
      db,
      'UPDATE users SET username = ?, role_id = ?, employee_id = ? WHERE id = ?',
      [username, roleId, employeeId, id],
    );
  });
  if (result.changes === 0) throw new HttpError(404, `User ${id} not found in this region.`);
  res.redirect(regionUrl(regionId, 'User updated.'));
});

// USER DELETE
app.post('/users/:id/delete', async (req, res) => {
  const { regionId } = req.body;
  const id = parseId(req.params.id);

  const result = await withRegionShard(regionId, (db) =>
    run(db, 'DELETE FROM users WHERE id = ?', [id]),
  );
  if (result.changes === 0) throw new HttpError(404, `User ${id} not found in this region.`);
  res.redirect(regionUrl(regionId, 'User deleted.'));
});

// Error handler (Express 5 forwards rejected promises here)
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  const message = status >= 500 ? 'Internal server error.' : err.message;
  res
    .status(status)
    .send(`<p>${ejs.escapeXML(message)}</p><p><a href="/">Back to dashboard</a></p>`);
});

initSystem()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Multi-region server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialise databases:', err);
    process.exit(1);
  });
