import { IsArray, IsIn, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ChatMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  content!: string;
}

export class ChatDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];

  @IsOptional()
  @IsIn(['ask', 'generateSql', 'explain'])
  mode?: 'ask' | 'generateSql' | 'explain';

  @IsUUID()
  endpointId!: string;

  @IsString()
  @MinLength(1)
  model!: string;
}
