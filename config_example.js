module.exports = {
  elasticsearch: {
    host: "http://localhost:9200",
    searchIndex: "points_index",
    geoPointField: "location"
  },
  tileSize: 256,
  debug: true
};
