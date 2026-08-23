

/*/ ***** Importaciones ***** /*/
import type { Db } from '../db/index.js';
import { AppError, ErrorCode } from '../http/errors.js';
import type { AssignmentRow, TaskAssigneeDto, TaskDto, TaskRow, TaskStatus } from '../types.js';
import { recordEvent } from './events.service.js';
// ####################################################################################################


/*/ ***** Tipos ***** /*/
interface AssigneeJoinRow extends AssignmentRow {
	name     : string;
	last_name: string;
	email    : string;
}
// ####################################################################################################


/*/ ***** Funciones ***** /*/
const nowIso = ()=>new Date().toISOString();

function assigneesOf( db:Db, taskIds:number[] ):Map<number, TaskAssigneeDto[]> {
	const map = new Map<number, TaskAssigneeDto[]>();

	if ( taskIds.length===0 ) return map;

	const placeholders = taskIds.map( ()=>'?' ).join( ', ' );

	const rows = db
	.prepare<number[], AssigneeJoinRow>(`
		SELECT a.*, u.name, u.last_name, u.email
		  FROM task_assignments a
		  JOIN users u ON u.id = a.user_id
		 WHERE a.task_id IN (${placeholders})
		 ORDER BY a.task_id, a.user_id
	`)
	.all( ...taskIds );

	for ( const row of rows ) {
		const dto: TaskAssigneeDto = {
			userId     : row.user_id,
			name       : row.name,
			lastName   : row.last_name,
			email      : row.email,
			assignedAt : row.assigned_at,
			completed  : row.completed_at!==null,
			completedAt: row.completed_at,
		};

		const list = map.get( row.task_id );

		if ( list ) list.push( dto );
		else        map.set( row.task_id, [dto] );
	}

	return map;
}
// ####################################################################################################


/*/ ***** Exportaciones ***** /*/
export interface CreateTaskInput {
	title       : string;
	description?: string | null;
}
export interface AssignResult {
	message        : string;
	taskId         : number;
	assigned       : number[];
	alreadyAssigned: number[];
	assignees      : TaskAssigneeDto[];
}
export interface CompleteResult {
	message              : string;
	taskId               : number;
	userId               : number;
	completedAt          : string;
	taskStatus           : TaskStatus;
	archived             : boolean;
	archivedByThisRequest: boolean;
	pendingUsers         : number[];
}

export function createTask( db:Db, input:CreateTaskInput ):TaskDto {
	const description = input.description?.trim() ? input.description.trim() : null;

	const task = db.transaction(()=>{
		const row = db
		.prepare<[string, string|null], TaskRow>( "INSERT INTO tasks (title, description, status) VALUES (?, ?, 'open') RETURNING *" )
		.get                                    ( input.title.trim(), description )!;

		recordEvent( db, { taskId:row.id, type:'task.created', payload:{ title:row.title } } );

		return row;
	})();

	return toTaskDto( task, [] );
}
export function getTaskRow( db:Db, id:number ):TaskRow|undefined {
	return db.prepare<[number], TaskRow>( 'SELECT * FROM tasks WHERE id = ?' ).get( id );
}
export function requireTask( db:Db, id:number ):TaskRow {
	const task = getTaskRow( db, id );

	if ( !task ) throw AppError.notFound( ErrorCode.TASK_NOT_FOUND, `No existe una tarea con id ${id}.` );

	return task;
}
export function toTaskDto( task:TaskRow, assignees:TaskAssigneeDto[] ):TaskDto {
	return {
		assignees     ,
		id            : task.id,
		title         : task.title,
		description   : task.description,
		status        : task.status,
		createdAt     : task.created_at,
		updatedAt     : task.updated_at,
		archivedAt    : task.archived_at,
		completedCount: assignees.filter( a=>a.completed ).length,
		totalAssignees: assignees.length,
	};
}
export function getTaskDetail( db:Db, taskId:number ):TaskDto {
	const task = requireTask( db, taskId );

	return toTaskDto( task, assigneesOf( db, [taskId] ).get( taskId ) ?? [] );
}
export function listTasks( db:Db, status?:TaskStatus ):TaskDto[] {
	const tasks = status
		? db.prepare<[string], TaskRow>( 'SELECT * FROM tasks WHERE status = ? ORDER BY id' ).all( status )
		: db.prepare<[], TaskRow>      ( 'SELECT * FROM tasks ORDER BY id'                  ).all(        )
	;

	const byTask = assigneesOf( db, tasks.map( t=>t.id ) );

	return tasks.map( task=>toTaskDto( task, byTask.get( task.id ) ?? [] ) );
}
export function assignUsers( db:Db, taskId:number, userIds:number[] ):AssignResult {
	const unique = [...new Set( userIds )];

	return db.transaction(()=>{
		const task = requireTask( db, taskId );

		if ( task.status==='archived' ) throw AppError.conflict( ErrorCode.TASK_ALREADY_ARCHIVED, `La tarea ${taskId} ya está archivada y no admite nuevas asignaciones.` );

		const existsUser = db.prepare<[number], { id:number }>( 'SELECT id FROM users WHERE id = ?' );
		const missing    = unique.filter( id=>!existsUser.get( id ) );

		if ( missing.length>0 ) throw AppError.notFound( ErrorCode.USER_NOT_FOUND, `No existen usuarios con id: ${missing.join( ', ' )}.` );

		const insert                    = db.prepare( 'INSERT OR IGNORE INTO task_assignments (task_id, user_id) VALUES (?, ?)' );
		const assigned       : number[] = [];
		const alreadyAssigned: number[] = [];

		for ( const userId of unique ) {
			const result = insert.run( taskId, userId );

			if ( result.changes===1 ) assigned.push( userId );
			else                      alreadyAssigned.push( userId );
		}

		if ( assigned.length>0 ) {
			db.prepare ( 'UPDATE tasks SET updated_at = ? WHERE id = ?'                     ).run( nowIso(), taskId );
			recordEvent( db, { taskId, type:'task.assigned', payload:{ userIds:assigned } } );
		}

		return {
			message        : 'Usuarios asignados correctamente.',
			taskId         ,
			assigned       ,
			alreadyAssigned,
			assignees      : assigneesOf( db, [taskId] ).get( taskId ) ?? [],
		};
	})();
}
export function completeUserPart( db:Db, taskId:number, userId:number ):CompleteResult {
	const run = db.transaction(()=>{
		const task = requireTask                        ( db, taskId                          );
		const user = db.prepare<[number], { id:number }>( 'SELECT id FROM users WHERE id = ?' ).get( userId );

		if ( !user ) throw AppError.notFound( ErrorCode.USER_NOT_FOUND, `No existe un usuario con id ${userId}.` );

		const assignment = db
		.prepare<[number, number], AssignmentRow>( 'SELECT * FROM task_assignments WHERE task_id = ? AND user_id = ?' )
		.get                                     ( taskId, userId );

		if ( !assignment ) throw AppError.badRequest( ErrorCode.USER_NOT_ASSIGNED, `El usuario ${userId} no está asignado a la tarea ${taskId}.` );

		const completedAt = assignment.completed_at ?? nowIso();

		if ( assignment.completed_at===null ) {
			db
			.prepare( 'UPDATE task_assignments SET completed_at = ? WHERE task_id = ? AND user_id = ?' )
			.run    ( completedAt, taskId, userId );

			recordEvent( db, { taskId, userId, type:'task.part_completed', payload:{ completedAt } } );
		}

		const pending = db
		.prepare<[number], { user_id:number }>( 'SELECT user_id FROM task_assignments WHERE task_id = ? AND completed_at IS NULL ORDER BY user_id' )
		.all                                  ( taskId       )
		.map                                  ( r=>r.user_id );

		let archivedByThisRequest = false;
		let status: TaskStatus    = task.status;

		if ( pending.length===0 && task.status==='open' ) {
			const archivedAt = nowIso();

			const changed = db
			.prepare(`
				UPDATE tasks SET status = 'archived', archived_at = ?, updated_at = ?
				 WHERE id = ? AND status = 'open'
			`)
			.run( archivedAt, archivedAt, taskId ).changes;

			if ( changed===1 ) {
				archivedByThisRequest = true;
				status                = 'archived';

				const payload = JSON.stringify({ taskId, title:task.title, archivedAt });

				db
				.prepare( 'INSERT OR IGNORE INTO notification_outbox (task_id, payload) VALUES (?, ?)' )
				.run    ( taskId, payload );

				recordEvent( db, { taskId, userId, type:'task.archived', payload:{ archivedAt } } );
			}
		}

		if ( status==='archived' ) status = requireTask( db, taskId ).status;

		const result: CompleteResult = {
			message              : 'Parte de la tarea marcada como completada.',
			taskId               ,
			userId               ,
			completedAt          ,
			taskStatus           : status,
			archived             : status==='archived',
			archivedByThisRequest,
			pendingUsers         : pending,
		};

		return result;
	});

	return run.immediate();
}
