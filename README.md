# Payment Gateway Router

A dynamic payment gateway routing service built with NestJS that intelligently routes transactions across multiple payment gateways (Razorpay, PayU, Cashfree) based on load distribution and real-time health monitoring.

## Features

- **Weighted Load Distribution**: Routes transactions based on configurable percentage weights
- **Real-time Health Monitoring**: Automatically disables unhealthy gateways based on success rate
- **Automatic Recovery**: Re-enables gateways after cooldown period
- **Transaction Management**: Full lifecycle management with status tracking
- **Structured Logging**: Pino-based logging with PII masking
- **REST API**: Clean, well-documented API endpoints

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Payment Gateway Router                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │  Transaction │────│   Gateway    │────│   Gateway    │       │
│  │   Service    │    │   Service    │    │    Health    │       │
│  └──────────────┘    └──────────────┘    │   Service    │       │
│                              │           └──────────────┘       │
│                              │                                   │
│                    ┌─────────┴─────────┐                        │
│                    │  Weighted Router  │                        │
│                    └─────────┬─────────┘                        │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐             │
│         │                    │                    │             │
│   ┌─────┴─────┐       ┌─────┴─────┐       ┌─────┴─────┐        │
│   │ Razorpay  │       │   PayU    │       │ Cashfree  │        │
│   │   (50%)   │       │   (30%)   │       │   (20%)   │        │
│   └───────────┘       └───────────┘       └───────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Gateway Routing Logic

1. **Weighted Selection**: Gateways are selected based on configured weights (Razorpay: 50%, PayU: 30%, Cashfree: 20%)
2. **Health Filtering**: Only healthy gateways are considered for selection
3. **Weight Redistribution**: When a gateway is unhealthy, its weight is redistributed proportionally

## Health Monitoring

- **Success Rate Threshold**: 90% (configurable)
- **Monitoring Window**: Last 15 minutes
- **Cooldown Period**: 30 minutes when disabled
- **Minimum Requests**: 5 requests required before health check applies

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run start:dev

# Start production server
npm run start:prod
```

### Using Docker

```bash
# Build image
docker build -t payment-gateway-router .

# Run container
docker run -p 3000:3000 payment-gateway-router
```

## API Documentation

### 1. Initiate Transaction

Creates a new payment transaction and selects the optimal gateway.

**Endpoint:** `POST /transactions/initiate`

**Request:**
```json
{
  "order_id": "ORD123",
  "amount": 499.0,
  "currency": "INR",
  "payment_instrument": {
    "type": "card",
    "card_number": "4111111111111111",
    "expiry": "12/25"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Transaction initiated successfully",
  "data": {
    "transaction_id": "uuid-here",
    "order_id": "ORD123",
    "amount": 499.0,
    "currency": "INR",
    "status": "pending",
    "gateway": "razorpay",
    "gateway_selection_reason": "Selected razorpay via weighted routing (50.0% effective probability)",
    "created_at": "2024-01-05T10:00:00.000Z"
  }
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/transactions/initiate \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "ORD123",
    "amount": 499.0,
    "payment_instrument": {
      "type": "card",
      "card_number": "4111111111111111",
      "expiry": "12/25"
    }
  }'
```

### 2. Transaction Callback

Updates transaction status after payment gateway response.

**Endpoint:** `POST /transactions/callback`

**Request (Success):**
```json
{
  "order_id": "ORD123",
  "status": "success",
  "gateway": "razorpay"
}
```

**Request (Failure):**
```json
{
  "order_id": "ORD123",
  "status": "failure",
  "gateway": "razorpay",
  "reason": "Customer Cancelled"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Transaction completed",
  "data": {
    "transaction_id": "uuid-here",
    "order_id": "ORD123",
    "status": "success",
    "gateway": "razorpay",
    "updated_at": "2024-01-05T10:01:00.000Z"
  }
}
```

**cURL Examples:**
```bash
# Success callback
curl -X POST http://localhost:3000/transactions/callback \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "ORD123",
    "status": "success",
    "gateway": "razorpay"
  }'

# Failure callback
curl -X POST http://localhost:3000/transactions/callback \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "ORD123",
    "status": "failure",
    "gateway": "razorpay",
    "reason": "Customer Cancelled"
  }'
```

### 3. Get Gateway Status

**Endpoint:** `GET /gateways`

**Response:**
```json
{
  "gateways": [
    {
      "name": "razorpay",
      "weight": 50,
      "enabled": true,
      "health": {
        "name": "razorpay",
        "isHealthy": true,
        "successRate": 0.95,
        "totalRequests": 100,
        "successCount": 95,
        "failureCount": 5,
        "disabledUntil": null
      }
    }
  ]
}
```

**cURL Example:**
```bash
curl http://localhost:3000/gateways
```

### 4. Get Transaction

**Endpoint:** `GET /transactions/:id`

**cURL Example:**
```bash
curl http://localhost:3000/transactions/uuid-here
```

### 5. Get Transaction by Order ID

**Endpoint:** `GET /transactions/order/:orderId`

**cURL Example:**
```bash
curl http://localhost:3000/transactions/order/ORD123
```

### 6. Get All Transactions

**Endpoint:** `GET /transactions`

**cURL Example:**
```bash
curl http://localhost:3000/transactions
```

### 7. Get Transaction Statistics

**Endpoint:** `GET /transactions/stats/summary`

**cURL Example:**
```bash
curl http://localhost:3000/transactions/stats/summary
```

### 8. Health Check

**Endpoint:** `GET /health`

**cURL Example:**
```bash
curl http://localhost:3000/health
```

### Admin Endpoints

```bash
# Manually disable a gateway
curl -X POST http://localhost:3000/gateways/razorpay/disable \
  -H "Content-Type: application/json" \
  -d '{"minutes": 30}'

# Manually enable a gateway
curl -X POST http://localhost:3000/gateways/razorpay/enable

# Reset all gateway stats
curl -X POST http://localhost:3000/gateways/reset

# Clear all transactions
curl -X POST http://localhost:3000/transactions/reset
```

## Testing

```bash
# Run unit tests
npm run test

# Run unit tests with coverage
npm run test:cov

# Run e2e tests
npm run test:e2e

# Run tests in watch mode
npm run test:watch
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment mode |
| `LOG_LEVEL` | info | Logging level |

### Gateway Configuration

Edit `src/gateway/types/gateway.types.ts` to modify:

```typescript
export const GATEWAY_CONFIG: GatewayConfig[] = [
  { name: 'razorpay', weight: 50, enabled: true },
  { name: 'payu', weight: 30, enabled: true },
  { name: 'cashfree', weight: 20, enabled: true },
];

export const HEALTH_CHECK_WINDOW_MINUTES = 15;
export const UNHEALTHY_COOLDOWN_MINUTES = 30;
export const SUCCESS_RATE_THRESHOLD = 0.9;
export const MIN_REQUESTS_FOR_HEALTH_CHECK = 5;
```
