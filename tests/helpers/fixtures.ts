import request from 'supertest';
import type { TestHarness } from './app.js';

let counter = 0;

export async function createUser( h:TestHarness, overrides:Record<string,unknown>={} ) {
	counter+= 1;

	const res = await request( h.app )
	.post( '/users' )
	.send( { name:`Usuario${counter}`, lastName:'Prueba', email:`user${counter}@example.com`, ...overrides } );

	return res;
}
export async function createUserId( h:TestHarness ):Promise<number> {
	const res = await createUser( h );

	if ( res.status!==201 ) throw new Error( `No se pudo crear el usuario: ${JSON.stringify( res.body )}` );

	return res.body.id as number;
}
export async function createTaskId( h:TestHarness, title='Tarea de prueba' ):Promise<number> {
	const res = await request( h.app ).post( '/tasks' ).send({ title, description:'Descripción' });

	if ( res.status!==201 ) throw new Error( `No se pudo crear la tarea: ${JSON.stringify(res.body)}` );

	return res.body.id as number;
}
export async function taskWithUsers( h:TestHarness, count:number ) {
	const taskId           = await createTaskId( h );
	const userIds:number[] = [];

	for ( let i=0; i<count; i+=1 ) userIds.push( await createUserId( h ) );

	await request( h.app ).post( `/tasks/${taskId}/assign` ).send({ userIds });

	return { taskId, userIds };
}
