/**
 * Carga datos de ejemplo para probar la API a mano.
 * Uso: npm run seed
 */
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { assignUsers, createTask } from '../src/domain/tasks.service.js';
import { createUser } from '../src/domain/users.service.js';

const config = loadConfig  ();
const db     = openDatabase( config.databasePath );

const people = [
	{ name:'Ana'  , lastName:'Ruiz', email:'ana.ruiz@example.com'   },
	{ name:'Luis' , lastName:'Paz' , email:'luis.paz@example.com'   },
	{ name:'Marta', lastName:'Gil' , email:'marta.gil@example.com'  },
];

const users = people.map( person=>{
	const existing = db
	.prepare<[string], { id:number }>( 'SELECT id FROM users WHERE email = ?' )
	.get                             ( person.email );

	return existing ? { ...person, id:existing.id } : createUser( db, person );
});

const tareaGrupal = createTask( db, {
	title      : 'Preparar la demo del trimestre',
	description: 'Guion, diapositivas y ensayo general.',
});

assignUsers( db, tareaGrupal.id, users.map( u=>u.id ) );

const tareaIndividual = createTask( db, {
	title      : 'Revisar el contrato del proveedor',
	description: null,
});

assignUsers( db, tareaIndividual.id, [users[0]!.id] );

createTask( db, { title:'Tarea sin asignar', description:'Todavía no tiene responsables.' } );

console.log( `Base de datos: ${config.databasePath}` );
console.log(`Usuarios: ${users.map( u=>`${u.id} (${u.email})` ).join( ', ' )}`);
console.log( `Tareas: ${tareaGrupal.id} (3 asignados), ${tareaIndividual.id} (1 asignado), y una sin asignar.` );

db.close();
