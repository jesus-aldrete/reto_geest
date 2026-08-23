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

CREATE INDEX idx_events_task ON task_events (task_id, id);
