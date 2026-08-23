

/*/ ***** Importaciones ***** /*/
import path from 'node:path';
// ####################################################################################################


/*/ ***** Funciones ***** /*/
function int( value:string|undefined, fallback:number ):number {
	const parsed = Number.parseInt( value ?? '', 10 );

	return Number.isFinite( parsed ) ? parsed : fallback;
}
// ####################################################################################################


/*/ ***** Exportaciones ***** /*/
export interface Config {
	port                : number;
	databasePath        : string;
	notifyUrl           : string | null;
	notifyMaxAttempts   : number;
	notifyRetryBaseMs   : number;
	notifyTimeoutMs     : number;
	notifyPollIntervalMs: number;
	idempotencyWaitMs   : number;
	nodeEnv             : string;
}
export function loadConfig( env:NodeJS.ProcessEnv=process.env ):Config {
	return {
		nodeEnv             : env.NODE_ENV      ?? 'development',
		notifyUrl           : env.NOTIFY_URL    && env.NOTIFY_URL.trim()!=='' ? env.NOTIFY_URL.trim() : null,
		databasePath        : env.DATABASE_PATH ?? path.resolve( process.cwd(), 'data/geest.db' ),
		port                : int( env.PORT                   , 3000 ),
		notifyMaxAttempts   : int( env.NOTIFY_MAX_ATTEMPTS    , 3    ),
		notifyRetryBaseMs   : int( env.NOTIFY_RETRY_BASE_MS   , 1000 ),
		notifyTimeoutMs     : int( env.NOTIFY_TIMEOUT_MS      , 5000 ),
		notifyPollIntervalMs: int( env.NOTIFY_POLL_INTERVAL_MS, 1000 ),
		idempotencyWaitMs   : int( env.IDEMPOTENCY_WAIT_MS    , 5000 ),
	};
}
// ####################################################################################################
