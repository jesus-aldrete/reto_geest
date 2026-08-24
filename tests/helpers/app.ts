import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import { openDatabase, type Db } from '../../src/db/index.js';
import { NotificationDispatcher, type DeliveryOutcome, type Transport } from '../../src/notifications/dispatcher.js';

export interface TestHarness {
	app               : ReturnType<typeof createApp>;
	db                : Db;
	config            : Config;
	dispatcher        : NotificationDispatcher;
	transportResponses: DeliveryOutcome[];
	transportCalls    : { url: string; payload: unknown }[];
	cleanup           : ()=>void;
	dbPath            : string;
}
export const ok = ( status=200 ):DeliveryOutcome=>({
	ok        : true,
	httpStatus: status,
	error     : null,
	durationMs: 1,
	retryable : false,
});
export const serverError = ( status=500 ):DeliveryOutcome=>({
	ok        : false,
	httpStatus: status,
	error     : `El destino respondió con HTTP ${status}.`,
	durationMs: 1,
	retryable :  true,
});
export const noResponse = ():DeliveryOutcome=>({
	ok        : false,
	httpStatus: null,
	error     : 'TimeoutError: el destino no respondió.',
	durationMs: 1,
	retryable : true,
});
export const clientError = ( status=400 ):DeliveryOutcome=>({
	ok        : false,
	httpStatus: status,
	error     : `El destino respondió con HTTP ${status}.`,
	durationMs: 1,
	retryable : false,
});

export function buildHarness( overrides:Partial<Config>={} ):TestHarness {
	const dir            = fs  .mkdtempSync( path.join( os.tmpdir(), 'geest-test-' ) );
	const dbPath         = path.join       ( dir, 'test.db'                          );
	const config: Config = {
		...loadConfig({}),
		databasePath        : dbPath,
		idempotencyWaitMs   : 2000,
		notifyMaxAttempts   : 3,
		notifyPollIntervalMs: 10,
		notifyRetryBaseMs   : 10,
		notifyTimeoutMs     : 100,
		notifyUrl           : 'https://notify.test/hook',
		...overrides,
	};

	const db                                                      = openDatabase( dbPath );
	const transportResponses: DeliveryOutcome[]                   = [ok()];
	const transportCalls    : { url: string; payload: unknown }[] = [];

	const transport: Transport = async( url, payload )=>{
		transportCalls.push({ url, payload });

		const index = Math.min( transportCalls.length - 1, transportResponses.length - 1 );

		return transportResponses[index]!;
	};

	const dispatcher = new NotificationDispatcher(  db, config, transport   );
	const app        = createApp                 ({ db, config, dispatcher });

	return {
		app               ,
		db                ,
		config            ,
		dispatcher        ,
		transportResponses,
		transportCalls    ,
		dbPath            ,
		cleanup: ()=>{
			dispatcher.stop  ();
			db        .close ();
			fs        .rmSync( dir, { recursive: true, force: true } );
		},
	};
}
export async function drainNotifications( h:TestHarness, taskId:number, timeoutMs=3000 ):Promise<void> {
	const deadline = Date.now() + timeoutMs;

	for ( ;; ) {
		await h.dispatcher.runOnce();

		const row = h.db
		.prepare<[number], { status:string }>( 'SELECT status FROM notification_outbox WHERE task_id = ?' )
		.get                                 ( taskId );

		if ( row && ( row.status==='delivered' || row.status==='failed' ) ) return;

		if ( Date.now()>=deadline ) throw new Error(`La notificación de la tarea ${taskId} no terminó: estado ${row?.status ?? 'inexistente'}`);

		await new Promise( r=>setTimeout( r, 15 ) );
	}
}
