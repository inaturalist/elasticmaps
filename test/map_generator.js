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

  describe( "geojsonDatasource", ( ) => {
    it( "prepares data for GeoJSON responses", ( ) => {
      const features = [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [12, 11]
          },
          properties: {
            name: "One"
          }
        },
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [22, 21]
          },
          properties: {
            name: "Two"
          }
        }
      ];
      const d = MapGenerator.geojsonDatasource( features );
      expect( d.extent( ) ).to.deep.eq( [12, 11, 22, 21] );
    } );
  } );
} );
