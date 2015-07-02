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

  describe( "basicEscape", function( ) {
    it( "removes single quotes", function( ) {
      expect( MapGenerator.basicEscape( "How's things") ).to.eq( "\"Hows things\"" );
    });

    it( "turn double quotes to single", function( ) {
      expect( MapGenerator.basicEscape( "a \"quoted\" value") ).to.eq( "\"a 'quoted' value\"" );
    });
  });

});
