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

MapGenerator.finishMap = function( req, res, map, layer, features, callback ) {
  if( features.length === 0 && req.params.format !== "grid.json" ) {
    res.writeHead( 200, { "Content-Type": "image/png" });
    res.end( MapGenerator.blankImage );
    return callback( null, req, res );
  }
  var mem_ds, im;
  var fields = _.map(
    _.without( req.elastic_query.fields, "location" ), function( f ) {
      return f.split( "." ).pop( );
  }).concat( [ "latitude", "longitude" ] );
  if( features.length > 0) {
    mem_ds = new mapnik.Datasource({
      type: "csv",
      inline: fields.join(",") + "\n" + features.join("\n")
    });
    layer.datasource = mem_ds;
  }
  map.add_layer( layer );
  if( req.params.format === "grid.json" ) {
    var options = { };
    options.layer = "tile";
    options.fields = fields;
    options.headers = { "Content-Type": "application/json" };
    im = new mapnik.Grid( global.config.tileSize, global.config.tileSize, { key: "id" } );
    map.render( im, options, function( err, im ) {
      if( err ) { return callback( err, req, res ); }
      res.jsonp( im.encodeSync( ) );
      callback( null, req, res );
    });
  } else {
    im = new mapnik.Image( global.config.tileSize, global.config.tileSize );
    map.render( im, function( err, im ) {
      if( err ) { return callback( err, req, res ); }
      res.writeHead( 200, { "Content-Type": "image/png" });
      res.end( im.encodeSync( ) );
      callback( null, req, res );
    });
  }
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
    var map = new mapnik.Map( global.config.tileSize, global.config.tileSize, proj4 );
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
