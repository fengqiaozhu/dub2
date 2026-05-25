import { defineStore } from 'pinia';
import request, { toMediaUrl } from '@/api/request';

export interface Book {
  id: number;
  title: string;
  format: string;
  author?: string;
  description?: string;
  language?: string;
  tags?: string;
  cover_url?: string;
  status?: string;
  publisher?: string;
  publish_year?: number;
  isbn?: string;
  chapter_count?: number;
  chapters?: any[];
  created_at?: string;
  progress?: number;
}

export const parseBookTags = (tags?: string | string[] | null): string[] => {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.filter(Boolean);
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return tags.split(',').map(t => t.trim()).filter(Boolean);
  }
};

export const resolveBookCoverUrl = (coverUrl?: string | null): string => {
  if (!coverUrl) return '';
  if (coverUrl.startsWith('blob:') || coverUrl.startsWith('data:')) return coverUrl;
  return toMediaUrl(coverUrl);
};

export const useBookStore = defineStore('books', {
  state: () => ({
    books: [] as Book[],
    totalBookCount: 0,
    searchQuery: '',
    sortBy: 'created_at' as 'title' | 'created_at' | 'author',
    sortOrder: 'desc' as 'asc' | 'desc',
    viewMode: 'grid' as 'grid' | 'list',
    formatFilter: null as string | null,
    loading: false,
  }),

  getters: {
    bookCount: (state) => state.totalBookCount,
    filteredBooks: (state) => {
      let result = [...state.books];
      if (state.formatFilter) {
        result = result.filter(b => b.format === state.formatFilter);
      }
      return result;
    },
    formatCounts: (state) => {
      const counts: Record<string, number> = {};
      for (const book of state.books) {
        const fmt = book.format || 'unknown';
        counts[fmt] = (counts[fmt] || 0) + 1;
      }
      return counts;
    },
  },

  actions: {
    async fetchBooks() {
      this.loading = true;
      try {
        const params: Record<string, string> = {};
        if (this.searchQuery) params.q = this.searchQuery;
        params.sort = this.sortBy;
        params.order = this.sortOrder;
        const res = await request.get('/books', { params });
        this.books = (res as any).data;
        if (!this.searchQuery) {
          this.totalBookCount = this.books.length;
        }
        this.fetchBookCount();
      } catch (error) {
        console.error('Failed to fetch books:', error);
      } finally {
        this.loading = false;
      }
    },

    async fetchBookCount() {
      try {
        const res = await request.get('/books/count');
        this.totalBookCount = (res as any).data?.total ?? this.totalBookCount;
      } catch (error) {
        console.error('Failed to fetch book count:', error);
      }
    },

    async deleteBook(id: number) {
      try {
        await request.delete(`/books/${id}`);
        this.books = this.books.filter(b => b.id !== id);
        await this.fetchBookCount();
      } catch (error) {
        console.error('Failed to delete book:', error);
        throw error;
      }
    },

    async updateBookMetadata(id: number, data: Partial<Book>) {
      try {
        const res = await request.put(`/books/${id}`, data);
        const index = this.books.findIndex(b => b.id === id);
        if (index !== -1) {
          const updated = (res as any).data;
          if (updated) {
            this.books[index] = { ...this.books[index], ...updated };
          } else {
            this.books[index] = { ...this.books[index], ...data };
          }
        }
        await this.fetchBookCount();
      } catch (error) {
        console.error('Failed to update book:', error);
        throw error;
      }
    },

    async uploadCover(id: number, file: File): Promise<string> {
      const formData = new FormData();
      formData.append('cover', file);
      try {
        const res = await request.post(`/books/${id}/cover`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        const coverUrl = (res as any).data?.cover_url;
        const index = this.books.findIndex(b => b.id === id);
        if (index !== -1) {
          this.books[index].cover_url = coverUrl;
        }
        return coverUrl;
      } catch (error) {
        console.error('Failed to upload cover:', error);
        throw error;
      }
    },

    setSearchQuery(q: string) {
      this.searchQuery = q;
    },
    setSortBy(sort: 'title' | 'created_at' | 'author') {
      this.sortBy = sort;
    },
    setSortOrder(order: 'asc' | 'desc') {
      this.sortOrder = order;
    },
    setViewMode(mode: 'grid' | 'list') {
      this.viewMode = mode;
    },
    setFormatFilter(format: string | null) {
      this.formatFilter = format;
    },
  },
});
