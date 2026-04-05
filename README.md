# Call Campaign Simulator

A robust, configurable TypeScript engine for managing and simulating automated phone call campaigns. Designed with architecture best practices, it features abstracted time handling, concurrency controls, daily limits, and smart retry logic.

## Features

- **Concurrency Management:** Dictates the maximum number of simultaneous active calls (`maxConcurrentCalls`).
- **Time/Window Restrictions:** Configurable working hours (`startTime` and `endTime`) and active timezone support powered by Luxon.
- **Daily Budget Limits:** Caps the maximum number of total call minutes used per calendar day (`maxDailyMinutes`).
- **Retry Logic:** Automatic rescheduling of failed or unanswered calls with configurable retry delays and maximum attempt limits.
- **Time Abstraction (`IClock`):** A fully decoupled time-handling system. This enforces that the system has no hard dependency on Native Node timers, allowing for high-speed simulation in testing or steady execution through real-time clocks.
- **Predictable Queuing:** Smartly processes pending numbers, prioritizing due retries before pulling new numbers out of the queue.

## Installation

1. Make sure you have [Node.js](https://nodejs.org/) installed.
2. Install the necessary dependencies:

   ```bash
   npm install
   ```

## Usage

### Running the Demo

A working demonstration is provided in `demo.ts`. It utilizes a simulated network call handler and a Real-Time implementation of `IClock`.

To start the demo:
```bash
npm start
```
*Note: The demo configuration uses a short retry delay to speed things up for demonstration purposes.*

### Basic Integration

```typescript
import { Campaign, IClock, CallResult, CampaignConfig } from "./src";

// 1. Define configuration
const config: CampaignConfig = {
  customerList: ["+1234567890", "+0987654321"],
  startTime: "09:00",
  endTime: "17:00",
  maxConcurrentCalls: 2,
  maxDailyMinutes: 60,
  maxRetries: 2,
  retryDelayMs: 3600000, // 1 hour
  timezone: "America/New_York",
};

// 2. Implement your IClock and CallHandler definitions
// (See demo.ts for a basic RealTimeClock and mockCallHandler implementation)

// 3. Initialize and Start Campaign
const campaign = new Campaign(config, mockCallHandler, clock);
campaign.start();

// Optionally, you can grab the engine's status at any time:
const status = campaign.getStatus();
console.log(status);
```

### API Reference

Once instantiated, the `Campaign` class exposes the following methods to control the engine:

- `campaign.start()`: Begins the core engine block. It will immediately begin verifying constraints (working hours, caps) and dialing phone numbers.
- `campaign.pause()`: Halts new calls from being dispatched. Active calls evaluate normally, but no further numbers will be called until resumed.
- `campaign.resume()`: Resumes the engine loop from a paused state.
- `campaign.getStatus()`: A synchronous method returning the live state of the simulator:
  - `state`: Current engine state (`"idle"`, `"running"`, `"paused"`, or `"completed"`).
  - `totalProcessed`: Count of answers/successes.
  - `totalFailed`: Count of final failures (calls that exhausted all their permitted retries).
  - `activeCalls`: Number of connection links currently active.
  - `pendingRetries`: Count of strings waiting in the retry queue.
  - `dailyMinutesUsed`: Running count of minutes logged for the current calendar day.

### Implementing Dependencies (Injections)

To initialize new implementations of the campaign, you'll need to define how calls resolve and how time moves.

**1. CallHandler**
An async function returning a `CallResult`. This is where you would hook your HTTP requests to your telephony API:
```typescript
const mockCallHandler = async (phoneNumber: string): Promise<CallResult> => {
  // .. Execute Twilio / phone API
  return {
    answered: true, // or false
    durationMs: 60 * 1000, 
  };
};
```

**2. IClock Interface**
A timing interface resolving time in milliseconds. Implement this cleanly to inject custom system timers:
```typescript
class MyClock implements IClock {
  now(): number { return Date.now(); }
  setTimeout(cb: () => void, ms: number): number { 
      // Handle native typing correctly
      return setTimeout(cb, ms) as unknown as number; 
  }
  clearTimeout(id: number): void { clearTimeout(id); }
}
```

## Architecture

- `src/interfaces.ts`: The required contract and definitions for the simulator (including `ICampaign` and `IClock`).
- `src/solution.ts`: The core engine implementation (`Campaign` class). Manages system state, tracks parallel processes up to the threshold limit, ensures working hour restraints, and resolves timeouts.
- `demo.ts`: An executable integration demonstrating configuration, custom clock injection, intervals, and a graceful script process rundown.

## Simulation & Extensibility

Because the system relies entirely on the injected `IClock` instance to track passing hours and dates, the campaign logic can be intensely simulated without actually waiting for real hours to pass. By injecting a "Fake/Virtual Clock", QA testing and simulation scenarios can warp time forward to safely verify daily minute resets and retry accuracy predictably.
