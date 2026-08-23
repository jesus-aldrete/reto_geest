

/*/ ***** Importaciones ***** /*/
import type { Db           } from '../db/index.js';
import type { TaskEventRow } from '../types.js';
// ####################################################################################################


/*/ ***** Exportaciones ***** /*/
export type TaskEventType =
	| 'task.created'
	| 'task.assigned'
	| 'task.part_completed'
	| 'task.archived'
	| 'notification.delivered'
	| 'notification.failed'
;

export function recordEvent( db:Db, event:{ taskId:number; type:TaskEventType; userId?:number|null; payload?:unknown } ):void {
	db
	.prepare( 'INSERT INTO task_events (task_id, user_id, type, payload) VALUES (?, ?, ?, ?)' )
	.run    (
		event.taskId,
		event.userId ?? null,
		event.type,
		event.payload===undefined ? null : JSON.stringify( event.payload ),
	);
}
export function listTaskEvents( db:Db, taskId:number ) {
	const rows = db
	.prepare<[number], TaskEventRow>( 'SELECT * FROM task_events WHERE task_id = ? ORDER BY id' )
	.all                            ( taskId );

	return rows.map( row=>({
		id       : row.id,
		type     : row.type,
		userId   : row.user_id,
		payload  : row.payload ? JSON.parse( row.payload ) as unknown : null,
		createdAt: row.created_at,
	}) );
}
// ####################################################################################################
