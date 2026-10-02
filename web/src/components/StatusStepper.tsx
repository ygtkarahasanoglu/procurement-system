const STEPS = [
  "Request created",
  "Sourcing event open",
  "Quotes available",
  "Recommendation generated",
  "Human decision formed",
  "Decision frozen",
  "Approval granted",
  "PO created",
] as const;

// Purely for usability (brief section 13: "UI state is for usability
// only"). This component makes no decision and blocks nothing — every
// action button's enabled/disabled state is computed independently in
// WorkflowPage from the same backend-returned data, and even if this
// component were wrong, the backend would still reject any invalid
// action.
export function StatusStepper({ currentStep }: { currentStep: number }) {
  return (
    <ol className="stepper">
      {STEPS.map((label, i) => {
        const stepNumber = i + 1;
        const state = stepNumber < currentStep ? "done" : stepNumber === currentStep ? "current" : "pending";
        return (
          <li key={label} className={`stepper__step stepper__step--${state}`}>
            <span className="stepper__index">{stepNumber}</span>
            <span className="stepper__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
