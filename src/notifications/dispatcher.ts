

/*/ ***** Importaciones ***** /*/
import type { Config                            } from '../config.js';
import type { Db                                } from '../db/index.js';
import type { NotificationAttemptRow, OutboxRow } from '../types.js';
import { recordEvent }                            from '../domain/events.service.js';
// ####################################################################################################


/*/ ***** Exportaciones ***** /*/
export interface DeliveryOutcome {
	ok        : boolean;
	httpStatus: number | null;
	error     : string | null;
	durationMs: number;
	retryable : boolean;
}
export type Transport = ( url:string, payload:unknown, timeoutMs:number )=>Promise<DeliveryOutcome>;

export const httpTransport:Transport = async( url, payload, timeoutMs )=>{
	const startedAt = Date.now();

	try {
		const response = await fetch(
			url,
			{
				method : 'POST',
				headers: { 'content-type':'application/json' },
				body   : JSON.stringify( payload ),
				signal : AbortSignal.timeout( timeoutMs ),
			}
		);

		const durationMs = Date.now() - startedAt;

		if ( response.ok ) return { ok:true, httpStatus:response.status, error:null, durationMs, retryable:false };

		return {
			durationMs,
			ok        : false,
			httpStatus: response.status,
			error     : `El destino respondió con HTTP ${response.status}.`,
			retryable : response.status>=500,
		};
	}
	catch ( err ) {
		return {
			ok        : false,
			httpStatus: null,
			error     : err instanceof Error ? `${err.name}: ${err.message}` : String( err ),
			durationMs: Date.now() - startedAt,
			retryable : true,
		};
	}
};

export function listNotificationAttempts( db:Db, taskId:number ) {
	const outbox = db
	.prepare<[number], OutboxRow>( 'SELECT * FROM notification_outbox WHERE task_id = ?' )
	.get                         ( taskId );

	const attempts = db
	.prepare<[number], NotificationAttemptRow>( 'SELECT * FROM notification_attempts WHERE task_id = ? ORDER BY attempt_number' )
	.all                                      ( taskId );

	return {
		taskId,
		status  : outbox ? outbox.status : 'not_scheduled' as const,
		attempts: attempts.map(
			a=>({
				attempt   : a.attempt_number,
				status    : a.status,
				httpStatus: a.http_status,
				error     : a.error,
				url       : a.url,
				durationMs: a.duration_ms,
				timestamp : a.created_at,
			})
		),
		totalAttempts: attempts.length,
		payload      : outbox ? JSON.parse( outbox.payload ) as unknown : null,
		nextAttemptAt: outbox && outbox.status==='pending' ? outbox.next_attempt_at : null,
	};
}

export class NotificationDispatcher {
	private timer:NodeJS.Timeout|null = null;
	private running                   = false;
	private pendingRun                = false;

	/*  */
	constructor(
		private readonly db       : Db,
		private readonly config   : Config,
		private readonly transport: Transport = httpTransport,
	) {}

	/* Funciones */
	private claimNext():OutboxRow|null {
		const now       = new Date().toISOString();
		const candidate = this.db
		.prepare<[string], OutboxRow>(`
			SELECT * FROM notification_outbox
			 WHERE status = 'pending' AND next_attempt_at <= ?
			 ORDER BY next_attempt_at, id
			 LIMIT 1
		`)
		.get( now );

		if ( !candidate ) return null;

		const claimed = this.db
		.prepare(`
			UPDATE notification_outbox
			   SET status = 'delivering', claimed_at = ?, updated_at = ?
			 WHERE id = ? AND status = 'pending'
		`)
		.run( now, now, candidate.id ).changes;

		if ( claimed!==1 ) return null;

		return { ...candidate, status:'delivering', claimed_at:now };
	}

	private async deliver( row:OutboxRow ):Promise<void> {
		const attemptNumber = row.attempts + 1;
		const payload       = JSON.parse( row.payload ) as unknown;
		const url           = this.config.notifyUrl;

		const outcome: DeliveryOutcome = url
		? await this.transport( url, payload, this.config.notifyTimeoutMs )
		: {
			ok        : false,
			httpStatus: null,
			error     : 'NOTIFY_URL no está configurada; no hay destino al que notificar.',
			durationMs: 0,
			retryable : false,
		};

		const now = new Date().toISOString();

		this.db.transaction(()=>{
			this.db
			.prepare(`
				INSERT OR IGNORE INTO notification_attempts
				  (task_id, attempt_number, status, http_status, error, url, duration_ms, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`)
			.run(
				row.task_id       ,
				attemptNumber     ,
				outcome.ok        ? 'success' : 'failed',
				outcome.httpStatus,
				outcome.error     ,
				url               ,
				outcome.durationMs,
				now               ,
			);

			if ( outcome.ok ) {
				this.db
				.prepare(`
					UPDATE notification_outbox
					   SET status = 'delivered', attempts = ?, claimed_at = NULL, updated_at = ?
					 WHERE id = ?
				`)
				.run( attemptNumber, now, row.id );

				recordEvent( this.db, {
					taskId : row.task_id,
					type   : 'notification.delivered',
					payload: { attempt:attemptNumber, httpStatus:outcome.httpStatus },
				});

				return;
			}

			const exhausted = attemptNumber>=this.config.notifyMaxAttempts || !outcome.retryable;

			if ( exhausted ) {
				this.db
				.prepare(`
					UPDATE notification_outbox
					   SET status = 'failed', attempts = ?, claimed_at = NULL, updated_at = ?
					 WHERE id = ?
				`)
				.run( attemptNumber, now, row.id );

				recordEvent( this.db, {
					taskId : row.task_id,
					type   : 'notification.failed',
					payload: { attempts:attemptNumber, lastError:outcome.error, retryable:outcome.retryable },
				});

				return;
			}

			const delayMs       = this.config.notifyRetryBaseMs * 2 ** ( attemptNumber - 1 );
			const nextAttemptAt = new Date( Date.now() + delayMs ).toISOString();

			this.db
			.prepare(`
				UPDATE notification_outbox
				   SET status = 'pending', attempts = ?, next_attempt_at = ?, claimed_at = NULL, updated_at = ?
				 WHERE id = ?
			`)
			.run( attemptNumber, nextAttemptAt, now, row.id );
		})();
	}

	/* Metodos */
	start():void {
		if ( this.timer ) return;

		this.timer = setInterval( ()=>void this.runOnce(), this.config.notifyPollIntervalMs );

		this.timer.unref?.();
	}
	stop():void {
		this.timer && clearInterval( this.timer );

		this.timer = null;
	}
	kick():void {
		setImmediate( ()=>void this.runOnce() );
	}

	async runOnce():Promise<number> {
		if ( this.running ) {
			this.pendingRun = true;

			return 0;
		}

		this.running = true;

		let delivered = 0;

		try {
			for ( ;; ) {
				const row = this.claimNext();

				if ( !row ) break;

				await this.deliver( row );

				delivered+= 1;
			}
		}
		catch ( err ) {
			console.error( '[notifications] error en el ciclo de entrega:', err );
		}
		finally {
			this.running = false;
		}

		if ( this.pendingRun ) {
			this.pendingRun = false;
			delivered      += await this.runOnce();
		}

		return delivered;
	}
}
// ####################################################################################################
