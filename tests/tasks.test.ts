import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHarness, type TestHarness } from './helpers/app.js';
import { createTaskId, createUserId, taskWithUsers } from './helpers/fixtures.js';

let h:TestHarness;

beforeEach( ()=>{ h = buildHarness() } );
afterEach ( ()=>h.cleanup()            );

describe( 'POST /tasks', ()=>{
	it( 'crea una tarea con estado "open" por defecto', async()=>{
		const res = await request( h.app ).post( '/tasks' ).send({ title:'Migrar API', description:'A Node' });

		expect( res.status          ).toBe         ( 201                                                       );
		expect( res.body            ).toMatchObject({ title:'Migrar API', description:'A Node', status:'open' });
		expect( typeof res.body.id  ).toBe         ( 'number'                                                  );
		expect( res.body.archivedAt ).toBeNull     (                                                           );
	});

	it( 'acepta tareas sin descripción, porque es opcional', async()=>{
		const res = await request( h.app ).post( '/tasks' ).send({ title:'Sólo título' });

		expect( res.status           ).toBe    ( 201    );
		expect( res.body.description ).toBeNull(        );
		expect( res.body.status      ).toBe    ( 'open' );
	});

	it.each([
		['sin title'           , {             }],
		['title vacío'         , { title:'   ' }],
		['title no textual'    , { title:123   }],
	])( 'devuelve error 400 %s', async( _label, body )=>{
		const res = await request( h.app ).post( '/tasks' ).send( body );

		expect( res.status          ).toBe( 400                );
		expect( res.body.error.code ).toBe( 'VALIDATION_ERROR' );
	});
});

describe( 'POST /tasks/:idTask/assign', ()=>{
	it( 'asigna un arreglo de usuarios y devuelve un mensaje de éxito', async()=>{
		const taskId = await createTaskId( h );
		const a      = await createUserId( h );
		const b      = await createUserId( h );

		const res = await request( h.app ).post( `/tasks/${taskId}/assign` ).send({ userIds:[a, b] });

		expect( res.status         ).toBe        ( 200                  );
		expect( res.body.message   ).toEqual     ( expect.any( String ) );
		expect( res.body.assigned  ).toEqual     ( [a, b]               );
		expect( res.body.assignees ).toHaveLength( 2                    );
	});

	it( 'no duplica la relación si el usuario ya estaba asignado', async()=>{
		const taskId = await createTaskId( h );
		const userId = await createUserId( h );

		await request( h.app ).post( `/tasks/${taskId}/assign` ).send({ userIds:[userId] });

		const res = await request( h.app ).post( `/tasks/${taskId}/assign` ).send({ userIds:[userId] });

		expect( res.status               ).toBe   ( 200      );
		expect( res.body.assigned        ).toEqual( []       );
		expect( res.body.alreadyAssigned ).toEqual( [userId] );

		const detail = await request( h.app ).get( `/tasks/${taskId}` );

		expect( detail.body.assignees ).toHaveLength( 1 );
	});

	it( 'deduplica IDs repetidos dentro del mismo request', async()=>{
		const taskId = await createTaskId( h );
		const userId = await createUserId( h );

		const res = await request( h.app ).post( `/tasks/${taskId}/assign` ).send({ userIds:[userId, userId, userId] });

		expect( res.status         ).toBe        ( 200 );
		expect( res.body.assignees ).toHaveLength( 1   );
	});

	it( 'devuelve 404 si la tarea no existe', async()=>{
		const userId = await createUserId( h );
		const res    = await request( h.app ).post( '/tasks/9999/assign' ).send({ userIds:[userId] });

		expect( res.status          ).toBe( 404              );
		expect( res.body.error.code ).toBe( 'TASK_NOT_FOUND' );
	});

	it( 'devuelve 404 si algún usuario no existe, sin asignar a ninguno', async()=>{
		const taskId = await createTaskId( h );
		const userId = await createUserId( h );

		const res = await request( h.app ).post( `/tasks/${taskId}/assign` ).send({ userIds:[userId, 9999] });

		expect( res.status          ).toBe( 404              );
		expect( res.body.error.code ).toBe( 'USER_NOT_FOUND' );

		const detail = await request( h.app ).get( `/tasks/${taskId}` );

		expect( detail.body.assignees ).toEqual( [] );
	});

	it.each([
		['userIds ausente'                 , {               }],
		['userIds vacío'                   , { userIds:[]    }],
		['userIds no es arreglo'           , { userIds:1     }],
		['userIds con valores no numéricos', { userIds:['a'] }],
	])( 'devuelve 400 cuando %s', async( _label, body )=>{
		const taskId = await createTaskId( h );
		const res    = await request( h.app ).post( `/tasks/${taskId}/assign` ).send( body );

		expect( res.status          ).toBe( 400                );
		expect( res.body.error.code ).toBe( 'VALIDATION_ERROR' );
	});
});

describe( 'POST /tasks/:idTask/complete', ()=>{
	it( 'marca la parte del usuario como completada', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 2 );

		const res = await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });

		expect( res.status            ).toBe   ( 200                  );
		expect( res.body.message      ).toEqual( expect.any( String ) );
		expect( res.body.taskStatus   ).toBe   ( 'open'               );
		expect( res.body.archived     ).toBe   ( false                );
		expect( res.body.pendingUsers ).toEqual( [userIds[1]]         );
	});

	it( 'archiva la tarea cuando el último usuario asignado termina', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 2 );

		await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });

		const res = await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[1] });

		expect( res.status          ).toBe( 200        );
		expect( res.body.taskStatus ).toBe( 'archived' );
		expect( res.body.archived   ).toBe( true       );

		const detail = await request( h.app ).get( `/tasks/${taskId}` );

		expect( detail.body.status     ).toBe   ( 'archived'           );
		expect( detail.body.archivedAt ).toEqual( expect.any( String ) );
	});

	it( 'devuelve 404 si la tarea no existe', async()=>{
		const userId = await createUserId( h );
		const res    = await request( h.app ).post( '/tasks/9999/complete' ).send({ userId });

		expect( res.status          ).toBe( 404              );
		expect( res.body.error.code ).toBe( 'TASK_NOT_FOUND' );
	});

	it( 'devuelve 404 si el usuario no existe', async()=>{
		const taskId = await createTaskId( h );
		const res    = await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:9999 });

		expect( res.status          ).toBe( 404              );
		expect( res.body.error.code ).toBe( 'USER_NOT_FOUND' );
	});

	it( 'devuelve error si el usuario no está asignado a la tarea', async()=>{
		const taskId   = await createTaskId( h );
		const outsider = await createUserId( h );

		const res = await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:outsider });

		expect( res.status          ).toBe( 400                 );
		expect( res.body.error.code ).toBe( 'USER_NOT_ASSIGNED' );
	});

	it( 'repetir la llamada sin Idempotency-Key no rompe ni cambia el resultado', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 1 );

		const first  = await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });
		const second = await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });

		expect( first.status  ).toBe( 200 );
		expect( second.status ).toBe( 200 );

		expect( second.body.completedAt ).toBe( first.body.completedAt );
		expect( second.body.archived    ).toBe( true                   );
	});

	it( 'devuelve 400 si falta userId', async()=>{
		const { taskId } = await taskWithUsers( h, 1 );
		const res        = await request( h.app ).post( `/tasks/${taskId}/complete` ).send({});

		expect( res.status          ).toBe( 400                );
		expect( res.body.error.code ).toBe( 'VALIDATION_ERROR' );
	});
});

describe( 'GET /tasks', ()=>{
	it( 'lista todas las tareas indicando qué usuarios completaron su parte', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 2 );

		await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[0] });

		const res  = await request( h.app ).get( '/tasks' );
		const task = res.body.tasks.find( ( t:{ id:number } )=>t.id===taskId );

		expect( res.status          ).toBe( 200 );
		expect( task.completedCount ).toBe( 1   );
		expect( task.totalAssignees ).toBe( 2   );

		const done = task.assignees.filter( ( a:{ completed:boolean } )=>a.completed );

		expect( done           ).toHaveLength( 1          );
		expect( done[0].userId ).toBe        ( userIds[0] );
	});

	it( 'filtra por ?status=open', async()=>{
		const abierta                        = await createTaskId( h, 'Abierta' );
		const { taskId: archivada, userIds } = await taskWithUsers( h, 1 );

		await request( h.app ).post( `/tasks/${archivada}/complete` ).send({ userId:userIds[0] });

		const res = await request( h.app ).get( '/tasks?status=open' );
		const ids = res.body.tasks.map( ( t:{ id:number } )=>t.id );

		expect( res.status                                                         ).toBe         ( 200       );
		expect( ids                                                                ).toContain    ( abierta   );
		expect( ids                                                                ).not.toContain( archivada );
		expect( res.body.tasks.every( ( t:{ status:string } )=>t.status==='open' ) ).toBe         ( true      );
	});

	it( 'filtra por ?status=archived', async()=>{
		const abierta                        = await createTaskId( h, 'Abierta' );
		const { taskId: archivada, userIds } = await taskWithUsers( h, 1 );

		await request( h.app ).post( `/tasks/${archivada}/complete` ).send({ userId:userIds[0] });

		const res = await request( h.app ).get( '/tasks?status=archived' );
		const ids = res.body.tasks.map( ( t:{ id:number } )=>t.id );

		expect( ids ).toContain    ( archivada );
		expect( ids ).not.toContain( abierta   );
	});

	it( 'rechaza un status desconocido', async()=>{
		const res = await request( h.app ).get( '/tasks?status=deleted' );

		expect( res.status          ).toBe( 400                );
		expect( res.body.error.code ).toBe( 'VALIDATION_ERROR' );
	});
});

describe( 'GET /tasks/:idTask', ()=>{
	it( 'devuelve título, descripción, estado y asignados con su progreso', async()=>{
		const { taskId, userIds } = await taskWithUsers( h, 2 );

		await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId:userIds[1] });

		const res = await request( h.app ).get( `/tasks/${taskId}` );

		expect( res.status         ).toBe         ( 200                                                 );
		expect( res.body           ).toMatchObject({ id:taskId, title:'Tarea de prueba', status:'open' });
		expect( res.body.assignees ).toHaveLength ( 2                                                   );

		const byUser = Object.fromEntries( res.body.assignees.map( ( a:{ userId:number } )=>[a.userId, a] ) );

		expect( byUser[userIds[1]!].completed ).toBe( true  );
		expect( byUser[userIds[0]!].completed ).toBe( false );
	});

	it( 'devuelve 404 si la tarea no existe', async()=>{
		const res = await request( h.app ).get( '/tasks/9999' );

		expect( res.status          ).toBe( 404              );
		expect( res.body.error.code ).toBe( 'TASK_NOT_FOUND' );
	});

	it( 'devuelve 400 si el id no es un entero positivo', async()=>{
		const res = await request( h.app ).get( '/tasks/abc' );

		expect( res.status          ).toBe( 400                );
		expect( res.body.error.code ).toBe( 'VALIDATION_ERROR' );
	});
});

describe( 'formato de errores', ()=>{
	it( 'toda respuesta de error tiene la forma { error: { code, message } }', async()=>{
		const res = await request( h.app ).get( '/tasks/9999' );

		expect( Object.keys( res.body ) ).toEqual       ( ['error'] );
		expect( res.body.error          ).toHaveProperty( 'code'    );
		expect( res.body.error          ).toHaveProperty( 'message' );
	});

	it( 'las rutas inexistentes también devuelven el formato de error', async()=>{
		const res = await request( h.app ).get( '/no-existe' );

		expect( res.status          ).toBe( 404         );
		expect( res.body.error.code ).toBe( 'NOT_FOUND' );
	});

	it( 'un JSON malformado devuelve 400 con el formato de error', async()=>{
		const res = await request( h.app )
		.post( '/tasks'                           )
		.set ( 'content-type', 'application/json' )
		.send( '{"title": '                       );

		expect( res.status          ).toBe( 400            );
		expect( res.body.error.code ).toBe( 'INVALID_JSON' );
	});
});
