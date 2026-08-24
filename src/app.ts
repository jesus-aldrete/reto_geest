

/*/ ***** Importaciones ***** /*/
import express, { type Express }         from 'express';
import type { AppContext }               from './context.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { idempotency                   } from './http/idempotency.js';
import { tasksRouter                   } from './http/routes/tasks.js';
import { usersRouter                   } from './http/routes/users.js';
// ####################################################################################################


/*/ ***** Exportaciones ***** /*/
export function createApp( ctx:AppContext ):Express {
	const app = express();

	app.disable( 'x-powered-by'                );
	app.use    ( express.json({ limit:'1mb' }) );

	app.get( '/health', ( _req, res )=>{
		const { count } = ctx.db.prepare<[], { count:number }>( 'SELECT COUNT(*) AS count FROM tasks' ).get()!;

		res.json({ status:'ok', tasks:count, notifyUrlConfigured:ctx.config.notifyUrl!==null });
	});

	app.get( '/', ( _req, res )=>{
		res.json({
			name     : 'GEEST Task API',
			version  : '1.0.0',
			endpoints: [
				'POST /users',
				'GET /users',
				'GET /users/:idUser/tasks',

				'POST /tasks',
				'GET /tasks?status=open|archived',
				'GET /tasks/:idTask',
				'POST /tasks/:idTask/assign',
				'POST /tasks/:idTask/complete',
				'GET /tasks/:idTask/notifications',
				'GET /tasks/:idTask/events',
			],
		});
	});

	app.use( idempotency( ctx.db, ctx.config ) );

	app.use( '/users', usersRouter( ctx ) );
	app.use( '/tasks', tasksRouter( ctx ) );

	app.use( notFoundHandler );
	app.use( errorHandler    );

	return app;
}
// ####################################################################################################
