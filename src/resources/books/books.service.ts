import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Book, BooksChunk } from './entities';
import { Repository } from 'typeorm';
import { CreateBookDto, CreateBooksChunkDto } from './dto';
import { splitEveryN } from '../../core/utils';
import { ConfigService } from '@nestjs/config';
import { CommonConfigs } from '@core/types';

@Injectable()
export class BooksService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Book) private readonly bookRepository: Repository<Book>,
    @InjectRepository(BooksChunk)
    private readonly bookChunkRepository: Repository<BooksChunk>,
  ) {}

  async createBook(payload: CreateBookDto): Promise<number> {
    const chunks = splitEveryN(payload.bookText);

    const { raw } = await this.bookRepository.insert({
      author: payload?.author,
      title: payload.title,
    });

    const insertedBookId = +raw[0]?.id;

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
    id: number,
    page: number,
  ): Promise<{
    text: string | undefined;
    title: string | undefined;
    bookId: number | undefined;
  } | null> {
    const chunk = await this.bookChunkRepository.findOne({
      where: {
        book: {
          id,
        },
        index: page,
      },
      relations: ['book'],
    });

    if (!chunk) {
      return null;
    }

    return {
      text: chunk.text,
      title: chunk.book.title,
      bookId: chunk.book.id,
    };
  }

  async getAll() {
    const result = [];

    const { appUrl } = this.configService.get<CommonConfigs>('common');

    const books = await this.bookRepository.find();

    for (let index = 0; index < books.length; index++) {
      const book = books[index];
      result.push({
        id: book.id,
        index: index + 1,
        title: book.title,
        author: book.author,
        link: `${appUrl}/r/${book.id}/1`,
      });
    }

    return result;
  }

  async deleteBookById(
    id: number,
  ): Promise<{ book: Book | null; result: boolean }> {
    const book = await this.bookRepository.findOne({
      where: {
        id,
      },
    });

    if (!book) {
      return {
        book,
        result: false,
      };
    }

    try {
      await this.bookRepository.delete({
        id: book.id,
      });

      await this.bookChunkRepository.delete({
        book: {
          id,
        },
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
}
