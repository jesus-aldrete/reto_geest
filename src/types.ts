

/*/ ***** Exportaciones ***** /*/
export interface UserRow {
	id        : number;
	name      : string;
	last_name : string;
	email     : string;
	created_at: string;
}
export type TaskStatus = 'open' | 'archived';
export interface TaskRow {
	id         : number;
	title      : string;
	description: string | null;
	status     : TaskStatus;
	created_at : string;
	updated_at : string;
	archived_at: string | null;
}
export interface AssignmentRow {
	task_id     : number;
	user_id     : number;
	assigned_at : string;
	completed_at: string | null;
}
export interface NotificationAttemptRow {
	id            : number;
	task_id       : number;
	attempt_number: number;
	status        : 'success' | 'failed';
	http_status   : number | null;
	error         : string | null;
	url           : string | null;
	duration_ms   : number | null;
	created_at    : string;
}
export interface OutboxRow {
	id             : number;
	task_id        : number;
	payload        : string;
	status         : 'pending' | 'delivering' | 'delivered' | 'failed';
	attempts       : number;
	next_attempt_at: string;
	claimed_at     : string | null;
	created_at     : string;
	updated_at     : string;
}
export interface TaskEventRow {
	id        : number;
	task_id   : number;
	user_id   : number | null;
	type      : string;
	payload   : string | null;
	created_at: string;
}
export interface UserDto {
	id       : number;
	name     : string;
	lastName : string;
	email    : string;
	createdAt: string;
}
export interface TaskAssigneeDto {
	userId     : number;
	name       : string;
	lastName   : string;
	email      : string;
	assignedAt : string;
	completed  : boolean;
	completedAt: string | null;
}
export interface TaskDto {
	id            : number;
	title         : string;
	description   : string | null;
	status        : TaskStatus;
	createdAt     : string;
	updatedAt     : string;
	archivedAt    : string | null;
	assignees     : TaskAssigneeDto[];
	completedCount: number;
	totalAssignees: number;
}

export function toUserDto( row:UserRow ):UserDto {
	return {
		id       : row.id,
		name     : row.name,
		lastName : row.last_name,
		email    : row.email,
		createdAt: row.created_at,
	};
}
// ####################################################################################################
