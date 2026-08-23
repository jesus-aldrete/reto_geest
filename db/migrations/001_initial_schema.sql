CREATE TABLE users (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT    NOT NULL,
	last_name  TEXT    NOT NULL,
	email      TEXT    NOT NULL UNIQUE,
	created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE tasks (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	title       TEXT    NOT NULL,
	description TEXT,
	status      TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'archived')),
	created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	archived_at TEXT,
	CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);

CREATE INDEX idx_tasks_status ON tasks (status);

CREATE TABLE task_assignments (
	task_id      INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
	user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	assigned_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	completed_at TEXT,
	PRIMARY KEY (task_id, user_id)
);

CREATE INDEX idx_assignments_user ON task_assignments (user_id);
CREATE INDEX idx_assignments_pending ON task_assignments (task_id) WHERE completed_at IS NULL;
