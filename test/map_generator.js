const { expect } = require( "chai" );
const _ = require( "lodash" );
const MapGenerator = require( "../lib/map_generator" );

describe( "MapGenerator", ( ) => {
  describe( "createMapTemplate", ( ) => {
    it( "fails on invalid styles", done => {
      MapGenerator.createMapTemplate(
        { params: { x: 0, y: 0, zoom: 1 }, style: "nonsense" }, err => {
          expect( err.message ).to.include( "Unable to process some data while parsing" );
          done( );
        }
      );
    } );
  } );

  describe( "basicEscape", ( ) => {
    it( "removes single quotes", ( ) => {
      expect( MapGenerator.basicEscape( "How's things" ) ).to.eq( "\"Hows things\"" );
    } );

    it( "turn double quotes to single", ( ) => {
      expect( MapGenerator.basicEscape( "a \"quoted\" value" ) ).to.eq( "\"a 'quoted' value\"" );
    } );
  } );

  describe( "createMapTemplate", ( ) => {
    it( "returns errors", ( ) => {
      MapGenerator.createMapTemplate( { style: "nothing" }, err => {
        expect( err.message ).to.eq(
          "Cannot read property 'format' of undefined"
        );
      } );
    } );
  } );

  describe( "memoryDatasource", ( ) => {
    it( "prepares data for responses with _source", ( ) => {
      const req = { params: { }, query: { source: true } };
      const fields = ["id", "latitude", "longitude", "_source"];
      const features = [
        {
          id: 1,
          latitude: 11,
          longitude: 12,
          _source: "One"
        },
        {
          id: 2,
          latitude: 21,
          longitude: 22,
          _source: "Two"
        }
      ];
      const d = MapGenerator.memoryDatasource( req, fields, features );
      expect( _.keys( d.fields( ) ) ).to.deep.eq(
        ["id", "latitude", "longitude", "_source"]
      );
      expect( d.extent( ) ).to.deep.eq( [12, 11, 22, 21] );
    } );

    it( "prepares data for responses with geojson", ( ) => {
      const req = { params: { dataType: "geojson" }, query: { } };
      const fields = ["id", "geojson"];
      const features = [
        {
          id: 1,
          geojson: {
            type: "Point",
            coordinates: [11, 12]
          }
        },
        {
          id: 2,
          geojson: {
            type: "Point",
            coordinates: [21, 22]
          }
        }
      ];
      const d = MapGenerator.memoryDatasource( req, fields, features );
      expect( _.keys( d.fields( ) ) ).to.deep.eq( ["id"] );
      expect( d.extent( ) ).to.deep.eq( [11, 12, 21, 22] );
    } );
  } );
} );
