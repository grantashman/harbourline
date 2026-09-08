export type FirstPaydayStep = "income" | "commitments" | "payday";

export interface FirstPaydayProgressInput {
  hasIncome: boolean;
  commitmentCount: number;
  minimumCommitments?: number;
  paydayConfirmed?: boolean;
}

export interface FirstPaydayProgress {
  currentStep: FirstPaydayStep;
  completedSteps: number;
  totalSteps: 3;
  percent: 0 | 33 | 67 | 100;
  nextAction: string;
  nextActionDetail: string;
}

const TOTAL_STEPS = 3 as const;

export function firstPaydayProgress({
  hasIncome,
  commitmentCount,
  minimumCommitments = 3,
  paydayConfirmed = false
}: FirstPaydayProgressInput): FirstPaydayProgress {
  const threshold = Math.max(Math.floor(minimumCommitments), 1);
  const commitments = Math.max(Math.floor(commitmentCount), 0);

  if (!hasIncome) {
    return {
      currentStep: "income",
      completedSteps: 0,
      totalSteps: TOTAL_STEPS,
      percent: 0,
      nextAction: "Add income",
      nextActionDetail: "Start with the take-home amount and date of your next pay."
    };
  }

  if (commitments < threshold) {
    const remaining = threshold - commitments;
    return {
      currentStep: "commitments",
      completedSteps: 1,
      totalSteps: TOTAL_STEPS,
      percent: 33,
      nextAction: `Add ${remaining} commitment${remaining === 1 ? "" : "s"}`,
      nextActionDetail: "Add the regular costs that shape what this pay needs to cover."
    };
  }

  if (!paydayConfirmed) {
    return {
      currentStep: "payday",
      completedSteps: 2,
      totalSteps: TOTAL_STEPS,
      percent: 67,
      nextAction: "Review your payday plan",
      nextActionDetail: "Check what to set aside and what is safe to spend until the next pay."
    };
  }

  return {
    currentStep: "payday",
    completedSteps: TOTAL_STEPS,
    totalSteps: TOTAL_STEPS,
    percent: 100,
    nextAction: "Payday plan confirmed",
    nextActionDetail: "Your next pay has a clear plan. Revisit it when real spending changes."
  };
}
