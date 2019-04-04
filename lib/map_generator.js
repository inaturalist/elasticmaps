/* eslint no-underscore-dangle: 0 */

const mapnik = require( "mapnik" );
const _ = require( "lodash" );
const fs = require( "fs" );
const path = require( "path" );
const flatten = require( "flat" );
const SphericalMercator = require( "@mapbox/sphericalmercator" );
const Styles = require( "./styles" );

// register shapefile plugin
if ( mapnik.register_default_input_plugins ) {
  mapnik.register_default_input_plugins( );
}

const proj4 = "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 "
            + "+y_0=0.0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +over";

const MapGenerator = { merc: null };

MapGenerator.blankImage = fs.readFileSync( path.join( __dirname, "assets/blank.png" ) );

MapGenerator.createMercator = ( ) => {
  if ( MapGenerator.merc === null ) {
    MapGenerator.merc = new SphericalMercator( { size: global.config.tileSize } );
  }
};

MapGenerator.bboxFromParams = req => {
  MapGenerator.createMercator( );
  let zoom = parseInt( req.params.zoom, 10 );
  if ( req.largeTiles ) { zoom -= 1; }
  return MapGenerator.merc.bbox(
    parseInt( req.params.x, 10 ),
    parseInt( req.params.y, 10 ),
    zoom, false, "900913"
  );
};

MapGenerator.createLayer = ( ) => {
  const layer = new mapnik.Layer( "tile", "+init=epsg:4326" );
  layer.styles = ["style"];
  return layer;
};

MapGenerator.postgisDatasource = req => {
  let zoom = parseInt( req.params.zoom, 10 );
  if ( req.largeTiles ) { zoom -= 1; }
  const datasourceConfig = Object.assign( { }, global.config.database, {
    type: "postgis",
    table: req.postgis.query,
    simplify_geometries: true,
    extent: MapGenerator.merc.bbox(
      parseInt( req.params.x, 10 ),
      parseInt( req.params.y, 10 ),
      zoom
    )
  } );
  return new mapnik.Datasource( datasourceConfig );
};

MapGenerator.geojsonDatasource = features => {
  if ( _.isEmpty( features ) ) { return null; }
  const datasourceConfig = {
    type: "geojson",
    inline: JSON.stringify( {
      type: "FeatureCollection",
      features
    } )
  };
  return new mapnik.Datasource( datasourceConfig );
};

/* eslint-disable no-param-reassign */
MapGenerator.finishMap = ( req, res, map, layer, features, callback ) => {
  if ( features && features.length === 0 && req.params.format !== "grid.json" ) {
    req.tileData = MapGenerator.blankImage;
    return void callback( null, req, res );
  }
  let fields;
  if ( req.params.dataType === "postgis" ) {
    layer.datasource = MapGenerator.postgisDatasource( req );
  } else {
    const memDS = MapGenerator.geojsonDatasource( features );
    if ( memDS ) { layer.datasource = memDS; }
  }
  map.add_layer( layer );
  let { tileSize } = global.config;
  if ( req.largeTiles ) { tileSize *= 2; }
  if ( req.params.format === "grid.json" ) {
    if ( req.skipTopHits ) {
      fields = ["cellCount", "latitude", "longitude"];
    } else if ( req.params.dataType === "geojson" ) {
      fields = req.params.fields || ["id", "geojson"];
    } else {
      fields = _.without( req.query.source.includes,
        global.config.elasticsearch.geoPointField );
      // geohash aggregations will have cellCount
      if ( req.elastic_query.aggregations && req.elastic_query.aggregations.zoom1 ) {
        fields.push( "cellCount" );
      }
      fields = fields.concat( ["latitude", "longitude"] );
    }

    const options = { };
    options.layer = "tile";
    options.fields = fields;
    options.headers = { "Content-Type": "application/json" };
    const im = new mapnik.Grid( tileSize / 2, tileSize / 2, { key: "id" } );
    map.render( im, options, ( err, img ) => {
      if ( err ) { return callback( err, req, res ); }
      req.tileData = img.encodeSync( );
      return callback( null, req, res );
    } );
  } else {
    const im = new mapnik.Image( tileSize, tileSize );
    map.render( im, { scale: 2 }, ( err, img ) => {
      if ( err ) { return callback( err, req, res ); }
      req.tileData = img.encodeSync( );
      return callback( null, req, res );
    } );
  }
};
/* eslint-enable no-param-reassign */

MapGenerator.basicEscape = text => {
  // remove ', \n, \r, \t
  // turn " into '
  const replaced = text.replace( /'/g, "" )
    .replace( /"/g, "'" )
    .replace( /(\\n|\\r|\\t)/g, " " )
    .replace( /(\\)/g, "/" );
  return `"${replaced}"`;
};

MapGenerator.mapXML = specificStyle => (
  `
    <Map srs='${proj4}' buffer-size='64' maximum-extent='-20037508.34,-20037508.34,20037508.34,20037508.34'>
      ${specificStyle}
    </Map>`
);

MapGenerator.createMapTemplate = ( req, callback ) => {
  try {
    req.style = req.style || Styles.points( );
    let { tileSize } = global.config;
    if ( req.largeTiles ) { tileSize *= 2; }
    if ( req.params.format === "grid.json" ) {
      tileSize /= 2;
    }
    const map = new mapnik.Map( tileSize, tileSize, proj4 );
    const bbox = MapGenerator.bboxFromParams( req );
    const layer = MapGenerator.createLayer( );
    map.extent = bbox;
    map.fromString( MapGenerator.mapXML( req.style ), { strict: true, base: "./" },
      ( err, mapFromString ) => {
        if ( err ) {
          return callback( err, req );
        }
        MapGenerator.createMercator( );
        return callback( null, req, mapFromString, layer, MapGenerator.merc.convert( bbox ) );
      } );
  } catch ( err ) {
    callback( err );
  }
};

MapGenerator.torqueJson = ( queryResult, req, res ) => {
  const [minlon, minlat, maxlon, maxlat] = req.bbox;
  const mercMin = MapGenerator.merc.px( [minlon, minlat], req.params.zoom );
  const mercMax = MapGenerator.merc.px( [maxlon, maxlat], req.params.zoom );
  const latdiff = Math.abs( mercMax[1] - mercMin[1] );
  const londiff = Math.abs( mercMax[0] - mercMin[0] );
  const returnArray = [];
  const filteredBuckets = _.filter( queryResult.aggregations.zoom1.buckets,
    b => !_.isEmpty( b.histogram.buckets ) );
  _.each( filteredBuckets, b => {
    const vals = [];
    const dates = [];
    let hashInfo;
    _.each( b.histogram.buckets, hb => {
      if ( !hashInfo ) {
        hashInfo = hb.geohash.hits.hits[0]._source.location.split( "," );
      }
      const doc = hb.geohash.hits.hits[0]._source;
      vals.push( Object.assign( { value: hb.doc_count }, flatten( doc ) ) );
      dates.push( hb.key - 1 );
    } );
    const mercCoords = MapGenerator.merc.px( [hashInfo[1], hashInfo[0]], req.params.zoom );
    const torqueX = Math.floor( ( Math.abs( mercCoords[0] - mercMin[0] ) / latdiff ) * 255 );
    const torqueY = Math.floor( ( Math.abs( mercCoords[1] - mercMin[1] ) / londiff ) * 255 );
    returnArray.push( {
      x__uint8: torqueX,
      y__uint8: torqueY,
      vals__uint8: vals,
      dates__uint16: dates
    } );
  } );
  res.set( "Content-Type", "text/html" ).status( 200 ).json( returnArray ).end( );
};

module.exports = MapGenerator;
