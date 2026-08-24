import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHarness, type TestHarness } from './helpers/app.js';
import { createTaskId, createUserId, taskWithUsers } from './helpers/fixtures.js';

let h:TestHarness;

beforeEach( ()=>{ h = buildHarness() } );
afterEach ( ()=>h.cleanup()            );

const countUsers = ()=>h.db.prepare<[],{c:number}>( 'SELECT COUNT(*) AS c FROM users' ).get()!.c;
const countTasks = ()=>h.db.prepare<[],{c:number}>( 'SELECT COUNT(*) AS c FROM tasks' ).get()!.c;

describe( 'Idempotency-Key en POST /users', ()=>{
	it( 'ejecuta la operación una sola vez y devuelve respuestas idénticas', async()=>{
		const body = { name:'Ana', lastName:'Ruiz', email:'ana@example.com' };

		const first  = await request( h.app ).post( '/users' ).set( 'Idempotency-Key', 'k-1' ).send( body );
		const second = await request( h.app ).post( '/users' ).set( 'Idempotency-Key', 'k-1' ).send( body );

		expect( first.status                           ).toBe   ( 201        );
		expect( second.status                          ).toBe   ( 201        );
		expect( second.body                            ).toEqual( first.body );
		expect( second.headers['idempotency-replayed'] ).toBe   ( 'true'     );
		expect( countUsers()                           ).toBe   ( 1          );
	});

	it( 'el orden de las claves del cuerpo no afecta a la idempotencia', async()=>{
		const first = await request( h.app )
		.post( '/users'                                               )
		.set ( 'Idempotency-Key', 'k-orden'                           )
		.send({ name:'Ana', lastName:'Ruiz', email:'ana@example.com' });

		const second = await request( h.app )
		.post( '/users'                                               )
		.set ( 'Idempotency-Key', 'k-orden'                           )
		.send({ email:'ana@example.com', lastName:'Ruiz', name:'Ana' });

		expect( second.body  ).toEqual( first.body );
		expect( countUsers() ).toBe   ( 1          );
	});

	it( 'rechaza con 409 la misma clave con un cuerpo distinto', async()=>{
		await request( h.app )
		.post( '/users'                                               )
		.set ( 'Idempotency-Key', 'k-2'                               )
		.send({ name:'Ana', lastName:'Ruiz', email:'ana@example.com' });

		const res = await request( h.app )
		.post( '/users'                                                     )
		.set ( 'Idempotency-Key', 'k-2'                                     )
		.send({ name:'Otro', lastName:'Distinto', email:'otro@example.com' });

		expect( res.status          ).toBe( 409                      );
		expect( res.body.error.code ).toBe( 'IDEMPOTENCY_KEY_REUSED' );
		expect( countUsers()        ).toBe( 1                        );
	});

	it( 'claves distintas ejecutan operaciones distintas', async()=>{
		await request( h.app )
		.post( '/users'                                               )
		.set ( 'Idempotency-Key', 'a'                                 )
		.send({ name:'Ana', lastName:'Ruiz', email:'ana@example.com' });

		await request( h.app )
		.post( '/users'                                                )
		.set ( 'Idempotency-Key', 'b'                                  )
		.send({ name:'Luis', lastName:'Paz', email:'luis@example.com' });

		expect( countUsers() ).toBe( 2 );
	});

	it( 'la misma clave en endpoints distintos no colisiona', async()=>{
		const user = await request( h.app )
		.post( '/users'                                               )
		.set ( 'Idempotency-Key', 'compartida'                        )
		.send({ name:'Ana', lastName:'Ruiz', email:'ana@example.com' });

		const task = await request( h.app )
		.post( '/tasks'                        )
		.set ( 'Idempotency-Key', 'compartida' )
		.send( { title:'Una tarea' }           );

		expect( user.status  ).toBe( 201 );
		expect( task.status  ).toBe( 201 );
		expect( countUsers() ).toBe( 1   );
		expect( countTasks() ).toBe( 1   );
	});

	it( 'también reproduce las respuestas de error', async()=>{
		const body = { name:'Ana', lastName:'Ruiz', email:'no-es-un-correo' };

		const first  = await request( h.app ).post( '/users' ).set( 'Idempotency-Key', 'k-err' ).send( body );
		const second = await request( h.app ).post( '/users' ).set( 'Idempotency-Key', 'k-err' ).send( body );

		expect( first .status ).toBe   ( 400        );
		expect( second.status ).toBe   ( 400        );
		expect( second.body   ).toEqual( first.body );
	});

	it( 'sin el header, cada request se procesa por separado', async()=>{
		await request( h.app ).post( '/tasks' ).send({ title:'T' });
		await request( h.app ).post( '/tasks' ).send({ title:'T' });

		expect( countTasks() ).toBe( 2 );
	});
});

describe( 'Idempotency-Key en requests paralelos', ()=>{
	it( 'POST /users duplicado en paralelo crea un único usuario', async()=>{
		const body = { name:'Ana', lastName:'Ruiz', email:'ana@example.com' };

		const responses = await Promise.all(
			Array.from( { length:5 }, ()=>request( h.app ).post( '/users' ).set( 'Idempotency-Key', 'paralela' ).send( body ) ),
		);

		expect( countUsers() ).toBe( 1 );

		for ( const res of responses ) {
			expect( res.status ).toBe   ( 201                );
			expect( res.body   ).toEqual( responses[0]!.body );
		}
	});

	it( 'POST /tasks duplicado en paralelo crea una única tarea', async()=>{
		const responses = await Promise.all(
			Array.from( { length:5 }, ()=>request( h.app ).post( '/tasks' ).set( 'Idempotency-Key', 'tarea-paralela' ).send({ title:'Única' }) ),
		);

		expect( countTasks() ).toBe( 1 );

		const ids = new Set( responses.map( r=>r.body.id ) );

		expect( ids.size ).toBe( 1 );
	});
});

describe( 'Idempotency-Key en assign y complete', ()=>{
	it( 'assign duplicado no altera el resultado', async()=>{
		const taskId = await createTaskId( h );
		const userId = await createUserId( h );
		const body   = { userIds:[userId] };

		const first = await request( h.app )
		.post( `/tasks/${taskId}/assign`    )
		.set ( 'Idempotency-Key', 'asignar' )
		.send( body                         );

		const second = await request( h.app )
		.post( `/tasks/${taskId}/assign`    )
		.set ( 'Idempotency-Key', 'asignar' )
		.send( body                         );

		expect( second.body          ).toEqual( first.body );
		expect( second.body.assigned ).toEqual( [userId]   );
	});

	it( 'complete duplicado se ejecuta una sola vez', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 2 );
		const body                = { userId:userIds[0] };

		const first = await request( h.app )
		.post( `/tasks/${taskId}/complete`    )
		.set ( 'Idempotency-Key', 'completar' )
		.send( body                           );

		const second = await request( h.app )
		.post( `/tasks/${taskId}/complete`    )
		.set ( 'Idempotency-Key', 'completar' )
		.send( body                           );

		expect( second.body ).toEqual( first.body );

		const events = h.db
		.prepare<[number],{c:number}>( "SELECT COUNT(*) AS c FROM task_events WHERE task_id = ? AND type = 'task.part_completed'" )
		.get                         ( taskId )!.c;

		expect( events ).toBe( 1 );
	});

	it( 'la misma clave en tareas distintas no colisiona', async()=>{
		const a = await taskWithUsers( h, 1 );
		const b = await taskWithUsers( h, 1 );

		const first = await request( h.app )
		.post( `/tasks/${a.taskId}/complete` )
		.set ( 'Idempotency-Key', 'misma'    )
		.send( {userId:a.userIds[0]}         );

		const second = await request( h.app )
		.post( `/tasks/${b.taskId}/complete` )
		.set ( 'Idempotency-Key', 'misma'    )
		.send( {userId:b.userIds[0] }        );

		expect( first .status      ).toBe( 200      );
		expect( second.status      ).toBe( 200      );
		expect( second.body.taskId ).toBe( b.taskId );
	});
});

describe( 'Alcance del header', ()=>{
	it( 'un GET con Idempotency-Key no queda cacheado', async()=>{
		const taskId = await createTaskId( h     );
		const before = await request     ( h.app ).get( '/tasks' ).set( 'Idempotency-Key', 'lectura' );

		expect( before.body.tasks ).toHaveLength( 1 );

		await createTaskId( h );

		const after = await request( h.app ).get( '/tasks' ).set( 'Idempotency-Key', 'lectura' );

		expect( after.body.tasks                      ).toHaveLength ( 2 );
		expect( after.headers['idempotency-replayed'] ).toBeUndefined(   );

		const stored = h.db
		.prepare<[],{c:number}>( "SELECT COUNT(*) AS c FROM idempotency_keys WHERE method = 'GET'" )
		.get                   ()!.c;

		expect( stored ).toBe           ( 0 );
		expect( taskId ).toBeGreaterThan( 0 );
	});
});
