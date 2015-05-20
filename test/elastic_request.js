var expect = require( "chai" ).expect,
    ElasticRequest = require( "../lib/elastic_request" );

describe( "ElasticRequest", function( ) {

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
          sort: { id: { order: "desc" } }, _source: {
          include: ElasticRequest.defaultMapFields( ) }, size: 1 } } } } } );
    });
  });

});
