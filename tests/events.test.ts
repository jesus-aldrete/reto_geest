import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHarness, drainNotifications, serverError, type TestHarness } from './helpers/app.js';
import { createTaskId, taskWithUsers } from './helpers/fixtures.js';

let h:TestHarness;

beforeEach( ()=>{ h = buildHarness() } );
afterEach ( ()=>h.cleanup()            );

const typesOf = ( body:{ events:{ type:string }[] } )=>body.events.map( e=>e.type );

describe( 'GET /tasks/:idTask/events', ()=>{
	it( 'registra la creación de la tarea', async()=>{
		const taskId = await createTaskId( h, 'Auditada' );
		const res    = await request     ( h.app         ).get( `/tasks/${taskId}/events` );

		expect( res.status                 ).toBe   ( 200                );
		expect( typesOf( res.body )        ).toEqual( ['task.created']   );
		expect( res.body.events[0].payload ).toEqual( {title:'Auditada'} );
	});

	it( 'registra el ciclo de vida completo en orden', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 2 );

		await request           ( h.app     ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });
		await request           ( h.app     ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[1] });
		await drainNotifications( h, taskId );

		const res = await request( h.app ).get( `/tasks/${taskId}/events` );

		expect( typesOf( res.body ) ).toEqual([
			'task.created'          ,
			'task.assigned'         ,
			'task.part_completed'   ,
			'task.part_completed'   ,
			'task.archived'         ,
			'notification.delivered',
		]);
	});

	it( 'atribuye cada completado a su usuario', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 2 );

		await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[1] });

		const res       = await request( h.app ).get( `/tasks/${taskId}/events` );
		const completed = res.body.events.filter( ( e:{ type:string } )=>e.type==='task.part_completed' );

		expect( completed                        ).toHaveLength( 1                    );
		expect( completed[0].userId              ).toBe        ( userIds[1]           );
		expect( completed[0].payload.completedAt ).toEqual     ( expect.any( String ) );
	});

	it( 'registra el fallo definitivo de la notificación', async()=>{
		h.transportResponses.splice( 0, h.transportResponses.length, serverError() );

		const { taskId, userIds } = await taskWithUsers( h, 1 );

		await request           ( h.app     ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });
		await drainNotifications( h, taskId );

		const res    = await request( h.app ).get( `/tasks/${taskId}/events` );
		const failed = res.body.events.find( ( e:{ type:string } )=>e.type==='notification.failed' );

		expect( failed                  ).toBeDefined(   );
		expect( failed.payload.attempts ).toBe       ( 3 );
	});

	it( 'no registra un evento de completado si la operación se repite', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 2 );

		await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });
		await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });

		const res       = await request( h.app ).get( `/tasks/${taskId}/events` );
		const completed = res.body.events.filter( ( e:{ type:string } )=>e.type==='task.part_completed' );

		expect( completed ).toHaveLength( 1 );
	});

	it( 'devuelve 404 si la tarea no existe', async()=>{
		const res = await request( h.app ).get( '/tasks/9999/events' );

		expect( res.status          ).toBe( 404              );
		expect( res.body.error.code ).toBe( 'TASK_NOT_FOUND' );
	});

	it( 'la bitácora no rompe la funcionalidad requerida: los eventos son sólo lectura', async()=>{
		const { taskId } = await taskWithUsers( h, 1  );
		const detail     = await request      ( h.app ).get( `/tasks/${taskId}` );

		expect( Object.keys( detail.body ).sort() )
		.toEqual(
			[
				'archivedAt'    ,
				'assignees'     ,
				'completedCount',
				'createdAt'     ,
				'description'   ,
				'id'            ,
				'status'        ,
				'title'         ,
				'totalAssignees',
				'updatedAt'     ,
			].sort()
		);
	});
});
