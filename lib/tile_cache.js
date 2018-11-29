/* eslint no-console: 0 */

const _ = require( "lodash" );
const crypto = require( "crypto" );
const del = require( "del" );
const fs = require( "fs" );
const PromisePool = require( "es6-promise-pool" );
const fsPromises = require( "fs" ).promises;
const CachemanFile = require( "cacheman-file" );
const MapGenerator = require( "./map_generator" );
const ElasticRequest = require( "./elastic_request" );

let tilesRootCache;
const COUNT_QUERY_TIMEOUT = 15;
const CACHE_QUERY_TIMEOUT = 90;
const CACHE_DATA_TTL = 60 * 60 * 24; // 24 hours
const CACHE_COUNT_LOWER_THRESHOLD = 300000;
const CACHE_COUNT_HIGH_THRESHOLD = 2000000;

const TileCache = class TileCache {
  static requestingCaching( req ) {
    return !!req.tileCache;
  }

  static cachedDataForRequest( r, callback ) {
    const req = _.cloneDeep( r );
    // set up the cacheman instance for the root tiles cache directory
    // do this in the method call instead of in teh class file as
    // global.config may not be assigned when the class is loaded
    if ( !tilesRootCache && global.config && global.config.tilesCacheDir ) {
      tilesRootCache = new CachemanFile( { tmpDir: global.config.tilesCacheDir } );
    }
    const precision = ElasticRequest.geohashPrecision( req.params.zoom );
    const cacheParams = TileCache.cacheParamsForReq( req );
    // do not attempt to cache if the cache wasn't configured, no tileCache param,
    // too zoomed in (too many grids), there are no params (all results - too many),
    // or the request is asking for its own ttl since this uses a predefined ttl
    if ( !tilesRootCache
      || !TileCache.requestingCaching( req )
      || precision >= 7
      || _.isEmpty( cacheParams )
      || ( req.query.ttl && Number( req.query.ttl ) < CACHE_DATA_TTL ) ) {
      return void callback( );
    }

    // data will be cached to e.g. TilesCacheDir/0F/0000000000000000000000000000000F
    const requestCacheHash = TileCache.cacheKeyForReq( req );
    const partition = requestCacheHash.slice( -2 );
    const partitionDir = `${global.config.tilesCacheDir}/${partition}`;
    req.queryCacheDir = `${partitionDir}/${requestCacheHash}`;
    req.precisionCacheDir = `${req.queryCacheDir}/${req.params.zoom}`;

    // create the directories needed to cache this request, if they don't exist
    if ( !fs.existsSync( partitionDir ) ) {
      fs.mkdirSync( partitionDir );
    }
    if ( !fs.existsSync( req.queryCacheDir ) ) {
      fs.mkdirSync( req.queryCacheDir );
    }
    if ( !fs.existsSync( req.precisionCacheDir ) ) {
      fs.mkdirSync( req.precisionCacheDir );
    }
    // set up a cacheman instance on this request's cache directory
    const precisionCache = new CachemanFile( { tmpDir: req.precisionCacheDir } );

    TileCache.isAlreadyCached( precisionCache ).then( isCached => {
      // if the data for this request is already cached, and not expired
      if ( isCached ) {
        TileCache.readCachedData( req ).then( cachedData => {
          void callback( null, cachedData );
        } ).catch( ( ) => (
          void callback( null, null )
        ) );
        return;
      }
      // callback so the inital search request continues without waiting for the cache process
      callback( null, null );
      // initiate the tile caching process independent of any web requests
      TileCache.processUncachedQuery( req, precisionCache );
    } ).catch( ( ) => { } );
  }

  static processUncachedQuery( req, precisionCache ) {
    TileCache.checkCachingLocked( ).then( ( ) => (
      TileCache.determinedToBeTooLarge( precisionCache )
    ) ).then( ( ) => {
      // create a lock file so this and all other instances of the app using
      // this same cache directory will know not to initiate any other
      // geohash caching. There are heavy queries and a lot of data involved
      // so only attempt one cache at a time across all instances
      tilesRootCache.set( "processing.lock", true, CACHE_QUERY_TIMEOUT * 2, ( ) => { } );
      TileCache.countTotalResults( req ).then( count => {
        const precision = ElasticRequest.geohashPrecision( req.params.zoom );
        if ( ( count > CACHE_COUNT_LOWER_THRESHOLD && precision > 5 )
          || ( count > CACHE_COUNT_HIGH_THRESHOLD && precision > 4 ) ) {
          precisionCache.set( "oversized.done", true, CACHE_DATA_TTL, ( ) => { } );
          throw new Error( "too many results" );
        }
        // delete the cache dir, clearing any existing cache data
        del( [req.precisionCacheDir] ).then( ( ) => {
          // create a new cache dir
          fs.mkdirSync( req.precisionCacheDir );
          TileCache.cacheGeohashGrid( req, precisionCache, ( ) => {
            // make sure to remove the lock file when all cache data has been written
            tilesRootCache.del( "processing.lock", ( ) => { } );
          } );
        } ).catch( ( ) => {
          // error with deleting the existing cache directory
          tilesRootCache.del( "processing.lock", ( ) => { } );
        } );
      } ).catch( ( ) => {
        // too many results to cache
        tilesRootCache.del( "processing.lock", ( ) => { } );
      } );
    } ).catch( e => {
      // console.log( e.message );
    } );
  }

  static isAlreadyCached( precisionCache ) {
    return new Promise( ( resolve, reject ) => {
      precisionCache.get( "saved.done", ( err, value ) => {
        if ( err ) { return void reject( err ); }
        resolve( !!value );
      } );
    } );
  }

  static determinedToBeTooLarge( precisionCache ) {
    return new Promise( ( resolve, reject ) => {
      precisionCache.get( "oversized.done", ( err, value ) => {
        if ( err ) { return void reject( err ); }
        if ( value ) {
          return void reject( new Error( "known to be too large" ) );
        }
        resolve( );
      } );
    } );
  }

  static checkCachingLocked( ) {
    return new Promise( ( resolve, reject ) => {
      tilesRootCache.get( "processing.lock", ( err, value ) => {
        if ( err ) { return void reject( err ); }
        if ( value ) {
          return void reject( new Error( "locked" ) );
        }
        resolve( );
      } );
    } );
  }

  static readCachedData( req ) {
    return new Promise( resolve => {
      const cellFile = `${req.precisionCacheDir}/${req.params.x}.${req.params.y}.data`;
      fsPromises.readFile( cellFile ).then( contents => {
        resolve( contents
          .toString( )
          .trim( )
          .split( "\n" )
          .map( i => JSON.parse( i ) ) );
      } ).catch( ( ) => {
        // return an empty array to indicate the data was cached, but empty
        resolve( [] );
      } );
    } );
  }

  static countTotalResults( req ) {
    return new Promise( ( resolve, reject ) => {
      const queryCopy = _.cloneDeep( req.elastic_query );
      delete queryCopy.aggregations;
      const searchReq = { elastic_query: queryCopy };
      const queryOpts = { requestTimeout: COUNT_QUERY_TIMEOUT * 1000 };
      ElasticRequest.search( searchReq, queryOpts, ( err, rsp ) => {
        if ( err ) { return void reject( err ); }
        resolve( rsp.hits.total );
      } );
    } );
  }

  static cacheGeohashGrid( r, precisionCache, callback ) {
    const req = _.cloneDeep( r );
    if ( !req.queryCacheDir || !req.precisionCacheDir ) {
      return void callback( );
    }
    MapGenerator.createMercator( );
    const queryCopy = _.cloneDeep( req.elastic_query );
    queryCopy.aggregations = TileCache.allCellAggregation( req );
    const startTime = new Date( ).getTime( );
    const searchReq = { elastic_query: queryCopy };
    const queryOpts = { requestTimeout: CACHE_QUERY_TIMEOUT * 1000 };
    ElasticRequest.search( searchReq, queryOpts, ( err, rsp ) => {
      // console.log( ["cache query duration", `took ${new Date( ).getTime( ) - startTime}ms`] );
      if ( err ) {
        if ( err.displayName === "RequestTimeout" ) {
          precisionCache.set( "oversized.done", true, CACHE_DATA_TTL, ( ) => { } );
        }
        return void callback( );
      }
      // console.log( ["cache bucket count", rsp.aggregations.zoom1.buckets.length] );
      TileCache.saveCacheQueryResults( req, rsp, precisionCache ).then( ( ) => {
        callback( );
      } );
    } );
  }

  static saveCacheQueryResults( req, rsp, precisionCache ) {
    return new Promise( resolve => {
      const ElasticMapper = require( "./elastic_mapper" ); // eslint-disable-line global-require
      // map the ES response to a common data structure
      const data = ElasticMapper.csvFromResult( req, rsp );

      const tilestartTime = new Date( ).getTime( );
      // console.log( "saving tile caches" ); // eslint-disable-line no-console

      // figure out which map tile X,Y cells each result should be cached within
      // keep track of the array index of each result for each map tile key
      const cellIndicesByKey = { };
      _.each( data, ( datum, index ) => {
        const rowCells = TileCache.mapCellsForResult( req, datum );
        _.each( rowCells, cellKey => {
          cellIndicesByKey[cellKey] = cellIndicesByKey[cellKey] || [];
          cellIndicesByKey[cellKey].push( index );
        } );
      } );

      // set up the promise pool by creating a promise for each of the
      // map tile keys. Write up to 5 cell cache files at a time
      const cellIndicesKeys = _.keys( cellIndicesByKey );
      const promiseProducer = ( ) => {
        const cellKey = cellIndicesKeys.pop( );
        return cellKey ? TileCache.writeCellDataToCacheFile(
          req, cellKey, cellIndicesByKey[cellKey], data
        ) : null;
      };
      const pool = new PromisePool( promiseProducer, 5 );

      // start the promise pool to write the cell cache files
      pool.start( ).then( ( ) => {
        const tileendTime = new Date( ).getTime( );
        // eslint-disable-next-line no-console
        console.log( ["done saving tile caches", `took ${tileendTime - tilestartTime}ms`] );
        precisionCache.set( "saved.done", true, CACHE_DATA_TTL, ( ) => { } );
        resolve( );
      } );
    } );
  }

  static allCellAggregation( req ) {
    return {
      zoom1: {
        geohash_grid: {
          field: global.config.elasticsearch.geoPointField,
          precision: ElasticRequest.geohashPrecision( req.params.zoom ),
          size: 3000000
        },
        aggs: {
          geohash: {
            top_hits: {
              sort: { id: { order: "desc" } },
              _source: ( ( req.query && req.query.source )
                ? req.query.source : false ),
              size: 1
            }
          }
        }
      }
    };
  }

  static writeCellDataToCacheFile( req, cellKey, dataIndices, data ) {
    return new Promise( resolve => {
      // cellKey is in format "X.Y"
      const keyParts = cellKey.split( "," );
      fs.writeFileSync( `${req.precisionCacheDir}/${keyParts[0]}.${keyParts[1]}.data`,
        _.map( dataIndices, index => JSON.stringify( data[index] ) ).join( "\n" ) );
      resolve( );
    } );
  }


  static mapCellsForResult( req, result ) {
    // return new Promise( resolve => {
    const cells = [];
    const xyz = MapGenerator.merc.xyz( [
      result.longitude, result.latitude, result.longitude, result.latitude
    ], req.params.zoom );
    const cellbbox = MapGenerator.merc.convert( MapGenerator.bboxFromParams( {
      params: {
        zoom: req.params.zoom,
        x: xyz.minX,
        y: xyz.minY
      }
    } ) );
    cells.push( `${xyz.minX},${xyz.minY}` );
    // results near the border of a map cell need to be saved with
    // the bordering cell to allow for map markers that span tiles
    const diffLng = ( cellbbox[2] - cellbbox[0] ) * 0.1;
    const diffLat = ( cellbbox[3] - cellbbox[1] ) * 0.1;
    if ( result.latitude < cellbbox[1] + diffLat ) {
      cells.push( `${xyz.minX},${xyz.minY + 1}` );
    }
    if ( result.latitude > cellbbox[3] - diffLat ) {
      cells.push( `${xyz.minX},${xyz.minY - 1}` );
    }
    if ( result.longitude > cellbbox[2] - diffLng ) {
      cells.push( `${xyz.minX + 1},${xyz.minY}` );
    }
    if ( result.longitude < cellbbox[0] + diffLng ) {
      cells.push( `${xyz.minX - 1},${xyz.minY}` );
    }
    return cells;
  }

  static cacheKeyForReq( req ) {
    const sorted = TileCache.cacheParamsForReq( req );
    return crypto
      .createHash( "md5" )
      .update( JSON.stringify( sorted ), "utf8" )
      .digest( "hex" );
  }

  static cacheParamsForReq( req ) {
    const query = _.cloneDeep( req.query );
    delete query.source;
    delete query.color;
    delete query.width;
    delete query.callback;
    return _( query ).toPairs( ).sortBy( 0 ).fromPairs( )
      .value( );
  }
};

module.exports = TileCache;
