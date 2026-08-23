

/*/ ***** Importaciones ***** /*/
import type Database     from 'better-sqlite3';
import fs                from 'node:fs';
import path              from 'node:path';
import { fileURLToPath } from 'node:url';
// ####################################################################################################


/*/ ***** Declaraciones ***** /*/
const here = path.dirname( fileURLToPath( import.meta.url ) );
// ####################################################################################################


/*/ ***** Funciones ***** /*/
function migrationsDir():string {
	const candidates = [
		path.resolve( here,          '../../db/migrations'    ),
		path.resolve( here,          '../../../db/migrations' ),
		path.resolve( process.cwd(), 'db/migrations'          ),
	];

	const found = candidates.find( dir=>fs.existsSync( dir ) );

	if ( !found ) throw new Error( `No se encontró el directorio de migraciones. Buscado en: ${candidates.join( ', ' )}` );

	return found;
}
// ####################################################################################################


/*/ ***** Exportaciones ***** /*/
export function runMigrations( db:Database.Database ):string[] {
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		);
	`);

	const dir     = migrationsDir();
	const applied = new Set(
		db.prepare<[], { version:string }>( 'SELECT version FROM schema_migrations' ).all().map( r=>r.version ),
	);

	const pending = fs
	.readdirSync( dir                           )
	.filter     ( file=>file.endsWith( '.sql' ) )
	.sort       (                               )
	.filter     ( file=>!applied.has( file )    );

	const record = db.prepare( 'INSERT INTO schema_migrations (version) VALUES (?)' );

	for ( const file of pending ) {
		const sql = fs.readFileSync( path.join( dir, file ), 'utf8' );

		db.transaction(()=>{
			db    .exec( sql  );
			record.run ( file );
		})();
	}

	return pending;
}
// ####################################################################################################
