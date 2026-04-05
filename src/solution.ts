import { DateTime } from 'luxon';
// Assume that ICampaign and other interfaces exist in interfaces.ts
import { 
  ICampaign, CampaignConfig, CallHandler, IClock, 
  CampaignStatus, CampaignState, CallResult 
} from './interfaces';

// Helper type to represent phone numbers to be called again
interface RetryTask {
  phoneNumber: string;
  attemptsMade: number;
  availableAtMs: number; // The time when we can retry
}

export class Campaign implements ICampaign {
  private state: CampaignState = 'idle';
  private queue: string[]; // Remaining numbers
  private retryQueue: RetryTask[] = []; // Retry queue
  
  // Track statistics
  private totalProcessed = 0;
  private totalFailed = 0;
  private activeCalls = 0;
  private dailyMinutesUsed = 0;
  
  // Track the current day to reset minutes at midnight
  private currentDayString: string = '';

  private currentTimeoutId: number | null = null;

  constructor(
    private config: CampaignConfig,
    private callHandler: CallHandler,
    private clock: IClock
  ) {
    // Copy the list to avoid modifying the original array
    this.queue = [...this.config.customerList];
  }

  public start(): void {
    if (this.state === 'idle' || this.state === 'paused') {
      this.state = 'running';
      this.tick(); // Start the core engine of the system
    }
  }

  public pause(): void {
    if (this.state === 'running') {
      this.state = 'paused';
      if (this.currentTimeoutId !== null) {
        this.clock.clearTimeout(this.currentTimeoutId);
        this.currentTimeoutId = null;
      }
    }
  }

  public resume(): void {
    this.start();
  }

  public getStatus(): CampaignStatus {
    return {
      state: this.state,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
      activeCalls: this.activeCalls,
      pendingRetries: this.retryQueue.length,
      dailyMinutesUsed: this.dailyMinutesUsed,
    };
  }

  // =========================================================
  // Core Engine
  // =========================================================
  private tick(): void {
    if (this.currentTimeoutId !== null) {
      this.clock.clearTimeout(this.currentTimeoutId);
      this.currentTimeoutId = null;
    }

    // 1. Check system state
    if (this.state !== 'running') return;

    // 2. Check if campaign has finished
    if (this.queue.length === 0 && this.retryQueue.length === 0 && this.activeCalls === 0) {
      this.state = 'completed';
      return;
    }

    // 3. Update day and reset minutes if necessary
    this.checkAndResetDailyMinutes();

    // 4. Check working hours and max minutes limit
    if (!this.canMakeCallNow()) {
      // If the time is not appropriate, schedule a new check after 1 minute (60000ms)
      this.currentTimeoutId = this.clock.setTimeout(() => this.tick(), 60000);
      return;
    }

    // 5. Try to launch new calls until we reach max concurrency limit
    while (this.activeCalls < this.config.maxConcurrentCalls) {
      const task = this.getNextTask();
      
      if (!task) {
        // No numbers are currently ready (maybe waiting for retry time)
        if (this.retryQueue.length > 0 && this.activeCalls === 0) {
           // Schedule tick when the first number in the retry queue is available
           const nextAvailable = Math.min(...this.retryQueue.map(t => t.availableAtMs));
           const delay = Math.max(0, nextAvailable - this.clock.now());
           this.currentTimeoutId = this.clock.setTimeout(() => this.tick(), delay);
        }
        break;
      }

      // Launch call asynchronously (without await so we don't block the loop)
      this.executeCall(task.phoneNumber, task.attemptsMade);
    }
  }

  // =========================================================
  // Call Execution
  // =========================================================
  private async executeCall(phoneNumber: string, attemptsMade: number): Promise<void> {
    this.activeCalls++;

    try {
      const result: CallResult = await this.callHandler(phoneNumber);
      this.dailyMinutesUsed += (result.durationMs / 60000); // Convert ms to minutes

      if (result.answered) {
        this.totalProcessed++;
      } else {
        this.handleFailedCall(phoneNumber, attemptsMade);
      }
    } catch (error) {
      // Treat any unexpected error as call failure
      this.handleFailedCall(phoneNumber, attemptsMade);
    } finally {
      this.activeCalls--;
      this.tick(); // After every call, trigger tick to check if we can make another call
    }
  }

  private handleFailedCall(phoneNumber: string, attemptsMade: number): void {
    const maxRetries = this.config.maxRetries ?? 2;
    const retryDelayMs = this.config.retryDelayMs ?? 3600000;

    if (attemptsMade < maxRetries) {
      // Add number to retry queue with its next available time
      this.retryQueue.push({
        phoneNumber,
        attemptsMade: attemptsMade + 1,
        availableAtMs: this.clock.now() + retryDelayMs,
      });
    } else {
      // Exhausted all retry attempts
      this.totalFailed++;
    }
  }

  // Fetches the next generic number from retry queue (if due) or main queue
  private getNextTask(): { phoneNumber: string; attemptsMade: number } | null {
    const now = this.clock.now();
    
    // Check the retry queue first
    const retryIndex = this.retryQueue.findIndex(t => t.availableAtMs <= now);
    if (retryIndex !== -1) {
      const task = this.retryQueue.splice(retryIndex, 1)[0];
      return { phoneNumber: task.phoneNumber, attemptsMade: task.attemptsMade };
    }

    // If nothing in retry queue, pull from main queue
    if (this.queue.length > 0) {
      return { phoneNumber: this.queue.shift()!, attemptsMade: 0 };
    }

    return null;
  }

  // =========================================================
  // Time & Timezones Logic
  // =========================================================
  private canMakeCallNow(): boolean {
    const tz = this.config.timezone || 'UTC';
    const now = DateTime.fromMillis(this.clock.now(), { zone: tz });
    
    // Check if daily minutes are exceeded
    if (this.dailyMinutesUsed >= this.config.maxDailyMinutes) {
      return false;
    }

    // Extract hours and minutes from start and end time
    const [startH, startM] = this.config.startTime.split(':').map(Number);
    const [endH, endM] = this.config.endTime.split(':').map(Number);

    const startDateTime = now.set({ hour: startH, minute: startM, second: 0, millisecond: 0 });
    const endDateTime = now.set({ hour: endH, minute: endM, second: 0, millisecond: 0 });

    // Does current time fall between start and end?
    return now >= startDateTime && now <= endDateTime;
  }

  private checkAndResetDailyMinutes(): void {
    const tz = this.config.timezone || 'UTC';
    const now = DateTime.fromMillis(this.clock.now(), { zone: tz });
    const todayString = now.toISODate(); // e.g. "2023-10-25"

    if (this.currentDayString !== todayString) {
      this.currentDayString = todayString!;
      this.dailyMinutesUsed = 0; // Reset minutes at midnight
    }
  }
}