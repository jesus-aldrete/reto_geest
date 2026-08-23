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

CREATE INDEX idx_outbox_ready ON notification_outbox (status, next_attempt_at);

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

CREATE INDEX idx_attempts_task ON notification_attempts (task_id, attempt_number);
