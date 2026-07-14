import { IsArray, IsIn, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { AppendMessagesBody } from '@prost/shared-types';

class ConversationMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  content!: string;
}

export class AppendMessagesDto implements AppendMessagesBody {
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConversationMessageDto)
  messages!: ConversationMessageDto[];
}

export class RenameConversationDto {
  @IsString()
  @MinLength(1)
  title!: string;
}
