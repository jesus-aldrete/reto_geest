import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHarness, type TestHarness } from './helpers/app.js';
import { createTaskId, createUser, createUserId } from './helpers/fixtures.js';

let h:TestHarness;

beforeEach( ()=>{ h = buildHarness() } );
afterEach ( ()=>h.cleanup()            );

describe( 'POST /users', ()=>{
	it( 'registra un usuario y devuelve su ID junto con la información', async()=>{
		const res = await request( h.app )
		.post( '/users'                                               )
		.send({ name:'Ana', lastName:'Ruiz', email:'ana@example.com' });

		expect( res.status         ).toBe           ( 201                                                    );
		expect( res.body           ).toMatchObject  ({ name:'Ana', lastName:'Ruiz', email:'ana@example.com' });
		expect( typeof res.body.id ).toBe           ( 'number'                                               );
		expect( res.body.id        ).toBeGreaterThan( 0                                                      );
		expect( res.body.createdAt ).toEqual        ( expect.any( String )                                   );
	});

	it( 'asigna IDs únicos a cada usuario', async()=>{
		const first  = await createUserId( h );
		const second = await createUserId( h );

		expect( second ).not.toBe( first );
	});

	it( 'normaliza el correo a minúsculas y recorta espacios', async()=>{
		const res = await request( h.app )
		.post( '/users'                                                       )
		.send({ name:'  Ana ', lastName:' Ruiz ', email:'  ANA@Example.COM ' });

		expect( res.status     ).toBe( 201               );
		expect( res.body.email ).toBe( 'ana@example.com' );
		expect( res.body.name  ).toBe( 'Ana'             );
	});

	it.each([
		['falta name'    , { lastName:'Ruiz', email:'a@b.com'             }],
		['falta lastName', { name:'Ana', email:'a@b.com'                  }],
		['falta email'   , { name:'Ana', lastName:'Ruiz'                  }],
		['name vacío'    , { name:'   ', lastName:'Ruiz', email:'a@b.com' }],
		['cuerpo vacío'  , {                                              }],
	])( 'devuelve error 400 cuando %s', async( _label, body )=>{
		const res = await request( h.app ).post( '/users' ).send( body );

		expect( res.status                    ).toBe( 400                );
		expect( res.body.error.code           ).toBe( 'VALIDATION_ERROR' );
		expect( typeof res.body.error.message ).toBe( 'string'           );
	});

	it.each( ['sin-arroba', 'a@', '@b.com', 'a b@c.com', 'a@b'] )( 'rechaza el correo inválido %s', async( email )=>{
		const res = await request( h.app ).post( '/users' ).send({ name:'Ana', lastName:'Ruiz', email });

		expect( res.status          ).toBe( 400                );
		expect( res.body.error.code ).toBe( 'VALIDATION_ERROR' );
	});

	it( 'rechaza un correo ya registrado, sin distinguir mayúsculas', async()=>{
		await createUser( h, { email:'dup@example.com' } );

		const res = await createUser( h, { email:'DUP@example.com' } );

		expect( res.status          ).toBe( 409                    );
		expect( res.body.error.code ).toBe( 'EMAIL_ALREADY_EXISTS' );
	});
});

describe( 'GET /users', ()=>{
	it( 'lista los usuarios con su información básica y sus tareas pendientes', async()=>{
		const userId = await createUserId( h              );
		const taskId = await createTaskId( h, 'Pendiente' );

		await request( h.app ).post( `/tasks/${taskId}/assign` ).send({ userIds:[userId] });

		const res  = await request( h.app ).get( '/users' );
		const user = res.body.users.find( ( u:{ id:number } )=>u.id===userId );

		expect( res.status             ).toBe         ( 200                            );
		expect( user                   ).toBeDefined  (                                );
		expect( user.email             ).toEqual      ( expect.any( String )           );
		expect( user.pendingTasksCount ).toBe         ( 1                              );
		expect( user.pendingTasks[0]   ).toMatchObject({ id:taskId, title:'Pendiente' });
	});

	it( 'deja de contar la tarea como pendiente cuando el usuario completa su parte', async()=>{
		const userId = await createUserId( h );
		const taskId = await createTaskId( h );

		await request( h.app ).post( `/tasks/${taskId}/assign`   ).send({ userIds:[userId] });
		await request( h.app ).post( `/tasks/${taskId}/complete` ).send({ userId           });

		const res  = await request( h.app ).get( '/users' );
		const user = res.body.users.find( ( u:{ id:number } )=>u.id===userId );

		expect( user.pendingTasksCount ).toBe   ( 0  );
		expect( user.pendingTasks      ).toEqual( [] );
	});
});

describe( 'GET /users/:idUser/tasks', ()=>{
	it( 'lista las tareas del usuario indicando si completó su parte en cada una', async()=>{
		const userId    = await createUserId( h              );
		const hecha     = await createTaskId( h, 'Hecha'     );
		const pendiente = await createTaskId( h, 'Pendiente' );

		await request( h.app ).post( `/tasks/${hecha}/assign`     ).send({ userIds:[userId] });
		await request( h.app ).post( `/tasks/${pendiente}/assign` ).send({ userIds:[userId] });
		await request( h.app ).post( `/tasks/${hecha}/complete`   ).send({ userId           });

		const res = await request( h.app ).get( `/users/${userId}/tasks` );

		expect( res.status     ).toBe        ( 200 );
		expect( res.body.tasks ).toHaveLength( 2   );

		const byId = Object.fromEntries( res.body.tasks.map( ( t:{ id:number } )=>[t.id, t] ) );

		expect( byId[hecha    ].completed   ).toBe    ( true                 );
		expect( byId[hecha    ].completedAt ).toEqual ( expect.any( String ) );
		expect( byId[pendiente].completed   ).toBe    ( false                );
		expect( byId[pendiente].completedAt ).toBeNull(                      );
	});

	it( 'devuelve 404 si el usuario no existe', async()=>{
		const res = await request( h.app ).get( '/users/9999/tasks' );

		expect( res.status          ).toBe( 404              );
		expect( res.body.error.code ).toBe( 'USER_NOT_FOUND' );
	});

	it( 'devuelve un arreglo vacío si el usuario no tiene tareas', async()=>{
		const userId = await createUserId( h );
		const res    = await request( h.app ).get( `/users/${userId}/tasks` );

		expect( res.status     ).toBe   ( 200 );
		expect( res.body.tasks ).toEqual( []  );
	});
});
