module.exports = {
  config: {
    elasticsearch: {
      host: "localhost:9200",
      searchIndex: `elasticmaps_${process.env.NODE_ENV || "development"}`,
      geoPointField: "location"
    },
    log: `elasticmaps.${process.env.NODE_ENV || "development"}.log`,
    tileSize: 256,
    debug: true
  }
};
