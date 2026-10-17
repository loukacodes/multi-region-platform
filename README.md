# Multi-Region SQLite Demo

A small Node.js, Express, SQLite, and EJS app that routes each region to its own SQLite database shard. The shards share one schema, and a separate registry database maps each region to its shard file.

<img width="1325" height="824" alt="image" src="https://github.com/user-attachments/assets/e8f8fe18-94b1-44e3-87e1-20829c7579fe" />


## Overview

- `db/global_registry.db` is the routing table. Its `regions` table maps each region ID to a shard file.
- `db/region_us.db`, `db/region_eu.db`, `db/region_apac.db`, `db/region_latam.db`, and `db/region_mea.db` are the regional shards. Each holds that region's employees, users, and roles.
- Every shard has the same tables:
  - `employees`: ID, name, and job title.
  - `users`: ID, username, access role (via `roles`), and an optional link to an employee.
  - `roles`: Admin, Manager, and Viewer.
- The selected region is looked up in the registry, and only that shard is opened. The browser sends a region ID, never a file path.
- Add, edit, and delete actions affect only the selected region's shard.
- Deleting an employee also deletes that employee's linked users, so no user is left pointing at a missing employee.
- The databases are created on server start. Each table is seeded only while it is empty, so your changes persist across restarts.

## Project Structure

```
server.js          Express server: SQLite helpers, registry lookup, shard setup, validation, and routes
seeds.js           Seed data: the regions (REGION_SEEDS) and the sample employees and users (EMPLOYEE_SEEDS)
index.ejs          Dashboard template (rendered from the project root)
db/                SQLite databases (registry and region shards), created on start
package.json       Dependencies and scripts
```

## Requirements

- Node.js 18 or newer
- npm

## Run Locally

```bash
npm install
npm start
```

Open http://localhost:3000 in a browser. To use a different port, run `PORT=4000 npm start`.

## Reset the Data

To start from scratch, stop the server, delete the database files, and start again:

```bash
rm db/*.db
npm start
```

The registry and all shards are recreated with the seed data.

## Adding a Region

1. Add a row to `REGION_SEEDS` in `seeds.js`, for example `{ id: 'region_jp', name: 'Japan', db_file: 'region_jp.db' }`.
2. Optional: add an `EMPLOYEE_SEEDS` entry for the region with sample rows.
3. Restart the server. The new shard is created, and the region appears in the dropdown.

If you remove a region from `REGION_SEEDS`, its registry row is removed on the next start, but its `.db` file stays in `db/` until you delete it.

## Inspecting the Databases

```bash
sqlite3 db/global_registry.db "SELECT * FROM regions;"
sqlite3 db/region_us.db ".tables"
sqlite3 db/region_us.db ".schema"
```

## Routes

| Method | Path                            | Purpose                                   |
| ------ | ------------------------------- | ----------------------------------------- |
| GET    | `/?region=region_us`            | View a region's employees and users       |
| GET    | `/?region=region_us&edit=1`     | Open the edit form for employee ID 1      |
| GET    | `/?region=region_us&editUser=1` | Open the edit form for user ID 1          |
| POST   | `/employees`                    | Add an employee                           |
| POST   | `/employees/:id/update`         | Update an employee                        |
| POST   | `/employees/:id/delete`         | Delete an employee and their linked users |
| POST   | `/users`                        | Add a user                                |
| POST   | `/users/:id/update`             | Update a user                             |
| POST   | `/users/:id/delete`             | Delete a user                             |

Region IDs are `region_us` (North America), `region_eu` (Europe), `region_apac` (Asia Pacific), `region_latam` (Latin America), and `region_mea` (Middle East and Africa).
