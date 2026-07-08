import { describeMissingInputs } from '../../utils/dealInputPreflight';
import { ErrorState } from '../../design-system';

export default function MissingInputsCard({ missing, panelLabel, onEditInputs }) {
  const fields = describeMissingInputs(missing);
  return (
    <ErrorState
      tone="warn"
      title={panelLabel ? `${panelLabel} is waiting on inputs` : 'Waiting on inputs'}
      action={
        onEditInputs && (
          <button
            type="button"
            onClick={onEditInputs}
            className="text-xs font-medium text-premium hover:underline underline underline-offset-2"
          >
            Edit financial inputs
          </button>
        )
      }
    >
      Enter {fields} to unlock scenarios.
    </ErrorState>
  );
}
