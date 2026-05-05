import { Queue } from "bullmq";
import { createRedisConnection } from "@/lib/redis";

export const QUEUE_NAMES = {
  REMINDER: "reminder",
  ESCALATION: "escalation",
  EMAIL: "channel-email",
  TEAMS: "channel-teams",
  TELEGRAM: "channel-telegram",
  WEBHOOK_PROCESSOR: "webhook-processor",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const queueConnection = isBuildPhase
  ? null
  : createRedisConnection("bullmq:queue");

function makeBuildStubQueue(name: string) {
  return {
    add: async () => {
      console.warn(
        `[queue:${name}] queue.add was called during build phase and was skipped`
      );
      return null as any;
    },
  } as unknown as Queue;
}

function makeQueue(name: string) {
  if (isBuildPhase || !queueConnection) {
    return makeBuildStubQueue(name);
  }
  return new Queue(name, {
    connection: queueConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
}

export const reminderQueue = makeQueue(QUEUE_NAMES.REMINDER);
export const escalationQueue = makeQueue(QUEUE_NAMES.ESCALATION);
export const emailQueue = makeQueue(QUEUE_NAMES.EMAIL);
export const teamsQueue = makeQueue(QUEUE_NAMES.TEAMS);
export const telegramQueue = makeQueue(QUEUE_NAMES.TELEGRAM);
export const webhookProcessorQueue = makeQueue(QUEUE_NAMES.WEBHOOK_PROCESSOR);
