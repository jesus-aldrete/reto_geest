import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHarness, clientError, drainNotifications, noResponse, ok, serverError, type TestHarness } from './helpers/app.js';
import { createTaskId, taskWithUsers } from './helpers/fixtures.js';

let h: TestHarness;

beforeEach( ()=>{ h = buildHarness() } );
afterEach ( ()=>h.cleanup()            );

async function archiveTask( harness:TestHarness, users=1 ) {
	const { taskId, userIds } = await taskWithUsers( harness, users );

	for ( const userId of userIds ) await request( harness.app ).post( `/tasks/${taskId}/complete` ).send( {userId} );

	return taskId;
}

describe( 'Notificación al archivar', ()=>{
	it( 'envía un POST con taskId, title y archivedAt', async()=>{
		const taskId = await archiveTask( h );

		await drainNotifications( h, taskId );

		expect( h.transportCalls ).toHaveLength( 1 );

		const call = h.transportCalls[0]!;

		expect( call.url     ).toBe   ( 'https://notify.test/hook' );
		expect( call.payload ).toEqual({
			taskId,
			title     : 'Tarea de prueba',
			archivedAt: expect.any( String ),
		});

		expect( ( call.payload as { archivedAt:string } ).archivedAt ).toMatch( /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/ );
	});

	it( 'no envía nada mientras la tarea siga abierta', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 2 );

		await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });
		await h.dispatcher.runOnce();

		expect( h.transportCalls ).toHaveLength( 0 );

		const res = await request( h.app ).get( `/tasks/${taskId}/notifications` );

		expect( res.body.status   ).toBe   ( 'not_scheduled' );
		expect( res.body.attempts ).toEqual( []              );
	});
});

describe( 'Reintentos', ()=>{
	it( 'reintenta ante un 5xx hasta un máximo de 3 intentos', async()=>{
		h.transportResponses.splice( 0, h.transportResponses.length, serverError( 500 ) );

		const taskId = await archiveTask( h );

		await drainNotifications( h, taskId );

		expect( h.transportCalls ).toHaveLength( 3 );

		const res = await request( h.app ).get( `/tasks/${taskId}/notifications` );

		expect( res.body.status        ).toBe( 'failed' );
		expect( res.body.totalAttempts ).toBe( 3 );
		expect( res.body.attempts.map  ( ( a:{attempt:number} )=>a.attempt           ) ).toEqual( [1, 2, 3] );
		expect( res.body.attempts.every( ( a:{status :string} )=>a.status==='failed' ) ).toBe   ( true      );
	});

	it( 'reintenta cuando el destino no responde', async()=>{
		h.transportResponses.splice( 0, h.transportResponses.length, noResponse() );

		const taskId = await archiveTask( h );

		await drainNotifications( h, taskId );

		expect( h.transportCalls ).toHaveLength( 3 );

		const res = await request( h.app ).get( `/tasks/${taskId}/notifications` );

		expect( res.body.attempts[0].httpStatus ).toBeNull(                      );
		expect( res.body.attempts[0].error      ).toEqual ( expect.any( String ) );
	});

	it( 'deja de reintentar en cuanto una entrega tiene éxito', async()=>{
		h.transportResponses.splice( 0, h.transportResponses.length, serverError( 503 ), ok( 200 ) );

		const taskId = await archiveTask( h );

		await drainNotifications( h, taskId );

		expect( h.transportCalls ).toHaveLength( 2 );

		const res = await request( h.app ).get( `/tasks/${taskId}/notifications` );

		expect( res.body.status        ).toBe         ( 'delivered'                                   );
		expect( res.body.totalAttempts ).toBe         ( 2                                             );
		expect( res.body.attempts[0]   ).toMatchObject({ attempt:1, status:'failed' , httpStatus:503 });
		expect( res.body.attempts[1]   ).toMatchObject({ attempt:2, status:'success', httpStatus:200 });
	});

	it( 'no reintenta ante un 4xx, porque el resultado no cambiaría', async()=>{
		h.transportResponses.splice( 0, h.transportResponses.length, clientError( 400 ) );

		const taskId = await archiveTask( h );

		await drainNotifications( h, taskId );

		expect( h.transportCalls ).toHaveLength( 1 );

		const res = await request( h.app ).get( `/tasks/${taskId}/notifications` );

		expect( res.body.status        ).toBe( 'failed' );
		expect( res.body.totalAttempts ).toBe( 1        );
	});

	it( 'las esperas entre reintentos son crecientes', async()=>{
		h.transportResponses.splice( 0, h.transportResponses.length, serverError() );

		const harness = buildHarness({ notifyRetryBaseMs:200, notifyPollIntervalMs:10 });

		try {
			harness.transportResponses.splice( 0, harness.transportResponses.length, serverError() );

			const taskId = await archiveTask( harness );

			// Primer intento inmediato.
			await harness.dispatcher.runOnce();

			expect( harness.transportCalls ).toHaveLength( 1 );

			const afterFirst = harness.db
			.prepare<[number], { next_attempt_at:string; attempts:number }>( 'SELECT next_attempt_at, attempts FROM notification_outbox WHERE task_id = ?' )
			.get                                                           ( taskId )!;

			const waitAfterFirst = new Date( afterFirst.next_attempt_at ).getTime() - Date.now();

			expect( afterFirst.attempts ).toBe           ( 1   );
			expect( waitAfterFirst      ).toBeGreaterThan( 100 );

			await harness.dispatcher.runOnce();

			expect( harness.transportCalls ).toHaveLength( 1 );

			await new Promise( r=>setTimeout( r, waitAfterFirst + 30 ) );
			await harness.dispatcher.runOnce();

			expect( harness.transportCalls ).toHaveLength( 2 );

			const afterSecond = harness.db
			.prepare<[number], { next_attempt_at:string }>( 'SELECT next_attempt_at FROM notification_outbox WHERE task_id = ?' )
			.get                                          ( taskId )!;

			const waitAfterSecond = new Date( afterSecond.next_attempt_at ).getTime() - Date.now();

			expect( waitAfterSecond ).toBeGreaterThan( waitAfterFirst );
		}
		finally {
			harness.cleanup();
		}
	});

	it( 'registra el intento fallido cuando NOTIFY_URL no está configurada', async()=>{
		const harness = buildHarness({ notifyUrl:null });

		try {
			const taskId = await archiveTask( harness );

			await drainNotifications( harness, taskId );

			expect( harness.transportCalls ).toHaveLength( 0 );

			const res = await request( harness.app ).get( `/tasks/${taskId}/notifications` );

			expect( res.body.status            ).toBe     ( 'failed'     );
			expect( res.body.totalAttempts     ).toBe     ( 1            );
			expect( res.body.attempts[0].error ).toContain( 'NOTIFY_URL' );
		}
		finally {
			harness.cleanup();
		}
	});
});

describe( 'GET /tasks/:idTask/notifications', ()=>{
	it( 'devuelve número de intento, timestamp y status HTTP de cada intento', async()=>{
		h.transportResponses.splice( 0, h.transportResponses.length, serverError( 502 ), ok( 204 ) );

		const taskId = await archiveTask( h );

		await drainNotifications( h, taskId );

		const res = await request( h.app ).get( `/tasks/${taskId}/notifications` );

		expect( res.status      ).toBe( 200    );
		expect( res.body.taskId ).toBe( taskId );

		for ( const attempt of res.body.attempts ) {
			expect( attempt           ).toHaveProperty( 'attempt'            );
			expect( attempt           ).toHaveProperty( 'timestamp'          );
			expect( attempt           ).toHaveProperty( 'httpStatus'         );
			expect( attempt.timestamp ).toEqual       ( expect.any( String ) );
		}

		expect( res.body.payload ).toMatchObject( {taskId} );
	});

	it( 'devuelve 404 si la tarea no existe', async()=>{
		const res = await request( h.app ).get( '/tasks/9999/notifications' );

		expect( res.status          ).toBe( 404              );
		expect( res.body.error.code ).toBe( 'TASK_NOT_FOUND' );
	});

	it( 'una tarea sin archivar devuelve la lista vacía', async()=>{
		const taskId = await createTaskId( h     );
		const res    = await request     ( h.app ).get( `/tasks/${taskId}/notifications` );

		expect( res.status             ).toBe   ( 200 );
		expect( res.body.attempts      ).toEqual( []  );
		expect( res.body.totalAttempts ).toBe   ( 0   );
	});
});
