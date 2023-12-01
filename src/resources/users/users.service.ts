import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';
import { InsertUserDto } from './dto/user.dto';
import { generateId } from '@core/utils';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private userRepository: Repository<User>,
  ) {}

  public async insert(user: InsertUserDto): Promise<User> {
    const apiKey = generateId(15);

    const insertedUser = await this.userRepository.save({
      ...user,
      apiKey,
    });

    return insertedUser;
  }

  public async getByTelegramId(telegramId: number): Promise<User> {
    return this.userRepository.findOne({
      where: { telegramId },
    });
  }

  public async getByApiKey(apiKey: string) {
    return this.userRepository.findOne({
      where: { apiKey },
    });
  }
}
