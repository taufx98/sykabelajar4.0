import { deliverAuthEmail } from "./email-delivery.mjs";
import type { AuthWorkerEnv } from "./env";

type AuthEmailMessage = {
  to: string;
  subject: string;
  text: string;
  action: "verify-email" | "reset-password";
};

export async function sendAuthEmail(
  env: AuthWorkerEnv,
  message: AuthEmailMessage,
): Promise<void> {
  await deliverAuthEmail(env, message);
}
