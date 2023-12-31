import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Book, BooksChunk } from './entities';
import { ILike, Repository } from 'typeorm';
import {
  CreateBookDto,
  CreateBooksChunkDto,
  GetBookDto,
  GetChunkDto,
} from './dto';
import { getPagesCount, getTextByLanguageCode, splitEveryN } from '@core/utils';
import { ConfigService } from '@nestjs/config';
import { CommonConfigs, LanguageCode, Page } from '@core/types';
import { User } from '@resources/users/entities';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class BooksService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Book) private readonly bookRepository: Repository<Book>,
    @InjectRepository(BooksChunk)
    private readonly bookChunkRepository: Repository<BooksChunk>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getAllChunksByBookId(
    id: string,
    apiKey: string,
  ): Promise<BooksChunk[]> {
    return this.bookChunkRepository.find({
      where: {
        book: {
          id,
          user: {
            apiKey,
          },
        },
      },
      relations: ['book', 'book.user'],
    });
  }

  async createBook(payload: CreateBookDto): Promise<number> {
    const { chunks, totalIndex } = splitEveryN(
      payload.bookText,
      payload.user.chunkSize,
    );

    const { raw } = await this.bookRepository.insert({
      author: payload?.author,
      title: payload.title,
      totalIndex: totalIndex - 1,
      user: payload.user,
    });

    const insertedBookId = raw[0]?.id;

    const chunksToInsert: CreateBooksChunkDto[] = chunks.map(
      ({ chunk: text, index }) => ({
        book: { id: insertedBookId },
        index,
        text,
      }),
    );

    await this.bookChunkRepository.insert(chunksToInsert);

    return insertedBookId;
  }

  async getPageByBookId(
    id: string,
    page: number,
    apiKey: string,
    saveCurrentPage = true,
  ): Promise<GetChunkDto | null> {
    const cacheKey = `page_${id}_${page}`;

    let chunk = await this.cacheManager.get<BooksChunk>(cacheKey);

    if (!chunk) {
      chunk = await this.bookChunkRepository.findOne({
        where: {
          book: {
            id,
            user: {
              apiKey,
            },
          },
          index: page,
        },
        relations: ['book', 'book.user'],
      });

      if (chunk) {
        this.cacheManager.set(cacheKey, chunk, 3600);
      }
    }

    if (!chunk) {
      return null;
    }

    if (page !== chunk.book.lastIndex && saveCurrentPage) {
      await this.bookRepository.update(id, {
        lastIndex: page,
      });
    }

    const nextPageCacheKey = `page_${id}_${page + 1}`;

    let nextPage = await this.cacheManager.get<BooksChunk>(nextPageCacheKey);

    if (!nextPage) {
      nextPage = await this.getChunk(id, page + 1, apiKey);

      if (nextPage) {
        this.cacheManager.set(nextPageCacheKey, nextPage);
      }
    }

    return {
      text: chunk.text,
      title: chunk.book.title,
      bookId: chunk.book.id,
      currentPage: page,
      totalPage: chunk.book.totalIndex,
      userLanguageCode: chunk.book.user.languageCode,
    };
  }

  async getAll(
    apiKey: string,
    page = 1,
    take = 5,
  ): Promise<{
    result: GetBookDto[];
    userName: string;
    pageLinks: Array<Page>;
    userLanguageCode: LanguageCode;
    pagesText: string;
    totalPageCount: number;
    booksCount: number;
  }> {
    const result: GetBookDto[] = [];

    const { appUrl } = this.configService.get<CommonConfigs>('common');

    const skip = (page - 1) * take;

    const [books, booksCount] = await this.bookRepository.findAndCount({
      where: {
        user: {
          apiKey,
        },
      },
      order: {
        updatedAt: 'DESC',
      },
      relations: ['user'],
      take,
      skip,
    });

    let user: User;

    if (books.length > 0) {
      user = books[0].user;
    } else {
      return {
        result: [],
        userName: '404',
        pageLinks: [],
        userLanguageCode: 'en',
        pagesText: 'Pages',
        totalPageCount: 0,
        booksCount: 0,
      };
    }

    const userLanguageCode = user.languageCode;

    const begginText = getTextByLanguageCode(
      userLanguageCode,
      'books_open_begin',
    );
    const continousText = getTextByLanguageCode(
      userLanguageCode,
      'books_continue',
    );
    const pagesText = getTextByLanguageCode(userLanguageCode, 'books_pages');

    const apiKeyParam = `?k=${apiKey}`;

    for (let index = 0; index < books.length; index++) {
      const book = books[index];
      result.push({
        id: book.id,
        index: index + skip + 1,
        title: book.title.replace(/.txt/g, ''),
        author: book.author,
        begginLink: `${appUrl}/r/${book.id}/1${apiKeyParam}`,
        continousLink: `${appUrl}/r/${book.id}/${book.lastIndex}${apiKeyParam}`,
        currentPage: book.lastIndex,
        totalPage: book.totalIndex,
        percent: `${Math.round((100 * book.lastIndex) / book.totalIndex)} %`,
        begginText,
        continousText,
      });
    }

    const pageLinks = getPagesCount(
      booksCount,
      take,
      `${appUrl}/menu${apiKeyParam}`,
    );

    return {
      result,
      userName: user
        ? `${
            user.firstName && user.secondName && user.username
              ? ` ${user.firstName} ${user.secondName} (${user.username})`
              : `${user.username}`
          }`
        : getTextByLanguageCode('en', 'books_auth_error'),
      pageLinks,
      userLanguageCode,
      pagesText,
      totalPageCount: pageLinks?.length,
      booksCount,
    };
  }

  async getBookById(id: string, apiKey: string): Promise<GetBookDto> {
    const book = await this.bookRepository.findOne({
      where: {
        id,
        user: {
          apiKey,
        },
      },
    });

    if (book) {
      const { appUrl } = this.configService.get<CommonConfigs>('common');
      const apiKeyParam = `?k=${apiKey}`;

      return {
        id: book.id,
        title: book.title.replace(/.txt/g, ''),
        author: book.author,
        begginLink: `${appUrl}/r/${book.id}/1${apiKeyParam}`,
        continousLink: `${appUrl}/r/${book.id}/${book.lastIndex}${apiKeyParam}`,
        currentPage: book.lastIndex,
        totalPage: book.totalIndex,
        fileName: book.title,
        percent: `${Math.round((100 * book.lastIndex) / book.totalIndex)} %`,
      };
    }
  }

  async deleteBookById(
    id: string,
    apiKey: string,
  ): Promise<{ book: Book | null; result: boolean }> {
    const book = await this.bookRepository.findOne({
      where: {
        id,
        user: {
          apiKey,
        },
      },
      relations: ['user'],
    });

    if (!book) {
      return {
        book,
        result: false,
      };
    }

    try {
      await this.bookChunkRepository.delete({
        book: {
          id,
        },
      });

      await this.bookRepository.delete({
        id: book.id,
      });

      return {
        book,
        result: true,
      };
    } catch (error) {
      console.log(error);

      return {
        book,
        result: false,
      };
    }
  }

  async getBooksCountByTelegramId(telegramId: number) {
    return this.bookRepository.count({
      where: {
        user: {
          telegramId,
        },
      },
      relations: ['user'],
    });
  }

  async search(
    text: string,
    bookId: string,
    apiKey: string,
    page = 1,
    take = 5,
  ): Promise<[Array<BooksChunk>, number]> {
    const skip = (page - 1) * take;
    return await this.bookChunkRepository.findAndCount({
      where: {
        text: ILike(`%${text.toLowerCase()}%`),
        book: {
          id: bookId,
          user: {
            apiKey,
          },
        },
      },
      take,
      skip,
      relations: ['book', 'book.user'],
    });
  }

  private async getChunk(id: string, page: number, apiKey: string) {
    return await this.bookChunkRepository.findOne({
      where: {
        book: {
          id,
          user: {
            apiKey,
          },
        },
        index: page,
      },
      relations: ['book', 'book.user'],
    });
  }
}
