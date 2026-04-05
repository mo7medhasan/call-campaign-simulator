import { Campaign, IClock, CallResult, CampaignConfig } from "./src";

// 1. Real-Time Clock for Demo
class RealTimeClock implements IClock {
  now(): number {
    return Date.now();
  }
  setTimeout(callback: () => void, delayMs: number): number {
    // Use Node.js setTimeout and cast to number
    return setTimeout(callback, delayMs) as unknown as number;
  }
  clearTimeout(id: number): void {
    clearTimeout(id);
  }
}

// 2. Fake Call Handler
const mockCallHandler = async (phoneNumber: string): Promise<CallResult> => {
  console.log(`📞 Dialing ${phoneNumber}...`);

  return new Promise((resolve) => {
    // Simulate call duration (1 real second represents 1 minute in system)
    setTimeout(() => {
      // 70% chance of call succeeding
      const isAnswered = Math.random() > 0.3;

      console.log(`[Call End] ${phoneNumber} - Answered: ${isAnswered}`);

      resolve({
        answered: isAnswered,
        durationMs: 60000, // default call duration is 1 minute
      });
    }, 1000);
  });
};

// 3. Campaign Config
const config: CampaignConfig = {
  customerList: [
    "+1234567890",
    "+0987654321",
    "+1112223334",
    "+5556667778",
    "+9998887776",
  ],
  startTime: "00:00", // Starts at midnight to work anytime for demo
  endTime: "23:59", // Ends 1 minute before midnight
  maxConcurrentCalls: 2, // 2 concurrent calls
  maxDailyMinutes: 10,
  maxRetries: 1,
  retryDelayMs: 3000, // Retry after 3 seconds to speed up demo
  timezone: "UTC",
};

// 4. Run the Campaign
async function runDemo() {
  console.log("🚀 Starting Campaign Simulator Demo...\n");

  const clock = new RealTimeClock();
  const campaign = new Campaign(config, mockCallHandler, clock);

  campaign.start();

  // Print status every 2 seconds to monitor progress
  const statusInterval = setInterval(() => {
    const status = campaign.getStatus();
    console.log("\n📊 Current Status:", status);

    if (status.state === "completed") {
      console.log("\n✅ Campaign Finished Successfully!");
      clearInterval(statusInterval);
      process.exit(0);
    }
  }, 2000);
}

runDemo();
