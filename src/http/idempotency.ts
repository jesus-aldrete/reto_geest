

/*/ ***** Importaciones ***** /*/
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Config                                          } from '../config.js';
import type { Db                                              } from '../db/index.js';
import crypto                                                   from 'node:crypto';
import { AppError, ErrorCode }                                  from './errors.js';
// ####################################################################################################


/*/ ***** Tipos ***** /*/
interface IdempotencyRow {
	idempotency_key: string;
	method         : string;
	path           : string;
	request_hash   : string;
	state          : 'in_progress' | 'completed';
	response_status: number | null;
	response_body  : string | null;
}
// ####################################################################################################


/*/ ***** Funciones ***** /*/
const sleep = ( ms:number )=>new Promise( resolve=>setTimeout( resolve, ms ) );

function canonicalize( value:unknown ):string {
	if ( value===null || typeof value!=='object' ) return JSON.stringify( value ) ?? 'null';
	if ( Array.isArray( value )                  ) return `[${value.map( canonicalize ).join( ',' )}]`;

	const entries = Object.entries( value as Record<string,unknown> )
	.filter( ( [  , v] )=>v!==undefined )
	.sort  ( ( [a],[b] )=>( a<b ? -1 : a>b ? 1 : 0 ) )
	.map   ( ( [k , v] )=>`${JSON.stringify( k )}:${canonicalize( v )}` );

	return `{${entries.join( ',' )}}`;
}
function hashRequest( body:unknown ):string {
	return crypto.createHash( 'sha256' ).update( canonicalize( body ?? null ) ).digest( 'hex' );
}
// ####################################################################################################


/*/ ***** Exportaciones ***** /*/
export function idempotency( db:Db, config:Config ):RequestHandler {
	const insert = db.prepare(`
		INSERT INTO idempotency_keys (idempotency_key, method, path, request_hash, state)
		VALUES (?, ?, ?, ?, 'in_progress')
	`);
	const select = db.prepare<[string, string, string], IdempotencyRow>( 'SELECT * FROM idempotency_keys WHERE idempotency_key = ? AND method = ? AND path = ?' );
	const complete = db.prepare(`
		UPDATE idempotency_keys
		   SET state = 'completed', response_status = ?, response_body = ?,
		       completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		 WHERE idempotency_key = ? AND method = ? AND path = ?
	`);
	const remove   = db.prepare( 'DELETE FROM idempotency_keys WHERE idempotency_key = ? AND method = ? AND path = ?' );
	const safeMethods = new Set( ['GET', 'HEAD', 'OPTIONS'] );

	async function waitForResult( key:string, method:string, routePath:string, hash:string ):Promise<{ status:number; body:unknown }> {
		const deadline = Date.now() + config.idempotencyWaitMs;

		for ( ;; ) {
			const row = select.get( key, method, routePath );

			if ( !row                     ) throw AppError.conflict( ErrorCode.REQUEST_IN_PROGRESS   , 'El request original no pudo completarse. Vuelve a intentarlo con la misma clave.' );
			if (  row.request_hash!==hash ) throw AppError.conflict( ErrorCode.IDEMPOTENCY_KEY_REUSED, 'El header Idempotency-Key ya fue usado con un cuerpo distinto en este endpoint.'  );
			if (  row.state==='completed' ) return { status:row.response_status??200, body:row.response_body?JSON.parse(row.response_body) as unknown:null };
			if (  Date.now()>=deadline    ) throw AppError.conflict( ErrorCode.REQUEST_IN_PROGRESS   , 'Ya hay un request en curso con este Idempotency-Key. Reintenta en unos segundos.' );

			await sleep( 25 );
		}
	}

	return async function idempotencyMiddleware( req:Request, res:Response, next:NextFunction ) {
		if ( safeMethods.has( req.method ) ) return next();

		const key = req.header( 'Idempotency-Key' );

		if ( !key || key.trim()==='' ) return next();

		const method    = req.method;
		const routePath = ( req.baseUrl || '' ) + ( req.path || '' );
		const hash      = hashRequest( req.body );

		let owner = false;

		try {
			insert.run( key, method, routePath, hash );

			owner = true;
		}
		catch ( err ) {
			if ( !( err instanceof Error ) || !err.message.includes( 'UNIQUE constraint failed' ) ) throw err;
		}

		if ( !owner ) {
			const replayed = await waitForResult( key, method, routePath, hash );

			res.setHeader( 'Idempotency-Replayed', 'true' );
			res.status   ( replayed.status                );

			return res.json( replayed.body );
		}

		res.setHeader( 'Idempotency-Key', key );

		let recorded = false;

		const originalJson = res.json.bind( res );

		res.json = ( body:unknown )=>{
			if ( !recorded ) {
				recorded = true;

				const status = res.statusCode;

				if ( status>=500 ) remove  .run( key, method, routePath                                 );
				else               complete.run( status, JSON.stringify( body ), key, method, routePath );
			}

			return originalJson( body );
		};

		res.on( 'close', ()=>{
			if ( !recorded ) {
				recorded = true;

				remove.run( key, method, routePath );
			}
		});

		return next();
	};
}
// ####################################################################################################
