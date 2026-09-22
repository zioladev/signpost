const { declarationUrls } = require('../provider-sources.cjs');

module.exports = function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ declaration_urls: declarationUrls() });
  } catch {
    res.status(500).json({ error: 'Invalid provider source configuration' });
  }
};
