const server = require( "../lib/elastic_mapper" );

server( { environment: "test", debug: true } );
const port = Number( process.env.PORT || 4000 );

server.listen( port, ( ) => {
  console.log( `Listening on ${port}` ); // eslint-disable-line no-console
} );
