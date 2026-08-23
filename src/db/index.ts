

/*/ ***** Importaciones ***** /*/
import Database          from 'better-sqlite3';
import fs                from 'node:fs';
import path              from 'node:path';
import { runMigrations } from './migrate.js';
// ####################################################################################################


/*/ ***** Exportaciones ***** /*/
export type Db = Database.Database;

export function openDatabase( databasePath:string ):Db {
	if ( databasePath!==':memory:' ) fs.mkdirSync( path.dirname( path.resolve( databasePath ) ), { recursive:true } );

	const db = new Database( databasePath );

	db.pragma( 'journal_mode = WAL'   );
	db.pragma( 'synchronous = NORMAL' );
	db.pragma( 'foreign_keys = ON'    );
	db.pragma( 'busy_timeout = 5000'  );

	runMigrations( db );

	return db;
}
// ####################################################################################################
