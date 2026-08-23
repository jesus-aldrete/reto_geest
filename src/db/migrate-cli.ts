

/*/ ***** Importaciones ***** /*/
import { loadConfig    } from '../config.js';
import { openDatabase  } from './index.js';
import { runMigrations } from './migrate.js';
// ####################################################################################################


/*/ ***** Declaraciones ***** /*/
const config  = loadConfig   (                     );
const db      = openDatabase ( config.databasePath );
const pending = runMigrations( db                  );
// ####################################################################################################


/*/ ***** Inicio ***** /*/ {
	console.log( `Base de datos: ${config.databasePath}` );
	console.log( pending.length===0 ? 'Sin migraciones pendientes: el esquema está al día.' : `Aplicadas: ${pending.join( ', ' )}` );

	db.close();
}
// ####################################################################################################
