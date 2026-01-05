export enum TransactionStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILURE = 'failure',
}

export enum PaymentInstrumentType {
  CARD = 'card',
  UPI = 'upi',
  NETBANKING = 'netbanking',
  WALLET = 'wallet',
}

export interface PaymentInstrument {
  type: PaymentInstrumentType;
  card_number?: string;
  expiry?: string;
  cvv?: string;
  upi_id?: string;
  bank_code?: string;
  wallet_provider?: string;
}

export interface Transaction {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  gateway: string;
  gateway_selection_reason: string;
  payment_instrument: PaymentInstrument;
  failure_reason?: string;
  created_at: Date;
  updated_at: Date;
}
