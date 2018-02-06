var _ = require( "lodash" ),
    ElasticMapper = require( "./lib/elastic_mapper" ),
    ElasticRequest = require( "./lib/elastic_request" );

module.exports = _.assignIn( ElasticMapper, {
  geohashPrecision: ElasticRequest.geohashPrecision,
  geohashAggregation: ElasticRequest.geohashAggregation,
  torqueAggregation: ElasticRequest.torqueAggregation
});
