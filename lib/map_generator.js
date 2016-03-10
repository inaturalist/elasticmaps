var mapnik = require( "mapnik" ),
    _ = require( "underscore" ),
    fs = require( "fs" ),
    path = require( "path" ),
    SphericalMercator = require( "sphericalmercator" ),
    Styles = require( "./styles" );

// register shapefile plugin
if( mapnik.register_default_input_plugins ) {
  mapnik.register_default_input_plugins( );
}

var proj4 = "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 " +
            "+y_0=0.0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +over";

var MapGenerator = { merc: null };

MapGenerator.blankImage = fs.readFileSync( path.join(__dirname, "assets/blank.png") );

MapGenerator.createMercator = function( ) {
  if( MapGenerator.merc === null) {
    MapGenerator.merc = new SphericalMercator({ size: global.config.tileSize });
  }
};

MapGenerator.bboxFromParams = function( req ) {
  MapGenerator.createMercator( );
  return MapGenerator.merc.bbox( parseInt( req.params.x ),
                                 parseInt( req.params.y ),
                                 parseInt( req.params.zoom ), false, "900913" );
};

MapGenerator.createLayer = function( ) {
  var layer = new mapnik.Layer( "tile", "+init=epsg:4326" );
  layer.styles = [ "style" ];
  return layer;
};

MapGenerator.postgisDatasource = function( req ) {
  var cfg = _.extend( { }, global.config.database, {
    type: "postgis",
    table: req.postgis.query,
    extent: MapGenerator.merc.bbox( parseInt( req.params.x ),
                                    parseInt( req.params.y ),
                                    parseInt( req.params.zoom ) )
  });
  return new mapnik.Datasource( cfg );
};

MapGenerator.memoryDatasource = function( req, fields, features ) {
  var mem_ds, im;
  if( features.length > 0) {
    var values = fields.join( "," ) + "\n" + _.map( features, function( f ) {
      if( req.params.dataType === "geojson" ) {
        var j = JSON.stringify( f.geojson ).replace(/"/g, "\\\"");
        return [ f.id + ',\"' + j + '\"' ].join( "," );
      } else {
        if( req.query.source ) {
          req.sourceModifier = req.sourceModifier || JSON.stringify;
          f._source = MapGenerator.basicEscape(
            req.sourceModifier( f._source ) );
        }
        return _.values( f ).join( "," )
      }
    }).join( "\n" );
    mem_ds = new mapnik.Datasource({
      type: "csv",
      inline: values
    });
  }
  return mem_ds;
};

MapGenerator.finishMap = function( req, res, map, layer, features, callback ) {
  if( features && features.length === 0 && req.params.format !== "grid.json" ) {
    req.tileData = MapGenerator.blankImage;
    return callback( null, req, res );
  }
  var fields;
  if( req.params.dataType === "postgis" ) {
    layer.datasource = MapGenerator.postgisDatasource( req );
  } else {
    if( req.params.dataType === "geojson" ) {
      fields = req.params.fields || [ "id", "geojson" ];
    } else {
      fields = _.without( req.elastic_query.fields,
        global.config.elasticsearch.geoPointField ).concat(
        [ "latitude", "longitude" ] );
      if( req.query.source ) {
        fields.push( "_source" );
      }
    }
    var mem_ds = MapGenerator.memoryDatasource( req, fields, features );
    if( mem_ds ) { layer.datasource = mem_ds; }
  }
  map.add_layer( layer );
  if( req.params.format === "grid.json" ) {
    var options = { };
    options.layer = "tile";
    options.fields = fields;
    options.headers = { "Content-Type": "application/json" };
    im = new mapnik.Grid( 256, 256, { key: "id" } );
    map.render( im, options, function( err, im ) {
      if( err ) { return callback( err, req, res ); }
      req.tileData = im.encodeSync( );
      callback( null, req, res );
    });
  } else {
    im = new mapnik.Image( global.config.tileSize, global.config.tileSize );
    map.render( im, { scale: global.config.tileSize / 256 }, function( err, im ) {
      if( err ) { return callback( err, req, res ); }
      req.tileData = im.encodeSync( );
      callback( null, req, res );
    });
  }
};

MapGenerator.basicEscape = function( text ) {
  // remove ', \n, \r, \t
  // turn " into '
  return "\"" + text.replace( /'/g, "" ).replace( /"/g, "'" ).
    replace( /(\\n|\\r|\\t)/g, " " ).replace( /(\\)/g, "\/" ) + "\"";
};

MapGenerator.mapXML = function( specificStyle ) {
  return "\
    <Map srs='" + proj4 + "' buffer-size='64' maximum-extent='-20037508.34,-20037508.34,20037508.34,20037508.34'>\
      " + specificStyle + "\
    </Map>";
};

MapGenerator.createMapTemplate = function( req, callback ) {
  try {
    req.style = req.style || Styles.points( );
    var tileSize = (req.params.format == "grid.json") ?
      256 : global.config.tileSize;
    var map = new mapnik.Map( tileSize, tileSize, proj4 );
    var bbox = MapGenerator.bboxFromParams( req );
    var layer = MapGenerator.createLayer( );
    map.extent = bbox;
    map.fromString( MapGenerator.mapXML( req.style ), { strict: true, base: "./" },
      function( err, map ) {
        if( err ) {
          return callback( err, req );
        }
        MapGenerator.createMercator( );
        callback( null, req, map, layer, MapGenerator.merc.convert( bbox ) );
      }
    );
  } catch( err ) {
    callback( err );
  }
};

module.exports = MapGenerator;
