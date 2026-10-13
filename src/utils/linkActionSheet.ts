import {
  Alert,
  type BrandedAlertButton,
  type BrandedAlertOptions,
} from '../components/BrandedAlert';

export interface LinkActionPrompt {
  title: string;
  message: string;
  buttons: BrandedAlertButton[];
  options: BrandedAlertOptions;
}
let listener: ((prompt: LinkActionPrompt) => void) | null = null;

export function registerLinkActionSheet(next: (prompt: LinkActionPrompt) => void): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
}

export function showLinkActionSheet(
  title: string,
  message: string,
  buttons: BrandedAlertButton[],
  options: BrandedAlertOptions,
): void {
  if (listener) listener({ title, message, buttons, options });
  else Alert.alert(title, message, buttons, options);
}
