

/*/ ***** Importacines ***** /*/
import type { AppContext } from '../../context.js';
import { Router                                                                           } from 'express';
import { z                                                                                } from 'zod';
import { listTaskEvents                                                                   } from '../../domain/events.service.js';
import { assignUsers, completeUserPart, createTask, getTaskDetail, listTasks, requireTask } from '../../domain/tasks.service.js';
import { listNotificationAttempts                                                         } from '../../notifications/dispatcher.js';
import { AppError, ErrorCode                                                              } from '../errors.js';
import { parseIdParam, parseOrThrow                                                       } from '../validate.js';
// ####################################################################################################


/*/ ***** Declaraciones ***** /*/
const createTaskSchema = z.object({
	title      : z.string({ error:'title es obligatorio.' }).trim().min( 1, 'title es obligatorio.' ).max( 200 ),
	description: z.string().trim().max( 5000 ).nullish(),
});
const assignSchema = z.object({
	userIds: z
	.array( z.number().int().positive( 'userIds debe contener enteros positivos.' ), { error:'userIds es obligatorio y debe ser un arreglo.' } )
	.min  ( 1, 'userIds debe contener al menos un usuario.' ),
});
const completeSchema = z.object({
	userId: z
	.number  ({ error:'userId es obligatorio y debe ser numérico.' })
	.int     ( 'userId debe ser un entero.' )
	.positive( 'userId debe ser un entero positivo.' ),
});
const listQuerySchema = z.object({
	status: z.enum( ['open', 'archived'], { error:"status sólo admite 'open' o 'archived'." } ).optional(),
});
// ####################################################################################################


/* Exportaciones */
export const taskErrors = { AppError, ErrorCode };

export function tasksRouter( ctx:AppContext ):Router {
	const router = Router();

	router.post( '/', ( req, res )=>{
		const input = parseOrThrow( createTaskSchema, req.body );
		const task  = createTask  ( ctx.db, { title:input.title, description:input.description ?? null } );

		res.status( 201 ).json( task );
	});
	router.get( '/', ( req, res )=>{
		const { status } = parseOrThrow( listQuerySchema, req.query );

		res.json({ tasks:listTasks( ctx.db, status ) });
	});
	router.get( '/:idTask', ( req, res )=>{
		const taskId = parseIdParam( req.params.idTask, 'idTask' );

		res.json( getTaskDetail( ctx.db, taskId ) );
	});
	router.post( '/:idTask/assign', ( req, res )=>{
		const taskId      = parseIdParam( req.params.idTask, 'idTask' );
		const { userIds } = parseOrThrow( assignSchema, req.body );

		res.json( assignUsers( ctx.db, taskId, userIds ) );
	});
	router.post( '/:idTask/complete', ( req, res )=>{
		const taskId     = parseIdParam    ( req.params.idTask, 'idTask' );
		const { userId } = parseOrThrow    ( completeSchema, req.body    );
		const result     = completeUserPart( ctx.db, taskId, userId      );

		if ( result.archivedByThisRequest ) ctx.dispatcher.kick();

		const { archivedByThisRequest, ...body } = result;

		res.json( body );
	});
	router.get( '/:idTask/notifications', ( req, res )=>{
		const taskId = parseIdParam( req.params.idTask, 'idTask' );

		requireTask( ctx.db, taskId );

		res.json( listNotificationAttempts( ctx.db, taskId ) );
	});
	router.get( '/:idTask/events', ( req, res )=>{
		const taskId = parseIdParam( req.params.idTask, 'idTask' );

		requireTask( ctx.db, taskId );

		res.json({ taskId, events:listTaskEvents( ctx.db, taskId ) });
	});

	return router;
}
// ####################################################################################################
