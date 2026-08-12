"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  trimValues: true,
  isArray: (tagName) => ["game", "entry", "question", "option", "segment", "color", "level", "symbol"].includes(tagName),
});

/**
 * Load a game's XML config file (games/<gameId>/<gameId>.xml) as a plain
 * object, returning the root tag's payload. Returns {} on any failure so
 * every handler can rely on sane defaults.
 */
function loadXml(gameId) {
  const fileName = gameId === "2048" ? "game2048.xml" : `${gameId}.xml`;
  const file = path.join(__dirname, "..", "..", "games", gameId, fileName);
  try {
    const parsed = parser.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed[gameId] || {} : {};
  } catch (_error) {
    return {};
  }
}

module.exports = { loadXml };
