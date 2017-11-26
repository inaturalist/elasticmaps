var _ = require( "underscore" ),
    ElasticMapper = require( "./lib/elastic_mapper" ),
    ElasticRequest = require( "./lib/elastic_request" );

module.exports = _.extend( ElasticMapper, {
  geohashPrecision: ElasticRequest.geohashPrecision,
  geohashAggregation: ElasticRequest.geohashAggregation,
  torqueAggregation: ElasticRequest.torqueAggregation
});
