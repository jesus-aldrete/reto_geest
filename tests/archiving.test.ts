import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/index.js';
import { completeUserPart } from '../src/domain/tasks.service.js';
import { buildHarness, drainNotifications, type TestHarness } from './helpers/app.js';
import { taskWithUsers } from './helpers/fixtures.js';

let h:TestHarness;

beforeEach( ()=>{ h=buildHarness() } );
afterEach ( ()=>h.cleanup()          );

const archivedEvents = ( taskId:number )=>h.db
.prepare<[number], { c:number }>( "SELECT COUNT(*) AS c FROM task_events WHERE task_id = ? AND type = 'task.archived'" )
.get                            ( taskId )!.c;

const outboxRows = ( taskId:number )=>h.db
.prepare<[number], { c:number }>( 'SELECT COUNT(*) AS c FROM notification_outbox WHERE task_id = ?' )
.get                            ( taskId )!.c;

describe( 'Archivado sin duplicados', ()=>{
	it( 'los dos últimos usuarios completando a la vez archivan la tarea exactamente una vez', async()=>{
		const {taskId, userIds} = await taskWithUsers( h, 2 );
		const [first , second ] = await Promise.all([
			request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] }),
			request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[1] }),
		]);

		expect( first.status  ).toBe( 200 );
		expect( second.status ).toBe( 200 );

		const detail = await request( h.app ).get( `/tasks/${taskId}` );

		expect( detail.body.status ).toBe( 'archived' );

		expect( archivedEvents( taskId ) ).toBe( 1 );
		expect( outboxRows    ( taskId ) ).toBe( 1 );
	});

	it( 'cinco usuarios completando simultáneamente producen un único archivado', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 5 );

		await Promise.all( userIds.map( userId=>request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId }) ) );

		expect( archivedEvents( taskId ) ).toBe( 1 );
		expect( outboxRows    ( taskId ) ).toBe( 1 );

		const detail = await request( h.app ).get( `/tasks/${taskId}` );

		expect( detail.body.status         ).toBe( 'archived' );
		expect( detail.body.completedCount ).toBe( 5 );
	});

	it( 'envía exactamente una notificación aunque el archivado se dispare en paralelo', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 3 );

		await Promise.all       ( userIds.map( userId=>request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId }) ) );
		await drainNotifications( h, taskId );

		expect( h.transportCalls             ).toHaveLength ( 1 );
		expect( h.transportCalls[0]!.payload ).toMatchObject({ taskId, title:'Tarea de prueba' });

		const notifications = await request( h.app ).get( `/tasks/${taskId}/notifications` );

		expect( notifications.body.totalAttempts ).toBe( 1 );
		expect( notifications.body.status        ).toBe( 'delivered' );
	});

	it( 'repetir el complete del último usuario no vuelve a archivar ni a notificar', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 1 );

		await request           ( h.app     ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });
		await request           ( h.app     ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });
		await request           ( h.app     ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });
		await drainNotifications( h, taskId );

		expect( archivedEvents( taskId ) ).toBe        ( 1 );
		expect( h.transportCalls         ).toHaveLength( 1 );
	});

	it( 'el UPDATE condicional impide un segundo archivado aunque se intente directamente', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 1 );

		await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });

		const changes = h.db
		.prepare(`
			UPDATE tasks SET status = 'archived', archived_at = ?, updated_at = ?
			 WHERE id = ? AND status = 'open'
		`)
		.run( new Date().toISOString(), new Date().toISOString(), taskId ).changes;

		expect( changes ).toBe( 0 );

		const inserted = h.db
		.prepare( 'INSERT OR IGNORE INTO notification_outbox (task_id, payload) VALUES (?, ?)' )
		.run    ( taskId, '{}' ).changes;

		expect( inserted             ).toBe( 0 );
		expect( outboxRows( taskId ) ).toBe( 1 );
	});

	it( 'dos conexiones distintas a la misma base archivan una sola vez', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 2 );

		const dbA = openDatabase( h.dbPath );
		const dbB = openDatabase( h.dbPath );

		try {
			const [a, b] = await Promise.all([
				Promise.resolve().then( ()=>completeUserPart( dbA, taskId, userIds[0]! ) ),
				Promise.resolve().then( ()=>completeUserPart( dbB, taskId, userIds[1]! ) ),
			]);

			expect( [a.archivedByThisRequest, b.archivedByThisRequest].filter( Boolean           ) ).toHaveLength( 1 );
			expect( [a.taskStatus           , b.taskStatus           ].filter( s=>s==='archived' ) ).toHaveLength( 1 );
		}
		finally {
			dbA.close();
			dbB.close();
		}

		const detail = await request( h.app ).get( `/tasks/${taskId}` );

		expect( detail.body.status       ).toBe( 'archived' );
		expect( archivedEvents( taskId ) ).toBe( 1          );
		expect( outboxRows    ( taskId ) ).toBe( 1          );
	});

	it( 'una tarea sin usuarios asignados no se archiva sola', async()=>{
		const res    = await request( h.app ).post( '/tasks' ).send({ title:'Sin asignar' });
		const taskId = res.body.id as number;
		const detail = await request( h.app ).get( `/tasks/${taskId}` );

		expect( detail.body.status   ).toBe( 'open' );
		expect( outboxRows( taskId ) ).toBe( 0      );
	});

	it( 'una tarea archivada no admite nuevas asignaciones', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 1 );

		await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });

		const otro = await request( h.app )
		.post( '/users' )
		.send({ name:'Nuevo', lastName:'Usuario', email:'nuevo@example.com' });

		const res = await request( h.app ).post( `/tasks/${taskId}/assign` ).send({ userIds:[otro.body.id] });

		expect( res.status          ).toBe( 409                     );
		expect( res.body.error.code ).toBe( 'TASK_ALREADY_ARCHIVED' );
	});
});
