const _ = require( "lodash" );
const ElasticMapper = require( "./lib/elastic_mapper" );
const ElasticRequest = require( "./lib/elastic_request" );

module.exports = _.assignIn( ElasticMapper, {
  geohashPrecision: ElasticRequest.geohashPrecision,
  geohashAggregation: ElasticRequest.geohashAggregation,
  torqueAggregation: ElasticRequest.torqueAggregation
} );
