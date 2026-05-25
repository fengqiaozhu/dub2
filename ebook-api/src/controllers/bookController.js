const path = require('path');
const fs = require('fs');
const parserService = require('../services/parserService');
const { bookRepository, chapterRepository } = require('../repositories');

class BookController {
  createBook(req, res) {
    try {
      const title = String(req.body.title || '').trim();
      const format = req.body.format || 'manual';

      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }

      const bookData = { title, format };

      // Optional metadata fields
      const optionalFields = ['author', 'description', 'language', 'tags', 'cover_url', 'status', 'publisher', 'publish_year', 'isbn'];
      for (const field of optionalFields) {
        if (req.body[field] !== undefined) {
          bookData[field] = req.body[field];
        }
      }

      const id = bookRepository.create(bookData);
      const book = bookRepository.findById(id);
      res.status(201).json({ message: 'Book created', data: book });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  updateBook(req, res) {
    try {
      const id = req.params.id;
      const updates = {};

      const allowedFields = ['title', 'format', 'author', 'description', 'language', 'tags', 'cover_url', 'status', 'publisher', 'publish_year', 'isbn'];

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          if (field === 'title') {
            const title = String(req.body.title).trim();
            if (!title) {
              return res.status(400).json({ error: 'title cannot be empty' });
            }
            updates.title = title;
          } else {
            updates[field] = req.body[field];
          }
        }
      }

      const success = bookRepository.update(id, updates);
      if (!success) {
        return res.status(404).json({ error: 'Book not found' });
      }

      const book = bookRepository.findById(id);
      res.json({ message: 'Book updated successfully', data: book });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  createChapterForBook(req, res) {
    try {
      const bookId = req.params.bookId;
      const book = bookRepository.findById(bookId);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      const title = String(req.body.title || '').trim() || `第 ${chapterRepository.getNextChapterIndex(bookId) + 1} 章`;
      const content = String(req.body.content || '').trim();
      const chapterIndex = req.body.chapter_index ?? chapterRepository.getNextChapterIndex(bookId);

      if (!content) {
        return res.status(400).json({ error: 'content is required' });
      }

      const id = chapterRepository.create({
        book_id: bookId,
        title,
        content,
        chapter_index: chapterIndex
      });

      res.status(201).json({ message: 'Chapter created', data: { id } });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async upload(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const filePath = req.file.path;
      const originalName = req.file.originalname;

      const result = await parserService.processUpload(filePath, originalName);
      
      res.status(201).json({
        message: 'Book uploaded and parsed successfully',
        data: result
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  uploadCover(req, res) {
    try {
      const id = req.params.id;
      const book = bookRepository.findById(id);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No cover file uploaded' });
      }

      // Ensure covers directory exists
      const coversDir = path.join(__dirname, '../../public/covers');
      if (!fs.existsSync(coversDir)) {
        fs.mkdirSync(coversDir, { recursive: true });
      }

      // Move uploaded file to covers directory
      const ext = path.extname(req.file.originalname) || '.jpg';
      const filename = `${id}_${Date.now()}${ext}`;
      const destPath = path.join(coversDir, filename);

      fs.copyFileSync(req.file.path, destPath);
      fs.unlinkSync(req.file.path);

      const coverUrl = `/covers/${filename}`;
      bookRepository.update(id, { cover_url: coverUrl });

      res.json({ message: 'Cover uploaded successfully', data: { cover_url: coverUrl } });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  getBookCount(req, res) {
    try {
      const total = bookRepository.count();
      res.json({ data: { total } });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  getChapters(req, res) {
    try {
      const bookId = req.params.bookId;
      const chapters = chapterRepository.findByBookId(bookId);
      res.json({ data: chapters });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  getBookById(req, res) {
    try {
      const id = req.params.id;
      const book = bookRepository.findById(id);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }
      const chapters = chapterRepository.findByBookId(id);
      book.chapters = chapters;
      res.json({ data: book });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  getAllBooks(req, res) {
    try {
      const options = {};
      if (req.query.q) options.q = req.query.q;
      if (req.query.sort) options.sort = req.query.sort;
      if (req.query.order) options.order = req.query.order;

      const books = bookRepository.findAll(options);
      res.json({ data: books });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  deleteBook(req, res) {
    try {
      const id = req.params.id;
      const success = bookRepository.delete(id);
      if (success) {
        res.json({ message: 'Book deleted successfully' });
      } else {
        res.status(404).json({ error: 'Book not found' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new BookController();
