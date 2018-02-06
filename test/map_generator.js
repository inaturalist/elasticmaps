var expect = require( "chai" ).expect,
    _ = require( "lodash" ),
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

  describe( "createMapTemplate", function( ) {
    it( "returns errors", function( ) {
      MapGenerator.createMapTemplate({ style: "nothing"}, function( err ) {
        expect( err.message ).to.eq(
          "Cannot read property 'format' of undefined" );
      });
    });
  });

  describe( "memoryDatasource", function( ) {
    it( "prepares data for responses with _source", function( ) {
      var req = { params: { }, query: { source: true } };
      var fields = [ "id", "latitude", "longitude", "_source" ];
      var features = [
        { id: 1, latitude: 11, longitude: 12, _source: "One" },
        { id: 2, latitude: 21, longitude: 22, _source: "Two" }
      ];
      var d = MapGenerator.memoryDatasource( req, fields, features );
      expect( _.keys( d.fields( ) )).to.deep.eq(
        [ "id", "latitude", "longitude", "_source" ]);
      expect( d.extent( ) ).to.deep.eq([ 12, 11, 22, 21 ]);
    });

    it( "prepares data for responses with geojson", function( ) {
      var req = { params: { dataType: "geojson" }, query: { } };
      var fields = [ "id", "geojson" ];
      var features = [
        { id: 1, geojson: { type: "Point", coordinates: [ 11, 12 ] } },
        { id: 2, geojson: { type: "Point", coordinates: [ 21, 22 ] } }
      ];
      var d = MapGenerator.memoryDatasource( req, fields, features );
      expect( _.keys( d.fields( ) )).to.deep.eq([ "id" ]);
      expect( d.extent( ) ).to.deep.eq([ 11, 12, 21, 22 ]);
    });

  });

});
