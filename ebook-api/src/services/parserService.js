const fs = require('fs');
const path = require('path');
const readline = require('readline');
const EPub = require('epub2').EPub;
const { bookRepository, chapterRepository } = require('../repositories');

class ParserService {
  async processUpload(filePath, originalName) {
    const ext = path.extname(originalName).toLowerCase();
    const title = path.basename(originalName, ext);
    
    let bookFormat = 'unknown';
    let chapters = []; // { title: string, content: string, chapter_index: number }

    try {
      if (ext === '.txt') {
        bookFormat = 'txt';
        chapters = await this.parseTxt(filePath);
      } else if (ext === '.epub') {
        bookFormat = 'epub';
        const parsed = await this.parseEpub(filePath);
        chapters = parsed.chapters;
      } else if (ext === '.mobi') {
        bookFormat = 'mobi';
        chapters = await this.parseMobi(filePath);
      } else {
        throw new Error(`Unsupported format: ${ext}`);
      }

      // Save to database
      const bookId = bookRepository.create({ title, format: bookFormat });
      
      const chaptersToSave = chapters.map(ch => ({
        ...ch,
        book_id: bookId
      }));

      chapterRepository.createMany(chaptersToSave);
      
      return {
        bookId,
        title,
        format: bookFormat,
        chapterCount: chapters.length
      };
    } finally {
      // Clean up uploaded file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  async parseTxt(filePath) {
    const chapters = [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    // Regex to match "第X章" or "Chapter X"
    const chapterRegex = /^(第[\d一二三四五六七八九十百千]+[章节卷回]|Chapter\s+\d+)/i;
    
    let currentChapterTitle = '序言'; // Default if no title matched yet
    let currentContent = [];
    let chapterIndex = 0;

    for await (const line of rl) {
      if (chapterRegex.test(line.trim())) {
        // Save previous chapter if it has content
        if (currentContent.length > 0) {
          chapters.push({
            title: currentChapterTitle,
            content: currentContent.join('\n'),
            chapter_index: chapterIndex++
          });
          currentContent = [];
        }
        currentChapterTitle = line.trim();
      } else {
        if (line.trim()) {
          currentContent.push(line);
        }
      }
    }

    // Push the last chapter
    if (currentContent.length > 0 || currentChapterTitle !== '序言') {
      chapters.push({
        title: currentChapterTitle,
        content: currentContent.join('\n'),
        chapter_index: chapterIndex
      });
    }

    return chapters;
  }

  async parseEpub(filePath) {
    return new Promise((resolve, reject) => {
      const epub = new EPub(filePath);
      
      epub.on('end', () => {
        const chapters = [];
        let index = 0;
        
        const processNext = (i) => {
          if (i >= epub.flow.length) {
            resolve({ chapters });
            return;
          }
          
          const chapter = epub.flow[i];
          epub.getChapter(chapter.id, (err, text) => {
            if (err) {
              console.warn(`Failed to parse chapter ${chapter.id}`);
            } else {
              // Strip HTML tags roughly since it's epub HTML content
              const cleanText = text.replace(/<[^>]+>/g, '').trim();
              if (cleanText) {
                chapters.push({
                  title: chapter.title || `Chapter ${index + 1}`,
                  content: cleanText,
                  chapter_index: index++
                });
              }
            }
            processNext(i + 1);
          });
        };
        
        processNext(0);
      });
      
      epub.on('error', (err) => reject(err));
      epub.parse();
    });
  }

  async parseMobi(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const mobiParserModule = await import('@lingo-reader/mobi-parser');
    const mobiParser = mobiParserModule.default || mobiParserModule;
    const parsedMobi = await mobiParser.parseMobi(fileBuffer);
    
    // Simplistic handling for Mobi parser structure
    // Since mobi content extraction might differ depending on library
    // Using simple approach based on text extraction
    
    let textContent = '';
    // Typically mobiParser returns html content or text
    if (parsedMobi && parsedMobi.text) {
       textContent = parsedMobi.text;
    } else if (parsedMobi && parsedMobi.html) {
       textContent = parsedMobi.html.replace(/<[^>]+>/g, '');
    } else {
       // fallback: assuming it might return an array of chapters
       return [{
         title: 'Full Book',
         content: JSON.stringify(parsedMobi), // Last resort fallback
         chapter_index: 0
       }];
    }

    // Split text by typical chapter markers if it's one big string
    // This is similar to the TXT parser logic
    const lines = textContent.split('\n');
    const chapterRegex = /^(第[\d一二三四五六七八九十百千]+[章节卷回]|Chapter\s+\d+)/i;
    
    const chapters = [];
    let currentChapterTitle = '序言';
    let currentContent = [];
    let chapterIndex = 0;

    for (const line of lines) {
      if (chapterRegex.test(line.trim())) {
        if (currentContent.length > 0) {
          chapters.push({
            title: currentChapterTitle,
            content: currentContent.join('\n'),
            chapter_index: chapterIndex++
          });
          currentContent = [];
        }
        currentChapterTitle = line.trim();
      } else {
        if (line.trim()) {
          currentContent.push(line);
        }
      }
    }

    if (currentContent.length > 0 || currentChapterTitle !== '序言') {
      chapters.push({
        title: currentChapterTitle,
        content: currentContent.join('\n'),
        chapter_index: chapterIndex
      });
    }

    return chapters;
  }
}

module.exports = new ParserService();
