

/*/ ***** Importaciones ***** /*/
import { z                   } from 'zod';
import { AppError, ErrorCode } from './errors.js';
// ####################################################################################################


/*/ ***** Exportaciones ***** /*/
export function parseOrThrow<T>( schema:z.ZodType<T>, data:unknown, code=ErrorCode.VALIDATION_ERROR ):T {
	const result = schema.safeParse( data );

	if ( result.success ) return result.data;

	const details = result.error.issues.map(
		issue=>({
			field  : issue.path.join( '.' ) || '(body)',
			message: issue.message,
		})
	);

	const first   = details[0];
	const message = first ? `${first.field}: ${first.message}` : 'Datos inválidos.';

	throw AppError.badRequest( code, message, details );
}
export function parseIdParam( raw:string|undefined, name:string ):number {
	const value = Number( raw );

	if ( !Number.isInteger( value ) || value<=0 ) throw AppError.badRequest( ErrorCode.VALIDATION_ERROR, `${name} debe ser un entero positivo.` );

	return value;
}
// ####################################################################################################
