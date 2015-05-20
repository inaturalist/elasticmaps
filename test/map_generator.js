var expect = require( "chai" ).expect,
    MapGenerator = require( "../lib/map_generator" );

describe( "MapGenerator", function( ) {

  describe( "createMapTemplate", function( ) {
    it( "fails on invalid styles", function( done ) {
      MapGenerator.createMapTemplate(
        { params: { x: 0, y: 0, zoom: 1 }, style: "nonsense" }, function( err ) {
        expect( err.message ).to.include( "Unable to process some data while parsing");
        done( );
      });
    });
  });

});
