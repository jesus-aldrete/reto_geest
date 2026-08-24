

/*/ ***** Importaciones ***** /*/
import type { Server }            from 'node:http';
import { createApp              } from './app.js';
import { loadConfig             } from './config.js';
import { openDatabase           } from './db/index.js';
import { NotificationDispatcher } from './notifications/dispatcher.js';
// ####################################################################################################


/*/ ***** Declaraciones ***** /*/
const config     = loadConfig                (                          );
const db         = openDatabase              ( config.databasePath      );
const dispatcher = new NotificationDispatcher( db, config               );
const app        = createApp                 ({ db, config, dispatcher });

let server:Server;
// ####################################################################################################


/*/ ***** Funciones ***** /*/
function shutdown( signal:string ) {
	console.log( `[geest-api] ${signal} recibido, cerrando...` );

	dispatcher.stop();

	server.close(
		()=>{
			db     .close(   );
			process.exit ( 0 );
		}
	);

	setTimeout( ()=>process.exit( 0 ), 5000 ).unref();
}
// ####################################################################################################


/*/ ***** Inicio ***** /*/{
	dispatcher.start();
	dispatcher.kick ();

	server = app.listen(
		config.port,
		()=>{
			console.log( `[geest-api] escuchando en http://0.0.0.0:${config.port} (${config.nodeEnv})` );
			console.log( `[geest-api] base de datos: ${config.databasePath}`                           );
			console.log( `[geest-api] NOTIFY_URL: ${config.notifyUrl ?? '(sin configurar)'}`           );
		}
	);

	process.on( 'SIGTERM', ()=>shutdown( 'SIGTERM' ) );
	process.on( 'SIGINT' , ()=>shutdown( 'SIGINT'  ) );
}
// ####################################################################################################
