

/*/ ***** Importaciones ***** /*/
import type { Db } from '../db/index.js';
import { AppError, ErrorCode } from '../http/errors.js';
import { toUserDto, type TaskStatus, type UserDto, type UserRow } from '../types.js';
// ####################################################################################################


/*/ ***** Tipos ***** /*/
interface UserTaskRow {
	user_id     : number;
	task_id     : number;
	title       : string;
	description : string | null;
	status      : TaskStatus;
	assigned_at : string;
	completed_at: string | null;
}
// ####################################################################################################


/*/ ***** Exportaciones ***** /*/
export interface CreateUserInput {
	name    : string;
	lastName: string;
	email   : string;
}

export function createUser( db:Db, input:CreateUserInput ):UserDto {
	const email = input.email.trim().toLowerCase();

	try {
		const row = db
		.prepare<[string, string, string], UserRow>( 'INSERT INTO users (name, last_name, email) VALUES (?, ?, ?) RETURNING *' )
		.get                                       ( input.name.trim(), input.lastName.trim(), email                           );

		return toUserDto( row! );
	}
	catch ( err ) {
		if ( err instanceof Error && err.message.includes( 'UNIQUE constraint failed: users.email' ) ) {
			throw AppError.conflict( ErrorCode.EMAIL_ALREADY_EXISTS, `Ya existe un usuario con el correo ${email}.` );
		}

		throw err;
	}
}
export function getUserRow( db:Db, id:number ):UserRow|undefined {
	return db.prepare<[number], UserRow>( 'SELECT * FROM users WHERE id = ?' ).get( id );
}
export function requireUser( db:Db, id:number ):UserRow {
	const user = getUserRow( db, id );

	if ( !user ) throw AppError.notFound( ErrorCode.USER_NOT_FOUND, `No existe un usuario con id ${id}.` );

	return user;
}
export function listUsersWithPendingTasks( db:Db ) {
	const users = db.prepare<[], UserRow>( 'SELECT * FROM users ORDER BY id' ).all();

	const pending = db
	.prepare<[], UserTaskRow>(`
		SELECT a.user_id, t.id AS task_id, t.title, t.description, t.status,
		       a.assigned_at, a.completed_at
		  FROM task_assignments a
		  JOIN tasks t ON t.id = a.task_id
		 WHERE a.completed_at IS NULL
		 ORDER BY t.id
	`)
	.all();

	const byUser = new Map<number, UserTaskRow[]>();

	for ( const row of pending ) {
		const list = byUser.get( row.user_id );

		if ( list ) list  .push( row                );
		else        byUser.set ( row.user_id, [row] );
	}

	return users.map( user=>{
		const tasks = byUser.get( user.id ) ?? [];

		return {
			...toUserDto( user ),
			pendingTasksCount: tasks.length,
			pendingTasks     : tasks.map( t=>({
				id         : t.task_id,
				title      : t.title,
				description: t.description,
				status     : t.status,
				assignedAt : t.assigned_at,
			}) ),
		};
	});
}
export function listTasksOfUser( db:Db, userId:number ) {
	requireUser( db, userId );

	const rows = db
	.prepare<[number], UserTaskRow & { created_at:string; archived_at:string|null }>(`
		SELECT a.user_id, t.id AS task_id, t.title, t.description, t.status,
		       a.assigned_at, a.completed_at, t.created_at, t.archived_at
		  FROM task_assignments a
		  JOIN tasks t ON t.id = a.task_id
		 WHERE a.user_id = ?
		 ORDER BY t.id
	`)
	.all( userId );

	return rows.map( row=>({
		id         : row.task_id,
		title      : row.title,
		description: row.description,
		status     : row.status,
		assignedAt : row.assigned_at,
		completed  : row.completed_at!==null,
		completedAt: row.completed_at,
		createdAt  : row.created_at,
		archivedAt : row.archived_at,
	}) );
}
