// Foreground-resume trigger for Marmot subscriptions that have no per-route
// AppState handling of their own (the merged group REQ). Group MLS ingest is
// non-urgent work: DM wraps re-arm immediately, this follows the app's
// three-second resume stagger (#554) and is cancelled by backgrounding again.
import { AppState } from 'react-native';

export const MARMOT_RESUME_DELAY_MS = 3_000;

export function watchMarmotResume(onResume: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const stateSub = AppState.addEventListener('change', (state) => {
    clear();
    if (state !== 'active') return;
    timer = setTimeout(() => {
      timer = null;
      onResume();
    }, MARMOT_RESUME_DELAY_MS);
  });
  return () => {
    clear();
    stateSub.remove();
  };
}
