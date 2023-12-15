import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Render,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { BooksService } from './books.service';
import { ConfigService } from '@nestjs/config';
import { CommonConfigs } from '@core/types';
import { UsersService } from '@resources/users/users.service';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller()
export class BooksController {
  constructor(
    private readonly userService: UsersService,
    private readonly booksService: BooksService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @Render('books')
  async getAll(
    @Query('k') apiKey: string,
    @Query('p', new DefaultValuePipe(1)) page: number,
  ) {
    if (!apiKey) {
      throw new UnauthorizedException(
        'query param "k" is required! use ?k=<key>',
      );
    }

    const {
      result: books,
      userName,
      pageLinks,
    } = await this.booksService.getAll(apiKey, page);

    return { books, userName, pageLinks };
  }

  @Get('r/:id/:page')
  @Render('page')
  async getBookPage(
    @Param('id', ParseIntPipe) bookId: number,
    @Param('page', ParseIntPipe) page: number,
    @Query('k') apiKey: string,
  ) {
    if (!apiKey) {
      throw new UnauthorizedException(
        'query param "k" is required! use ?k=<key>',
      );
    }

    const apiKeyParam = `?k=${apiKey}`;

    const chunk = await this.booksService.getPageByBookId(bookId, page, apiKey);

    if (chunk) {
      const { appUrl } = this.configService.get<CommonConfigs>('common');

      return {
        ...chunk,
        main: `${appUrl}${apiKeyParam}`,
        back: `${appUrl}/r/${chunk.bookId}/${
          page === 1 ? page : page - 1
        }${apiKeyParam}`,
        next: `${appUrl}/r/${chunk.bookId}/${page + 1}${apiKeyParam}`,
      };
    } else {
      const { appUrl } = this.configService.get<CommonConfigs>('common');

      return {
        main: `${appUrl}${apiKeyParam}`,
        title: 'Не найдено',
        text: 'Страница или книга не найдены!',
      };
    }
  }

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 128000000,
        files: 1,
      },
    }),
  )
  async uploadFile(
    @Query('k') apiKey: string,
    @Query('author', new DefaultValuePipe('noname')) author: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!apiKey) {
      throw new UnauthorizedException(
        'query param "k" is required! use ?k=<key>',
      );
    }

    if (file.mimetype === 'text/plain') {
      const user = await this.userService.getByApiKey(apiKey);

      if (!user) {
        throw new UnauthorizedException('we do not recognize you!');
      }

      const booksCount = await this.booksService.getBooksCountByTelegramId(
        user.telegramId,
      );

      if (user.booksLimit <= booksCount) {
        throw new BadRequestException('books limit!');
      }

      try {
        const id = await this.booksService.createBook({
          title: file.originalname,
          bookText: file.buffer.toString(),
          author,
          user,
        });

        const { appUrl } = this.configService.get<CommonConfigs>('common');

        return {
          bookUrl: `${appUrl}/r/${id}/1?k=${apiKey}`,
        };
      } catch (error) {
        throw new InternalServerErrorException('error in creating book!');
      }
    } else {
      throw new BadRequestException(
        `you need mimetype: text/plain. your file's mimetype is ${file.mimetype}`,
      );
    }
  }
}
