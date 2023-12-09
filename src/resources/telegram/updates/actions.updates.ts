import { Action, Update } from 'nestjs-telegraf';
import { Update as TelegrafUpdate } from 'telegraf/typings/core/types/typegram';
import { BooksService } from '@resources/books/books.service';
import { CommonConfigs, MainUpdateContext } from '@core/types';
import { GetChunkDto } from '../../books/dto';
import { getReadBookKeyboard } from '../../../core/telegram';
import { ConfigService } from '@nestjs/config';

@Update()
export class ActionsUpdate {
  constructor(
    private readonly booksService: BooksService,
    private readonly configService: ConfigService,
  ) {}

  @Action(/back_+/)
  async getBackPage(ctx: MainUpdateContext) {
    const { callback_query: callbackQuery } =
      ctx.update as TelegrafUpdate.CallbackQueryUpdate;

    const [, bookId, page] = (callbackQuery as any).data.split('_');

    const chunk = await this.booksService.getPageByBookId(
      +bookId,
      +page,
      ctx.state.user.apiKey,
    );

    if (!chunk) {
      ctx.answerCbQuery('Ошибка! Этой страницы или книги не существует!', {
        show_alert: true,
      });

      ctx.deleteMessage();

      return;
    }

    await this.updateMessage(ctx, chunk);
  }

  @Action(/next_+/)
  async getNextPage(ctx: MainUpdateContext) {
    const { callback_query: callbackQuery } =
      ctx.update as TelegrafUpdate.CallbackQueryUpdate;

    const [, bookId, page] = (callbackQuery as any).data.split('_');

    const chunk = await this.booksService.getPageByBookId(
      +bookId,
      +page,
      ctx.state.user.apiKey,
    );

    if (!chunk) {
      ctx.answerCbQuery('Ошибка! Этой страницы или книги не существует!', {
        show_alert: true,
      });

      ctx.deleteMessage();

      return;
    }

    await this.updateMessage(ctx, chunk);
  }

  private async updateMessage(ctx: MainUpdateContext, chunk: GetChunkDto) {
    const { appUrl } = this.configService.get<CommonConfigs>('common');

    await ctx.editMessageText(chunk.text, {
      reply_markup: {
        inline_keyboard: getReadBookKeyboard(
          chunk.currentPage,
          chunk.totalPage,
          chunk.bookId,
          `${appUrl}/r/${chunk.bookId}/${chunk.currentPage}?k=${ctx.state.user.apiKey}`,
        ),
      },
    });

    await ctx.answerCbQuery(`${chunk.currentPage + 1} / ${chunk.totalPage}`);
  }
}
