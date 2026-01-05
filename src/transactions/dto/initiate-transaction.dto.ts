import {
  IsString,
  IsNumber,
  IsObject,
  IsEnum,
  IsOptional,
  Min,
  ValidateNested,
  IsNotEmpty,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentInstrumentType } from '../types/transaction.types';

export class PaymentInstrumentDto {
  @IsEnum(PaymentInstrumentType, {
    message: `type must be one of: ${Object.values(PaymentInstrumentType).join(', ')}`,
  })
  type: PaymentInstrumentType;

  @IsOptional()
  @IsString({ message: 'card_number must be a string' })
  @Matches(/^[0-9]{13,19}$/, {
    message: 'card_number must be a valid card number (13-19 digits)',
  })
  card_number?: string;

  @IsOptional()
  @IsString({ message: 'expiry must be a string' })
  @Matches(/^(0[1-9]|1[0-2])\/([0-9]{2})$/, {
    message: 'expiry must be in MM/YY format',
  })
  expiry?: string;

  @IsOptional()
  @IsString({ message: 'cvv must be a string' })
  @Matches(/^[0-9]{3,4}$/, {
    message: 'cvv must be 3 or 4 digits',
  })
  cvv?: string;

  @IsOptional()
  @IsString({ message: 'upi_id must be a string' })
  @Matches(/^[\w.-]+@[\w]+$/, {
    message: 'upi_id must be a valid UPI ID (e.g., name@upi)',
  })
  upi_id?: string;

  @IsOptional()
  @IsString({ message: 'bank_code must be a string' })
  @MaxLength(20, { message: 'bank_code must not exceed 20 characters' })
  bank_code?: string;

  @IsOptional()
  @IsString({ message: 'wallet_provider must be a string' })
  @MaxLength(50, { message: 'wallet_provider must not exceed 50 characters' })
  wallet_provider?: string;
}

export class InitiateTransactionDto {
  @IsString({ message: 'order_id must be a string' })
  @IsNotEmpty({ message: 'order_id is required' })
  @MaxLength(100, { message: 'order_id must not exceed 100 characters' })
  order_id: string;

  @IsNumber({}, { message: 'amount must be a valid number' })
  @Min(0.01, { message: 'amount must be at least 0.01' })
  amount: number;

  @IsOptional()
  @IsString({ message: 'currency must be a string' })
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a valid 3-letter ISO currency code (e.g., INR, USD)',
  })
  currency?: string;

  @IsObject({ message: 'payment_instrument must be an object' })
  @IsNotEmpty({ message: 'payment_instrument is required' })
  @ValidateNested({ message: 'payment_instrument contains invalid data' })
  @Type(() => PaymentInstrumentDto)
  payment_instrument: PaymentInstrumentDto;
}
