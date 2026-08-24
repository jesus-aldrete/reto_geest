import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { httpTransport } from '../src/notifications/dispatcher.js';

let server:http.Server|null = null;

afterEach( async()=>{
	if ( server ) await new Promise( resolve=>server!.close( resolve ) );

	server = null;
});

async function listen( handler:http.RequestListener ):Promise<string> {
	server = http.createServer( handler );

	await new Promise<void>( resolve=>server!.listen( 0, '127.0.0.1', resolve ) );

	const { port } = server.address() as AddressInfo;

	return `http://127.0.0.1:${port}/hook`;
}

describe( 'httpTransport', ()=>{
	it( 'envía el payload como JSON por POST y acepta un 2xx', async()=>{
		let received:{ method:string; contentType?:string; body:string }|null = null;

		const url = await listen( ( req, res )=>{
			let body = '';

			req.on( 'data', chunk=>( body+= chunk ) );
			req.on( 'end' , ()=>{
				received = { method:req.method!, contentType:req.headers['content-type'], body };

				res.writeHead( 200 ).end( 'ok' );
			});
		});

		const outcome = await httpTransport( url, { taskId:7, title:'X' }, 2000 );

		expect( outcome.ok                   ).toBe     ( true                  );
		expect( outcome.httpStatus           ).toBe     ( 200                   );
		expect( received!.method             ).toBe     ( 'POST'                );
		expect( received!.contentType        ).toContain( 'application/json'    );
		expect( JSON.parse( received!.body ) ).toEqual  ({ taskId:7, title:'X' });
	});

	it( 'marca un 500 como fallo reintentable', async()=>{
		const url     = await listen       ( ( _req, res )=>res.writeHead( 500 ).end() );
		const outcome = await httpTransport( url, {}, 2000                             );

		expect( outcome.ok         ).toBe( false );
		expect( outcome.httpStatus ).toBe( 500   );
		expect( outcome.retryable  ).toBe( true  );
	});

	it( 'marca un 400 como fallo no reintentable', async()=>{
		const url     = await listen       ( ( _req, res )=>res.writeHead( 400 ).end() );
		const outcome = await httpTransport( url, {}, 2000                             );

		expect( outcome.ok        ).toBe( false );
		expect( outcome.retryable ).toBe( false );
	});

	it( 'trata el timeout como fallo reintentable sin status HTTP', async()=>{
		const url     = await listen       ( ()=>{}       );
		const outcome = await httpTransport( url, {}, 150 );

		expect( outcome.ok         ).toBe    ( false                );
		expect( outcome.httpStatus ).toBeNull(                      );
		expect( outcome.retryable  ).toBe    ( true                 );
		expect( outcome.error      ).toEqual ( expect.any( String ) );
	});

	it( 'trata una conexión rechazada como fallo reintentable', async()=>{
		const outcome = await httpTransport( 'http://127.0.0.1:1/hook', {}, 500 );

		expect( outcome.ok         ).toBe    ( false );
		expect( outcome.httpStatus ).toBeNull(       );
		expect( outcome.retryable  ).toBe    ( true  );
	});
});
