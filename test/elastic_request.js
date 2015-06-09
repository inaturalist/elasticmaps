var expect = require( "chai" ).expect,
    ElasticRequest = require( "../lib/elastic_request" );

describe( "ElasticRequest", function( ) {

  describe( "search", function( ) {
    it( "returns an error with a malformed query", function( done ) {
      ElasticRequest.search({ made: "up" }, function( err, rsp ) {
        expect( err.message ).to.eql(
          "IndexMissingException[[elasticmaps_development] missing]" );
        done( );
      });
    });
  });

  describe( "boundingBoxFilter", function( ) {
    it( "enlarges the boundary for better tile edges", function( ) {
      expect( ElasticRequest.boundingBoxFilter(
        [ 0, 0, 1, 1 ], true ) ).to.eql( { geo_bounding_box: { location: {
          bottom_left: [ -0.1, -0.1 ], top_right: [ 1.1, 1.1 ] }}});
    });

    it( "can skip smoothing", function( ) {
      expect( ElasticRequest.boundingBoxFilter(
        [ 0, 0, 1, 1 ], false ) ).to.eql( { geo_bounding_box: { location: {
          bottom_left: [ 0, 0 ], top_right: [ 1, 1 ] }}});
    });

    it( "creates a conditional query for dateline wrapping bboxes", function( ) {
      expect( ElasticRequest.boundingBoxFilter(
        [ 179, 1, -179, 2 ], false ) ).to.eql( { or: [
          { geo_bounding_box: { location: {
            bottom_left: [ 179, 1 ], top_right: [ 180, 2 ] }}},
          { geo_bounding_box: { location: {
            bottom_left: [ -180, 1 ], top_right: [ -179, 2 ] }}}
          ]});
    });
  });

  describe( "geohashPrecision", function( ) {
    it( "returns the proper percision for a zoom", function( ) {
      expect( ElasticRequest.geohashPrecision( 1 ) ).to.eql( 3 );
      expect( ElasticRequest.geohashPrecision( 2 ) ).to.eql( 4 );
      expect( ElasticRequest.geohashPrecision( 4 ) ).to.eql( 5 );
      expect( ElasticRequest.geohashPrecision( 6 ) ).to.eql( 6 );
      expect( ElasticRequest.geohashPrecision( 9 ) ).to.eql( 7 );
      expect( ElasticRequest.geohashPrecision( 10 ) ).to.eql( 8 );
      expect( ElasticRequest.geohashPrecision( 13 ) ).to.eql( 9 );
      expect( ElasticRequest.geohashPrecision( 15 ) ).to.eql( 10 );
      expect( ElasticRequest.geohashPrecision( 16 ) ).to.eql( 12 );
    });
  });

  describe( "geohashAggregation", function( ) {
    it( "returns the proper aggregation hash based on zoom", function( ) {
      expect( ElasticRequest.geohashAggregation({
        params: { zoom: 15 },
        elastic_query: { fields: ElasticRequest.defaultMapFields( ) } } ) ).
        to.eql({ zoom1: { geohash_grid: { field: "location",
          size: 50000, precision: 10 }, aggs: { geohash: { top_hits: {
          sort: { id: { order: "desc" } }, _source: false, fielddata_fields:
          ElasticRequest.defaultMapFields( ), size: 1 } } } } } );
    });
  });

});
