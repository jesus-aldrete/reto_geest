

/*/ ***** Importaciones ***** /*/
import type { AppContext } from '../../context.js';
import { Router                                                 } from 'express';
import { z                                                      } from 'zod';
import { createUser, listTasksOfUser, listUsersWithPendingTasks } from '../../domain/users.service.js';
import { ErrorCode                                              } from '../errors.js';
import { parseIdParam, parseOrThrow                             } from '../validate.js';
// ####################################################################################################


/*/ ***** Schemas ***** /*/
const createUserSchema = z.object({
	name    : z.string({ error:'name es obligatorio.'     }).trim().min( 1, 'name es obligatorio.'     ).max( 120 ),
	lastName: z.string({ error:'lastName es obligatorio.' }).trim().min( 1, 'lastName es obligatorio.' ).max( 120 ),
	email   : z
	.string ({ error:'email es obligatorio.' }      )
	.trim   (                                       )
	.min    ( 1, 'email es obligatorio.'            )
	.max    ( 254                                   )
	.email  ( 'El correo electrónico no es válido.' ),
});
// ####################################################################################################


/*/ ***** Extension ***** /*/
export const userErrorCodes = ErrorCode;

export function usersRouter( ctx:AppContext ):Router {
	const router = Router();

	router.post( '/', ( req, res )=>{
		const input = parseOrThrow( createUserSchema, req.body );
		const user  = createUser  ( ctx.db, input              );

		res.status( 201 ).json( user );
	});
	router.get( '/', ( _req, res )=>{
		res.json({ users:listUsersWithPendingTasks( ctx.db ) });
	});
	router.get( '/:idUser/tasks', ( req, res )=>{
		const userId = parseIdParam( req.params.idUser, 'idUser' );

		res.json({ userId, tasks:listTasksOfUser( ctx.db, userId ) });
	});

	return router;
}
// ####################################################################################################
