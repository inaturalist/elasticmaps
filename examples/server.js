var ElasticMapper = require( "../lib/elastic_mapper" ),
    server = ElasticMapper.server( { environment: "test", debug: true }),
    port = Number( process.env.PORT || 4000 );

server.listen( port, function( ) {
  console.log( "Listening on " + port );
});
