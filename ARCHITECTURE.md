# Payment Gateway Router - Architecture & Code Documentation

This document provides a deep dive into how the Payment Gateway Router works, explaining each component, their interactions, and the flow of data through the system.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Project Structure](#project-structure)
3. [Module Breakdown](#module-breakdown)
4. [Gateway Module - The Brain](#gateway-module---the-brain)
5. [Transactions Module - The Heart](#transactions-module---the-heart)
6. [Health Module - The Pulse](#health-module---the-pulse)
7. [Data Flow & Interactions](#data-flow--interactions)
8. [Request Lifecycle Examples](#request-lifecycle-examples)
9. [Configuration & Constants](#configuration--constants)

---

## System Overview

The Payment Gateway Router is a NestJS application that intelligently routes payment transactions across multiple payment gateways (Razorpay, PayU, Cashfree). It uses two key strategies:

1. **Weighted Load Distribution**: Traffic is distributed based on configured percentages
2. **Health-Based Routing**: Unhealthy gateways are automatically excluded

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         INCOMING REQUEST                                 │
│                    POST /transactions/initiate                           │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      TRANSACTIONS SERVICE                                │
│  • Validates request                                                     │
│  • Checks for duplicate orders                                           │
│  • Asks Gateway Service: "Which gateway should I use?"                   │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        GATEWAY SERVICE                                   │
│  • Asks Health Service: "Which gateways are healthy?"                    │
│  • Filters out unhealthy gateways                                        │
│  • Applies weighted random selection                                     │
│  • Returns: "Use Razorpay"                                               │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    GATEWAY HEALTH SERVICE                                │
│  • Tracks success/failure per gateway                                    │
│  • Calculates success rates over 15-min window                           │
│  • Returns list of healthy gateways                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
src/
├── main.ts                      # App bootstrap (local development)
├── app.module.ts                # Root module - wires everything together
│
├── gateway/                     # Gateway routing & health
│   ├── gateway.module.ts        # Module definition
│   ├── gateway.service.ts       # Routing logic (weighted selection)
│   ├── gateway-health.service.ts # Health tracking & circuit breaker
│   ├── gateway.controller.ts    # Admin endpoints
│   └── types/
│       └── gateway.types.ts     # Interfaces & configuration
│
├── transactions/                # Transaction management
│   ├── transactions.module.ts   # Module definition
│   ├── transactions.service.ts  # Business logic
│   ├── transactions.controller.ts # API endpoints
│   ├── dto/                     # Request validation
│   │   ├── initiate-transaction.dto.ts
│   │   └── callback.dto.ts
│   └── types/
│       └── transaction.types.ts # Interfaces & enums
│
└── health/                      # System health
    ├── health.module.ts
    └── health.controller.ts     # Health check endpoints

api/
└── index.ts                     # Vercel serverless entry point
```

---

## Module Breakdown

### How NestJS Modules Work

In NestJS, modules are containers that group related functionality. They define:
- **Providers**: Services that contain business logic
- **Controllers**: Handle HTTP requests
- **Imports**: Other modules this module depends on
- **Exports**: Providers available to other modules

```typescript
// app.module.ts - The Root Module
@Module({
  imports: [
    LoggerModule.forRoot({...}),  // Pino logging
    GatewayModule,                 // Gateway functionality
    TransactionsModule,            // Transaction functionality
    HealthModule,                  // Health checks
  ],
})
export class AppModule {}
```

**Dependency Graph:**

```
AppModule
    │
    ├── LoggerModule (Pino)
    │
    ├── GatewayModule
    │   ├── GatewayService ──────► GatewayHealthService
    │   ├── GatewayHealthService
    │   └── GatewayController
    │
    ├── TransactionsModule
    │   ├── TransactionsService ──► GatewayService (imported from GatewayModule)
    │   └── TransactionsController
    │
    └── HealthModule
        └── HealthController
```

---

## Gateway Module - The Brain

The Gateway module handles the intelligent routing decisions. It consists of three main parts:

### 1. Gateway Types & Configuration

**File:** `src/gateway/types/gateway.types.ts`

This file defines all the interfaces and configuration constants:

```typescript
// Gateway configuration - defines available gateways and their weights
export const GATEWAY_CONFIG: GatewayConfig[] = [
  { name: 'razorpay', weight: 50, enabled: true },   // 50% of traffic
  { name: 'payu', weight: 30, enabled: true },       // 30% of traffic
  { name: 'cashfree', weight: 20, enabled: true },   // 20% of traffic
];

// Health monitoring constants
export const HEALTH_CHECK_WINDOW_MINUTES = 15;    // Look at last 15 mins
export const UNHEALTHY_COOLDOWN_MINUTES = 30;     // Disable for 30 mins
export const SUCCESS_RATE_THRESHOLD = 0.9;        // 90% success required
export const MIN_REQUESTS_FOR_HEALTH_CHECK = 5;   // Need 5+ requests to evaluate
```

**Key Interfaces:**

```typescript
interface GatewayConfig {
  name: string;      // 'razorpay', 'payu', 'cashfree'
  weight: number;    // Percentage weight (0-100)
  enabled: boolean;  // Can be manually disabled
}

interface GatewayHealth {
  name: string;
  isHealthy: boolean;
  successRate: number;      // 0.0 to 1.0
  totalRequests: number;
  successCount: number;
  failureCount: number;
  disabledUntil: Date | null;  // When it will be re-enabled
}
```

### 2. Gateway Health Service - The Circuit Breaker

**File:** `src/gateway/gateway-health.service.ts`

This service implements a **circuit breaker pattern** to protect against failing gateways.

**In-Memory Data Structures:**

```typescript
@Injectable()
export class GatewayHealthService {
  // Stores transaction history per gateway
  // Key: gateway name, Value: array of {timestamp, success}
  private gatewayTransactions: Map<string, TransactionRecord[]> = new Map();
  
  // Tracks disabled gateways
  // Key: gateway name, Value: Date when it can be re-enabled
  private disabledGateways: Map<string, Date> = new Map();
}
```

**How Recording Works:**

```typescript
recordTransaction(gateway: string, success: boolean): void {
  // 1. Add record to the gateway's history
  const transactions = this.gatewayTransactions.get(gateway) || [];
  transactions.push({
    timestamp: new Date(),
    success,
  });
  
  // 2. If it was a failure, check if gateway should be disabled
  if (!success) {
    this.checkAndUpdateHealth(gateway);
  }
}
```

**Health Check Algorithm:**

```typescript
private checkAndUpdateHealth(gateway: string): void {
  const stats = this.getGatewayStats(gateway);  // Get stats for last 15 mins
  
  // Need minimum 5 requests to make a decision
  if (stats.totalRequests < MIN_REQUESTS_FOR_HEALTH_CHECK) {
    return;  // Too few requests, can't judge
  }
  
  const successRate = stats.successCount / stats.totalRequests;
  
  // If success rate < 90%, disable the gateway
  if (successRate < SUCCESS_RATE_THRESHOLD) {
    const disabledUntil = new Date(Date.now() + 30 * 60 * 1000);  // 30 mins
    this.disabledGateways.set(gateway, disabledUntil);
  }
}
```

**Example Scenario:**

```
Time 10:00 - Razorpay transaction SUCCESS
Time 10:01 - Razorpay transaction SUCCESS
Time 10:02 - Razorpay transaction FAILURE
Time 10:03 - Razorpay transaction FAILURE
Time 10:04 - Razorpay transaction FAILURE

Stats: 5 requests, 2 success, 3 failure
Success Rate: 2/5 = 40%
Threshold: 90%
Result: 40% < 90% → DISABLE Razorpay until 10:34

From 10:04 to 10:34:
- All traffic goes to PayU (60%) and Cashfree (40%)
- Their weights are redistributed: PayU 30/(30+20) = 60%, Cashfree 20/(30+20) = 40%
```

### 3. Gateway Service - The Router

**File:** `src/gateway/gateway.service.ts`

This service decides which gateway to use for each transaction.

**Weighted Random Selection Algorithm:**

```typescript
selectGateway(): GatewaySelectionResult {
  // Step 1: Get only healthy gateways
  const healthyGateways = this.getHealthyGatewayConfigs();
  // Example: If Razorpay is disabled, returns [PayU(30), Cashfree(20)]
  
  if (healthyGateways.length === 0) {
    throw new Error('No healthy payment gateways available');
  }
  
  // Step 2: Calculate total weight of healthy gateways
  const totalWeight = healthyGateways.reduce((sum, g) => sum + g.weight, 0);
  // Example: 30 + 20 = 50
  
  // Step 3: Generate random number between 0 and totalWeight
  const random = Math.random() * totalWeight;
  // Example: random = 35
  
  // Step 4: Find which gateway the random number falls into
  let cumulativeWeight = 0;
  for (const gateway of healthyGateways) {
    cumulativeWeight += gateway.weight;
    if (random <= cumulativeWeight) {
      return { gateway: gateway.name, reason: '...' };
    }
  }
  
  // Step 4 visualization for random=35:
  // PayU: cumulative = 0 + 30 = 30, is 35 <= 30? NO
  // Cashfree: cumulative = 30 + 20 = 50, is 35 <= 50? YES → Select Cashfree
}
```

**Visual Representation of Weighted Selection:**

```
All Gateways Healthy:
|-------- Razorpay (50%) --------|---- PayU (30%) ----|-- Cashfree (20%) --|
0                                50                   80                  100

Random = 25 → Razorpay
Random = 60 → PayU
Random = 90 → Cashfree

When Razorpay is Disabled:
|---------- PayU (60%) ----------|---- Cashfree (40%) ----|
0                                60                      100

Random = 40 → PayU
Random = 80 → Cashfree
```

---

## Transactions Module - The Heart

The Transactions module handles the lifecycle of payment transactions.

### 1. Transaction Types & DTOs

**File:** `src/transactions/types/transaction.types.ts`

```typescript
export enum TransactionStatus {
  PENDING = 'pending',     // Just created, waiting for callback
  SUCCESS = 'success',     // Payment successful
  FAILURE = 'failure',     // Payment failed
}

export interface Transaction {
  id: string;                    // UUID
  order_id: string;              // Merchant's order ID
  amount: number;
  currency: string;
  status: TransactionStatus;
  gateway: string;               // Which gateway was selected
  gateway_selection_reason: string;
  payment_instrument: PaymentInstrument;
  failure_reason?: string;       // Only if status = failure
  created_at: Date;
  updated_at: Date;
}
```

**DTOs with Validation:**

```typescript
// src/transactions/dto/initiate-transaction.dto.ts
export class InitiateTransactionDto {
  @IsString({ message: 'order_id must be a string' })
  @IsNotEmpty({ message: 'order_id is required' })
  order_id: string;

  @IsNumber({}, { message: 'amount must be a valid number' })
  @Min(0.01, { message: 'amount must be at least 0.01' })
  amount: number;

  @ValidateNested()
  @Type(() => PaymentInstrumentDto)
  payment_instrument: PaymentInstrumentDto;
}

// If validation fails, user gets:
{
  "statusCode": 400,
  "message": ["amount must be at least 0.01"],
  "error": "Bad Request"
}
```

### 2. Transaction Service - Business Logic

**File:** `src/transactions/transactions.service.ts`

**In-Memory Storage:**

```typescript
@Injectable()
export class TransactionsService {
  // Primary storage: transaction_id → Transaction
  private transactions: Map<string, Transaction> = new Map();
  
  // Index for fast lookup: order_id → transaction_id
  private orderToTransaction: Map<string, string> = new Map();
}
```

**Initiate Transaction Flow:**

```typescript
async initiateTransaction(dto: InitiateTransactionDto): Promise<Transaction> {
  // Step 1: Check for duplicate orders
  if (this.orderToTransaction.has(dto.order_id)) {
    const existingTxn = this.transactions.get(existingTxnId);
    if (existingTxn?.status === TransactionStatus.PENDING) {
      throw new BadRequestException('Transaction already initiated...');
    }
  }
  
  // Step 2: Select gateway (calls GatewayService)
  const gatewaySelection = this.gatewayService.selectGateway();
  // Returns: { gateway: 'razorpay', reason: 'Selected via weighted routing...' }
  
  // Step 3: Create transaction
  const transaction: Transaction = {
    id: crypto.randomUUID(),
    order_id: dto.order_id,
    amount: dto.amount,
    status: TransactionStatus.PENDING,
    gateway: gatewaySelection.gateway,
    gateway_selection_reason: gatewaySelection.reason,
    payment_instrument: this.sanitizePaymentInstrument(dto.payment_instrument),
    created_at: new Date(),
    updated_at: new Date(),
  };
  
  // Step 4: Store transaction
  this.transactions.set(transaction.id, transaction);
  this.orderToTransaction.set(dto.order_id, transaction.id);
  
  return transaction;
}
```

**PII Sanitization:**

```typescript
private sanitizePaymentInstrument(instrument: PaymentInstrument): PaymentInstrument {
  const sanitized = { ...instrument };
  
  // Mask card number: 4111111111111111 → ****1111
  if (sanitized.card_number) {
    sanitized.card_number = '****' + sanitized.card_number.slice(-4);
  }
  
  // Remove CVV completely - never store it
  delete sanitized.cvv;
  
  return sanitized;
}
```

**Callback Processing Flow:**

```typescript
async processCallback(dto: CallbackDto): Promise<Transaction> {
  // Step 1: Find the transaction
  const transactionId = this.orderToTransaction.get(dto.order_id);
  if (!transactionId) {
    throw new NotFoundException('Transaction not found...');
  }
  
  const transaction = this.transactions.get(transactionId);
  
  // Step 2: Validate gateway matches (security check)
  if (transaction.gateway !== dto.gateway) {
    throw new BadRequestException('Gateway mismatch...');
    // Prevents spoofed callbacks from wrong gateway
  }
  
  // Step 3: Ensure transaction is still pending
  if (transaction.status !== TransactionStatus.PENDING) {
    throw new BadRequestException('Transaction already processed...');
  }
  
  // Step 4: Update transaction status
  const isSuccess = dto.status === CallbackStatus.SUCCESS;
  transaction.status = isSuccess ? TransactionStatus.SUCCESS : TransactionStatus.FAILURE;
  transaction.updated_at = new Date();
  
  if (!isSuccess && dto.reason) {
    transaction.failure_reason = dto.reason;
  }
  
  // Step 5: Feed health metrics to Gateway Health Service
  this.gatewayService.recordTransactionResult(dto.gateway, isSuccess);
  // This is the FEEDBACK LOOP that enables health monitoring!
  
  return transaction;
}
```

---

## Health Module - The Pulse

Simple module for system health checks.

**File:** `src/health/health.controller.ts`

```typescript
@Controller()
export class HealthController {
  @Get()
  getRoot() {
    return {
      name: 'Payment Gateway Router',
      version: '1.0.0',
      endpoints: {
        initiate: 'POST /transactions/initiate',
        callback: 'POST /transactions/callback',
        gateways: 'GET /gateways',
        health: 'GET /health',
      },
    };
  }

  @Get('health')
  healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
      },
    };
  }
}
```

---

## Data Flow & Interactions

### Complete Transaction Flow Diagram

```
┌──────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  Client  │────►│TransactionsController│────►│ TransactionsService │
└──────────┘     └─────────────────────┘     └──────────┬──────────┘
                                                        │
                  POST /transactions/initiate           │ selectGateway()
                  {order_id, amount, payment_instrument}│
                                                        ▼
                                              ┌─────────────────────┐
                                              │   GatewayService    │
                                              └──────────┬──────────┘
                                                         │
                                    getHealthyGateways() │
                                                         ▼
                                              ┌─────────────────────┐
                                              │GatewayHealthService │
                                              │                     │
                                              │ gatewayTransactions │◄─── Records from
                                              │ disabledGateways    │     previous callbacks
                                              └─────────────────────┘
                                                         │
                          Returns ['razorpay', 'payu', 'cashfree'] (all healthy)
                          or ['payu', 'cashfree'] (if razorpay unhealthy)
                                                         │
                                                         ▼
                                              ┌─────────────────────┐
                                              │   GatewayService    │
                                              │                     │
                                              │ Weighted Selection  │
                                              │ random=45 → razorpay│
                                              └──────────┬──────────┘
                                                         │
                                    {gateway: 'razorpay', reason: '...'}
                                                         │
                                                         ▼
                                              ┌─────────────────────┐
                                              │ TransactionsService │
                                              │                     │
                                              │ Creates Transaction │
                                              │ status: PENDING     │
                                              │ gateway: razorpay   │
                                              └──────────┬──────────┘
                                                         │
                                                         ▼
                                              ┌──────────────────────┐
                                              │Response to Client    │
                                              │{                     │
                                              │  transaction_id: xxx │
                                              │  gateway: razorpay   │
                                              │  status: pending     │
                                              │}                     │
                                              └──────────────────────┘
```

### Callback Flow (Feedback Loop)

```
┌──────────────────┐
│ Payment Gateway  │  (Razorpay sends callback after payment)
│   (Razorpay)     │
└────────┬─────────┘
         │
         │ POST /transactions/callback
         │ {order_id: "ORD123", status: "success", gateway: "razorpay"}
         ▼
┌─────────────────────┐     ┌─────────────────────┐
│TransactionsController│────►│ TransactionsService │
└─────────────────────┘     └──────────┬──────────┘
                                       │
                            1. Find transaction
                            2. Validate gateway matches
                            3. Update status to SUCCESS
                            4. Record result
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │   GatewayService    │
                            │recordTransactionResult()
                            └──────────┬──────────┘
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │GatewayHealthService │
                            │recordTransaction()   │
                            │                     │
                            │ Adds to history:    │
                            │ razorpay: [{        │
                            │   timestamp: now,   │
                            │   success: true     │
                            │ }]                  │
                            └─────────────────────┘

This record will influence FUTURE gateway selections!
```

---

## Request Lifecycle Examples

### Example 1: Normal Transaction Flow

```bash
# Step 1: Initiate Transaction
curl -X POST http://localhost:3000/transactions/initiate \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "ORD-001",
    "amount": 999.00,
    "payment_instrument": {
      "type": "card",
      "card_number": "4111111111111111",
      "expiry": "12/25"
    }
  }'
```

**Internal Flow:**
```
1. TransactionsController receives request
2. ValidationPipe validates DTO
3. TransactionsService.initiateTransaction() called
4. Checks: Is ORD-001 already used? → No
5. GatewayService.selectGateway() called
6. GatewayHealthService.getHealthyGateways() → ['razorpay', 'payu', 'cashfree']
7. Weighted selection: random=35 → razorpay (0-50 range)
8. Transaction created: {id: 'abc-123', status: 'pending', gateway: 'razorpay'}
9. Stored in memory maps
10. Response returned
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transaction_id": "abc-123",
    "order_id": "ORD-001",
    "amount": 999,
    "status": "pending",
    "gateway": "razorpay",
    "gateway_selection_reason": "Selected razorpay via weighted routing (50.0% probability)"
  }
}
```

```bash
# Step 2: Gateway Callback (success)
curl -X POST http://localhost:3000/transactions/callback \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "ORD-001",
    "status": "success",
    "gateway": "razorpay"
  }'
```

**Internal Flow:**
```
1. TransactionsController receives callback
2. TransactionsService.processCallback() called
3. Finds transaction by order_id → abc-123
4. Validates: gateway matches? razorpay === razorpay → Yes
5. Validates: status is pending? → Yes
6. Updates: status = 'success', updated_at = now
7. Records: GatewayHealthService.recordTransaction('razorpay', true)
8. Health history updated: razorpay has 1 success
9. Response returned
```

### Example 2: Gateway Gets Disabled

```bash
# Simulate 5 failed transactions for Razorpay
for i in {1..5}; do
  # Initiate
  curl -X POST http://localhost:3000/transactions/initiate \
    -d '{"order_id": "FAIL-'$i'", "amount": 100, "payment_instrument": {"type": "card"}}'
  
  # Fail callback
  curl -X POST http://localhost:3000/transactions/callback \
    -d '{"order_id": "FAIL-'$i'", "status": "failure", "gateway": "razorpay", "reason": "Declined"}'
done
```

**After 5 failures:**
```
GatewayHealthService internal state:

gatewayTransactions = {
  'razorpay': [
    {timestamp: 10:00:01, success: false},
    {timestamp: 10:00:02, success: false},
    {timestamp: 10:00:03, success: false},
    {timestamp: 10:00:04, success: false},
    {timestamp: 10:00:05, success: false},
  ],
  'payu': [],
  'cashfree': []
}

On 5th failure:
- totalRequests = 5 (meets MIN_REQUESTS_FOR_HEALTH_CHECK)
- successCount = 0
- successRate = 0/5 = 0%
- 0% < 90% threshold → DISABLE

disabledGateways = {
  'razorpay': Date('2024-01-05T10:30:05')  // 30 mins from now
}
```

```bash
# Now check gateway status
curl http://localhost:3000/gateways
```

**Response:**
```json
{
  "gateways": [
    {
      "name": "razorpay",
      "weight": 50,
      "enabled": true,
      "health": {
        "isHealthy": false,
        "successRate": 0,
        "totalRequests": 5,
        "failureCount": 5,
        "disabledUntil": "2024-01-05T10:30:05.000Z"
      }
    },
    {
      "name": "payu",
      "weight": 30,
      "enabled": true,
      "health": {
        "isHealthy": true,
        "successRate": 1,
        "totalRequests": 0
      }
    },
    {
      "name": "cashfree",
      "weight": 20,
      "enabled": true,
      "health": {
        "isHealthy": true,
        "successRate": 1,
        "totalRequests": 0
      }
    }
  ]
}
```

```bash
# New transaction - Razorpay excluded!
curl -X POST http://localhost:3000/transactions/initiate \
  -d '{"order_id": "ORD-NEW", "amount": 500, "payment_instrument": {"type": "card"}}'
```

**Response:**
```json
{
  "data": {
    "gateway": "payu",  // or cashfree - Razorpay is excluded!
    "gateway_selection_reason": "Selected payu via weighted routing (60.0% probability). Excluded unhealthy gateways: razorpay"
  }
}
```

---

## Configuration & Constants

### Modifying Gateway Weights

Edit `src/gateway/types/gateway.types.ts`:

```typescript
export const GATEWAY_CONFIG: GatewayConfig[] = [
  { name: 'razorpay', weight: 40, enabled: true },  // Changed from 50
  { name: 'payu', weight: 40, enabled: true },      // Changed from 30
  { name: 'cashfree', weight: 20, enabled: true },  // Same
];
```

### Adjusting Health Thresholds

```typescript
// More lenient - allow 80% success rate
export const SUCCESS_RATE_THRESHOLD = 0.8;

// Shorter cooldown - re-enable after 15 mins
export const UNHEALTHY_COOLDOWN_MINUTES = 15;

// Longer evaluation window - look at last 30 mins
export const HEALTH_CHECK_WINDOW_MINUTES = 30;

// Require more data before judging - need 10 requests
export const MIN_REQUESTS_FOR_HEALTH_CHECK = 10;
```

### Adding a New Gateway

```typescript
export const GATEWAY_CONFIG: GatewayConfig[] = [
  { name: 'razorpay', weight: 40, enabled: true },
  { name: 'payu', weight: 25, enabled: true },
  { name: 'cashfree', weight: 20, enabled: true },
  { name: 'stripe', weight: 15, enabled: true },  // New gateway!
];
```

No other code changes needed - the system automatically:
- Initializes health tracking for 'stripe'
- Includes it in weighted selection
- Monitors its health

---

## Summary

| Component | Responsibility |
|-----------|---------------|
| `GatewayHealthService` | Track transaction outcomes, detect unhealthy gateways, manage cooldowns |
| `GatewayService` | Select gateway using weighted random algorithm, filter unhealthy gateways |
| `TransactionsService` | Create transactions, process callbacks, feed health metrics |
| `TransactionsController` | HTTP endpoints for initiate/callback |
| `GatewayController` | Admin endpoints for viewing/managing gateway health |

**Key Interactions:**
1. `TransactionsService` → `GatewayService` (get gateway for new transaction)
2. `GatewayService` → `GatewayHealthService` (get healthy gateways)
3. `TransactionsService` → `GatewayService` → `GatewayHealthService` (record callback result)

**The Feedback Loop:**
```
Transaction Created → Gateway Selected → Callback Received → Health Updated → Future Selections Affected
```

