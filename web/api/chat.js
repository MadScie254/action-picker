const data = require("../data.json");
const { createHandler } = require("./_chat-core.js");

module.exports = createHandler({ fetchImpl: fetch, env: process.env, data });
