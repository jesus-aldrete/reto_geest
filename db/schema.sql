CREATE TABLE idempotency_keys (
	idempotency_key TEXT    NOT NULL,
	method          TEXT    NOT NULL,
	path            TEXT    NOT NULL,
	request_hash    TEXT    NOT NULL,
	state           TEXT    NOT NULL CHECK (state IN ('in_progress', 'completed')),
	response_status INTEGER,
	response_body   TEXT,
	created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	completed_at    TEXT,
	PRIMARY KEY (idempotency_key, method, path)
);

CREATE TABLE notification_attempts (
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	task_id        INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
	attempt_number INTEGER NOT NULL,
	status         TEXT    NOT NULL CHECK (status IN ('success', 'failed')),
	http_status    INTEGER,
	error          TEXT,
	url            TEXT,
	duration_ms    INTEGER,
	created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	UNIQUE (task_id, attempt_number)
);

CREATE TABLE notification_outbox (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	task_id         INTEGER NOT NULL UNIQUE REFERENCES tasks (id) ON DELETE CASCADE,
	payload         TEXT    NOT NULL,
	status          TEXT    NOT NULL DEFAULT 'pending'
	                                 CHECK (status IN ('pending', 'delivering', 'delivered', 'failed')),
	attempts        INTEGER NOT NULL DEFAULT 0,
	next_attempt_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	claimed_at      TEXT,
	created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE schema_migrations (
	version    TEXT PRIMARY KEY,
	applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE task_assignments (
	task_id      INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
	user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	assigned_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	completed_at TEXT,
	PRIMARY KEY (task_id, user_id)
);

CREATE TABLE task_events (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	task_id    INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
	user_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
	type       TEXT    NOT NULL CHECK (type IN (
	              'task.created',
	              'task.assigned',
	              'task.part_completed',
	              'task.archived',
	              'notification.delivered',
	              'notification.failed'
	            )),
	payload    TEXT,
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

CREATE TABLE users (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT    NOT NULL,
	last_name  TEXT    NOT NULL,
	email      TEXT    NOT NULL UNIQUE,
	created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_assignments_pending ON task_assignments (task_id) WHERE completed_at IS NULL;

CREATE INDEX idx_assignments_user ON task_assignments (user_id);

CREATE INDEX idx_attempts_task ON notification_attempts (task_id, attempt_number);

CREATE INDEX idx_events_task ON task_events (task_id, id);

CREATE INDEX idx_idempotency_created ON idempotency_keys (created_at);

CREATE INDEX idx_outbox_ready ON notification_outbox (status, next_attempt_at);

CREATE INDEX idx_tasks_status ON tasks (status);
