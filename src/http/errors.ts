

/*/ ***** Importaciones ***** /*/
import type { NextFunction, Request, Response } from 'express';
// ####################################################################################################


/*/ ***** Exportaciones ***** /*/
export const ErrorCode = {
	VALIDATION_ERROR      : 'VALIDATION_ERROR'      ,
	INVALID_EMAIL         : 'INVALID_EMAIL'         ,
	EMAIL_ALREADY_EXISTS  : 'EMAIL_ALREADY_EXISTS'  ,
	USER_NOT_FOUND        : 'USER_NOT_FOUND'        ,
	TASK_NOT_FOUND        : 'TASK_NOT_FOUND'        ,
	USER_NOT_ASSIGNED     : 'USER_NOT_ASSIGNED'     ,
	TASK_ALREADY_ARCHIVED : 'TASK_ALREADY_ARCHIVED' ,
	IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
	REQUEST_IN_PROGRESS   : 'REQUEST_IN_PROGRESS'   ,
	INVALID_JSON          : 'INVALID_JSON'          ,
	NOT_FOUND             : 'NOT_FOUND'             ,
	INTERNAL_ERROR        : 'INTERNAL_ERROR'        ,
} as const;

export type ErrorCodeValue = ( typeof ErrorCode )[keyof typeof ErrorCode];

export class AppError extends Error {
	readonly status : number;
	readonly code   : ErrorCodeValue;
	readonly details: unknown;

	/* Herramientas */
	static badRequest( code:ErrorCodeValue, message:string, details?:unknown ) { return new AppError( 400, code, message, details ) }
	static notFound  ( code:ErrorCodeValue, message:string                   ) { return new AppError( 404, code, message          ) }
	static conflict  ( code:ErrorCodeValue, message:string                   ) { return new AppError( 409, code, message          ) }

	/*  */
	constructor( status:number, code:ErrorCodeValue, message:string, details?:unknown ) {
		super( message );

		this.name    = 'AppError';
		this.status  = status;
		this.code    = code;
		this.details = details;
	}
}

export function errorBody( code:string, message:string, details?:unknown ) {
	const error:Record<string,unknown> = { code, message };

	details!==undefined && ( error.details = details );

	return { error };
}
export function errorHandler( err:unknown, _req:Request, res:Response, next:NextFunction ) {
	if ( res.headersSent                             ) return next( err );
	if ( err instanceof AppError                     ) return res.status( err.status ).json( errorBody( err.code, err.message, err.details                                 ) );
	if ( err instanceof SyntaxError && 'body' in err ) return res.status( 400        ).json( errorBody( ErrorCode.INVALID_JSON, 'El cuerpo del request no es JSON válido.' ) );

	console.error( '[error] excepción no controlada:', err );

	return res
	.status( 500 )
	.json  ( errorBody( ErrorCode.INTERNAL_ERROR, 'Ocurrió un error inesperado al procesar el request.' ) );
}
export function notFoundHandler( req:Request, res:Response ) {
	let jso = errorBody( ErrorCode.NOT_FOUND, `Ruta no encontrada: ${req.method} ${req.path}` );

	res.status( 404 ).json( jso );
}
// ####################################################################################################
