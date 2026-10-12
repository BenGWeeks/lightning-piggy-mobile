import React, { memo, Suspense, useEffect } from 'react';
import { ActivityIndicator, InteractionManager } from 'react-native';
import type AddWalletWizard from './AddWalletWizard';

type WizardModule = { default: typeof AddWalletWizard };
let pending: Promise<WizardModule> | undefined;

// Share the idle prefetch and first-open request. Prefetch evaluates modules,
// but never mounts the wizard or asks for camera permissions.
function loadWizard(): Promise<WizardModule> {
  pending ??= import('./AddWalletWizard').catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}

const Wizard = React.lazy(loadWizard);

// The global withdraw host owns this warm-up, even when Home isn't the route.
// Give startup hydration time to settle, then wait for gestures/animations.
export function usePrefetchAddWalletWizard(): void {
  useEffect(() => {
    let task: ReturnType<typeof InteractionManager.runAfterInteractions> | undefined;
    const timer = setTimeout(() => {
      task = InteractionManager.runAfterInteractions(() => {
        void loadWizard().catch(() => {
          // First open can retry a failed speculative import.
        });
      });
    }, 3000);
    return () => {
      clearTimeout(timer);
      task?.cancel();
    };
  }, []);
}

// Hosts mount once on first use and keep this boundary mounted on close, so
// loading and in-flight wallet work survive dismissal. No whole-screen fallback.
function LazyAddWalletWizard(props: React.ComponentProps<typeof AddWalletWizard>) {
  return (
    <Suspense fallback={props.visible ? <ActivityIndicator /> : null}>
      <Wizard {...props} />
    </Suspense>
  );
}

export default memo(LazyAddWalletWizard);
