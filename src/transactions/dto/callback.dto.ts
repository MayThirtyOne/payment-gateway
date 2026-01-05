import { IsString, IsEnum, IsOptional, IsNotEmpty, MaxLength } from 'class-validator';

export enum CallbackStatus {
  SUCCESS = 'success',
  FAILURE = 'failure',
}

export class CallbackDto {
  @IsString({ message: 'order_id must be a string' })
  @IsNotEmpty({ message: 'order_id is required' })
  @MaxLength(100, { message: 'order_id must not exceed 100 characters' })
  order_id: string;

  @IsEnum(CallbackStatus, {
    message: 'status must be either "success" or "failure"',
  })
  status: CallbackStatus;

  @IsString({ message: 'gateway must be a string' })
  @IsNotEmpty({ message: 'gateway is required' })
  gateway: string;

  @IsOptional()
  @IsString({ message: 'reason must be a string' })
  @MaxLength(500, { message: 'reason must not exceed 500 characters' })
  reason?: string;
}
