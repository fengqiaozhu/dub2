const storageService = require('../services/storage/storageService');

class MediaController {
  async getMedia(req, res) {
    try {
      const key = decodeURIComponent(req.params[0] || '');
      if (!key) {
        return res.status(400).json({ error: 'media key is required' });
      }

      const object = await storageService.getObjectStream(key);
      if (object.contentType) res.setHeader('Content-Type', object.contentType);
      if (object.contentLength) res.setHeader('Content-Length', String(object.contentLength));
      res.setHeader('Cache-Control', 'private, max-age=3600');
      object.stream.pipe(res);
    } catch (error) {
      const status = error.$metadata?.httpStatusCode === 404 ? 404 : 500;
      res.status(status).json({ error: status === 404 ? 'Media not found' : error.message });
    }
  }
}

module.exports = new MediaController();
